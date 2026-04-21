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
    // HealthSherpa customer-support chat widget (WebSocket + iframe).
    // The bot never interacts with it, and its persistent connection adds
    // work to every tab we open.
    'niceincontact.com',
    'nicecxone.com',
    'incontact.com',
    // Additional common noise the bot doesn't need.
    'launchdarkly.com',
    'cloudflareinsights.com',
    'googlesyndication.com',
]);

// Memory watchdog thresholds — when exceeded, run cleanupInPlace.
//
// IMPORTANT: `process.memoryUsage().rss` is the NODE bot's RSS, not Chrome's.
// Chrome memory is what actually leaks, so all of the triggers below are
// based on Chromium-side signals read via `page.metrics()`:
//   - JS_HEAP_BYTES:       renderer JS heap ceiling before forced cleanup
//   - DOM_NODES:           total DOM nodes — MUI DataGrid virtualization leaks
//                          manifest here. 25k+ means rows aren't being recycled.
//   - JS_EVENT_LISTENERS:  React effect leaks show up as climbing listener counts.
const MEMORY_THRESHOLDS = Object.freeze({
    JS_HEAP_BYTES: 250 * 1024 * 1024,          // 250 MB JS heap → in-place cleanup
    // NOTE: JS_HEAP_BYTES_CRITICAL is *computed* at runtime from the V8 heap
    // ceiling (see env.js), because an absolute number doesn't make sense:
    // it must always be a fraction of the actual ceiling to leave headroom
    // for the heap spike that the hard reset itself causes mid-reset.
    // Config exposes it as `config.memory.jsHeapBytesCritical`.
    JS_HEAP_BYTES_CRITICAL_FRACTION: 0.75,     // 75% of V8 max-old-space-size
    DOM_NODES: 25_000,
    JS_EVENT_LISTENERS: 15_000,
    SAMPLE_EVERY_N_LINKS: 5,                   // how often to sample memory during link processing
    CLEANUP_EVERY_N_LINKS: 25,                 // scheduled cleanup cadence inside a page (links)
    CLEANUP_EVERY_N_PAGES: 5,                  // scheduled cleanup cadence during processing phase
    // Skip phase is the most memory-hostile one (159 rapid clicks back-to-back
    // with no time to breathe). Everything here is intentionally more aggressive.
    //
    // Empirically, `cleanupInPlace` during skip reclaims ~60-90 MB per run
    // but the DataGrid leak adds ~150 MB per 5 skipped pages, so cleanup at
    // cadence 5 keeps up with only ~1/3 of the leak. Cadence 2 brings this
    // up to ~5/6, which translates to a much flatter heap curve across the
    // skip (e.g. ending the skip near ~2.5 GB instead of ~3.6 GB for 160
    // skipped pages). Cost: ~1.5-2 extra min for a 160-page skip.
    SKIP_CLEANUP_EVERY_N_PAGES: 2,
    SKIP_CLICK_DELAY_MIN_MS: 2_000,
    SKIP_CLICK_DELAY_MAX_MS: 3_500,
});

// Hard-reset = reload the main page to drop the accumulated renderer heap,
// then click-skip back to the page we were on.  Cookies survive the reload,
// so the Google auth session does NOT need to be re-entered.
//
// IMPORTANT caveat: the MUI DataGrid row-retention leak RE-BUILDS during
// the re-skip (every skipped page loads rows that the grid then retains),
// so the reset only recovers the portion of the heap that came from child
// tab cycles (processLink). That's typically ~500-700 MB out of a 1.5 GB
// heap — not nothing, but not a miracle either.
//
// Defaults below reflect that trade-off:
//   - EVERY_N_PAGES = 0 : no preventive resets. The reset will only fire
//     if JS_HEAP_BYTES_CRITICAL is crossed, i.e. in an actual emergency
//     where continuing would probably OOM.
//   - Set EVERY_N_PAGES to a positive number via HARD_RESET_EVERY_N_PAGES
//     in .env if you have a very long run (>500 pages) and want periodic
//     trimming even at the cost of re-skip time.
const HARD_RESET = Object.freeze({
    EVERY_N_PAGES: 0,                          // preventive reload cadence (0 = disabled, emergency-only)
    POST_RELOAD_WAIT_MS: 3_000,                // breather after reload before re-skip starts
});

// Retry behaviour when the "Next page" click fails to re-render the grid.
// This is our last-chance safety net before concluding we're stuck — we do
// one more cleanup pass, wait a moment, then try once more.
const PAGE_RETRY = Object.freeze({
    ATTEMPTS: 3,
    BETWEEN_ATTEMPTS_MS: 5_000,
});

// Storage types safe to clear on healthsherpa.com origin without killing the
// Google auth session. `cookies` and `local_storage` are deliberately omitted.
// `indexeddb` is also omitted as a precaution — some OAuth libraries use it.
const STORAGE_TYPES_TO_CLEAR = 'cache_storage,shader_cache,service_workers,websql,file_systems,appcache';

// Cleanup / trimming cadence
const CLEANUP = Object.freeze({
    TRIM_ORPHAN_TABS_EVERY_N_LINKS: 10,
    MIN_OPEN_TABS_BEFORE_TRIM: 2,              // main page + optional processing page
    SCROLL_STEP_PX: 250,
    SCROLL_MAX_ITERATIONS: 10,
    SCROLL_INTERVAL_MS: 100,
});

const LOG_FILE_NAME = 'recorded-log.txt';

// -----------------------------------------------------------------------
// Chromium launch tuning.
//
// V8's per-renderer heap defaults to ~2-4 GB regardless of how much RAM the
// machine has. We explicitly raise it so the HealthSherpa SPA has headroom
// to grow before the OOM ceiling is hit. Switching to Edge/Brave/Chrome
// doesn't help here — they all share the same V8 engine and the same limit.
const DEFAULT_MAX_OLD_SPACE_MB = 8192;

// Flags that make the Chromium renderer more predictable for a long-running
// automation session. None of these compromise the visible UX, but they
// avoid subtle failures (e.g. MUI timers pausing when the window loses
// focus, making Next-click waits time out).
const DEFAULT_BROWSER_FLAGS = Object.freeze([
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-background-timer-throttling',
    '--disable-ipc-flooding-protection',
    '--disable-hang-monitor',
    '--disable-breakpad',
    '--disable-features=IsolateOrigins,site-per-process,TranslateUI',
]);

module.exports = {
    STATE_FLAGS,
    SELECTORS,
    TIMEOUTS,
    BLOCKED_RESOURCE_TYPES,
    BLOCKED_URL_PATTERNS,
    MEMORY_THRESHOLDS,
    PAGE_RETRY,
    STORAGE_TYPES_TO_CLEAR,
    CLEANUP,
    LOG_FILE_NAME,
    DEFAULT_MAX_OLD_SPACE_MB,
    DEFAULT_BROWSER_FLAGS,
    HARD_RESET,
};
