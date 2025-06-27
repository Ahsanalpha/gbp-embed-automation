// gmaps_directions_screenshot.js (Enhanced Version)

// const puppeteer = require("puppeteer");
const fs = require("fs");
const csv = require("csv-parser");
const path = require("path");
const userAgent = require("user-agents");

const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
puppeteer.use(StealthPlugin());

class GoogleMapsDirectionsScreenshot {
  constructor(options = {}) {
    this.options = {
      headless: options.headless !== undefined ? options.headless : false,
      timeout: options.timeout || 30000,
      waitForNetworkIdle: options.waitForNetworkIdle || 5000,
      maxRetries: options.maxRetries || 3,
      delay: options.delay || 3000,
      userAgent:
        options.userAgent ||
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      screenshotPath: options.screenshotPath || ".screenshots/gmaps_directions_screenshots/",
      questionsScreenshotPath: options.questionsScreenshotPath || ".screenshots/gmaps_questions_screenshots/",
      searchResultsScreenshotPath: options.searchResultsScreenshotPath || ".screenshots/gmaps_search_results_screenshots/", // NEW
      startingPoint: options.startingPoint || "New York",
      searchQuery: options.searchQuery || "car detailing portland", // NEW: Configurable search query
      showBoundingBox: options.showBoundingBox !== false,
      boundingBoxDelay: options.boundingBoxDelay || 5000
    };
    this.results = [];
    this.questionsResults = [];
    this.searchResults = []; // NEW: Array for search results
    this.errors = [];
  }

