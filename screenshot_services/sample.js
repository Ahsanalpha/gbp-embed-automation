const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

function getDefaultProfilePath() {
    const os = require("os");
    const platform = os.platform();
    const path = require("path");
    let profileDir;

    switch (platform) {
      case "win32":
        // For Windows
        profileDir = path.join(
          os.homedir(),
          "AppData",
          "Local",
          "Google",
          "Chrome",
          "User Data",
          "Default"
        );
        break;

      case "darwin":
        // For macOS
        profileDir = path.join(
          os.homedir(),
          "Library",
          "Application Support",
          "Google",
          "Chrome"
        );
        break;

      case "linux":
        // For Linux
        profileDir = path.join(os.homedir(), ".config", "google-chrome");
        break;

      default:
        // For any other platform, use a temp directory
        profileDir = path.join(os.tmpdir(), "puppeteer-default-profile");
        break;
    }
    console.log(`📁 Using profile directory: ${profileDir}`);
    return profileDir;
  }

async function automateChrome() {
    let browser;

    try {

        const defaultProfilePath = getDefaultProfilePath();

        // Launch Chrome with dev tools enabled
        browser = await puppeteer.launch({
            headless: false, // Set to true if you don't want to see the browser
            // devtools: true,  // Open dev tools automatically
            slowMo: true,
             userDataDir: defaultProfilePath,
            args: [
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-dev-shm-usage",
                "--disable-accelerated-2d-canvas",
                "--disable-blink-features=AutomationControlled",
                "--disable-features=VizDisplayCompositor",
                "--window-size=1920,1200",
                "--start-maximized",
                "--disable-geolocation", // Disables location entirely
                "--use-fake-ui-for-media-stream", // Prevents permission prompt
                "--start-fullscreen",]
        });

        const page = await browser.newPage();

        // Set viewport size
        await page.setViewport({ width: 1920, height: 1080 });
        await page.setUserAgent(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        );

        // Remove webdriver property to avoid detection
        await page.evaluateOnNewDocument(() => {
            Object.defineProperty(navigator, "webdriver", {
                get: () => undefined,
            });
            Object.defineProperty(navigator, "languages", {
                get: () => ["en-US", "en"],
            });
            Object.defineProperty(navigator, "plugins", {
                get: () => [1, 2, 3, 4, 5],
            });
        });

        // Override the plugins property to avoid detection
        await page.evaluateOnNewDocument(() => {
            const originalQuery = window.navigator.permissions.query;
            return (window.navigator.permissions.query = (parameters) =>
                parameters.name === "notifications"
                    ? Promise.resolve({ state: Notification.permission })
                    : originalQuery(parameters));
        });


        // Navigate to Google
        console.log('Opening Google...');
        await page.goto('https://www.google.com', {
            waitUntil: 'networkidle2'
        });

        // Find the Google search input box
        console.log('Looking for Google search input...');

        // Google search input selectors (try multiple in case Google changes their HTML)
        const searchSelectors = [
            'input[name="q"]',           // Most common
            'textarea[name="q"]',        // Sometimes it's a textarea
            '[role="combobox"]',         // ARIA role
            '.gLFyf',                    // Class name (may change)
            '#APjFqb'                    // ID (may change)
        ];

        let searchInput = null;
        for (const selector of searchSelectors) {
            searchInput = await page.$(selector);
            if (searchInput) {
                console.log(`Found search input with selector: ${selector}`);
                break;
            }
        }

        if (searchInput) {
            await searchInput.click();
            const searchText = 'Squeegee Car Detailing Portland';
            console.log(`Typing: "${searchText}"`);
            await searchInput.type(searchText, { delay: 150 }); // delay makes it look more human-like

            await page.keyboard.press('Enter');

            // Wait for search results to load
            await page.waitForNavigation({ waitUntil: 'networkidle2' });
            console.log('Search results loaded!');

            // find element with [role="complementary"] and take a screenshot
            const complementaryElement = await page.$('[role="complementary"]');
            if (complementaryElement) {
                const highlightedInputPath = path.join(__dirname, 'google-highlighted-input.png');
                await complementaryElement.screenshot({ path: highlightedInputPath });
                console.log('Highlighted input element screenshot taken:', highlightedInputPath);
            } else {
                console.log('Could not find complementary element for screenshot');
            }

            // find span with class "z3dsh" and text See photos click it
            const photosElement = await page.$('span.z3dsh');
            if (photosElement) {
                await photosElement.click();
                console.log('Clicked on photos element');
            } else {
                console.log('Could not find photos element to click');
            }

            // wait for network idle to ensure all resources are loaded
            await page.waitForNavigation({ waitUntil: 'networkidle2' });


            const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

            for (let i = 0; i < 5; i++) {
            // find element with aria-label="Browse photos of Squeegee Car Detailing"
            const browsePhotosElement = await page.$('[aria-label="Browse photos of Squeegee Car Detailing"]');
            if (browsePhotosElement) {
                const browsePhotosPath = path.join(__dirname, `browse-photos${i}.png`);
                await browsePhotosElement.screenshot({ path: browsePhotosPath });
                console.log('Browse photos screenshot taken:', browsePhotosPath);
            } else {
                console.log('Could not find browse photos element for screenshot');
            }

            sleep(1000); // wait for 2 seconds before taking the next screenshot

            }

            
            console.log('Successfully typed in Google search box!');
        } else {
            console.log('Could not find Google search input box');
            // Take a screenshot anyway to see what's on the page
            await page.screenshot({ path: 'google-page-debug.png' });
        }

    } catch (error) {
        console.error('Error occurred:', error);
    } finally {
        // Close the browser
        if (browser) {
            // Wait a bit before closing to see the results
            console.log('Waiting 5 seconds before closing browser...');
            await new Promise(resolve => setTimeout(resolve, 5000));
            await browser.close();
        }
    }
}

