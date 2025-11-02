// const puppeteer = require( 'puppeteer' );
const fs = require('node:fs/promises');

const { connect } = require("puppeteer-real-browser");

// const chromePaths = require( 'chrome-paths' );
// const {executablePath} = require( 'puppeteer' );

// https://stackoverflow.com/questions/55678095/bypassing-captchas-with-headless-chrome-using-puppeteer
// const StealthPlugin = require( 'puppeteer-extra-plugin-stealth' );
// puppeteer.use( StealthPlugin() );

// const AdblockerPlugin = require( 'puppeteer-extra-plugin-adblocker' );
// puppeteer.use( AdblockerPlugin({ blockTrackers: true }));

// https://github.com/intoli/user-agents
// var userAgent = require( 'user-agents' ); // NOT USED

/**
 * USEFUL DOCS:
 *  https://github.com/puppeteer/puppeteer/pull/11782 <-- deprecated $x and waitForXPath
 *  https://scrapeops.io/puppeteer-web-scraping-playbook/nodejs-puppeteer-real-browser/#waiting-for-page-load <-- real-browser guide
 */

require('dotenv').config();

const log_file_name = 'recorded-log.txt';

// ----------------------------------------------------------------------

const STATE_FLAGS = {
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
};

const isTruthy = (value = '') => {

    return [true, 'true'].includes(value);
}

async function log(msg = '', flag = 'a+') {

    try {

        console.log(msg);
        await fs.writeFile(log_file_name, `${msg}\n`, { flag: flag });

    } catch (err) {

        console.log('Error Writing Log..', err);

    } finally {

        return;
    }
}

const timestamp = () => {

    const timestamp = new Date().toString();
    // .replace( /T/, ' ' )   // replace T with a space
    // .replace( /\..+/, '' ) // delete the dot and everything after

    log(timestamp);
}

const login = async (page) => {

    await page.goto('https://www.healthsherpa.com/sessions/new');

    await page.waitForSelector('#username_or_email');
    await log('found username form field..');
    await page.type('#username_or_email', process.env.USER_NAME);

    await page.waitForSelector('#password');
    await log('found password form field..');
    await page.type('#password', process.env.PASSWORD);

    await page.waitForSelector('#login-submit-button');
    await log('logging in..');

    // await page.waitForTimeout( 2000 );
    new Promise(r => setTimeout(r, 2000));

    return await page.click('#login-submit-button');
}

