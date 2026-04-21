'use strict';

/**
 * Register SIGINT / SIGTERM / unhandledRejection / uncaughtException handlers
 * so the bot closes the log stream and the browser cleanly and prints the
 * last processed page, which the operator can plug into STARTING_PAGE to
 * resume without losing progress.
 *
 * The context object is mutable and shared with the main loop:
 *   { browser, logger, state: { lastProcessedPage, linkNumber } }
 */
const installShutdownHandlers = (ctx) => {

    let shuttingDown = false;

    const shutdown = async (reason, { code = 0, err = null } = {}) => {

        if (shuttingDown) { return; }
        shuttingDown = true;

        const logger = ctx.logger;

        try {

            if (logger) {
                logger.info('');
                logger.divider();
                logger.info(`Shutdown requested: ${reason}`);
                if (err) { logger.error(`Reason error: ${err.stack || err.message || String(err)}`); }

                if (ctx.state) {
                    logger.info(`Last processed page: ${ctx.state.lastProcessedPage ?? 'n/a'}`);
                    logger.info(`Total links attempted: ${ctx.state.linkNumber ?? 0}`);
                    if (ctx.state.lastProcessedPage) {
                        logger.info(`To resume, set STARTING_PAGE=${ctx.state.lastProcessedPage + 1} in your .env`);
                    }
                }

                logger.divider();
            }

        } catch (_) { /* swallow — we're exiting anyway */ }

        // The browser must NOT be force-closed when the user is mid-way
        // through the manual Google auth step on start-up, so only close it
        // once we actually have a reference.
        try {

            if (ctx.browser) {
                await ctx.browser.close().catch(() => {});
            }

        } catch (_) { /* ignore */ }

        try {

            if (logger) { await logger.close(); }

        } catch (_) { /* ignore */ }

        process.exit(code);
    };

    process.once('SIGINT',  () => shutdown('SIGINT',  { code: 130 }));
    process.once('SIGTERM', () => shutdown('SIGTERM', { code: 143 }));

    process.on('unhandledRejection', (err) => {

        if (ctx.logger) {
            ctx.logger.error(`unhandledRejection: ${err && err.stack ? err.stack : err}`);
        }
        // Don't exit — unhandled rejections are survivable for a long-running bot.
    });

    process.on('uncaughtException', (err) => {

        // Uncaught exceptions leave the event loop in an undefined state,
        // so we do shut down after logging.
        shutdown('uncaughtException', { code: 1, err });
    });

    return shutdown;
};

module.exports = {
    installShutdownHandlers,
};