// Enhanced version specifically for Google search automation
async function automateGoogleSearch(options = {}) {
    const {
        searchText = 'Hello from Puppeteer automation!',
        outputDir = './screenshots',
        waitTime = 2000,
        headless = false,
        pressEnter = false
    } = options;

    // Create output directory if it doesn't exist
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    let browser;

    try {
        browser = await puppeteer.launch({
            headless,
            devtools: true,
            args: ['--start-maximized']
        });

        const page = await browser.newPage();
        await page.setViewport({ width: 1920, height: 1080 });

        console.log('Opening Google...');
        await page.goto('https://www.google.com', { waitUntil: 'networkidle2' });
        // await page.waitForTimeout(waitTime);

        // Multiple selectors for Google search input
        const searchSelectors = [
            'input[name="q"]',
            'textarea[name="q"]',
            '[role="combobox"]',
            '.gLFyf',
            '#APjFqb'
        ];

        let searchInput = null;
        for (const selector of searchSelectors) {
            searchInput = await page.$(selector);
            if (searchInput) {
                console.log(`Found search input with selector: ${selector}`);
                break;
            }
        }

        if (searchInput) {
            // Take screenshot before typing
            const beforePath = path.join(outputDir, 'before-typing.png');
            await page.screenshot({ path: beforePath });

            // Click and type
            await searchInput.click();
            //   await page.waitForTimeout(500);

            console.log(`Typing: "${searchText}"`);
            await searchInput.type(searchText, { delay: 100 });
            //   await page.waitForTimeout(1000);

            // Take screenshot after typing
            const afterPath = path.join(outputDir, 'after-typing.png');
            await page.screenshot({ path: afterPath });

            // Screenshot the input element
            const inputPath = path.join(outputDir, 'input-element.png');
            await searchInput.screenshot({ path: inputPath });

            // Optional: Press Enter to search
            if (pressEnter) {
                await page.keyboard.press('Enter');
                // await page.waitForTimeout(3000);
                const resultsPath = path.join(outputDir, 'search-results.png');
                await page.screenshot({ path: resultsPath });
            }

            console.log(`Screenshots saved to ${outputDir}`);
            return {
                success: true,
                searchText,
                screenshots: {
                    before: beforePath,
                    after: afterPath,
                    input: inputPath
                }
            };
        } else {
            console.log('Could not find Google search input');
            const debugPath = path.join(outputDir, 'debug.png');
            await page.screenshot({ path: debugPath });
            return { success: false, message: 'Search input not found' };
        }

    } catch (error) {
        console.error('Error:', error);
        return { success: false, error: error.message };
    } finally {
        if (browser) {
            await new Promise(resolve => setTimeout(resolve, 3000));
            await browser.close();
        }
    }
}

// Example usage
if (require.main === module) {
    // Basic Google search automation
    automateChrome();

    // Or use the enhanced version with custom options
    // automateGoogleSearch({
    //   searchText: 'JavaScript automation tutorial',
    //   outputDir: './google-screenshots',
    //   waitTime: 3000,
    //   headless: false,
    //   pressEnter: true  // Set to true to actually perform the search
    // });
}

module.exports = { automateChrome, automateGoogleSearch };