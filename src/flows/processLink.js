'use strict';

const { SELECTORS, TIMEOUTS, CLEANUP } = require('../config/constants');
const { sleep, humanPause } = require('../core/timing');
const { attachInterception, detachInterception } = require('../core/browser');
const { isPageAccessible } = require('../core/memory');
const { dismissFfmModal } = require('./login');

/**
 * Handle the occasional "Grant permission" checkbox + Continue button combo.
 */
const handlePermissionPrompt = async (tab, { logger }) => {

    try {

        await tab.waitForSelector(SELECTORS.PERMISSION_CHECKBOX, { timeout: TIMEOUTS.PERMISSION_CHECKBOX });
        await tab.click(SELECTORS.PERMISSION_CHECKBOX);

        if (logger) { logger.info('Optional Permission Checkbox detected..'); }

        try {

            await tab.waitForSelector(SELECTORS.CONTINUE_BUTTON_XPATH);
            const continueButtons = await tab.$$(SELECTORS.CONTINUE_BUTTON_XPATH);
            if (continueButtons.length > 0) {
                if (logger) { logger.info('Continue button found for Permission Checkbox..'); }
                await continueButtons[0].click().catch(() => {});
            }

        } catch (_) {

            if (logger) { logger.info('No Continue button found for Permission Checkbox..'); }
        }

    } catch (_) {
        // Permission step not shown — common case.
    }
};

/**
 * Handle the optional "Enable EDE" yellow-background step.
 */
const handleEnableEde = async (tab, { logger }) => {

    try {

        await tab.waitForSelector(SELECTORS.ENABLE_EDE_BUTTON_XPATH, { timeout: TIMEOUTS.ENABLE_EDE });

        const buttons = await tab.$$(SELECTORS.ENABLE_EDE_BUTTON_XPATH);
        if (buttons.length > 0) {
            await buttons[0].click().catch(() => {});
            if (logger) { logger.info('Optional EDE Sync Enable detected..'); }
        }

    } catch (_) {
        // Enable-EDE step not shown — common case.
    }
};

/**
 * Optional yellow-banner step: consumer withdrew consent — click Reconnect.
 */
const handleReconnectConsent = async (tab, { logger }) => {

    try {

        await tab.waitForSelector(SELECTORS.RECONNECT_BUTTON_OR_LINK_XPATH, { timeout: TIMEOUTS.RECONNECT });

        const els = await tab.$$(SELECTORS.RECONNECT_BUTTON_OR_LINK_XPATH);
        if (els.length > 0) {
            await els[0].click().catch(() => {});
            if (logger) { logger.info('Reconnect (consent withdrawn banner) clicked..'); }
            await humanPause(400, 900);
        }

    } catch (_) {
        // Banner not shown — common case.
    }
};

/**
 * Slow, bounded scroll to trigger lazy loads HealthSherpa relies on.
 * Capped at SCROLL_MAX_ITERATIONS steps so a misbehaving page can't spin
 * this forever.
 */
const slowScrollToBottom = async (tab) => {

    await tab.evaluate(async ({ step, maxIterations, intervalMs }) => {

        await new Promise((resolve) => {

            let iteration = 0;
            const timer = setInterval(() => {

                window.scrollBy(0, step);
                iteration++;

                const atBottom =
                    document.documentElement.scrollTop + window.innerHeight
                    >= document.documentElement.scrollHeight;

                if (atBottom || iteration >= maxIterations) {
                    clearInterval(timer);
                    resolve();
                }
            }, intervalMs);
        });

    }, {
        step: CLEANUP.SCROLL_STEP_PX,
        maxIterations: CLEANUP.SCROLL_MAX_ITERATIONS,
        intervalMs: CLEANUP.SCROLL_INTERVAL_MS,
    });
};

/**
 * Close a processing tab, dropping its DOM and listeners first so the
 * renderer reclaims memory promptly.
 */
const disposeTab = async (tab, { logger }) => {

    if (!tab) { return; }

    try {

        detachInterception(tab);

        if (await isPageAccessible(tab)) {

            // about:blank drops the heavy SPA DOM before close, which
            // meaningfully reduces peak renderer memory.
            await tab.goto('about:blank', { waitUntil: 'domcontentloaded', timeout: 5000 })
                .catch(() => {});

            await tab.close({ runBeforeUnload: false });
        }

    } catch (err) {

        if (logger) { logger.warn(`disposeTab error: ${err.message}`); }
    }
};

/**
 * Open `link` in a new tab, run the site-specific steps, then guaranteed
 * cleanup. `try/finally` ensures the tab is always disposed, even if any
 * intermediate step throws.
 */
const processLink = async (browser, link, { pageNumber, linkNumber, logger }) => {

    let tab = null;

    try {

        tab = await browser.newPage();

        // Explicitly attach interception BEFORE goto. The `targetcreated`
        // browser-level listener also attaches it, but asynchronously — so
        // without this call, the first wave of requests (images, trackers)
        // can slip through unblocked and inflate renderer memory.
        await attachInterception(tab);

        await tab.goto(link, { waitUntil: 'domcontentloaded', timeout: TIMEOUTS.NAVIGATION });
        await humanPause(250, 600);

        await dismissFfmModal(tab, { logger });
        await handlePermissionPrompt(tab, { logger });
        await handleEnableEde(tab, { logger });
        await handleReconnectConsent(tab, { logger });

        if (logger) { logger.info(`Scrolling Tab ${linkNumber}..`); }
        await slowScrollToBottom(tab);
        await sleep(2000);

        // Confirm the page actually loaded the expected coverage section.
        try {

            await tab.waitForSelector(SELECTORS.APP_COVERAGE_DETAILS, { timeout: TIMEOUTS.APP_COVERAGE_DETAILS });
            if (logger) { logger.info(`-- Page #${pageNumber} Link #${linkNumber} Loaded Successfully --`); }

        } catch (err) {

            if (logger) {
                logger.warn(`-- Page #${pageNumber}, Link #${linkNumber} Failed to Load --`);
                logger.warn(`ERROR MSG - ${err.message}`);
            }
        }

    } catch (err) {

        if (logger) {
            logger.error(`-- Processing Tab Error on Page #${pageNumber}, Link #${linkNumber} --`);
            logger.error(`ERROR MSG - ${err.message}`);
        }

    } finally {

        await disposeTab(tab, { logger });

        if (logger) {
            logger.info('Tab finished..');
            logger.timestamp();
            logger.divider();
        }
    }
};

module.exports = {
    processLink,
    disposeTab,
};
