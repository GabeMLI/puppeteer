'use strict';

/**
 * HealthSherpa automation bot.
 *
 * High-level flow:
 *   1. Launch Brave/Chrome via puppeteer-real-browser (see src/core/browser.js)
 *   2. Log in (operator completes the Google auth code manually — see README)
 *   3. Visit the filtered list page once (this lands us on page 1)
 *   4. Click "Next page" until we reach STARTING_PAGE, running in-place
 *      memory cleanup every N clicks so the skip phase doesn't OOM
 *   5. For each page from there on, process its links and then click
 *      "Next page" to advance. HealthSherpa blocks deep-linking to
 *      arbitrary page numbers via URL, so click-based pagination is the
 *      only option.
 *   6. Periodically trim orphan tabs and run in-place memory cleanup
 *      when process RSS / JS heap cross their thresholds. We never
 *      navigate away from the main page, so the Google auth session
 *      is preserved through every cleanup cycle.
 *
 * See src/config/constants.js for tunables.
 */

const { loadConfig } = require('./src/config/env');
const { Logger } = require('./src/core/logger');
const { launchBrowser } = require('./src/core/browser');
const { installShutdownHandlers } = require('./src/core/shutdown');
const { cleanupInPlace, sampleMemory, trimOrphanTabs } = require('./src/core/memory');
const { MEMORY_THRESHOLDS } = require('./src/config/constants');

const { login } = require('./src/flows/login');
const { visitFilters } = require('./src/flows/filters');
const { gotoNextPage, skipToStartingPage, isOnLastPage } = require('./src/flows/pagination');
const { processCurrentPage } = require('./src/flows/processPage');
const { hardResetMainPage, shouldHardReset } = require('./src/flows/hardReset');

const runMemoryCheck = async ({ mainPage, logger, label }) => {

    const sample = await sampleMemory(mainPage);
    logger.info(
        `[memory] ${label}: heap=${sample.formatted.jsHeap} nodes=${sample.formatted.nodes} ` +
        `listeners=${sample.formatted.listeners} docs=${sample.formatted.documents}`,
    );

    if (sample.exceeded) {

        const reasons = [];
        if (sample.heapExceeded) { reasons.push(`heap=${sample.formatted.jsHeap}`); }
        if (sample.nodesExceeded) { reasons.push(`nodes=${sample.formatted.nodes}`); }
        if (sample.listenersExceeded) { reasons.push(`listeners=${sample.formatted.listeners}`); }

        logger.warn(`[memory] threshold exceeded (${reasons.join(', ')}), running in-place cleanup.`);
        await cleanupInPlace(mainPage, { logger, label: `threshold-${label}` });
        return true;
    }

    return false;
};

