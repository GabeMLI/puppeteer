'use strict';

const { SELECTORS, CLEANUP, MEMORY_THRESHOLDS } = require('../config/constants');
const { sleep, randomBetween } = require('../core/timing');
const { sampleMemory, cleanupInPlace, trimOrphanTabs } = require('../core/memory');
const { processLink } = require('./processLink');

/**
 * Extract unique processing URLs from the results grid on the main page.
 * Deduped because the MUI DataGrid often renders the same href in
 * multiple cells per row.
 */
const extractLinksForAgent = async (page, agentName) => {

    const anchorSelector = `${SELECTORS.RESULTS_CONTAINER} a[href*="/agents/${agentName}"]`;
    const hrefs = await page.$$eval(anchorSelector, (anchors) => anchors.map((a) => a.href));
    return Array.from(new Set(hrefs));
};

/**
 * Iterate all links on the currently-loaded results page, processing each
 * in a short-lived tab. Between iterations we:
 *   - trim any orphan tabs left behind by errors
 *   - sample memory and run an in-place cleanup when thresholds are exceeded
 *
 * Because HealthSherpa blocks deep-linking to arbitrary page numbers, we
 * never navigate the main page away — `cleanupInPlace` relies on CDP GC
 * + cache clearing without leaving the current paginated state.
 *
 * @returns {Promise<{ linkCount: number, cleanupTriggered: boolean }>}
 */
const processCurrentPage = async ({ browser, mainPage, config, logger, state, pageNumber }) => {

    logger.divider();
    logger.timestamp();
    logger.info(`Processing Page #${pageNumber}..`);

    await sleep(1000);

    const links = await extractLinksForAgent(mainPage, config.agent.name);

    logger.info('');
    logger.info(`Found ${links.length} links on this page..`);
    logger.info('');

    let cleanupTriggered = false;

    for (const link of links) {

        state.linkNumber++;

        if (state.linkNumber % CLEANUP.TRIM_ORPHAN_TABS_EVERY_N_LINKS === 0) {
            try { await trimOrphanTabs(browser, mainPage, { logger }); }
            catch (err) { logger.warn(`trimOrphanTabs threw: ${err.message}`); }
        }

        if (state.linkNumber % MEMORY_THRESHOLDS.SAMPLE_EVERY_N_LINKS === 0) {

            const sample = await sampleMemory(mainPage);
            logger.info(`[memory] RSS=${sample.formatted.rss} heap=${sample.formatted.jsHeap}`);

            if (sample.exceeded) {

                logger.warn(`[memory] threshold exceeded (RSS=${sample.formatted.rss}, heap=${sample.formatted.jsHeap}), running in-place cleanup.`);
                await cleanupInPlace(mainPage, { logger, label: 'memory-threshold' });
                cleanupTriggered = true;
            }
        }

        await sleep(500 + randomBetween(0, 300));

        logger.divider();
        logger.timestamp();
        logger.info(`Processing Link #${state.linkNumber}: ${link}..`);

        await processLink(browser, link, {
            pageNumber,
            linkNumber: state.linkNumber,
            logger,
        });

        state.lastProcessedPage = pageNumber;
    }

    return { linkCount: links.length, cleanupTriggered };
};

module.exports = {
    processCurrentPage,
    extractLinksForAgent,
};