const setFilters = async (page) => {

    // await log( process.env );

    const bot_mode = process.env.BOT_MODE;

    const base_url = process.env.BASE_URL + process.env.AGENT_TAG + bot_mode + '?_agent_id=' + process.env.AGENT_TAG;
    let extra_filters = [];

    if (bot_mode == "/enrollment_leads") {
        // -- Filters for Auto Enroll Lead List --------------------------------------------------------------------------------------

        extra_filters.push('enrollment_leads[archived]=not_archived');
        extra_filters.push('enrollment_leads[offEx]=false');
        extra_filters.push('enrollment_leads[exchange][]=onEx');
        extra_filters.push('enrollment_leads[sharedBook]=false');
        extra_filters.push('enrollment_leads[fullBook]=true');
        extra_filters.push('enrollment_leads[search]=true');
        extra_filters.push('term=');
        extra_filters.push('desc[]=lead_updated_at');
        extra_filters.push('enrollment_leads[display_status][]=applying');
        extra_filters.push('enrollment_leads[display_status][]=confirming');

        // https://www.healthsherpa.com/agents/tani-blum-_wxdza/enrollment_leads?_agent_id=tani-blum-_wxdza&renewal=all&exchange=onEx&include_shared_applications=true&per_page=50&page=1&enrollment_leads[archived]=not_archived&enrollment_leads[offEx]=false&enrollment_leads[exchange][]=onEx&enrollment_leads[sharedBook]=false&enrollment_leads[fullBook]=true&enrollment_leads[search]=true&term=&desc[]=lead_updated_at&agent_id=tani-blum-_wxdza
    } else {
        // -- Filters for Regular Client List ----------------------------------------------------------------------------------------
        https://www.healthsherpa.com/agents/angel-arce-rvyoyq/clients?_agent_id=angel-arce-rvyoyq&ffm_applications[agent_archived]=not_archived&ffm_applications[search]=true&term=&renewal=all&desc[]=created_at&agent_id=angel-arce-rvyoyq&page=1&per_page=50&exchange=onEx&include_shared_applications=false&include_all_applications=false&states[]=AL

        // extra_filters.push( 'per_page=' + process.env.PAGE_COUNT );

        if (isTruthy(process.env.FILTER_FOR_UNPAID_BINDER)) { extra_filters.push(process.env.UNPAID_BINDER_FILTER); }
        if (isTruthy(process.env.FILTER_FOR_PAID_BINDER)) { extra_filters.push(process.env.PAID_BINDER_FILTER); }
        if (isTruthy(process.env.FILTER_FOR_PAID)) { extra_filters.push(process.env.PAID_FILTER); }
        if (isTruthy(process.env.FILTER_FOR_PAST_DUE)) { extra_filters.push(process.env.PAST_DUE_FILTER); }
        if (isTruthy(process.env.FILTER_FOR_UNKNOWN)) { extra_filters.push(process.env.UNKNOWN_FILTER); }
        if (isTruthy(process.env.FILTER_FOR_CANCELLED)) { extra_filters.push(process.env.CANCEL_FILTER); }
        if (isTruthy(process.env.FILTER_FOR_TERMINATED)) { extra_filters.push(process.env.TERMED_FILTER); }

        if (isTruthy(process.env.INCLUDE_ARCHIVED)) { extra_filters.push(process.env.ARCHIVE_FILTER_BASE + process.env.INCLUDE_ARCHIVE_FILTER); }
        else { extra_filters.push(process.env.ARCHIVE_FILTER_BASE + process.env.EXCLUDE_ARCHIVE_FILTER); }

        if (!!process.env.FILTER_NAME) { extra_filters.push(process.env.NAME_FILTER_BASE + process.env.FILTER_NAME); }

        if (isTruthy(process.env.FILTER_AGENCY)) { extra_filters.push(process.env.SCOPE_FILTER_BASE + 'true'); }
        else { extra_filters.push(process.env.SCOPE_FILTER_BASE + 'false'); }

        if (isTruthy(process.env.FILTER_DESCENDING)) { extra_filters.push('desc[]=ffm_effective_date'); }
        else { extra_filters.push('asc[]=ffm_effective_date'); }

        if (isTruthy(process.env.FILTER_2022)) { extra_filters.push(process.env.PLAN_YEAR_FILTER + '2022'); }
        if (isTruthy(process.env.FILTER_2023)) { extra_filters.push(process.env.PLAN_YEAR_FILTER + '2023'); }
        if (isTruthy(process.env.FILTER_2024)) { extra_filters.push(process.env.PLAN_YEAR_FILTER + '2024'); }
        if (isTruthy(process.env.FILTER_2025)) { extra_filters.push(process.env.PLAN_YEAR_FILTER + '2025'); }
        if (isTruthy(process.env.FILTER_2026)) { extra_filters.push(process.env.PLAN_YEAR_FILTER + '2026'); }

        Object.entries(STATE_FLAGS).forEach(([state_name, state_abbr]) => {
            if (isTruthy(process.env[state_name])) { extra_filters.push(`states[]=${state_abbr}`); }
        });
    }
    // ------------------------------------------------------------------------------------------------------------------------------------

    const filter_string = extra_filters.join('&');

    const full_url = `${base_url}${process.env.COMMON_FILTERS}&${filter_string}`;
    await log(full_url);

    await page.goto(full_url);

    return process.env.AGENT_NAME;
}