const main = async () => {

    const config = loadConfig();
    const logger = new Logger({ truncate: true });

    // Shared mutable state observed by the shutdown handler for resume hints.
    const state = {
        linkNumber: 0,
        lastProcessedPage: null,
        pagesRan: 0,
        pagesSinceLastReset: 0,
        hardResetsDone: 0,
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
    logger.info(
        `V8 heap ceiling: ${config.browser.maxOldSpaceMb} MB, ` +
        `hard-reset at ${Math.round(config.memory.jsHeapBytesCritical / 1024 / 1024)} MB JS heap` +
        (config.hardReset.everyNPages
            ? ` or every ${config.hardReset.everyNPages} pages`
            : ' (preventive cadence disabled)'),
    );

    const { browser, page } = await launchBrowser({ logger, config });
    shutdownCtx.browser = browser;

    await login(page, {
        username: config.credentials.username,
        password: config.credentials.password,
        logger,
    });

    // After login the operator may need to manually input the Google auth
    // code before the filtered list renders.
    await visitFilters(page, config, { logger });

    const { startingPage, maxPagesToRun } = config.pagination;

    // -- Skip-forward phase ------------------------------------------------
    // With STARTING_PAGE=160 this is 159 consecutive Next clicks. We run
    // in-place memory cleanup every N pages during the skip so the grid's
    // accumulated state never reaches the OOM threshold.
    //
    // If the renderer heap crosses the critical threshold during the skip,
    // a hard-reset would be useless here because it would re-skip and
    // re-accumulate the same leak. Instead we abort with a clear error
    // pointing the operator at MAX_OLD_SPACE_SIZE_MB.
    const arrivedAt = await skipToStartingPage(page, startingPage, {
        logger,
        intervalPages: MEMORY_THRESHOLDS.SKIP_CLEANUP_EVERY_N_PAGES,
        onInterval: async (pageJustReached) => {

            await cleanupInPlace(page, { logger, label: `skip-${pageJustReached}` });
            await trimOrphanTabs(browser, page, { logger });

            const sample = await sampleMemory(page);
            if (sample.jsHeap >= config.memory.jsHeapBytesCritical) {
                return {
                    abort: true,
                    reason: `js-heap-critical (${sample.formatted.jsHeap})`,
                };
            }

            return undefined;
        },
    });

    // If skip stopped short AND heap is at the critical line, we aborted
    // because memory ran out. A hard-reset here would just repeat the same
    // skip and land us back in the same spot — better to bail out loudly
    // and have the operator raise MAX_OLD_SPACE_SIZE_MB.
    const postSkipSample = await sampleMemory(page);
    const skipShortByHeap = arrivedAt < startingPage
        && postSkipSample.jsHeap >= config.memory.jsHeapBytesCritical;

    if (skipShortByHeap) {

        logger.error(`Skip phase aborted at page ${arrivedAt}/${startingPage} due to heap pressure.`);
        logger.error(`Heap reached ${postSkipSample.formatted.jsHeap} — a reset+reskip would just repeat this.`);
        logger.error(`Fix: raise MAX_OLD_SPACE_SIZE_MB in .env (try 12288 or 16384 if you have the RAM),`);
        logger.error(`     or reduce STARTING_PAGE so the skip has less ground to cover.`);
        throw new Error(`Skip phase aborted at page ${arrivedAt}/${startingPage} (heap critical).`);

    } else if (arrivedAt !== startingPage) {

        logger.warn(`Could not reach STARTING_PAGE=${startingPage}; stopped at ${arrivedAt}.`);
    }

    let currentPage = arrivedAt;

    // -- Processing phase --------------------------------------------------
    while (true) {

        if (maxPagesToRun && state.pagesRan >= maxPagesToRun) {
            logger.info(`Reached NUMBER_PAGES_TO_RUN=${maxPagesToRun}, stopping.`);
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
        state.pagesSinceLastReset++;

        // Scheduled in-place cleanup even when thresholds aren't hit, to
        // keep the renderer's heap from drifting upward over long runs.
        if (state.pagesRan % MEMORY_THRESHOLDS.CLEANUP_EVERY_N_PAGES === 0) {
            await cleanupInPlace(page, { logger, label: `scheduled-p${currentPage}` });
            await trimOrphanTabs(browser, page, { logger });
        } else {
            // Light-touch check after every page — logs the memory trend
            // and triggers cleanup only if thresholds are breached.
            await runMemoryCheck({ mainPage: page, logger, label: `p${currentPage}` });
        }

        // Hard-reset check: when the heap has grown past the critical
        // threshold (leaked references that cleanup can't touch), OR when
        // the scheduled cadence fires, reload the main tab and re-skip.
        // This is the only effective remedy against MUI DataGrid leaks.
        const postPageSample = await sampleMemory(page);
        const resetReason = shouldHardReset({
            sample: postPageSample,
            pagesSinceLastReset: state.pagesSinceLastReset,
            everyNPages: config.hardReset.everyNPages,
            jsHeapBytesCritical: config.memory.jsHeapBytesCritical,
        });

        if (resetReason) {

            logger.warn(`[hard-reset] triggered: ${resetReason}`);

            await trimOrphanTabs(browser, page, { logger });

            currentPage = await hardResetMainPage(page, {
                config,
                logger,
                targetPage: currentPage,
            });

            state.pagesSinceLastReset = 0;
            state.hardResetsDone++;
            // After a successful reset we're still on `currentPage` and ready
            // to process its links — no need to advance here.
            continue;
        }

        if (linkCount === 0 && (await isOnLastPage(page))) {
            logger.info(`Page #${currentPage} appears to be the last one, stopping.`);
            break;
        }

        // Advance to the next page via click.
        const advanced = await gotoNextPage(page, { logger });
        if (!advanced) {
            logger.info(`Could not advance past page #${currentPage}, stopping.`);
            break;
        }

        currentPage++;
    }

    logger.info('Bot reached the end, stopping..');
    logger.info(
        `Summary: pagesRan=${state.pagesRan}, hardResets=${state.hardResetsDone}, ` +
        `lastPage=${state.lastProcessedPage}`,
    );

    try { await browser.close(); } catch (_) { /* ignore */ }
    await logger.close();
};

main().catch((err) => {

    console.error('Fatal error in main():', err && err.stack ? err.stack : err);
    process.exit(1);
});
