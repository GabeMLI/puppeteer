'use strict';

const { detachInterception } = require('./browser');
const { MEMORY_THRESHOLDS, CLEANUP, STORAGE_TYPES_TO_CLEAR } = require('../config/constants');

/**
 * Human-readable memory size formatting for log lines.
 */
const formatBytes = (bytes) => {

    if (!Number.isFinite(bytes) || bytes <= 0) { return '0 B'; }

    const units = ['B', 'KB', 'MB', 'GB'];
    let value = bytes;
    let i = 0;
    while (value >= 1024 && i < units.length - 1) {
        value /= 1024;
        i++;
    }
    return `${value.toFixed(1)} ${units[i]}`;
};

/**
 * Defensive probe — the puppeteer API throws if the target is gone.
 */
const isPageAccessible = async (page) => {

    if (!page) { return false; }

    try {

        await page.title();
        return true;

    } catch (err) {

        if (err && err.message && err.message.includes('Target closed')) {
            return false;
        }

        return false;
    }
};

/**
 * Sample current JS heap from a page without creating persistent CDP sessions.
 * Returns 0 on failure.
 */
const getPageJsHeapBytes = async (page) => {

    try {

        const metrics = await page.metrics();
        return metrics && Number.isFinite(metrics.JSHeapUsedSize)
            ? metrics.JSHeapUsedSize
            : 0;

    } catch (_) {
        return 0;
    }
};

/**
 * In-place memory cleanup. Runs the renderer-side garbage collector and
 * drops the HTTP cache via the DevTools Protocol *without* navigating,
 * so we stay exactly where we are in the MUI pagination.
 *
 * This is the central OOM mitigation now that direct URL navigation to
 * arbitrary page numbers is blocked by HealthSherpa — we cannot navigate
 * to `about:blank` and back, so we lean on CDP to reclaim memory in situ.
 *
 * Cookies and sessionStorage are deliberately NOT touched — the Google
 * auth session must survive every cleanup cycle.
 */
const cleanupInPlace = async (page, { logger, label = 'cleanup' } = {}) => {

    if (!page) { return; }

    if (!(await isPageAccessible(page))) {

        if (logger) { logger.warn(`[${label}] page not accessible, skipping cleanup.`); }
        return;
    }

    let beforeHeap = 0;
    let client = null;

    try {

        beforeHeap = await getPageJsHeapBytes(page);

        client = await page.target().createCDPSession();

        // Run the collector repeatedly — a single sweep rarely reclaims
        // everything from a long-lived SPA (finalizers, weak references,
        // etc. need multiple cycles).
        for (let i = 0; i < 3; i++) {
            await client.send('HeapProfiler.collectGarbage').catch(() => {});
        }

        // Drop the HTTP cache — gigabytes of cached assets accumulate here
        // on long runs (MUI bundles, icons, JSON responses, etc.).
        await client.send('Network.clearBrowserCache').catch(() => {});

        // Wipe per-origin browser storage that we are certain does NOT hold
        // auth state (no cookies, no localStorage, no indexeddb). This is
        // what typically holds the biggest non-cache memory footprint:
        // CacheStorage API, service worker scripts, shader cache, etc.
        try {

            const currentUrl = page.url();
            if (currentUrl && /^https?:/i.test(currentUrl)) {

                const origin = new URL(currentUrl).origin;
                await client.send('Storage.clearDataForOrigin', {
                    origin,
                    storageTypes: STORAGE_TYPES_TO_CLEAR,
                }).catch(() => {});
            }

        } catch (_) { /* origin parse failed, skip */ }

        // Prune DOM internals the SPA might be holding onto: any detached
        // DOM nodes kept alive only by React handlers. Safe best-effort.
        await page.evaluate(() => {

            if (typeof window === 'undefined') { return; }

            // Hint the engine to release references. Has no effect without
            // --js-flags=--expose-gc but is harmless when gc() is absent.
            if (typeof window.gc === 'function') { try { window.gc(); } catch (_) { /* ignore */ } }

        }).catch(() => {});

        // Re-run GC after clearing storage so the freed objects are actually
        // reaped on this tick.
        for (let i = 0; i < 2; i++) {
            await client.send('HeapProfiler.collectGarbage').catch(() => {});
        }

    } catch (err) {

        if (logger) { logger.warn(`[${label}] cleanupInPlace error: ${err.message}`); }

    } finally {

        if (client) {
            try { await client.detach(); } catch (_) { /* ignore */ }
        }
    }

    if (logger) {

        const afterHeap = await getPageJsHeapBytes(page);
        const rss = process.memoryUsage().rss;
        const delta = beforeHeap - afterHeap;
        const deltaStr = delta > 0 ? `-${formatBytes(delta)}` : `+${formatBytes(-delta)}`;
        logger.info(
            `[${label}] RSS=${formatBytes(rss)} heap=${formatBytes(afterHeap)} (${deltaStr})`,
        );
    }
};