  /**
   * Ensure screenshot directory exists
   */
  ensureDirectoryExists(dirPath) {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
      console.log(`📁 Created directory: ${dirPath}`);
    }
  }

  /**
   * Read data from enhanced CSV file
   */
  async readEnhancedCsv(csvFilePath) {
    return new Promise((resolve, reject) => {
      const records = [];

      if (!fs.existsSync(csvFilePath)) {
        reject(new Error(`CSV file not found: ${csvFilePath}`));
        return;
      }

      fs.createReadStream(csvFilePath)
        .pipe(csv())
        .on("data", (row) => {
          if (row.Search_URL && row.Search_URL.trim()) {
            records.push({
              url: row.URL || '',
              city: row.City || '',
              businessName: row.Business_Name || '',
              searchUrl: row.Search_URL.trim(),
              iframeSrc: row.GBP_Iframe_Source || '',
              originalRow: row
            });
          }
        })
        .on("end", () => {
          console.log(`📋 Loaded ${records.length} records with Search URLs from CSV`);
          resolve(records);
        })
        .on("error", (error) => {
          reject(error);
        });
    });
  }

  /**
   * NEW: Capture search results screenshot
   */
  async captureSearchResultsScreenshot(record, page) {
    const businessName = record.businessName || 'Unknown';
    const sanitizedBusinessName = businessName.replace(/[^a-zA-Z0-9\s]/g, '').replace(/\s+/g, '_');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const searchScreenshotPath = path.join(this.options.searchResultsScreenshotPath, `${sanitizedBusinessName}_${timestamp}_search.png`);

    try {
      console.log(`🔍 Performing search results capture for: ${businessName}`);

      // Navigate back to the original search results page
      console.log(`🔙 Navigating back to original search page for: ${businessName}`);
      
      try {
        await page.goBack({ 
          waitUntil: 'networkidle2',
          timeout: 15000 
        });

        // Wait for the main view to be restored
        await page.waitForSelector('#searchboxinput, .widget-pane', { 
          visible: true, 
          timeout: 15000 
        });
        
        console.log(`✅ Successfully returned to main search view for: ${businessName}`);
        
      } catch (backError) {
        console.log(`⚠️ Browser back failed, reloading original URL for: ${businessName}`);
        
        await page.goto(record.searchUrl, {
          waitUntil: "networkidle2",
          timeout: 20000,
        });
        
        await page.waitForSelector('#searchboxinput, .widget-pane', { 
          visible: true, 
          timeout: 15000 
        });
      }

      // Additional wait for UI to settle
      // await page.waitForTimeout(3000);
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Find the main search input box
      console.log(`🔍 Looking for search input box for: ${businessName}`);
      
      await page.waitForFunction(() => {
        const selectors = [
          '#searchboxinput',
          'input[aria-label*="Search Google Maps"]',
          'input[placeholder*="Search Google Maps"]',
          '.searchbox input',
          'input[jsaction*="search"]',
          'input[name="q"]'
        ];
        
        for (const selector of selectors) {
          const element = document.querySelector(selector);
          if (element && element.offsetParent !== null) {
            return element;
          }
        }
        return false;
      }, { timeout: 15000 });

      console.log(`⌨️ Replacing search query with: "${this.options.searchQuery}" for: ${businessName}`);

      // Clear the search box and enter new search query
      const searchInputSuccess = await page.evaluate((searchQuery) => {
        const selectors = [
          '#searchboxinput',
          'input[aria-label*="Search Google Maps"]',
          'input[placeholder*="Search Google Maps"]',
          '.searchbox input',
          'input[jsaction*="search"]',
          'input[name="q"]'
        ];

        for (const selector of selectors) {
          const input = document.querySelector(selector);
          if (input && input.offsetParent !== null) {
            // Focus and clear the input
            input.focus();
            input.select();
            input.value = '';
            
            // Set new value
            input.value = searchQuery;
            
            // Trigger events
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
            
            return true;
          }
        }
        return false;
      }, this.options.searchQuery);

      if (!searchInputSuccess) {
        throw new Error('Could not find or fill search input box');
      }

      // Press Enter to perform the search
      await page.keyboard.press('Enter');
      
      console.log(`⏳ Waiting for search results to load for query: "${this.options.searchQuery}"`);

      // Wait for search results to load
      await page.waitForFunction(() => {
        const resultSelectors = [
          '.section-result',
          '.section-result-content',
          '.place-result',
          '.widget-pane-content',
          '[data-result-index]',
          '.section-listbox',
          '.section-scrollbox'
        ];
        
        return resultSelectors.some(selector => {
          const elements = document.querySelectorAll(selector);
          return elements.length > 0 && Array.from(elements).some(el => el.offsetParent !== null);
        });
      }, { timeout: 15000 }).catch(() => {
        console.log(`⚠️ Search results may not have loaded completely for query: "${this.options.searchQuery}"`);
      });

      // Wait for loading indicators to disappear
      try {
        await page.waitForSelector('.loading, .spinner, [aria-label*="Loading"]', { 
          hidden: true, 
          timeout: 10000 
        }).catch(() => console.log('Loading indicator handling completed'));
      } catch (error) {
        console.log('Loading detection completed, proceeding...');
      }

      // Additional wait for UI to settle
      // await page.waitForTimeout(4000);
      await new Promise(resolve => setTimeout(resolve, 4000));

      // Wait for fonts and images to load
      await page.evaluate(() => {
        return document.fonts.ready;
      }).catch(() => console.log('Font loading completed'));

      await page.waitForFunction(() => {
        const images = Array.from(document.images);
        return images.every(img => img.complete);
      }, { timeout: 8000 }).catch(() => console.log('Image loading completed'));

      console.log(`📸 Taking search results screenshot for query: "${this.options.searchQuery}"`);

      // Take screenshot of search results
      const screenshotArea = {
        x: 72,
        y: 60,
        width: 408,
        height: 1065 * 0.69
      };

      await page.screenshot({
        path: searchScreenshotPath,
        fullPage: false,
        clip: screenshotArea,
        type: 'png'
      });

      console.log(`✅ Search results screenshot saved: ${searchScreenshotPath}`);

      // Record successful search result
      this.searchResults.push({
        url: record.url,
        business_name: businessName,
        original_search_url: record.searchUrl,
        search_query: this.options.searchQuery,
        screenshot_path: searchScreenshotPath,
        city: record.city,
        screenshot_status: 'success',
        processed_at: new Date().toISOString(),
        error_message: ''
      });

      return { 
        success: true, 
        screenshot_path: searchScreenshotPath,
        reason: 'Search results screenshot captured successfully'
      };

    } catch (error) {
      console.error(`❌ Error capturing search results screenshot for ${businessName}: ${error.message}`);
      
      // Record search error result
      this.searchResults.push({
        url: record.url,
        business_name: businessName,
        original_search_url: record.searchUrl,
        search_query: this.options.searchQuery,
        screenshot_path: '',
        city: record.city,
        screenshot_status: 'error',
        processed_at: new Date().toISOString(),
        error_message: error.message
      });

      return { 
        success: false, 
        screenshot_path: '',
        reason: error.message
      };
    }
  }

  /**
   * Capture "More questions" screenshot
   */
  async captureQuestionsScreenshot(record, page) {
    const businessName = record.businessName || 'Unknown';
    const sanitizedBusinessName = businessName.replace(/[^a-zA-Z0-9\s]/g, '').replace(/\s+/g, '_');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const questionsScreenshotPath = path.join(this.options.questionsScreenshotPath, `${sanitizedBusinessName}_${timestamp}_questions.png`);

    try {
      console.log(`❓ Looking for "More questions" button for: ${businessName}`);

      await page.waitForSelector('#searchboxinput, .widget-pane', { 
        visible: true, 
        timeout: 20000 
      });

      const moreQuestionsFound = await page.waitForFunction(() => {
        const selectors = [
          'button[aria-label*="More questions" i]',
          'button[data-value*="questions" i]',
          'button:has-text("More questions")',
          '[jsaction*="questions"]',
          'button[data-tab-index]:has-text("Questions")',
          '.widget-pane button:has-text("Questions")',
          'button[aria-label*="Questions" i]'
        ];
        
        for (const selector of selectors) {
          try {
            const element = document.querySelector(selector);
            if (element && element.offsetParent !== null && 
                (element.textContent.toLowerCase().includes('question') || 
                 element.getAttribute('aria-label')?.toLowerCase().includes('question'))) {
              return element;
            }
          } catch (e) {
            // Continue to next selector
          }
        }

        const buttons = Array.from(document.querySelectorAll('button'));
        for (const button of buttons) {
          if (button.offsetParent !== null && 
              (button.textContent.toLowerCase().includes('question') || 
               button.getAttribute('aria-label')?.toLowerCase().includes('question'))) {
            return button;
          }
        }
        
        return false;
      }, { timeout: 10000 }).catch(() => {
        console.log(`⚠️ "More questions" button not found for ${businessName}`);
        return false;
      });

      if (!moreQuestionsFound) {
        console.log(`⏭️ Skipping questions screenshot for ${businessName} - button not available`);
        return { success: false, reason: 'More questions button not found' };
      }

      const clickSuccess = await page.evaluate(() => {
        const selectors = [
          'button[aria-label*="More questions" i]',
          'button[data-value*="questions" i]',
          'button[aria-label*="Questions" i]'
        ];
        
        let targetButton = null;
        
        for (const selector of selectors) {
          try {
            const element = document.querySelector(selector);
            if (element && element.offsetParent !== null) {
              targetButton = element;
              break;
            }
          } catch (e) {
            continue;
          }
        }

        if (!targetButton) {
          const buttons = Array.from(document.querySelectorAll('button'));
          for (const button of buttons) {
            if (button.offsetParent !== null && 
                (button.textContent.toLowerCase().includes('question') || 
                 button.getAttribute('aria-label')?.toLowerCase().includes('question'))) {
              targetButton = button;
              break;
            }
          }
        }

        if (targetButton) {
          targetButton.scrollIntoView({ behavior: 'smooth', block: 'center' });
          targetButton.click();
          targetButton.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
          return true;
        }
        
        return false;
      });

      if (!clickSuccess) {
        console.log(`❌ Failed to click "More questions" button for ${businessName}`);
        return { success: false, reason: 'Failed to click button' };
      }

      console.log(`✅ Clicked "More questions" button for: ${businessName}`);

      // await page.waitForTimeout(2000);
      await new Promise(resolve => setTimeout(resolve, 2000));

      await page.waitForFunction(() => {
        const questionSelectors = [
          '.section-question',
          '.question-item',
          '[data-question-id]',
          '.widget-pane [role="button"]:has-text("?")',
          '.questions-container',
          '.qa-section'
        ];
        
        return questionSelectors.some(selector => {
          try {
            const elements = document.querySelectorAll(selector);
            return elements.length > 0 && Array.from(elements).some(el => el.offsetParent !== null);
          } catch (e) {
            return false;
          }
        });
      }, { timeout: 8000 }).catch(() => {
        console.log(`⚠️ Questions content may not have loaded completely for ${businessName}`);
      });

      // await page.waitForTimeout(1500);
      await new Promise(resolve => setTimeout(resolve, 1500));

      await page.waitForFunction(() => {
        return document.fonts.ready;
      }, { timeout: 5000 }).catch(() => console.log('Font loading timeout'));

      console.log(`📸 Taking questions screenshot for: ${businessName}`);

      const screenshotArea = {
        x: 72,
        y: 60,
        width: 408,
        height: 1065 * 0.66
      };

      await page.screenshot({
        path: questionsScreenshotPath,
        fullPage: false,
        clip: screenshotArea,
        type: 'png'
      });

      console.log(`✅ Questions screenshot saved: ${questionsScreenshotPath}`);

      this.questionsResults.push({
        url: record.url,
        business_name: businessName,
        search_url: record.searchUrl,
        screenshot_path: questionsScreenshotPath,
        city: record.city,
        screenshot_status: 'success',
        processed_at: new Date().toISOString(),
        error_message: ''
      });

      console.log(`🔙 Using browser back navigation to return to main view for: ${businessName}`);

      // await page.waitForTimeout(1000);
      await new Promise(resolve => setTimeout(resolve, 1000));

      try {
        await page.goBack({ 
          waitUntil: 'networkidle2',
          timeout: 15000 
        });

        console.log(`✅ Successfully navigated back using browser back for: ${businessName}`);
        
        await page.waitForSelector('#searchboxinput, [data-value="Directions"], .widget-pane', { 
          visible: true, 
          timeout: 15000 
        });
        
        // await page.waitForTimeout(2000);
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        await page.evaluate(() => {
          return document.fonts.ready;
        }).catch(() => console.log('Font loading timeout after back navigation'));
        
        console.log(`🔄 Successfully returned to main view for: ${businessName}`);

      } catch (error) {
        console.log(`⚠️ Browser back navigation failed for ${businessName}: ${error.message}`);
        console.log(`🔄 Attempting to reload the original URL...`);
        
        try {
          await page.goto(record.searchUrl, {
            waitUntil: "networkidle2",
            timeout: 20000,
          });
          
          await page.waitForSelector('#searchboxinput, [data-value="Directions"], .widget-pane', { 
            visible: true, 
            timeout: 15000 
          });
          
          // await page.waitForTimeout(3000);
          await new Promise(resolve => setTimeout(resolve, 3000));
          
          console.log(`✅ Successfully reloaded original URL for: ${businessName}`);
        } catch (reloadError) {
          console.error(`❌ Failed to reload original URL for ${businessName}: ${reloadError.message}`);
          throw new Error(`Unable to return to main view: ${reloadError.message}`);
        }
      }

      return { 
        success: true, 
        screenshot_path: questionsScreenshotPath,
        reason: 'Questions screenshot captured successfully'
      };

    } catch (error) {
      console.error(`❌ Error capturing questions screenshot for ${businessName}: ${error.message}`);
      
      this.questionsResults.push({
        url: record.url,
        business_name: businessName,
        search_url: record.searchUrl,
        screenshot_path: '',
        city: record.city,
        screenshot_status: 'error',
        processed_at: new Date().toISOString(),
        error_message: error.message
      });

      return { 
        success: false, 
        screenshot_path: '',
        reason: error.message
      };
    }
  }

  /**
   * Take screenshot of Google Maps directions sidebar
   */
  async captureDirectionsScreenshot(record, browser) {
    const page = await browser.newPage();

    await page.setUserAgent(new userAgent().toString());
    await page.setViewport({
      width: 1366 + Math.floor(Math.random() * 100),
      height: 768 + Math.floor(Math.random() * 100),
      deviceScaleFactor: 1,
    });
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, "webdriver", {
        get: () => false,
      });
    });

    let screenshotPath = '';
    let questionsResult = { success: false, screenshot_path: '', reason: 'Not attempted' };
    let searchResult = { success: false, screenshot_path: '', reason: 'Not attempted' }; // NEW
    
    try {
      await page.setUserAgent(this.options.userAgent);
      
      await page.setViewport({ 
        width: 1920, 
        height: 1080,
      });

      await page.setRequestInterception(true);
      page.on("request", (req) => {
        const resourceType = req.resourceType();
        const url = req.url();
        
        if (resourceType === 'media' && (url.includes('.mp4') || url.includes('.webm') || url.includes('.mp3'))) {
          req.abort();
        } else {
          req.continue();
        }
      });

      const businessName = record.businessName || 'Unknown';
      const sanitizedBusinessName = businessName.replace(/[^a-zA-Z0-9\s]/g, '').replace(/\s+/g, '_');
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      screenshotPath = path.join(this.options.screenshotPath, `${sanitizedBusinessName}_${timestamp}_directions.png`);

      console.log(`🗺️ Processing directions for: ${businessName}`);
      console.log(`📍 Navigating to: ${record.searchUrl}`);

      await page.goto(record.searchUrl, {
        waitUntil: "networkidle0",
        timeout: this.options.timeout,
      });

      await page.waitForSelector('#searchboxinput, [data-value="Directions"], .widget-pane', { 
        visible: true, 
        timeout: 20000 
      });

      // await page.waitForTimeout(this.options.waitForNetworkIdle);
      await new Promise(resolve => setTimeout(resolve, this.options.waitForNetworkIdle));

      await page.evaluate(() => {
        return document.fonts.ready;
      });

      // Capture "More questions" screenshot first
      // questionsResult = await this.captureQuestionsScreenshot(record, page);

      if (questionsResult.success) {
        console.log(`🔄 Ensuring we're on the main view before proceeding with directions for: ${businessName}`);
        
        // await page.waitForTimeout(1000);
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        const mainViewReady = await page.$('#searchboxinput, [data-value="Directions"], .widget-pane');
        if (!mainViewReady) {
          console.log(`⚠️ Main view not ready, attempting to restore for: ${businessName}`);
          // await page.waitForTimeout(2000);
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }

      console.log(`🎯 Looking for Directions tab for: ${businessName}`);

      await page.waitForFunction(() => {
        const selectors = [
          '[data-value="Directions"]',
          'button[data-value="Directions"]',
          '[aria-label*="Directions"]',
          'button[jsaction*="directions"]'
        ];
        
        for (const selector of selectors) {
          const element = document.querySelector(selector);
          if (element && element.offsetParent !== null) {
            return element;
          }
        }
        return false;
      }, { timeout: 20000 });

      console.log(`🎯 Clicking Directions tab for: ${businessName}`);

      const directionsClicked = await page.evaluate(() => {
        const selectors = [
          '[data-value="Directions"]',
          'button[data-value="Directions"]',
          '[aria-label*="Directions"]',
          'button[jsaction*="directions"]',
          '.widget-directions-button',
          '[data-tab-index="1"]'
        ];

        for (const selector of selectors) {
          const element = document.querySelector(selector);
          if (element && element.offsetParent !== null) {
            element.scrollIntoView({ behavior: 'smooth', block: 'center' });
            element.click();
            element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
            return true;
          }
        }
        return false;
      });

      if (!directionsClicked) {
        throw new Error('Could not find or click Directions tab');
      }

      // await page.waitForTimeout(4000);
      await new Promise(resolve => setTimeout(resolve, 4000));

      await page.waitForFunction(() => {
        const inputSelectors = [
          'input[placeholder*="starting point" i]',
          'input[placeholder*="choose starting point" i]',
          'input[aria-label*="starting point" i]',
          '.directions-searchbox-container input',
          '.searchbox input',
          '[aria-label="Choose starting point, or click on the map..."]',
          '[data-value="directions-searchbox-0"] input'
        ];
        
        for (const selector of inputSelectors) {
          const input = document.querySelector(selector);
          if (input && input.offsetParent !== null) {
            return input;
          }
        }
        return false;
      }, { timeout: 15000 });

      console.log(`⌨️ Entering starting point: ${this.options.startingPoint}`);

      const inputSuccess = await page.evaluate(async (startingPoint) => {
        const selectors = [
          'input[placeholder*="Choose starting point, or click on the map..." i]',
          'input[aria-label*="Choose starting point, or click on the map..." i]',
          '.directions-searchbox-container input',
          'input[aria-label="Choose starting point, or click on the map..."]',
          '[data-value="directions-searchbox-0"] input',
          '.searchbox input'
        ];

        for (const selector of selectors) {
          const input = document.querySelector(selector);
          if (input && input.offsetParent !== null) {
            input.scrollIntoView({ behavior: 'smooth', block: 'center' });
            input.focus();
            input.select();
            input.value = '';
            input.value = startingPoint;
            await new Promise(resolve => setTimeout(resolve, 500));
            input.dispatchEvent(new Event('input', { bubbles: false }));
            // input.dispatchEvent(new Event('change', { bubbles: true }));
            // input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
            // await new Promise(resolve => setTimeout(resolve, 2000));
            return true;
          }
        }
        return false;
      }, this.options.startingPoint);

      if (!inputSuccess) {
        throw new Error('Could not find or fill starting point input');
      }

      
      console.log("pressed page 'Enter' key")
      await page.keyboard.press('Enter')
      // await page.waitForTimeout(500);
      await new Promise(resolve => setTimeout(resolve, 500));

      console.log(`⏳ Waiting for directions to load for: ${businessName}`);

      try {
        await page.waitForSelector('.loading, .spinner, [aria-label*="Loading"]', { 
          hidden: true, 
          timeout: 20000 
        }).catch(() => console.log('Loading indicator did not disappear'));
      } catch (error) {
        console.log('Loading detection failed, continuing...');
      }

      await page.waitForFunction(() => {
        const directionSelectors = [
          '.directions-mode-group',
          '.directions-travel-mode', 
          '[data-value="directions-searchbox-1"]',
          '.directions-renderer',
          '.route-info',
          '.directions-info',
          '.section-directions-trip',
          '.widget-directions-inner'
        ];
        
        return directionSelectors.some(selector => {
          const element = document.querySelector(selector);
          return element && element.offsetParent !== null;
        });
      }, { timeout: 5000 }).catch(() => {
        console.log(`⚠️ Directions UI may not have loaded completely for ${businessName}, proceeding with screenshot...`);
      });

      // await page.waitForTimeout(this.options.waitForNetworkIdle);
      await new Promise(resolve => setTimeout(resolve, this.options.waitForNetworkIdle));

      await page.waitForFunction(() => {
        const images = Array.from(document.images);
        return images.every(img => img.complete);
      }, { timeout: 10000 }).catch(() => console.log('Some images may not have loaded'));

      console.log(`📸 Taking directions screenshot for: ${businessName}`);

      const screenshotArea = {
        x: 72,
        y: 60,
        width: 408,
        height: 1065 * 0.5
      };
    
      await page.screenshot({
        path: screenshotPath,
        fullPage: false,
        clip: screenshotArea,
        type: 'png'
      });

      console.log(`✅ Directions screenshot saved: ${screenshotPath}`);

      // NEW: Perform search results screenshot after directions
      console.log(`🔍 Starting search results capture for: ${businessName}`);
      searchResult = await this.captureSearchResultsScreenshot(record, page);

      // Record successful result with all screenshot info
      this.results.push({
        url: record.url,
        business_name: businessName,
        search_url: record.searchUrl,
        screenshot_path: screenshotPath,
        questions_screenshot_path: questionsResult.screenshot_path,
        questions_screenshot_status: questionsResult.success ? 'success' : 'error',
        questions_error_message: questionsResult.success ? '' : questionsResult.reason,
        search_screenshot_path: searchResult.screenshot_path, // NEW
        search_screenshot_status: searchResult.success ? 'success' : 'error', // NEW
        search_error_message: searchResult.success ? '' : searchResult.reason, // NEW
        search_query: this.options.searchQuery, // NEW
        city: record.city,
        screenshot_status: 'success',
        processed_at: new Date().toISOString(),
        starting_point: this.options.startingPoint,
        error_message: ''
      });

    } catch (error) {
      console.error(`❌ Error processing ${record.businessName || 'Unknown'}: ${error.message}`);
      
      this.results.push({
        url: record.url,
        business_name: record.businessName || 'Unknown',
        search_url: record.searchUrl,
        screenshot_path: '',
        questions_screenshot_path: questionsResult.screenshot_path,
        questions_screenshot_status: questionsResult.success ? 'success' : 'error',
        questions_error_message: questionsResult.success ? '' : questionsResult.reason,
        search_screenshot_path: searchResult.screenshot_path, // NEW
        search_screenshot_status: searchResult.success ? 'success' : 'error', // NEW
        search_error_message: searchResult.success ? '' : searchResult.reason, // NEW
        search_query: this.options.searchQuery, // NEW
        city: record.city,
        screenshot_status: 'error',
        processed_at: new Date().toISOString(),
        starting_point: this.options.startingPoint,
        error_message: error.message
      });

      this.errors.push({
        business_name: record.businessName || 'Unknown',
        search_url: record.searchUrl,
        error: error.message,
        timestamp: new Date().toISOString(),
      });

    } finally {
      await page.close();
    }
  }

  async generateReport(results, outputPath) {
    const summary = {
      totalProcessed: results.length,
      successful: results.filter((r) => r.screenshot_status === 'success').length,
      failed: results.filter((r) => r.screenshot_status === 'error').length,
      timestamp: new Date().toISOString(),
      results: results,
    };
  
    fs.writeFileSync(outputPath, JSON.stringify(summary, null, 2));
    console.log(`Report saved: ${outputPath}`);
    return summary;
  }

  async generateQuestionsReport(questionsResults, outputPath) {
    const summary = {
      totalProcessed: questionsResults.length,
      successful: questionsResults.filter((r) => r.screenshot_status === 'success').length,
      failed: questionsResults.filter((r) => r.screenshot_status === 'error').length,
      timestamp: new Date().toISOString(),
      results: questionsResults,
    };
  
    fs.writeFileSync(outputPath, JSON.stringify(summary, null, 2));
    console.log(`Questions report saved: ${outputPath}`);
    return summary;
  }

  // NEW: Generate search results report
  async generateSearchResultsReport(searchResults, outputPath) {
    const summary = {
      totalProcessed: searchResults.length,
      successful: searchResults.filter((r) => r.screenshot_status === 'success').length,
      failed: searchResults.filter((r) => r.screenshot_status === 'error').length,
      searchQuery: this.options.searchQuery,
      timestamp: new Date().toISOString(),
      results: searchResults,
    };
  
    fs.writeFileSync(outputPath, JSON.stringify(summary, null, 2));
    console.log(`Search results report saved: ${outputPath}`);
    return summary;
  }

   getDefaultProfilePath() {
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

  /**
   * Main processing function
   */
  async processDirectionsScreenshots(csvFilePath, outputPath) {
    try {
      // Ensure all screenshot directories exist
      this.ensureDirectoryExists(this.options.screenshotPath);
      this.ensureDirectoryExists(this.options.questionsScreenshotPath);
      this.ensureDirectoryExists(this.options.searchResultsScreenshotPath); // NEW

      // Read records from CSV
      const records = await this.readEnhancedCsv(csvFilePath);

      if (records.length === 0) {
        throw new Error("No records with Search URLs found in the CSV file");
      }

      console.log(`🚀 Starting screenshot process for ${records.length} business(es)...`);
      console.log(`📍 Starting point: ${this.options.startingPoint}`);
      console.log(`🔍 Search query: ${this.options.searchQuery}`); // NEW
      console.log(`🖥️  Headless mode: ${this.options.headless ? 'Enabled' : 'Disabled'}`);
      console.log(`📂 Directions screenshots: ${this.options.screenshotPath}`);
      console.log(`❓ Questions screenshots: ${this.options.questionsScreenshotPath}`);
      console.log(`🔍 Search results screenshots: ${this.options.searchResultsScreenshotPath}`); // NEW

      // Get default Chrome profile path
      const defaultProfilePath = this.getDefaultProfilePath();

      const browser = await puppeteer.launch({
        headless: this.options.headless,
        slowMo: this.options.slowMo,
        userDataDir: defaultProfilePath,
        args: [
          "--start-maximized",
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-infobars",
          "--disable-blink-features=AutomationControlled",
          "--disable-dev-shm-usage",
          "--disable-extensions",
          "--disable-background-networking",
          "--disable-background-timer-throttling",
          "--disable-backgrounding-occluded-windows",
          "--disable-renderer-backgrounding",
          "--mute-audio",
          "--no-default-browser-check",
          "--no-first-run",
          "--disable-popup-blocking",
          "--disable-translate",
          "--disable-sync",
          "--metrics-recording-only",
          "--enable-automation",
          "--password-store=basic",
          "--use-mock-keychain"
        ],
      });

      try {
        // Process records sequentially to avoid overwhelming Google Maps
        for (let i = 0; i < records.length; i++) {
          const record = records[i];
          console.log(`\n📊 Processing ${i + 1}/${records.length}: ${record.businessName || 'Unknown'}`);
          
          await this.captureDirectionsScreenshot(record, browser);
          
          // Add delay between requests to be respectful to Google Maps
          if (i < records.length - 1) {
            await new Promise(resolve => setTimeout(resolve, this.options.delay));
          }
        }

        // Save all results
        this.generateReport(this.results, outputPath);

        // Generate separate questions report
        const questionsOutputPath = path.join(this.options.questionsScreenshotPath, "questions_processing_report.json");
        this.generateQuestionsReport(this.questionsResults, questionsOutputPath);

        // NEW: Generate separate search results report
        const searchResultsOutputPath = path.join(this.options.searchResultsScreenshotPath, "search_results_processing_report.json");
        this.generateSearchResultsReport(this.searchResults, searchResultsOutputPath);

        // Print summary
        const successCount = this.results.filter(r => r.screenshot_status === 'success').length;
        const questionsSuccessCount = this.questionsResults.filter(r => r.screenshot_status === 'success').length;
        const searchSuccessCount = this.searchResults.filter(r => r.screenshot_status === 'success').length; // NEW
        const errorCount = this.errors.length;

        console.log("\n=== SCREENSHOT SUMMARY ===");
        console.log(`Total businesses processed: ${records.length}`);
        console.log(`Successful directions screenshots: ${successCount}`);
        console.log(`Successful questions screenshots: ${questionsSuccessCount}`);
        console.log(`Successful search results screenshots: ${searchSuccessCount}`); // NEW
        console.log(`Errors encountered: ${errorCount}`);
        console.log(`Directions screenshots saved to: ${this.options.screenshotPath}`);
        console.log(`Questions screenshots saved to: ${this.options.questionsScreenshotPath}`);
        console.log(`Search results screenshots saved to: ${this.options.searchResultsScreenshotPath}`); // NEW
        console.log(`Results saved to: ${outputPath}`);
        console.log(`Questions results saved to: ${questionsOutputPath}`);
        console.log(`Search results saved to: ${searchResultsOutputPath}`); // NEW

      } finally {
        await browser.close();
      }
      console.log("gbp_location_output:::", this.results);
      return this.results;

    } catch (error) {
      console.error("Screenshot process failed:", error);
      throw error;
    }
  }
}

