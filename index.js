'use strict';

/**
 * HealthSherpa automation bot.
 *
 * High-level flow:
 *   1. Launch Brave/Chrome via puppeteer-real-browser (see src/core/browser.js)
 *   2. Log in (operator completes the Google auth code manually — see README)
 *   3. Visit the filtered list page once to warm up the session
 *   4. For each page N starting at STARTING_PAGE, navigate DIRECTLY to
 *      that page via URL (no "Next" button clicks) and process its links
 *   5. Periodically trim orphan tabs, sample memory, and soft-reset the
 *      main page when thresholds are exceeded — never closing the browser,
 *      so the Google auth session is preserved.
 *
 * See docs/architecture.md and src/config/constants.js for tunables.
 */

const { loadConfig } = require('./src/config/env');
const { Logger } = require('./src/core/logger');
const { launchBrowser } = require('./src/core/browser');
const { installShutdownHandlers } = require('./src/core/shutdown');
const { softResetMainPage, sampleMemory } = require('./src/core/memory');
const { MEMORY_THRESHOLDS } = require('./src/config/constants');

const { login } = require('./src/flows/login');
const { visitFilters } = require('./src/flows/filters');
const { gotoPage, urlForPage, isOnLastPage } = require('./src/flows/pagination');
const { processCurrentPage } = require('./src/flows/processPage');

const main = async () => {

    const config = loadConfig();
    const logger = new Logger({ truncate: true });

    // Shared mutable state observed by the shutdown handler for resume hints.
    const state = {
        linkNumber: 0,
        lastProcessedPage: null,
        pagesRan: 0,
    };

    const shutdownCtx = { logger, browser: null, state };
    installShutdownHandlers(shutdownCtx);

    logger.info('HealthSherpa bot starting..');
    logger.info(`Agent: ${config.agent.name} (${config.agent.tag})`);
    logger.info(`Bot mode: ${config.botMode}`);
    logger.info(`Starting page: ${config.pagination.startingPage}`);
    logger.info(
        config.pagination.maxPagesToRun
            ? `Max pages to run: ${config.pagination.maxPagesToRun}`
            : 'No page limit specified..',
    );

    const { browser, page } = await launchBrowser({ logger });
    shutdownCtx.browser = browser;

    await login(page, {
        username: config.credentials.username,
        password: config.credentials.password,
        logger,
    });

    // After login the operator may need to manually input the Google auth
    // code. We don't race the results grid here — we just proceed to
    // the filtered URL, which will redirect to auth if required.
    await visitFilters(page, config, { logger });

    const { startingPage, maxPagesToRun } = config.pagination;
    let currentPage = startingPage;

    while (true) {

        if (maxPagesToRun && state.pagesRan >= maxPagesToRun) {
            logger.info(`Reached NUMBER_PAGES_TO_RUN=${maxPagesToRun}, stopping.`);
            break;
        }

        const gridLoaded = await gotoPage(page, currentPage, config, { logger });
        if (!gridLoaded) {
            logger.warn(`Could not load results grid on page #${currentPage}, stopping.`);
            break;
        }

        const { linkCount } = await processCurrentPage({
            browser,
            mainPage: page,
            config,
            logger,
            state,
            pageNumber: currentPage,
        });

        state.pagesRan++;

        // Preventive soft reset on a fixed cadence — even if thresholds
        // haven't been hit, long-lived SPA state accumulates slowly.
        if (state.pagesRan % MEMORY_THRESHOLDS.SOFT_RESET_EVERY_N_PAGES === 0) {
            const sample = await sampleMemory(page);
            logger.info(`[memory] scheduled check after ${state.pagesRan} pages: RSS=${sample.formatted.rss} heap=${sample.formatted.jsHeap}`);
            await softResetMainPage(page, urlForPage(config, currentPage), { logger });
        }

        if (linkCount === 0) {

            // No links could mean we're past the last page of results.
            if (await isOnLastPage(page)) {
                logger.info(`Page #${currentPage} appears to be the last one, stopping.`);
                break;
            }

            logger.warn(`Page #${currentPage} returned 0 links but 'Next' is enabled, continuing.`);
        }

        currentPage++;
    }

    logger.info('Bot reached the end, stopping..');

    try { await browser.close(); } catch (_) { /* ignore */ }
    await logger.close();
};

main().catch((err) => {

    console.error('Fatal error in main():', err && err.stack ? err.stack : err);
    process.exit(1);
});