/**
 * Inspect memory usage and return whether thresholds are exceeded, along
 * with the sampled values (useful for logging and decision-making).
 */
const sampleMemory = async (page) => {

    const rss = process.memoryUsage().rss;
    const jsHeap = await getPageJsHeapBytes(page);

    return {
        rss,
        jsHeap,
        rssExceeded: rss >= MEMORY_THRESHOLDS.RSS_BYTES,
        heapExceeded: jsHeap >= MEMORY_THRESHOLDS.JS_HEAP_BYTES,
        exceeded: rss >= MEMORY_THRESHOLDS.RSS_BYTES || jsHeap >= MEMORY_THRESHOLDS.JS_HEAP_BYTES,
        formatted: {
            rss: formatBytes(rss),
            jsHeap: formatBytes(jsHeap),
        },
    };
};

/**
 * Close any tab that isn't the main page. Called periodically to sweep
 * orphan tabs left over from errors or aborted processLink calls.
 */
const trimOrphanTabs = async (browser, mainPage, { logger } = {}) => {

    if (!browser || !mainPage) { return 0; }

    let closed = 0;

    try {

        const pages = await browser.pages();

        if (pages.length <= CLEANUP.MIN_OPEN_TABS_BEFORE_TRIM) { return 0; }

        for (const page of pages) {

            if (page === mainPage) { continue; }

            try {

                detachInterception(page);
                await page.goto('about:blank', { waitUntil: 'domcontentloaded', timeout: 5000 })
                    .catch(() => {});
                await page.close({ runBeforeUnload: false });
                closed++;

            } catch (err) {

                if (logger) { logger.warn(`trimOrphanTabs close error: ${err.message}`); }
            }
        }

        if (closed > 0) {

            try { await mainPage.bringToFront(); } catch (_) { /* ignore */ }
            if (logger) { logger.info(`Trimmed ${closed} orphan tab(s).`); }
        }

    } catch (err) {

        if (logger) { logger.warn(`trimOrphanTabs error: ${err.message}`); }
    }

    return closed;
};

/**
 * Log what the page actually looks like right now. Useful when a click or
 * selector wait times out and we want to know whether the renderer is
 * alive at all.
 */
const logPageDiagnostics = async (page, { logger, label = 'diagnostic' } = {}) => {

    if (!logger) { return; }

    try {

        const accessible = await isPageAccessible(page);
        if (!accessible) {
            logger.error(`[${label}] page is NOT accessible — renderer likely crashed (Aw, Snap!).`);
            return;
        }

        const [title, url, sample] = await Promise.all([
            page.title().catch(() => '(no title)'),
            Promise.resolve(page.url()).catch(() => '(no url)'),
            sampleMemory(page),
        ]);

        logger.warn(`[${label}] title="${title}" url="${url}"`);
        logger.warn(`[${label}] RSS=${sample.formatted.rss} heap=${sample.formatted.jsHeap}`);

    } catch (err) {

        logger.warn(`[${label}] diagnostics failed: ${err.message}`);
    }
};

module.exports = {
    cleanupInPlace,
    sampleMemory,
    trimOrphanTabs,
    isPageAccessible,
    logPageDiagnostics,
    formatBytes,
};
