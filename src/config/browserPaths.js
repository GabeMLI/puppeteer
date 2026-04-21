'use strict';

const fs = require('node:fs');

/**
 * Known install locations for Brave and Chrome across platforms.
 * Checked in order; the first existing path wins.
 */
const DEFAULT_BROWSER_PATHS = Object.freeze({
    brave: {
        darwin: [
            '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
        ],
        linux: [
            '/usr/bin/brave-browser',
            '/usr/bin/brave',
            '/snap/bin/brave',
            '/opt/brave.com/brave/brave-browser',
        ],
        win32: [
            'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
            'C:\\Program Files (x86)\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
            `${process.env.LOCALAPPDATA || ''}\\BraveSoftware\\Brave-Browser\\Application\\brave.exe`,
        ],
    },
    chrome: {
        darwin: [
            '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
            '/Applications/Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta',
            '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
            '/Applications/Chromium.app/Contents/MacOS/Chromium',
        ],
        linux: [
            '/usr/bin/google-chrome',
            '/usr/bin/google-chrome-stable',
            '/usr/bin/chromium-browser',
            '/usr/bin/chromium',
            '/snap/bin/chromium',
        ],
        win32: [
            'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
            'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
            `${process.env.LOCALAPPDATA || ''}\\Google\\Chrome\\Application\\chrome.exe`,
        ],
    },
});

const findFirstExistingPath = (paths = []) => {

    for (const candidate of paths) {

        if (!candidate) { continue; }

        try {
            if (fs.existsSync(candidate)) { return candidate; }
        } catch (_) { /* ignore */ }
    }

    return null;
};

const detectBrowser = (name) => {

    const byPlatform = DEFAULT_BROWSER_PATHS[name];
    if (!byPlatform) { return null; }

    return findFirstExistingPath(byPlatform[process.platform] || []);
};

/**
 * Resolve which browser executable to launch based on env overrides.
 * Returns { path, name } or null if nothing was found.
 *
 * Priority:
 *   1. BROWSER_EXECUTABLE_PATH / BRAVE_PATH / CHROME_PATH (explicit override)
 *   2. BROWSER env var ("brave" or "chrome") picks that one first, falls back to the other
 *   3. USE_BRAVE=true prefers Brave, falls back to Chrome
 *   4. Default: try Brave first, then Chrome
 */
const getBrowserExecutable = (env = process.env) => {

    const forcedPath = env.BROWSER_EXECUTABLE_PATH
        || env.BRAVE_PATH
        || env.CHROME_PATH;

    if (forcedPath) {
        return { path: forcedPath, name: 'custom' };
    }

    const preference = (env.BROWSER || '').toLowerCase();
    const useBrave = ['true', '1', 'yes'].includes((env.USE_BRAVE || '').toLowerCase());

    let order;
    if (preference === 'chrome') {
        order = ['chrome', 'brave'];
    } else if (preference === 'brave' || useBrave) {
        order = ['brave', 'chrome'];
    } else {
        order = ['brave', 'chrome'];
    }

    for (const name of order) {
        const path = detectBrowser(name);
        if (path) { return { path, name }; }
    }

    return null;
};

module.exports = {
    DEFAULT_BROWSER_PATHS,
    getBrowserExecutable,
};
