'use strict';

const { connect } = require('puppeteer-real-browser');

const { getBrowserExecutable } = require('../config/browserPaths');
const {
    TIMEOUTS,
    BLOCKED_RESOURCE_TYPES,
    BLOCKED_URL_PATTERNS,
    DEFAULT_BROWSER_FLAGS,
    DEFAULT_MAX_OLD_SPACE_MB,
} = require('../config/constants');

/**
 * Decide whether a given request should be aborted to save memory/bandwidth.
 * Applied to every page, main or child.
 */
const shouldBlockRequest = (request) => {

    const resourceType = request.resourceType();
    if (BLOCKED_RESOURCE_TYPES.includes(resourceType)) { return true; }

    const url = request.url();
    for (const pattern of BLOCKED_URL_PATTERNS) {
        if (url.includes(pattern)) { return true; }
    }

    return false;
};

/**
 * Attach request interception + default timeouts to a single page.
 *
 * We deliberately use puppeteer's own `page.setCacheEnabled(false)` rather
 * than opening a raw CDP session with `Network.enable` — opening a session
 * without consuming its event stream was flooding the Node-side CDP pipe
 * with `requestWillBeSent` / `responseReceived` / `loadingFinished` events
 * we never read, which accumulate in the EventEmitter queue over hours.
 *
 * The handler is stored on the page instance so it can be removed later
 * to avoid listener leaks.
 */
const attachInterception = async (page) => {

    if (page.__hsInterceptionAttached) { return; }

    try {

        // Disable HTTP caching using puppeteer's managed session. This does
        // NOT leave a separate CDP session attached the way our old code did.
        try { await page.setCacheEnabled(false); } catch (_) { /* older wrappers may lack this */ }

        await page.setRequestInterception(true);

        const handler = async (request) => {

            try {

                if (request.isInterceptResolutionHandled && request.isInterceptResolutionHandled()) {
                    return;
                }

                if (shouldBlockRequest(request)) {
                    await request.abort();
                } else {
                    await request.continue();
                }

            } catch (_) {
                // The request may have been resolved or the frame detached
                // while we were deciding. Swallow — not fatal.
            }
        };

        page.on('request', handler);

        page.__hsInterceptionHandler = handler;
        page.__hsInterceptionAttached = true;

        page.setDefaultTimeout(TIMEOUTS.DEFAULT);
        page.setDefaultNavigationTimeout(TIMEOUTS.NAVIGATION);

    } catch (err) {

        // If interception fails (target already closed etc.), don't crash.
        // The page simply runs without blocking — not ideal but not fatal.
    }
};

/**
 * Remove the interception handler from a page so that page.close()
 * actually drops references to the listener closure.
 */
const detachInterception = (page) => {

    if (!page || !page.__hsInterceptionAttached) { return; }

    try {

        if (page.__hsInterceptionHandler) {
            page.off('request', page.__hsInterceptionHandler);
        }

        // Do NOT call page.removeAllListeners('request') here — puppeteer
        // itself registers internal listeners we must not strip.

    } catch (_) { /* ignore */ }

    page.__hsInterceptionHandler = null;
    page.__hsInterceptionAttached = false;
};

/**
 * Build the full Chromium launch args array from the defaults, the
 * V8 heap ceiling, and any extra user-provided flags from .env.
 *
 * Notes on the flags we use (see src/config/constants.js::DEFAULT_BROWSER_FLAGS):
 *   --js-flags=--max-old-space-size=N raises V8's heap ceiling per renderer
 *   (default ~2-4 GB). This is the most impactful flag for OOM on long runs.
 *   --disable-backgrounding-occluded-windows / --disable-renderer-backgrounding
 *   / --disable-background-timer-throttling stop Chromium from pausing the
 *   tab when focus moves elsewhere — otherwise MUI timers stall and our
 *   Next-click waits time out.
 */
const buildLaunchArgs = (browserConfig = {}) => {

    const maxOldSpaceMb = Number.isFinite(browserConfig.maxOldSpaceMb) && browserConfig.maxOldSpaceMb > 0
        ? browserConfig.maxOldSpaceMb
        : DEFAULT_MAX_OLD_SPACE_MB;

    const args = [
        ...DEFAULT_BROWSER_FLAGS,
        `--js-flags=--max-old-space-size=${maxOldSpaceMb}`,
    ];

    if (Array.isArray(browserConfig.extraFlags) && browserConfig.extraFlags.length) {
        args.push(...browserConfig.extraFlags);
    }

    return args;
};

/**
 * Launch the real browser and ensure EVERY page (existing or future)
 * gets request interception attached automatically.
 *
 * Returns { browser, page, executable }.
 */
const launchBrowser = async ({ logger, config = {} } = {}) => {

    const detected = getBrowserExecutable();
    const launcherConfig = detected ? { chromePath: detected.path } : {};

    if (logger) {
        if (detected) {
            const label = detected.name === 'custom'
                ? 'custom'
                : detected.name.charAt(0).toUpperCase() + detected.name.slice(1);
            logger.info(`Detected ${label} browser at: ${detected.path}`);
        } else {
            logger.warn('No Brave or Chrome installation detected, falling back to puppeteer-real-browser default.');
        }
    }

    const launchArgs = buildLaunchArgs(config.browser);

    if (logger) {
        logger.info(`Launching Chromium with flags:`);
        for (const flag of launchArgs) { logger.info(`  ${flag}`); }
    }

    const { browser } = await connect({
        headless: false,
        args: launchArgs,
        customConfig: launcherConfig,
        turnstile: true,
        connectOption: { defaultViewport: null },
        disableXvfb: false,
        ignoreAllFlags: false,
    });

    // Attach interception to any newly created page automatically.
    browser.on('targetcreated', async (target) => {

        if (target.type() !== 'page') { return; }

        try {
            const newPage = await target.page();
            if (newPage) { await attachInterception(newPage); }
        } catch (_) { /* ignore */ }
    });

    // Prepare the initial working page.
    const page = await browser.newPage();
    await attachInterception(page);

    // Close any extra blank pages that puppeteer-real-browser opened.
    await closeExtraBlankPages(browser, page, logger);

    return { browser, page, executable: detected };
};

/**
 * puppeteer-real-browser often opens an initial "about:blank" tab alongside
 * the page we requested. Close anything that isn't our working page, so we
 * start with a clean slate.
 */
const closeExtraBlankPages = async (browser, mainPage, logger) => {

    try {

        const allPages = await browser.pages();

        for (const p of allPages) {

            if (p === mainPage) { continue; }

            try {

                const url = p.url();
                if (url === 'about:blank' || url === '' || url === 'chrome://newtab/') {
                    await p.close({ runBeforeUnload: false });
                }

            } catch (_) { /* ignore individual close errors */ }
        }

        await mainPage.bringToFront();

    } catch (err) {

        if (logger) { logger.warn(`closeExtraBlankPages error: ${err.message}`); }
    }
};

module.exports = {
    launchBrowser,
    attachInterception,
    detachInterception,
    shouldBlockRequest,
};
