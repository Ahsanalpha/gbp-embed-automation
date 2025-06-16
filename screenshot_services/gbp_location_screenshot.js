// gmaps_directions_screenshot.js

const puppeteer = require("puppeteer");
const fs = require("fs");
const csv = require("csv-parser");
const createCsvWriter = require("csv-writer").createObjectCsvWriter;
const path = require("path");

class GoogleMapsDirectionsScreenshot {
  constructor(options = {}) {
    this.options = {
      // headless: options.headless !== undefined ? options.headless : false,
      headless: false,
      timeout: options.timeout || 30000,
      waitForNetworkIdle: options.waitForNetworkIdle || 5000,
      maxRetries: options.maxRetries || 3,
      delay: options.delay || 3000,
      concurrency: options.concurrency || 3, // Number of concurrent processes
      userAgent:
        options.userAgent ||
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      screenshotPath: options.screenshotPath || ".screenshots/gmaps_directions_screenshots/",
      startingPoint: options.startingPoint || "New York"};
    this.results = [];
    this.errors = [];
    this.semaphore = new Semaphore(this.options.concurrency);
    this.resultsLock = new AsyncLock(); // For thread-safe result updates
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
   * Take screenshot of Google Maps directions sidebar with error handling and retries
   */
  async captureDirectionsScreenshot(record, browser, workerIndex) {
    const page = await browser.newPage();
    let screenshotPath = '';
    const logPrefix = `[Worker ${workerIndex}]`;
    
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

      console.log(`${logPrefix} 🗺️  Processing directions for: ${businessName}`);
      console.log(`${logPrefix} 📍 Navigating to: ${record.searchUrl}`);

      await page.goto(record.searchUrl, {
        waitUntil: "networkidle0",
        timeout: this.options.timeout,
      });

      await page.waitForSelector('#searchboxinput, [data-value="Directions"], .widget-pane', { 
        visible: true, 
        timeout: 20000 
      });

      await page.waitForTimeout(this.options.waitForNetworkIdle);

      await page.evaluate(() => {
        return document.fonts.ready;
      });

      console.log(`${logPrefix} 🎯 Looking for Directions tab for: ${businessName}`);

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

      console.log(`${logPrefix} 🎯 Clicking Directions tab for: ${businessName}`);

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

      await page.waitForTimeout(4000);

      await page.waitForFunction(() => {
        const inputSelectors = [
          'input[placeholder*="starting point" i]',
          'input[placeholder*="choose starting point" i]',
          'input[aria-label*="starting point" i]',
          '.directions-searchbox-container input',
          '.searchbox input',
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

      console.log(`${logPrefix} ⌨️  Entering starting point: ${this.options.startingPoint}`);

      const inputSuccess = await page.evaluate((startingPoint) => {
        const selectors = [
          'input[placeholder*="starting point" i]',
          'input[placeholder*="choose starting point" i]',
          'input[aria-label*="starting point" i]',
          '.directions-searchbox-container input',
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
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
            return true;
          }
        }
        return false;
      }, this.options.startingPoint);

      if (!inputSuccess) {
        throw new Error('Could not find or fill starting point input');
      }

      await page.keyboard.press('Enter');
      await page.waitForTimeout(500);

      console.log(`${logPrefix} ⏳ Waiting for directions to load for: ${businessName}`);

      try {
        await page.waitForSelector('.loading, .spinner, [aria-label*="Loading"]', { 
          hidden: true, 
          timeout: 20000 
        }).catch(() => console.log(`${logPrefix} Loading indicator did not disappear`));
      } catch (error) {
        console.log(`${logPrefix} Loading detection failed, continuing...`);
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
        console.log(`${logPrefix} ⚠️  Directions UI may not have loaded completely for ${businessName}, proceeding with screenshot...`);
      });

      await page.waitForTimeout(this.options.waitForNetworkIdle);

      await page.waitForFunction(() => {
        const images = Array.from(document.images);
        return images.every(img => img.complete);
      }, { timeout: 10000 }).catch(() => console.log(`${logPrefix} Some images may not have loaded`));

      console.log(`${logPrefix} 📸 Taking screenshot for: ${businessName}`);

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

      console.log(`${logPrefix} ✅ Screenshot saved: ${screenshotPath}`);

      // Thread-safe result recording
      await this.resultsLock.acquire();
      try {
        this.results.push({
          url: record.url,
          business_name: businessName,
          search_url: record.searchUrl,
          screenshot_path: screenshotPath,
          screenshot_status: 'success',
          processed_at: new Date().toISOString(),
          starting_point: this.options.startingPoint,
          error_message: ''
        });
      } finally {
        this.resultsLock.release();
      }

    } catch (error) {
      console.error(`${logPrefix} ❌ Error processing ${record.businessName || 'Unknown'}: ${error.message}`);
      
      // Thread-safe error recording
      await this.resultsLock.acquire();
      try {
        this.results.push({
          url: record.url,
          business_name: record.businessName || 'Unknown',
          search_url: record.searchUrl,
          screenshot_path: '',
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
        this.resultsLock.release();
      }

    } finally {
      await page.close();
    }
  }

  /**
   * Process a single record with semaphore control
   */
  async processRecordConcurrently(record, browser, index, total) {
    await this.semaphore.acquire();
    
    try {
      const workerIndex = this.semaphore.getCurrentWorkerIndex();
      console.log(`\n📊 Processing ${index + 1}/${total}: ${record.businessName || 'Unknown'} (Worker ${workerIndex})`);
      
      await this.captureDirectionsScreenshot(record, browser, workerIndex);
      
    } finally {
      this.semaphore.release();
    }
  }

  /**
   * Save results to CSV file
   */
  async saveResultsToCsv(outputPath) {
    const csvWriter = createCsvWriter({
      path: outputPath,
      header: [
        { id: "url", title: "Original_URL" },
        { id: "business_name", title: "Business_Name" },
        { id: "search_url", title: "Search_URL" },
        { id: "screenshot_path", title: "Screenshot_Path" },
        { id: "screenshot_status", title: "Screenshot_Status" },
        { id: "starting_point", title: "Starting_Point" },
        { id: "processed_at", title: "Processed_At" },
        { id: "error_message", title: "Error_Message" },
      ],
    });

    await csvWriter.writeRecords(this.results);
    console.log(`\n✅ Directions screenshot results saved to ${outputPath}`);

    if (this.errors.length > 0) {
      const errorCsvWriter = createCsvWriter({
        path: "./screenshots/gmaps_directions_screenshots/gmaps_directions_errors.csv",
        header: [
          { id: "business_name", title: "Business_Name" },
          { id: "search_url", title: "Search_URL" },
          { id: "error", title: "Error" },
          { id: "timestamp", title: "Timestamp" },
        ],
      });

      await errorCsvWriter.writeRecords(this.errors);
      console.log(`✅ Errors saved to gmaps_directions_errors.csv`);
    }
  }

  /**
   * Main processing function with concurrent execution
   */
  async processDirectionsScreenshots(csvFilePath, outputPath = "./screenshots/gmaps_directions_screenshots/gmaps_directions_results.csv") {
    try {
      this.ensureDirectoryExists(this.options.screenshotPath);

      const records = await this.readEnhancedCsv(csvFilePath);

      if (records.length === 0) {
        throw new Error("No records with Search URLs found in the CSV file");
      }

      console.log(`🚀 Starting concurrent directions screenshot process for ${records.length} business(es)...`);
      console.log(`🔄 Concurrency level: ${this.options.concurrency}`);
      console.log(`📍 Starting point: ${this.options.startingPoint}`);
      console.log(`🖥️  Headless mode: ${this.options.headless ? 'Enabled' : 'Disabled'}`);

      const browser = await puppeteer.launch({
        headless: this.options.headless,
        args: [
          "--start-fullscreen",
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-blink-features=AutomationControlled",
          "--disable-features=VizDisplayCompositor",
          "--disable-web-security",
          "--disable-features=site-per-process"
        ],
      });

      try {
        // Process records concurrently using Promise.all
        const processingPromises = records.map((record, index) => 
          this.processRecordConcurrently(record, browser, index, records.length)
        );

        // Wait for all concurrent processes to complete
        await Promise.all(processingPromises);

        // Add a small delay to ensure all operations are complete
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Save results
        await this.saveResultsToCsv(outputPath);

        // Print summary
        const successCount = this.results.filter(r => r.screenshot_status === 'success').length;
        const errorCount = this.errors.length;

        console.log("\n=== CONCURRENT DIRECTIONS SCREENSHOT SUMMARY ===");
        console.log(`Total businesses processed: ${records.length}`);
        console.log(`Successful screenshots: ${successCount}`);
        console.log(`Errors encountered: ${errorCount}`);
        console.log(`Concurrency level used: ${this.options.concurrency}`);
        console.log(`Screenshots saved to: ${this.options.screenshotPath}`);
        console.log(`Results saved to: ${outputPath}`);

      } finally {
        await browser.close();
      }

      return this.results;

    } catch (error) {
      console.error("Concurrent directions screenshot process failed:", error);
      throw error;
    }
  }
}

/**
 * Semaphore class for controlling concurrency
 */
class Semaphore {
  constructor(maxConcurrency) {
    this.maxConcurrency = maxConcurrency;
    this.running = 0;
    this.queue = [];
    this.workerIndexCounter = 0;
  }

  async acquire() {
    return new Promise((resolve) => {
      const tryAcquire = () => {
        if (this.running < this.maxConcurrency) {
          this.running++;
          this.workerIndexCounter++;
          resolve(this.workerIndexCounter);
        } else {
          this.queue.push(tryAcquire);
        }
      };
      tryAcquire();
    });
  }

  release() {
    this.running--;
    if (this.queue.length > 0) {
      const next = this.queue.shift();
      next();
    }
  }

  getCurrentWorkerIndex() {
    return this.workerIndexCounter;
  }
}

/**
 * Simple async lock for thread-safe operations
 */
class AsyncLock {
  constructor() {
    this.locked = false;
    this.queue = [];
  }

  async acquire() {
    return new Promise((resolve) => {
      const tryAcquire = () => {
        if (!this.locked) {
          this.locked = true;
          resolve();
        } else {
          this.queue.push(tryAcquire);
        }
      };
      tryAcquire();
    });
  }

  release() {
    if (this.queue.length > 0) {
      const next = this.queue.shift();
      setImmediate(() => {
        this.locked = false;
        next();
      });
    } else {
      this.locked = false;
    }
  }
}

/**
 * Initialize and run the Google Maps directions screenshot process with concurrency
 */
async function InitializeGoogleMapsDirectionsScreenshot(csvFilePath, options = {}) {
  const screenshotProcessor = new GoogleMapsDirectionsScreenshot({
    // headless: options.headless !== undefined ? options.headless : false,
    headless: false,
    timeout: options.timeout || 45000,
    delay: options.delay || 3000,
    concurrency: options.concurrency || 3, // Default to 3 concurrent processes
    screenshotPath: options.screenshotPath || "./screenshots/gmaps_directions_screenshots/",
    startingPoint: options.startingPoint || "New York",
  });

  const outputPath = options.outputPath || "./screenshots/gmaps_directions_screenshots/gmaps_directions_results.csv";
  
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
    headless: false,
    concurrency: 3 // Process 3 records concurrently
  })
    .then(() => {
      console.log("\n🎉 Concurrent Google Maps directions screenshot process completed successfully!");
    })
    .catch((error) => {
      console.error("Process failed:", error);
      process.exit(1);
    });
}