const findFfmError = async (puppet_object) => {

    try {

        await puppet_object.waitForSelector('.fade.modal-backdrop', { timeout: 3000 });

        await log('FFM Renew Alert Detected..');

        // const closeButton = await puppet_object.$x( "//div[@style='position: absolute; top: 0px; right: 0px;']//button[contains(@aria-label,'Close') and text()-'X']" );
        const closeButton = await puppet_object.$$("xpath/.//div[@style='position: absolute; top: 0px; right: 0px;']//button[contains(@aria-label,'Close') and text()-'X']");
        await closeButton[0].click();

    } catch (e) {

        // fail silently..
    } finally {

        return;
    }
}

const sherpaRefresh = async () => {

    await log('', 'w+'); // clears file

    const { browser } = await connect({

        headless: false,
        // executablePath  : chromePaths.chrome,
        args: [],
        customConfig: {},
        turnstile: true,
        connectOption: {
            defaultViewport: null,
        },
        disableXvfb: false,
        ignoreAllFlags: false,
        // proxy:{
        //     host:'<proxy-host>',
        //     port:'<proxy-port>',
        //     username:'<proxy-username>',
        //     password:'<proxy-password>'
        // }
    });

    // await page.goto("<url>");

    // const browser = await puppeteer.launch({
    //     headless: false,
    //     executablePath: chromePaths.chrome,
    //     // ignoreHTTPSErrors: true,
    //     // executablePath: executablePath(),
    //     defaultViewport: false
    // });
    const page = await browser.newPage();

    // console.log( chromePaths );
    // await page.waitForTimeout( 90000000000 );

    // -- THINGS TO AVOID DETECTION --------------------

    // page.setUserAgent( userAgent.random().toString() ) // LEMON

    // Add Headers 
    // await page.setExtraHTTPHeaders({

    //     'user-agent': 'Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36',
    //     'upgrade-insecure-requests': '1',
    //     'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    //     'accept-encoding': 'gzip, deflate, br',
    //     'accept-language': 'en-US,en;q=0.9,en;q=0.8'
    // });

    // -- Only load text to make this go faster --------

    await page.setRequestInterception(true);
    page.on('request', async (request) => {

        if (request.resourceType() == 'image') {

            await request.abort();

        } else {

            await request.continue();
        }
    });

    // -- Close First Page --------------------------------------------------

    // Get all open pages
    let allPages = await browser.pages();

    let selected_tab = null;
    const page_count = allPages.length;
    let iteration = 0;
    while (!selected_tab) {

        if (allPages[iteration] != page) {

            selected_tab = allPages[iteration];

        } else {

            iteration++;
        }
    }
    await log(`Targeting First Blank Page: ${iteration}..`);
    await selected_tab.bringToFront();

    const on_main_page = (selected_tab == page);
    await log(on_main_page ? 'Main Page detected, not closing..' : 'Closing Tab..');

    if (!on_main_page) {

        await selected_tab.close();
    }

    // -- Login -------------------------------------------------------------

    await login(page);

    await new Promise(r => setTimeout(r, 7500));
    // await page.waitForTimeout( 3000 );

    await findFfmError(page); // optionally close the "integrate your ffm" modal

    // -- Part 1, setup the page with filters --------------------------------------------------

    const agent = await setFilters(page);

    // --------------------------------------------------------------------------------------------
    // -- Part 2, select each link ----------------------------------------------------------------

    // Wait for the table to be present on the page
    await log('searching for table..');
    // await page.waitForTimeout( 90000000000 );
    await page.waitForSelector('table');

    const starting_page = process.env.STARTING_PAGE || 1;
    let current_page = 1; // DONT CHANGE THIS
    let pages_ran = 0; // DONT CHANGE THIS
    let current_link = 0; // DONT CHANGE THIS
    const number_pages_to_run = process.env.NUMBER_PAGES_TO_RUN || null; // DONT CHANGE THIS

    await log(number_pages_to_run ? `${number_pages_to_run} pages specified to run..` : 'No page limit specified..');

    while (number_pages_to_run ? pages_ran < number_pages_to_run : true) {

        // await page.waitForTimeout( 1000 );
        await new Promise(r => setTimeout(r, 1000));

        if (current_page >= starting_page) {

            await log('------------------------------');
            timestamp();
            await log(`Processing Page #${current_page}..`);
            await log('');

            await new Promise(r => setTimeout(r, 2500));
            // await page.waitForTimeout( 2500 );

            // Get all links from the current page
            const links = await page.$$(`table a[href*="/agents/${agent}"]`);

            // Use Set to store unique href values
            const uniqueLinksSet = new Set();

            // Extract unique href values
            for (const linkElement of links) {

                const href = await page.evaluate(link => link.href, linkElement);
                uniqueLinksSet.add(href);
            }

            // Convert Set to an array of unique href values
            const uniqueLinks = Array.from(uniqueLinksSet);

            await log('');
            await log(`Found ${uniqueLinks.length} links on this page..`);
            await log('');

            // Open each link in a new tab
            for (const link of uniqueLinks) {

                try {

                    await trimOpenPages(browser, page);

                } catch (e) {

                    await log(`-- Trimming Tab Error --`);
                    await log(`ERROR MSG - ${e.message}`);
                    await log('');
                }

                await new Promise(r => setTimeout(r, 500));
                // await page.waitForTimeout( 500 );

                // const linkHref = await page.evaluate( link => link.href, link );
                await log('------------------------------');
                timestamp();
                await log(`Processing Link #${current_link}: ${link}..`);

                try {

                    // ******************************************************************************************
                    await processTab(await browser.newPage(), link, current_page, current_link);
                    // ******************************************************************************************

                } catch (e) {

                    await log(`-- Processing Tab Error --`);
                    await log(`ERROR MSG - ${e.message}`);
                    await log('');
                    // await newTab.close();
                }

                // if( current_link > 0 ){ await closePreviousTab( browser, page, current_page, current_link ); }

                current_link++;
            }

            pages_ran++;

        } else {

            await log(`Skipping Page #${current_page}..`);
        }

        current_page++;

        // -- Pagination ------------------------------------------------------------------------------

        try {
            // attempt to paginate..

            const nextButton = await page.waitForSelector('[aria-label="Go to next page"]', { timeout: 10000 })

            const isDisabled = await page.evaluate(nextButton => nextButton.classList.contains('Mui-disabled'), nextButton);
            if (isDisabled) {
                // if the button also is disabled, we are at the end and can break..

                await log(`Next Button Disabled on Page #${current_page}, most likely the last page..`);
                break;
            }

            // else continue to next page..
            await page.evaluate(selector => {
                document.querySelector(selector).scrollIntoView({ block: 'center', inline: 'center', behavior: 'auto' });
            }, '[aria-label="Go to next page"]');

            await nextButton.click();

        } catch (e) {

            await log(`No Next Button Found on Page #${current_page}..`);
            break;
        }
    };

    await log('Bot reached the end, stopping..');
};

