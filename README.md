# HealthSherpa bot

Automated client/enrollment list processor for HealthSherpa. Logs in, paginates
through the results grid, and walks each linked application to keep it warm.

The bot is designed to run **for hours or days at a time** on a single browser
instance without requiring a restart — important because the operator must
manually enter a Google auth code at the very start of each session.

## Quick start

```bash
npm install
cp .env.example .env         # edit to taste
npm start
```

When the browser opens, complete the Google authentication manually. The bot
will then drive the rest of the flow.

To resume after a crash or planned stop, set `STARTING_PAGE=N` in `.env` and
launch again.

## Project layout

```
index.js                 # Thin orchestrator (~120 lines)
src/
  config/
    constants.js         # Selectors, timeouts, memory thresholds, blocklist
    env.js               # .env loader + validator; exposes loadConfig()
    browserPaths.js      # Brave/Chrome auto-detection per OS
  core/
    logger.js            # Append-only file stream + console mirror
    timing.js            # sleep / randomBetween / humanPause
    browser.js           # connect() + request interception for every tab
    memory.js            # softResetMainPage, sampleMemory, trimOrphanTabs
    shutdown.js          # SIGINT/SIGTERM + unhandled error handlers
  flows/
    login.js             # Login form + FFM modal dismissal
    filters.js           # Build filters URL from env, visit it
    pagination.js        # Direct URL-based page navigation
    processLink.js       # Open one application tab, run steps, dispose
    processPage.js       # Iterate links on the current results page
```

## Why this version does not run out of memory

The previous implementation crashed with
`Aw, Snap! Out of Memory` after several hours, because:

1. It navigated results pages by clicking "Next page" N times on the same
   MUI DataGrid, accumulating DOM, cached rows, analytics, images, and
   trackers until the renderer ran out of memory.
2. **Request interception was only applied to the main page** — every new
   tab re-downloaded images, fonts, analytics, trackers, etc.
3. Browser cache was never cleared.
4. Orphan tabs and listener closures leaked between iterations.

HealthSherpa blocks deep-linking to arbitrary page numbers via URL, so
we still have to click "Next page" to advance. The mitigations in this
version — all of which preserve cookies so the Google auth session is
never lost — are:

- **In-place memory cleanup via CDP** — `src/core/memory.js::cleanupInPlace`
  runs `HeapProfiler.collectGarbage` three times and
  `Network.clearBrowserCache` through the DevTools Protocol without
  navigating anywhere. Cookies and sessionStorage are left untouched.
- **Cleanup during the skip-forward phase** — when the bot starts with
  `STARTING_PAGE=160` it must click Next 159 times before processing
  anything. `skipToStartingPage` invokes `cleanupInPlace` every N pages
  (default 20) so the grid's heap never reaches the OOM ceiling during
  the skip.
- **Global request interception** — `src/core/browser.js` attaches a
  `targetcreated` listener so every new tab blocks `image`, `media`,
  `font`, plus a curated tracker/analytics domain blocklist.
- **Memory watchdog** — `sampleMemory()` checks process RSS and JS heap
  every `SAMPLE_EVERY_N_LINKS` links and runs an extra cleanup when
  thresholds (default 1.5 GB RSS / 500 MB JS heap) are exceeded.
- **Scheduled cleanup** — once per `CLEANUP_EVERY_N_PAGES` pages the
  bot runs `cleanupInPlace` unconditionally, so the renderer's heap
  doesn't drift upward over long runs.
- **Raised V8 heap ceiling** — `--js-flags=--max-old-space-size=N` raises
  Chromium's per-renderer heap limit from the default 2-4 GB to 8 GB
  (configurable via `MAX_OLD_SPACE_SIZE_MB`). Switching to Edge/Chrome
  instead of Brave would not help — they all share the same V8 engine
  with the same default ceiling.
- **Background-throttling disabled** — `--disable-renderer-backgrounding`,
  `--disable-background-timer-throttling` and friends stop Chromium from
  pausing the tab when it loses focus, which otherwise makes MUI timers
  stall and Next-click waits time out.
- **HTTP cache disabled globally** — via `Network.setCacheDisabled` on
  every tab, so the cache can never accumulate gigabytes of MUI bundles
  and JSON responses during a multi-hour session.
- **Per-origin storage wipe** — each `cleanupInPlace` also calls
  `Storage.clearDataForOrigin` with `cache_storage,shader_cache,service_workers,websql,file_systems,appcache`
  (cookies and localStorage are deliberately preserved).
- **Click retry with cleanup** — when the "Next page" click fails to
  re-render the grid (classic symptom of an imminent OOM), the bot runs
  a full `cleanupInPlace`, waits, and retries up to 3 times before
  giving up.
- **Tab hygiene** — `trimOrphanTabs` sweeps stray tabs every
  `TRIM_ORPHAN_TABS_EVERY_N_LINKS` links, and each processing tab is
  disposed with `detachInterception` → `about:blank` → `close`.
- **Graceful shutdown** — SIGINT/SIGTERM/uncaughtException log the last
  processed page so the operator can resume via `STARTING_PAGE=N+1`.

All thresholds live in [`src/config/constants.js`](src/config/constants.js) and
can be tuned without touching the flow code.

## Key environment variables

| Variable                   | Purpose                                                                                          |
|----------------------------|--------------------------------------------------------------------------------------------------|
| `USER_NAME`, `PASSWORD`    | HealthSherpa credentials                                                                         |
| `AGENT_NAME`, `AGENT_TAG`  | Which agent's list the bot operates on                                                           |
| `BOT_MODE`                 | `/clients` (default) or `/enrollment_leads`                                                      |
| `STARTING_PAGE`            | Page number to start on; set this after a restart to resume                                      |
| `NUMBER_PAGES_TO_RUN`      | Empty = run forever; otherwise stop after N pages                                                |
| `BROWSER`                  | `brave` or `chrome` (default preference order)                                                   |
| `BROWSER_EXECUTABLE_PATH`  | Full override path to the browser binary                                                         |
| `MAX_OLD_SPACE_SIZE_MB`    | V8 heap ceiling per renderer (default `8192`). Raise on machines with 32 GB+ RAM, lower on 8 GB  |
| `EXTRA_BROWSER_FLAGS`      | Comma-separated extra Chromium launch flags                                                      |
| `FILTER_*`, `STATE_*`      | Result filters — see `.env.example` for the full catalogue                                       |

`.env.example` documents every option and is kept in sync with the code.

## Resuming after a crash

On clean shutdown (Ctrl+C, SIGTERM, or uncaught exception) the bot prints a
line like:

```
To resume, set STARTING_PAGE=161 in your .env
```

Update `.env` accordingly and restart. Because pagination is URL-based, the
bot jumps straight to that page without traversing earlier ones.
