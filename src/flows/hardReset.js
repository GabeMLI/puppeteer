'use strict';

const { SELECTORS, TIMEOUTS, HARD_RESET, MEMORY_THRESHOLDS } = require('../config/constants');
const { sleep } = require('../core/timing');
const { sampleMemory } = require('../core/memory');
const { buildFiltersUrl } = require('./filters');
const { skipToStartingPage } = require('./pagination');

/**
 * Nuclear memory recovery. Used when the JS heap has grown so large that
 * in-place cleanup cannot reclaim it (typical cause: MUI DataGrid retaining
 * rows from every previously visited page — those are "live" references,
 * not garbage, so GC cannot touch them).
 *
 * Strategy:
 *   1. Navigate the main page to `about:blank` — drops the SPA's DOM and
 *      every JS reference still holding memory.
 *   2. Re-visit the filters URL to re-render the grid from scratch.
 *   3. Click-skip back to `targetPage` using the regular skip flow.
 *
 * Cookies and localStorage survive this entire cycle, so the Google auth
 * session (which is cookie-backed) is preserved — the operator does NOT
 * need to re-enter the auth code.
 *
 * Cost: ~N * skipClickDelay seconds to re-skip N pages. Worth it because
 * the post-reset heap drops back to ~100-200 MB, buying another long run.
 *
 * Returns the page number we actually arrived at (may be less than
 * `targetPage` if the skip failed).
 */
const hardResetMainPage = async (page, { config, logger, targetPage }) => {

    const label = `hard-reset-p${targetPage}`;

    if (logger) {

        const before = await sampleMemory(page);
        logger.warn(
            `[${label}] starting hard reset (heap=${before.formatted.jsHeap} ` +
            `nodes=${before.formatted.nodes} listeners=${before.formatted.listeners})`,
        );
        logger.warn(`[${label}] this will reload the main tab and re-skip to page ${targetPage}.`);
        logger.warn(`[${label}] Google auth session is cookie-based so it will survive.`);
    }

    const filtersUrl = buildFiltersUrl(config.urls);

    try {

        // Step 1: drop the heavy SPA DOM entirely. Going through about:blank
        // is more effective than page.reload() because it forces every
        // reference to be dropped before the new navigation starts.
        await page.goto('about:blank', {
            waitUntil: 'domcontentloaded',
            timeout: 10_000,
        });

        await sleep(500);

        // Step 2: revisit the filter URL.
        await page.goto(filtersUrl, {
            waitUntil: 'domcontentloaded',
            timeout: TIMEOUTS.NAVIGATION,
        });

        await page.waitForSelector(SELECTORS.RESULTS_CONTAINER, {
            timeout: TIMEOUTS.RESULTS_GRID,
        });

        await sleep(HARD_RESET.POST_RELOAD_WAIT_MS);

        if (logger) {

            const mid = await sampleMemory(page);
            logger.info(
                `[${label}] reload complete (heap=${mid.formatted.jsHeap} ` +
                `nodes=${mid.formatted.nodes} listeners=${mid.formatted.listeners})`,
            );
        }

    } catch (err) {

        if (logger) { logger.error(`[${label}] reload failed: ${err.message}`); }
        return 1;
    }

    // Step 3: skip back to where we were. The skip flow already handles
    // aggressive cleanup every N clicks on its own.
    const arrivedAt = await skipToStartingPage(page, targetPage, {
        logger,
        intervalPages: MEMORY_THRESHOLDS.SKIP_CLEANUP_EVERY_N_PAGES,
    });

    if (logger) {

        const after = await sampleMemory(page);
        logger.info(
            `[${label}] finished. Arrived at page ${arrivedAt} ` +
            `(heap=${after.formatted.jsHeap} nodes=${after.formatted.nodes}).`,
        );
    }

    return arrivedAt;
};

/**
 * Decide whether a hard reset is warranted *right now*, given the most
 * recent memory sample and how many pages have been processed since the
 * last reset.
 *
 * Returns a string reason when a reset should happen, null otherwise.
 * The reason is surfaced in the log so the cause is auditable.
 */
const shouldHardReset = ({ sample, pagesSinceLastReset, everyNPages, jsHeapBytesCritical }) => {

    if (sample && jsHeapBytesCritical && sample.jsHeap >= jsHeapBytesCritical) {
        return `js-heap-critical (${sample.formatted.jsHeap})`;
    }

    if (everyNPages > 0 && pagesSinceLastReset >= everyNPages) {
        return `scheduled-every-${everyNPages}-pages`;
    }

    return null;
};

module.exports = {
    hardResetMainPage,
    shouldHardReset,
};