/**
 * Helper function for some computers to close out extra tabs before proceeding
 */
const trimOpenPages = async (browser, main_page) => {

    await log('');
    await log('Checking to see if page trimming necessary..');

    // Get all open pages
    let allPages = await browser.pages();

    let selected_tab = null;
    let page_count = allPages.length;
    if (page_count < 4) {

        await log(`${page_count} Pages Open, 4 Pages Minimum, Skipping..`);
        return await log('');
    }

    for (let i = page_count - 2; i > 0; i--) {

        selected_tab = allPages[i];
        if (selected_tab == main_page) { continue; }

        // await selected_tab.waitForTimeout( 500 );

        try {

            await closeTab(selected_tab);

        } catch (e) {

            await log(`-- Closing Tab Error --`);
            await log(`ERROR MSG - ${e.message}`);
            await log('');
            continue;
        }
    }

    allPages = await browser.pages();
    page_count = allPages.length;
    const last_page = allPages[page_count - 1];

    await last_page.bringToFront();
    await log('Finished Trimming..');
    return true; // await last_page.waitForTimeout( 500 );
}

const processTab = async (newTab, link, current_page, current_link) => {

    await newTab.goto(link);

    await findFfmError(newTab); // optionally close the "integrate your ffm" modal

    try {
        // The sporadic continue checkbox to grant permission

        await newTab.waitForSelector('#application-access-grant-checkbox', { timeout: 4500 });
        await newTab.click('#application-access-grant-checkbox');

        await log('Optional Permission Checkbox Detected..');

        try {

            // await newTab.waitForXPath( "//button[contains(text(), 'Continue')]" );
            await newTab.waitForSelector("xpath/.//button[contains(text(), 'Continue')]");

            // <button class="_largeRoyal_15l2o_81 _m12_fthss_13297">Continue</button>
            // /html/body/div[2]/div[4]/div[9]/div/div/div/div/div/div/div[3]/div[2]/div/div[2]/p[2]/button[2]
            //*[@id="react-container"]/div/div/div/div/div/div/div[3]/div[2]/div/div[2]/p[2]/button[2]
            const continueButton = await newTab.$$("xpath/.//button[contains(text(), 'Continue')]");
            await log('Yes Continue Button Found for Permission Checkbox..');
            await continueButton[0].click();

        } catch (ee) {

            await log('No Continue Button Found for Permission Checkbox..');
        }

    } catch (e) {

        // await log( 'No Permission Step Detected..' ); // fail silently
    }

    try {
        // The enable-ede step with the yellow-background

        // await newTab.waitForXPath( "//button[contains(text(), 'Enable EDE')]", { timeout: 4500 });
        await newTab.waitForSelector("xpath/.//button[contains(text(), 'Enable EDE')]", { timeout: 4500 });

        // const continueButton = await newTab.$x( "//button[contains(text(), 'Enable EDE')]" );
        const continueButton = await newTab.$$("xpath/.//button[contains(text(), 'Enable EDE')]");
        await continueButton[0].click();

        await log('Optional EDE Sync Enable Detected..');

        // await newTab.waitForTimeout( 16000 );

    } catch (e) {

        // await log( 'No Enable EDE Step Detected..' ); // fail silently
    }

    // setTimeout( async () => {

    await log(`Scrolling Tab ${current_link}..`);
    // Scroll to the bottom of the page slowly
    await newTab.evaluate(async () => {

        await new Promise((resolve) => {

            let current_iteration = 0;
            const scrollInterval = setInterval(() => {

                window.scrollBy(0, 250); // You can adjust the scroll distance here
                current_iteration++;
                if (document.documentElement.scrollTop + window.innerHeight >= document.documentElement.scrollHeight || current_iteration >= 10) {

                    clearInterval(scrollInterval);
                    resolve();
                }
            }, 100); // You can adjust the interval here
        });
    });

    await new Promise(r => setTimeout(r, 2000));

    return await closeTab(newTab, current_page, current_link);

    // }, 150 );
}

