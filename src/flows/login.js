'use strict';

const { SELECTORS, TIMEOUTS } = require('../config/constants');
const { sleep, randomBetween, humanPause } = require('../core/timing');

const LOGIN_URL = 'https://www.healthsherpa.com/sessions/new';

/**
 * Attempt to dismiss the "integrate your FFM / renew" modal that sometimes
 * pops up after login. Silent no-op when the modal is not present.
 */
const dismissFfmModal = async (page, { logger } = {}) => {

    try {

        await page.waitForSelector(SELECTORS.FFM_MODAL_BACKDROP, { timeout: TIMEOUTS.FFM_MODAL });

        if (logger) { logger.info('FFM Renew Alert detected, closing modal..'); }

        const closeButtons = await page.$$(SELECTORS.FFM_CLOSE_BUTTON);
        if (closeButtons.length > 0) {
            await closeButtons[0].click().catch(() => {});
        }

    } catch (_) {
        // Modal not shown — this is the common case.
    }
};

/**
 * Perform the HealthSherpa login flow. After login, the caller must still
 * manually enter the Google auth code — that step is *not* automated on
 * purpose, and the surrounding bot must never close this tab.
 */
const login = async (page, { username, password, logger }) => {

    await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: TIMEOUTS.NAVIGATION });

    await page.waitForSelector(SELECTORS.USERNAME_INPUT);
    if (logger) { logger.info('found username form field..'); }
    await page.type(SELECTORS.USERNAME_INPUT, username, { delay: randomBetween(60, 120) });
    await humanPause(150, 350);

    await page.waitForSelector(SELECTORS.PASSWORD_INPUT);
    if (logger) { logger.info('found password form field..'); }
    await page.type(SELECTORS.PASSWORD_INPUT, password, { delay: randomBetween(60, 120) });
    await humanPause(200, 450);

    await page.waitForSelector(SELECTORS.LOGIN_BUTTON);
    if (logger) { logger.info('logging in..'); }

    await sleep(400 + randomBetween(100, 600));
    await page.click(SELECTORS.LOGIN_BUTTON);

    // Allow either an actual navigation event OR a time-based fallback so the
    // bot keeps going even when HealthSherpa renders the post-login page
    // client-side without triggering a full navigation.
    try {

        await Promise.race([
            page.waitForNavigation({ waitUntil: 'networkidle2', timeout: TIMEOUTS.LOGIN_AFTER_CLICK }),
            sleep(2000 + randomBetween(250, 800)),
        ]);

    } catch (_) { /* ignore */ }

    await sleep(300 + randomBetween(400, 900));
    await dismissFfmModal(page, { logger });
};

module.exports = {
    login,
    dismissFfmModal,
};
