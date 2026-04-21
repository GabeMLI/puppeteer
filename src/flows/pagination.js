'use strict';

const { SELECTORS, TIMEOUTS } = require('../config/constants');
const { sleep, randomBetween } = require('../core/timing');

/**
 * Detect whether the current page is the last one by checking the
 * MUI pagination "Next" button's disabled state.
 */
const isOnLastPage = async (page) => {

    try {

        const nextButton = await page.$(SELECTORS.NEXT_PAGE_BUTTON);
        if (!nextButton) { return true; }

        const disabled = await page.evaluate(
            (el) => el.classList.contains('Mui-disabled') || el.getAttribute('aria-disabled') === 'true',
            nextButton,
        );

        return Boolean(disabled);

    } catch (_) {
        return false;
    }
};

/**
 * Click the "Next page" button of the MUI DataGrid and wait for the
 * results grid to re-render. HealthSherpa blocks deep-linking to arbitrary
 * page numbers via URL, so click-based pagination is the only option.
 *
 * Returns true when the next page loaded, false when the Next button is
 * disabled (end of results) or the click failed.
 */
const gotoNextPage = async (page, { logger } = {}) => {

    try {

        const nextButton = await page.waitForSelector(
            SELECTORS.NEXT_PAGE_BUTTON,
            { timeout: 10_000 },
        );

        if (!nextButton) {
            if (logger) { logger.warn('Next Page button not found.'); }
            return false;
        }

        const disabled = await page.evaluate(
            (el) => el.classList.contains('Mui-disabled') || el.getAttribute('aria-disabled') === 'true',
            nextButton,
        );

        if (disabled) {
            if (logger) { logger.info('Next Page button is disabled — reached the last page.'); }
            return false;
        }

        // Ensure the button is in view before clicking (long grids can push it
        // below the fold and MUI ignores clicks on offscreen pagination controls).
        await page.evaluate((selector) => {
            const el = document.querySelector(selector);
            if (el) { el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'auto' }); }
        }, SELECTORS.NEXT_PAGE_BUTTON);

        await nextButton.click();

        // Give the SPA time to swap rows. A light jitter protects against
        // HealthSherpa rate-limiting heuristics.
        await sleep(400 + randomBetween(500, 1100));

        try {

            await page.waitForSelector(SELECTORS.RESULTS_CONTAINER, { timeout: TIMEOUTS.RESULTS_GRID });

        } catch (err) {

            if (logger) { logger.warn(`Results grid did not re-render after Next click: ${err.message}`); }
            return false;
        }

        return true;

    } catch (err) {

        if (logger) { logger.warn(`gotoNextPage error: ${err.message}`); }
        return false;
    }
};

/**
 * Click "Next" repeatedly to skip from page 1 to `targetPage`, running
 * `onInterval()` every `intervalPages` clicks. The callback is where memory
 * cleanup happens during the skip phase — important because a cold start
 * with STARTING_PAGE=160 means 159 consecutive clicks, which is exactly
 * what used to OOM the renderer.
 *
 * Returns the actual page reached (may be less than targetPage if the
 * Next button became disabled before arriving).
 */
const skipToStartingPage = async (page, targetPage, { logger, onInterval, intervalPages = 20 } = {}) => {

    if (targetPage <= 1) { return 1; }

    if (logger) { logger.info(`Skipping forward to page ${targetPage} via Next button..`); }

    let current = 1;

    while (current < targetPage) {

        const advanced = await gotoNextPage(page, { logger });
        if (!advanced) {

            if (logger) { logger.warn(`Could not advance past page #${current} (Next disabled or error).`); }
            return current;
        }

        current++;

        if (logger && (current % 5 === 0 || current === targetPage)) {
            logger.info(`Skip progress: page ${current} / ${targetPage}`);
        }

        // Hand control back so the caller can do in-place memory cleanup
        // without us having to know what that means.
        if (onInterval && (current - 1) % intervalPages === 0) {
            try { await onInterval(current); }
            catch (err) {
                if (logger) { logger.warn(`skipToStartingPage onInterval error: ${err.message}`); }
            }
        }
    }

    if (logger) { logger.info(`Arrived at starting page ${current}.`); }
    return current;
};

module.exports = {
    gotoNextPage,
    skipToStartingPage,
    isOnLastPage,
};