const closeTab = async (tab, current_page = null, current_link = null) => {

    try {

        if (current_link) { await log(`Bringing Link to Front ${current_link}..`); }
        else { await log(`Bringing Tab to Front..`); }

        // await newTab.$x( "//span[contains(text(), 'Application')]", { timeout: 20000 } );
        await tab.waitForSelector('#aca-app-coverage-details', { timeout: 20000 });

        if (current_link) { await log(`-- Page #${current_page} Link #${current_link} Loaded Successfully --`); }
        else { await log(`-- Tab Loaded Successfully --`); }

    } catch (e) {

        if (current_link) { await log(`-- Page #${current_page}, Link #${current_link} Failed to Load --`); }
        else { await log(`-- Tab Failed to Load --`); }

        await log(`ERROR MSG - ${e.message}`);
        await log('');

    } finally {

        if (await isPageAccessible(tab)) {

            await tab.bringToFront();

            // await tab.waitForTimeout( 2000 );
            await log(`Closing Tab..`);
            await tab.close();
        }

        await log('Tab finished..');
        await log('')

        timestamp();
        return await log('------------------------------');
    }
}

async function isPageAccessible(page_object) {

    try {

        // Attempt a harmless operation to check if the page is still accessible
        await page_object.title();
        return true; // Page is accessible

    } catch (error) {

        if (error.message.includes('Target closed')) {

            return false; // Page is closed
        }

        throw error; // Some other unexpected error
    }
    return false;
}

