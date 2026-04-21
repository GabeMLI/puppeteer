'use strict';

const { SELECTORS, TIMEOUTS } = require('../config/constants');

/**
 * Build the fully-qualified filters URL from the config `urls` block.
 * Pure function — no page/browser access.
 */
const buildFiltersUrl = (urls) => {

    const { baseUrl, commonFilters, extraFilters } = urls;
    const filterString = extraFilters.filter(Boolean).join('&');

    return `${baseUrl}${commonFilters}&${filterString}`;
};

/**
 * Navigate the main page to the filtered list and wait for the results grid.
 */
const visitFilters = async (page, config, { logger } = {}) => {

    const url = buildFiltersUrl(config.urls);

    if (logger) { logger.info(url); }

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: TIMEOUTS.NAVIGATION });

    if (logger) { logger.info('searching for results grid..'); }
    await page.waitForSelector(SELECTORS.RESULTS_CONTAINER, { timeout: TIMEOUTS.RESULTS_GRID });

    return url;
};

module.exports = {
    buildFiltersUrl,
    visitFilters,
};
