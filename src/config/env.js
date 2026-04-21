'use strict';

require('dotenv').config();

const { STATE_FLAGS, DEFAULT_MAX_OLD_SPACE_MB, HARD_RESET, MEMORY_THRESHOLDS } = require('./constants');

const isTruthy = (value) => {
    if (value === true) { return true; }
    if (typeof value !== 'string') { return false; }
    return ['true', '1', 'yes'].includes(value.trim().toLowerCase());
};

const readString = (key, fallback = '') => {
    const raw = process.env[key];
    return (raw === undefined || raw === null) ? fallback : String(raw);
};

const readInt = (key, fallback = null) => {
    const raw = process.env[key];
    if (raw === undefined || raw === null || raw === '') { return fallback; }
    const n = parseInt(raw, 10);
    return Number.isFinite(n) ? n : fallback;
};

const requireString = (key) => {
    const value = readString(key, '').trim();
    if (!value) {
        throw new Error(`Missing required environment variable: ${key}`);
    }
    return value;
};

/**
 * Build the static part of a filters URL from env.
 * The `page` query string parameter is left as a placeholder that
 * pagination.js will overwrite when navigating directly to a page number.
 */
const buildFilterPieces = () => {

    const botMode = readString('BOT_MODE', '/clients');
    const agentTag = requireString('AGENT_TAG');
    const baseUrl = `${requireString('BASE_URL')}${agentTag}${botMode}?_agent_id=${agentTag}`;

    const extra = [];

    if (botMode === '/enrollment_leads') {

        extra.push('enrollment_leads[archived]=not_archived');
        extra.push('enrollment_leads[offEx]=false');
        extra.push('enrollment_leads[exchange][]=onEx');
        extra.push('enrollment_leads[sharedBook]=false');
        extra.push('enrollment_leads[fullBook]=true');
        extra.push('enrollment_leads[search]=true');
        extra.push('term=');
        extra.push('desc[]=lead_updated_at');
        extra.push('enrollment_leads[display_status][]=applying');
        extra.push('enrollment_leads[display_status][]=confirming');

    } else {

        if (isTruthy(process.env.FILTER_FOR_UNPAID_BINDER)) { extra.push(readString('UNPAID_BINDER_FILTER')); }
        if (isTruthy(process.env.FILTER_FOR_PAID_BINDER)) { extra.push(readString('PAID_BINDER_FILTER')); }
        if (isTruthy(process.env.FILTER_FOR_PAID)) { extra.push(readString('PAID_FILTER')); }
        if (isTruthy(process.env.FILTER_FOR_PAST_DUE)) { extra.push(readString('PAST_DUE_FILTER')); }
        if (isTruthy(process.env.FILTER_FOR_UNKNOWN)) { extra.push(readString('UNKNOWN_FILTER')); }
        if (isTruthy(process.env.FILTER_FOR_CANCELLED)) { extra.push(readString('CANCEL_FILTER')); }
        if (isTruthy(process.env.FILTER_FOR_TERMINATED)) { extra.push(readString('TERMED_FILTER')); }

        const archiveBase = readString('ARCHIVE_FILTER_BASE');
        if (isTruthy(process.env.INCLUDE_ARCHIVED)) {
            extra.push(archiveBase + readString('INCLUDE_ARCHIVE_FILTER'));
        } else {
            extra.push(archiveBase + readString('EXCLUDE_ARCHIVE_FILTER'));
        }

        const filterName = readString('FILTER_NAME').trim();
        if (filterName) { extra.push(readString('NAME_FILTER_BASE') + filterName); }

        const scopeBase = readString('SCOPE_FILTER_BASE');
        extra.push(scopeBase + (isTruthy(process.env.FILTER_AGENCY) ? 'true' : 'false'));

        if (isTruthy(process.env.FILTER_DESCENDING)) {
            extra.push('desc[]=ffm_effective_date');
        } else {
            extra.push('asc[]=ffm_effective_date');
        }

        const planYearBase = readString('PLAN_YEAR_FILTER');
        for (const year of ['2022', '2023', '2024', '2025', '2026']) {
            if (isTruthy(process.env[`FILTER_${year}`])) {
                extra.push(planYearBase + year);
            }
        }

        for (const [flagName, stateAbbr] of Object.entries(STATE_FLAGS)) {
            if (isTruthy(process.env[flagName])) {
                extra.push(`states[]=${stateAbbr}`);
            }
        }
    }

    return {
        baseUrl,
        commonFilters: readString('COMMON_FILTERS'),
        extraFilters: extra,
        botMode,
    };
};

const parseFlagList = (raw) => {

    if (!raw) { return []; }

    // Accept comma or newline separated flags, each optionally starting with "--".
    return raw
        .split(/[,\n]+/)
        .map((flag) => flag.trim())
        .filter(Boolean)
        .map((flag) => (flag.startsWith('--') ? flag : `--${flag}`));
};

const loadConfig = () => {

    const { baseUrl, commonFilters, extraFilters, botMode } = buildFilterPieces();

    const maxOldSpaceMb = Math.max(
        1024,
        readInt('MAX_OLD_SPACE_SIZE_MB', DEFAULT_MAX_OLD_SPACE_MB) || DEFAULT_MAX_OLD_SPACE_MB,
    );

    // Critical heap threshold is normally a fraction of V8's ceiling so it
    // scales correctly when the user tunes MAX_OLD_SPACE_SIZE_MB. At 8 GB
    // ceiling this is 6 GB; at 16 GB ceiling it's 12 GB.
    //
    // For debugging/testing, the operator can override it with an absolute
    // value via JS_HEAP_CRITICAL_MB in .env. Useful to force a hard-reset
    // to fire at, say, 1 GB to verify the recovery flow works end-to-end.
    const jsHeapCriticalOverrideMb = readInt('JS_HEAP_CRITICAL_MB', null);
    const jsHeapBytesCritical = jsHeapCriticalOverrideMb
        ? jsHeapCriticalOverrideMb * 1024 * 1024
        : Math.floor(
            maxOldSpaceMb * 1024 * 1024 * MEMORY_THRESHOLDS.JS_HEAP_BYTES_CRITICAL_FRACTION,
        );

    return Object.freeze({
        credentials: {
            username: requireString('USER_NAME'),
            password: requireString('PASSWORD'),
        },
        agent: {
            name: requireString('AGENT_NAME'),
            tag: requireString('AGENT_TAG'),
        },
        botMode,
        pagination: {
            startingPage: Math.max(1, readInt('STARTING_PAGE', 1) || 1),
            maxPagesToRun: readInt('NUMBER_PAGES_TO_RUN', null),
        },
        urls: {
            baseUrl,
            commonFilters,
            extraFilters,
        },
        browser: {
            maxOldSpaceMb,
            extraFlags: parseFlagList(readString('EXTRA_BROWSER_FLAGS', '')),
        },
        hardReset: {
            // 0 disables preventive hard resets. Heap-triggered hard reset
            // (on the computed critical threshold) is NOT gated by this
            // value — it always fires when the critical threshold is crossed.
            everyNPages: Math.max(
                0,
                readInt('HARD_RESET_EVERY_N_PAGES', HARD_RESET.EVERY_N_PAGES)
                    ?? HARD_RESET.EVERY_N_PAGES,
            ),
        },
        memory: {
            jsHeapBytesCritical,
        },
    });
};

module.exports = {
    loadConfig,
    isTruthy,
};