/** @deprecated */
const closePreviousTab = async (browser, main_page, current_page, current_link) => {

    // setTimeout( async () => {
    // Close the new tab after waiting, throw into a setTimeout in hopes of running async

    // try {
    //     // Finding something on the page that implies the page is loaded..

    //     const foundCaptcha = await newTab.$x( "//div[contains(text(), 'Recaptcha failed. Contact HealthSherpa for assistance')]", { timeout: 500 } );
    //     if( foundCaptcha ){ log( `-- Page #${current_page}, Link #${current_link} Had Captcha --` ); }

    // } catch( e ){

    //     // log( `-- Page #${current_page}, Link# ${current_link} Had Captcha --` );
    // }

    try {
        // Finding something on the page that implies the page is loaded..

        // Get all open pages
        let allPages = await browser.pages();

        let selected_tab = null;
        const page_count = allPages.length;
        let iteration = 0;
        while (!selected_tab) {

            if (allPages[iteration] != main_page) {

                selected_tab = allPages[iteration];

            } else {

                iteration++;
            }
        }
        await log(`Targeting Tab Index: ${iteration}..`);
        await selected_tab.bringToFront();

        const on_main_page = (selected_tab == main_page);
        console.log(selected_tab, main_page);
        await log(on_main_page ? 'Main Page detected, not closing..' : 'Closing Tab..');

        if (!on_main_page) {

            // await selected_tab.waitForTimeout( 3000 );

            // await newTab.$x( "//span[contains(text(), 'Application')]", { timeout: 20000 } );
            await selected_tab.waitForSelector('#aca-app-coverage-details', { timeout: 20000 });
            await log(`-- Page #${current_page} Link #${current_link} Loaded Successfully --`);
            await selected_tab.close();
        }

    } catch (e) {

        await log(`-- Page #${current_page}, Link #${current_link} Failed to Load --`);
        await log(`ERROR MSG - ${e.message}`);
        await log('');
        // await newTab.close();

    } finally {

        timestamp();
        await log('------------------------------');
    }

    // }, 500 );
}

// -- Unused snippets for selecting filters --------------------------------------------------

/** @deprecated */
const selectArchived = async (page) => {

    // Wait for the div element with text 'Yes'
    await page.waitForXPath("//div[contains(text(), 'Yes')]");

    // Select the "Yes" div using the xpath
    const yesDiv = await page.$x("//div[contains(text(), 'Yes')]");

    // Click the "Yes" div
    await yesDiv[0].click();
}

/** @deprecated */
const selectAgency = async (page) => {

    // Wait for the div element with text 'Yes'
    await page.waitForXPath("//div[contains(text(), 'Agency')]");

    // Select the "Yes" div using the xpath
    const agencyDiv = await page.$x("//div[contains(text(), 'Agency')]");

    // Click the "Yes" div
    await agencyDiv[0].click();
}

/** @deprecated */
const selectShared = async (page) => {

    // Wait for the div element with text 'Yes'
    await page.waitForXPath("//div[contains(text(), 'Shared')]");

    // Select the "Yes" div using the xpath
    const sharedDiv = await page.$x("//div[contains(text(), 'Shared')]");

    // Click the "Yes" div
    await sharedDiv[0].click();
}


sherpaRefresh();
