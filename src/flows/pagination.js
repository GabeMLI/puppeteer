'use strict';

const { SELECTORS, TIMEOUTS } = require('../config/constants');
const { sleep, randomBetween } = require('../core/timing');
const { buildFiltersUrl } = require('./filters');

/**
 * Replace (or append) the `page=N` query string parameter on the filters URL.
 * This keeps every other filter intact.
 */
const withPageParam = (url, pageNum) => {

    if (/([?&])page=\d+/.test(url)) {
        return url.replace(/([?&])page=\d+/, `$1page=${pageNum}`);
    }

    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}page=${pageNum}`;
};

/**
 * Build the filters URL for a specific page number.
 */
const urlForPage = (config, pageNum) => {

    const base = buildFiltersUrl(config.urls);
    return withPageParam(base, pageNum);
};

/**
 * Navigate the main page directly to a page number via URL instead of
 * clicking "Next page" repeatedly. This is the main OOM mitigation — it
 * eliminates the N-click accumulation that bloats the MUI DataGrid SPA.
 *
 * Returns true when the results grid loaded, false otherwise.
 */
const gotoPage = async (page, pageNum, config, { logger } = {}) => {

    const url = urlForPage(config, pageNum);

    if (logger) { logger.info(`Navigating directly to page ${pageNum}..`); }

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: TIMEOUTS.NAVIGATION });

    // Small jitter so the SPA has a chance to render rows before we query.
    await sleep(400 + randomBetween(300, 800));

    try {

        await page.waitForSelector(SELECTORS.RESULTS_CONTAINER, { timeout: TIMEOUTS.RESULTS_GRID });
        return true;

    } catch (err) {

        if (logger) { logger.warn(`Results grid not found on page ${pageNum}: ${err.message}`); }
        return false;
    }
};

/**
 * Detect whether the current page is the last one by checking the
 * MUI pagination "Next" button's disabled state. Used as an early-exit
 * signal when the caller has no explicit `NUMBER_PAGES_TO_RUN`.
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
        // If we can't tell, don't assume we're at the end.
        return false;
    }
};

module.exports = {
    gotoPage,
    urlForPage,
    withPageParam,
    isOnLastPage,
};
