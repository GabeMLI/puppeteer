'use strict';

/**
 * Central repository for selectors, timeouts, and tunable thresholds.
 * Keep magic numbers out of flow code — adjust behaviour here.
 */

const STATE_FLAGS = Object.freeze({
    FILTER_FOR_ALABAMA: 'AL',
    FILTER_FOR_ALASKA: 'AK',
    FILTER_FOR_ARIZONA: 'AZ',
    FILTER_FOR_ARKANSAS: 'AR',
    FILTER_FOR_DELAWARE: 'DE',
    FILTER_FOR_FLORIDA: 'FL',
    FILTER_FOR_GEORGIA: 'GA',
    FILTER_FOR_ILLINOIS: 'IL',
    FILTER_FOR_INDIANA: 'IN',
    FILTER_FOR_IOWA: 'IA',
    FILTER_FOR_KANSAS: 'KS',
    FILTER_FOR_LOUISIANA: 'LA',
    FILTER_FOR_MICHIGAN: 'MI',
    FILTER_FOR_MISSISSIPPI: 'MS',
    FILTER_FOR_MISSOURI: 'MO',
    FILTER_FOR_MONTANA: 'MT',
    FILTER_FOR_NEBRASKA: 'NE',
    FILTER_FOR_NEW_HAMPSHIRE: 'NH',
    FILTER_FOR_NORTH_CAROLINA: 'NC',
    FILTER_FOR_NORTH_DAKOTA: 'ND',
    FILTER_FOR_OHIO: 'OH',
    FILTER_FOR_OKLAHOMA: 'OK',
    FILTER_FOR_OREGON: 'OR',
    FILTER_FOR_SOUTH_CAROLINA: 'SC',
    FILTER_FOR_TENNESSEE: 'TN',
    FILTER_FOR_TEXAS: 'TX',
    FILTER_FOR_UTAH: 'UT',
    FILTER_FOR_WEST_VIRGINIA: 'WV',
    FILTER_FOR_WISCONSIN: 'WI',
    FILTER_FOR_WYOMING: 'WY',
});

const SELECTORS = Object.freeze({
    USERNAME_INPUT: '#username_or_email',
    PASSWORD_INPUT: '#password',
    LOGIN_BUTTON: '#login-submit-button',
    FFM_MODAL_BACKDROP: '.fade.modal-backdrop',
    FFM_CLOSE_BUTTON:
        "xpath/.//div[@style='position: absolute; top: 0px; right: 0px;']//button[contains(@aria-label,'Close') and (text()='X' or contains(text(),'X'))]",
    RESULTS_CONTAINER: '[role="grid"], .MuiDataGrid-main',
    NEXT_PAGE_BUTTON: '[aria-label="Go to next page"]',
    PERMISSION_CHECKBOX: '#application-access-grant-checkbox',
    CONTINUE_BUTTON_XPATH: "xpath/.//button[contains(text(), 'Continue')]",
    ENABLE_EDE_BUTTON_XPATH: "xpath/.//button[contains(text(), 'Enable EDE')]",
    APP_COVERAGE_DETAILS: '#aca-app-coverage-details',
});

const TIMEOUTS = Object.freeze({
    DEFAULT: 30_000,
    NAVIGATION: 30_000,
    LOGIN_AFTER_CLICK: 15_000,
    RESULTS_GRID: 30_000,
    FFM_MODAL: 3_000,
    PERMISSION_CHECKBOX: 4_500,
    ENABLE_EDE: 4_500,
    APP_COVERAGE_DETAILS: 20_000,
});

// Resource types always blocked on every tab (big memory wins).
const BLOCKED_RESOURCE_TYPES = Object.freeze([
    'image',
    'media',
    'font',
]);

// Known third-party tracker/analytics hosts. Blocked entirely to keep
// renderer heap small during long runs.
const BLOCKED_URL_PATTERNS = Object.freeze([
    'google-analytics.com',
    'googletagmanager.com',
    'googletagservices.com',
    'googleadservices.com',
    'doubleclick.net',
    'facebook.net',
    'facebook.com/tr',
    'connect.facebook.net',
    'segment.io',
    'segment.com',
    'intercom.io',
    'intercomcdn.com',
    'intercomassets.com',
    'hotjar.com',
    'mixpanel.com',
    'fullstory.com',
    'fullstory.io',
    'mouseflow.com',
    'clarity.ms',
    'amplitude.com',
    'heap.io',
    'heapanalytics.com',
    'optimizely.com',
    'sentry.io',
    'bugsnag.com',
    'datadoghq.com',
    'newrelic.com',
    'pendo.io',
    'tiktok.com',
    'snapchat.com',
    'pinterest.com',
    'linkedin.com/px',
    'licdn.com/px',
]);

// Memory watchdog thresholds — when exceeded, trigger softResetMainPage.
const MEMORY_THRESHOLDS = Object.freeze({
    RSS_BYTES: 1_500 * 1024 * 1024,           // 1.5 GB process RSS
    JS_HEAP_BYTES: 500 * 1024 * 1024,          // 500 MB JS heap on main tab
    SAMPLE_EVERY_N_LINKS: 10,                  // how often to sample
    SOFT_RESET_EVERY_N_PAGES: 20,              // forced reset cadence
});

// Cleanup / trimming cadence
const CLEANUP = Object.freeze({
    TRIM_ORPHAN_TABS_EVERY_N_LINKS: 10,
    MIN_OPEN_TABS_BEFORE_TRIM: 2,              // main page + optional processing page
    SCROLL_STEP_PX: 250,
    SCROLL_MAX_ITERATIONS: 10,
    SCROLL_INTERVAL_MS: 100,
});

const LOG_FILE_NAME = 'recorded-log.txt';

module.exports = {
    STATE_FLAGS,
    SELECTORS,
    TIMEOUTS,
    BLOCKED_RESOURCE_TYPES,
    BLOCKED_URL_PATTERNS,
    MEMORY_THRESHOLDS,
    CLEANUP,
    LOG_FILE_NAME,
};
