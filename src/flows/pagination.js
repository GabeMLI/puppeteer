'use strict';

const { SELECTORS, TIMEOUTS, PAGE_RETRY, MEMORY_THRESHOLDS } = require('../config/constants');
const { sleep, randomBetween } = require('../core/timing');
const { cleanupInPlace, logPageDiagnostics } = require('../core/memory');

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
 * Perform a single Next-page click attempt.
 * Returns 'advanced' | 'disabled' | 'error'.
 */
const tryNextClick = async (page, { logger, clickDelay }) => {

    try {

        const nextButton = await page.waitForSelector(
            SELECTORS.NEXT_PAGE_BUTTON,
            { timeout: 10_000 },
        );

        if (!nextButton) { return 'error'; }

        const disabled = await page.evaluate(
            (el) => el.classList.contains('Mui-disabled') || el.getAttribute('aria-disabled') === 'true',
            nextButton,
        );

        if (disabled) {
            if (logger) { logger.info('Next Page button is disabled — reached the last page.'); }
            return 'disabled';
        }

        await page.evaluate((selector) => {
            const el = document.querySelector(selector);
            if (el) { el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'auto' }); }
        }, SELECTORS.NEXT_PAGE_BUTTON);

        await nextButton.click();

        await sleep(clickDelay.min + randomBetween(0, Math.max(0, clickDelay.max - clickDelay.min)));

        await page.waitForSelector(SELECTORS.RESULTS_CONTAINER, { timeout: TIMEOUTS.RESULTS_GRID });
        return 'advanced';

    } catch (err) {

        if (logger) { logger.warn(`Next-click attempt failed: ${err.message}`); }
        return 'error';
    }
};

/**
 * Click the "Next page" button with retry + in-place cleanup when the grid
 * fails to re-render. HealthSherpa blocks deep-linking to arbitrary page
 * numbers via URL, so click-based pagination is the only option.
 *
 * Returns:
 *   - true when the next page loaded successfully
 *   - false when the Next button is disabled (end of results) or all
 *     retries failed
 *
 * Options:
 *   - clickDelay: { min, max } sleep between click and grid re-render check
 *   - attempts:   how many tries before giving up
 */
const gotoNextPage = async (page, { logger, clickDelay, attempts } = {}) => {

    const delay = clickDelay || { min: 900, max: 1500 };
    const maxAttempts = attempts || PAGE_RETRY.ATTEMPTS;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {

        const outcome = await tryNextClick(page, { logger, clickDelay: delay });

        if (outcome === 'advanced') { return true; }
        if (outcome === 'disabled') { return false; }

        // outcome === 'error' — the grid didn't re-appear. Most common
        // cause on this codebase is the renderer being on the verge of an
        // OOM (or having already crashed). Diagnose, run the most
        // aggressive cleanup we have, then try again.
        if (logger) {
            logger.warn(`Next-click failed on attempt ${attempt}/${maxAttempts}, running recovery cleanup..`);
        }

        await logPageDiagnostics(page, { logger, label: `next-fail-${attempt}` });

        if (attempt < maxAttempts) {

            await cleanupInPlace(page, { logger, label: `next-retry-${attempt}` });
            await sleep(PAGE_RETRY.BETWEEN_ATTEMPTS_MS);
        }
    }

    if (logger) { logger.error(`gotoNextPage exhausted ${maxAttempts} attempts.`); }
    return false;
};

/**
 * Click "Next" repeatedly to skip from page 1 to `targetPage`, running
 * `onInterval()` every `intervalPages` clicks. The callback is where memory
 * cleanup happens during the skip phase — important because a cold start
 * with STARTING_PAGE=160 means many consecutive clicks, which is exactly
 * what used to OOM the renderer.
 *
 * Uses the skip-specific (slower) click delay by default, giving the SPA
 * more breathing room between clicks.
 *
 * `onInterval(currentPage)` may return:
 *   - undefined / nothing    → continue skipping normally
 *   - `{ abort: true, reason }` → stop the skip right here. The function
 *     returns the page reached so the caller can decide what to do.
 *
 * Returns the actual page reached (may be less than targetPage if the
 * Next button became disabled, clicks stopped working, or onInterval
 * requested an abort).
 */
const skipToStartingPage = async (page, targetPage, { logger, onInterval, intervalPages } = {}) => {

    if (targetPage <= 1) { return 1; }

    const skipInterval = intervalPages || MEMORY_THRESHOLDS.SKIP_CLEANUP_EVERY_N_PAGES;
    const clickDelay = {
        min: MEMORY_THRESHOLDS.SKIP_CLICK_DELAY_MIN_MS,
        max: MEMORY_THRESHOLDS.SKIP_CLICK_DELAY_MAX_MS,
    };

    if (logger) { logger.info(`Skipping forward to page ${targetPage} via Next button..`); }

    let current = 1;

    while (current < targetPage) {

        const advanced = await gotoNextPage(page, { logger, clickDelay });
        if (!advanced) {

            if (logger) { logger.warn(`Could not advance past page #${current} (Next disabled or error).`); }
            return current;
        }

        current++;

        if (logger && (current % 5 === 0 || current === targetPage)) {
            logger.info(`Skip progress: page ${current} / ${targetPage}`);
        }

        if (onInterval && (current - 1) % skipInterval === 0) {

            let result;
            try { result = await onInterval(current); }
            catch (err) {
                if (logger) { logger.warn(`skipToStartingPage onInterval error: ${err.message}`); }
            }

            if (result && result.abort) {

                if (logger) {
                    logger.warn(
                        `skipToStartingPage: aborting at page ${current} as requested ` +
                        `by onInterval (${result.reason || 'no reason'}).`,
                    );
                }
                return current;
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