/**
 * Initialize and run the Google Maps directions screenshot process
 */
async function InitializeGoogleMapsDirectionsScreenshot(csvFilePath, options = {}) {
  const screenshotProcessor = new GoogleMapsDirectionsScreenshot({
    headless: options.headless !== undefined ? options.headless : false,
    timeout: options.timeout || 45000,
    delay: options.delay || 3000,
    screenshotPath: options.screenshotPath || "./screenshots/gmaps_directions_screenshots/",
    questionsScreenshotPath: options.questionsScreenshotPath || "./screenshots/gmaps_questions_screenshots/",
    searchResultsScreenshotPath: options.searchResultsScreenshotPath || "./screenshots/gmaps_search_results_screenshots/", // NEW
    startingPoint: options.startingPoint || "New York",
    searchQuery: options.searchQuery || "car detailing portland", // NEW
    showBoundingBox: options.showBoundingBox !== false,
  });

  const outputPath = "./screenshots/gmaps_directions_screenshots/processing_report.json";
  
  return await screenshotProcessor.processDirectionsScreenshots(csvFilePath, outputPath);
}

// Export for use as module
module.exports = { 
  InitializeGoogleMapsDirectionsScreenshot, 
  GoogleMapsDirectionsScreenshot 
};

// Run if called directly
if (require.main === module) {
  InitializeGoogleMapsDirectionsScreenshot("./gbp_output_data/gbp_enhanced_records.csv", {
    showBoundingBox: true,
    headless: false,
    searchQuery: "car detailing portland" // NEW: Configurable search query
  })
    .then(() => {
      console.log("\n🎉 Google Maps screenshot process completed successfully!");
    })
    .catch((error) => {
      console.error("Process failed:", error);
      process.exit(1);
    });
}