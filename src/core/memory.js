'use strict';

const { detachInterception, attachInterception } = require('./browser');
const { MEMORY_THRESHOLDS, CLEANUP, TIMEOUTS, SELECTORS } = require('../config/constants');

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
 * Ask the renderer to drop as much cached/unreferenced memory as possible
 * without losing cookies/session storage (so Google auth survives).
 */
const clearRendererCaches = async (page, { logger } = {}) => {

    let client = null;

    try {

        client = await page.target().createCDPSession();

        // Heap GC first so the subsequent cache clears actually release bytes.
        await client.send('HeapProfiler.collectGarbage').catch(() => {});
        await client.send('Network.clearBrowserCache').catch(() => {});

        // Keep cookies (would break Google session) — intentionally NOT calling
        // Network.clearBrowserCookies.

    } catch (err) {

        if (logger) { logger.warn(`clearRendererCaches error: ${err.message}`); }

    } finally {

        if (client) {
            try { await client.detach(); } catch (_) { /* ignore */ }
        }
    }
};

/**
 * Navigate the main page to about:blank to drop its DOM/heap, then back
 * to the provided URL. Cookies (and therefore Google session) are preserved
 * because we never close the tab or the browser.
 *
 * This is the central mitigation for the "Aw, Snap! Out of Memory" error.
 */
const softResetMainPage = async (page, url, { logger } = {}) => {

    if (!page) { return; }

    if (logger) { logger.info(`-- Soft-resetting main page to free memory --`); }

    try {

        detachInterception(page);

        await page.goto('about:blank', { waitUntil: 'domcontentloaded', timeout: TIMEOUTS.NAVIGATION })
            .catch(() => {});

        await clearRendererCaches(page, { logger });

        await attachInterception(page);

        if (url) {

            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: TIMEOUTS.NAVIGATION });

            // Best-effort wait for the SPA grid to render. Ignore timeout —
            // the caller can handle missing selectors.
            try {
                await page.waitForSelector(SELECTORS.RESULTS_CONTAINER, { timeout: TIMEOUTS.RESULTS_GRID });
            } catch (_) { /* ignore */ }
        }

        if (logger) {

            const afterHeap = await getPageJsHeapBytes(page);
            const rss = process.memoryUsage().rss;
            logger.info(`-- Soft-reset done: RSS=${formatBytes(rss)} heap=${formatBytes(afterHeap)} --`);
        }

    } catch (err) {

        if (logger) { logger.error(`softResetMainPage failed: ${err.message}`); }
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

module.exports = {
    softResetMainPage,
    clearRendererCaches,
    sampleMemory,
    trimOrphanTabs,
    isPageAccessible,
    formatBytes,
};
