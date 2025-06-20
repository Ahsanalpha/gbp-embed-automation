// gmaps_directions_screenshot.js

const puppeteer = require("puppeteer");
const fs = require("fs");
const csv = require("csv-parser");
const path = require("path");

class GoogleMapsDirectionsScreenshot {
  constructor(options = {}) {
    this.options = {
      headless: options.headless !== undefined ? options.headless : false, // Default to non-headless to see bounding box
      timeout: options.timeout || 30000, // Increased timeout
      waitForNetworkIdle: options.waitForNetworkIdle || 5000, // Longer wait
      maxRetries: options.maxRetries || 3,
      delay: options.delay || 3000, // Longer delay between requests
      userAgent:
        options.userAgent ||
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36", // Updated user agent
      screenshotPath: options.screenshotPath || ".screenshots/gmaps_directions_screenshots/",
      startingPoint: options.startingPoint || "New York",
      showBoundingBox: options.showBoundingBox !== false, // Default to true
      boundingBoxDelay: options.boundingBoxDelay || 5000 // How long to show bounding box (5 seconds default)
    };
    this.results = [];
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
          // Only process rows that have a Search_URL
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
   * Take screenshot of Google Maps directions sidebar
   */
  async captureDirectionsScreenshot(record, browser) {
    const page = await browser.newPage();
    let screenshotPath = '';
    
    try {
      await page.setUserAgent(this.options.userAgent);
      
      // Set larger viewport with device scale factor for better rendering
      await page.setViewport({ 
        width: 1920, 
        height: 1080,
      });

      // Enable request interception but only block truly unnecessary resources
      await page.setRequestInterception(true);
      page.on("request", (req) => {
        const resourceType = req.resourceType();
        const url = req.url();
        
        // Only block video/audio media, but allow images, fonts, and stylesheets
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

      console.log(`🗺️  Processing directions for: ${businessName}`);
      console.log(`📍 Navigating to: ${record.searchUrl}`);

      // Navigate to Google Maps search URL with longer timeout
      await page.goto(record.searchUrl, {
        waitUntil: "networkidle0", // Wait for all network requests to finish
        timeout: this.options.timeout,
      });

      // Wait for Google Maps to fully load - look for key UI elements
      await page.waitForSelector('#searchboxinput, [data-value="Directions"], .widget-pane', { 
        visible: true, 
        timeout: 20000 
      });

      // Additional wait for UI to settle and render completely
      await page.waitForTimeout(this.options.waitForNetworkIdle);

      // Wait for fonts and styles to load completely
      await page.evaluate(() => {
        return document.fonts.ready;
      });

      console.log(`🎯 Looking for Directions tab for: ${businessName}`);

      // Wait for the Directions button/tab to be fully visible and clickable
      await page.waitForFunction(() => {
        const selectors = [
          '[data-value="Directions"]',
          'button[data-value="Directions"]',
          '[aria-label*="Directions"]',
          'button[jsaction*="directions"]'
        ];
        
        for (const selector of selectors) {
          const element = document.querySelector(selector);
          if (element && element.offsetParent !== null) { // Check if visible
            return element;
          }
        }
        return false;
      }, { timeout: 20000 });

      console.log(`🎯 Clicking Directions tab for: ${businessName}`);

      // Click the Directions tab with better error handling
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
            // Scroll element into view if needed
            element.scrollIntoView({ behavior: 'smooth', block: 'center' });
            
            // Use both click methods for better reliability
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

      // Wait longer for directions UI to load and render
      await page.waitForTimeout(4000);

      // Wait for directions interface to be ready
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

      console.log(`⌨️  Entering starting point: ${this.options.startingPoint}`);

      // More robust input handling
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
            // Scroll into view and focus
            input.scrollIntoView({ behavior: 'smooth', block: 'center' });
            input.focus();
            
            // Clear and set value
            input.select();
            input.value = '';
            input.value = startingPoint;
            
            // Trigger multiple events for better compatibility
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

      // Press Enter to initiate the search with additional reliability
      await page.keyboard.press('Enter');
      await page.waitForTimeout(500);

      console.log(`⏳ Waiting for directions to load for: ${businessName}`);

      // Wait for loading indicators to appear and disappear
      try {
        // Wait for loading spinner or progress indicator
        // await page.waitForSelector('.loading, .spinner, [aria-label*="Loading"]', { 
        //   visible: true, 
        //   timeout: 5000 
        // }).catch(() => console.log('No loading indicator found'));
        
        // Wait for loading to disappear
        await page.waitForSelector('.loading, .spinner, [aria-label*="Loading"]', { 
          hidden: true, 
          timeout: 20000 
        }).catch(() => console.log('Loading indicator did not disappear'));
      } catch (error) {
        console.log('Loading detection failed, continuing...');
      }

      // Wait for directions results to load - comprehensive selector check
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
        console.log(`⚠️  Directions UI may not have loaded completely for ${businessName}, proceeding with screenshot...`);
      });

      // Final wait for UI to fully settle and render
      await page.waitForTimeout(this.options.waitForNetworkIdle);

      // Ensure all images and icons are loaded
      await page.waitForFunction(() => {
        const images = Array.from(document.images);
        return images.every(img => img.complete);
      }, { timeout: 10000 }).catch(() => console.log('Some images may not have loaded'));

      console.log(`📸 Taking screenshot for: ${businessName}`);

        const screenshotArea = {
            x: 72,
            y: 60,
            width: 408,
            height: 1065 * 0.5
          };
        
        // Final fallback to viewport screenshot
        await page.screenshot({
          path: screenshotPath,
          fullPage: false,
          clip: screenshotArea,
          type: 'png'
        });
      // }

      console.log(`✅ Screenshot saved: ${screenshotPath}`);

      // Record successful result
      this.results.push({
        url: record.url,
        business_name: businessName,
        search_url: record.searchUrl,
        screenshot_path: screenshotPath,
        city: record.city,
        screenshot_status: 'success',
        processed_at: new Date().toISOString(),
        starting_point: this.options.startingPoint,
        error_message: ''
      });

    } catch (error) {
      console.error(`❌ Error processing ${record.businessName || 'Unknown'}: ${error.message}`);
      
      // Record error result
      this.results.push({
        url: record.url,
        business_name: record.businessName || 'Unknown',
        search_url: record.searchUrl,
        screenshot_path: '',
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

  async generateReport(results,outputPath) {
    const summary = {
      totalProcessed: results.length,
      successful: results.filter((r) => r.success).length,
      failed: results.filter((r) => !r.success).length,
      timestamp: new Date().toISOString(),
      results: results,
    };
  
    fs.writeFileSync(outputPath, JSON.stringify(summary, null, 2));
    console.log(`Report saved: ${outputPath}`);
    return summary;
  }

  /**
   * Main processing function
   */
  async processDirectionsScreenshots(csvFilePath, outputPath) {
    try {
      // Ensure screenshot directory exists
      this.ensureDirectoryExists(this.options.screenshotPath);

      // Read records from CSV
      const records = await this.readEnhancedCsv(csvFilePath);

      if (records.length === 0) {
        throw new Error("No records with Search URLs found in the CSV file");
      }

      console.log(`🚀 Starting directions screenshot process for ${records.length} business(es)...`);
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

        // Save results

        this.generateReport(this.results,outputPath)

        // Print summary
        const successCount = this.results.filter(r => r.screenshot_status === 'success').length;
        const errorCount = this.errors.length;

        console.log("\n=== DIRECTIONS SCREENSHOT SUMMARY ===");
        console.log(`Total businesses processed: ${records.length}`);
        console.log(`Successful screenshots: ${successCount}`);
        console.log(`Errors encountered: ${errorCount}`);
        console.log(`Screenshots saved to: ${this.options.screenshotPath}`);
        console.log(`Results saved to: ${outputPath}`);

      } finally {
        await browser.close();
      }
      console.log("gbp_location_output:::",this.results)
      return this.results;

    } catch (error) {
      console.error("Directions screenshot process failed:", error);
      throw error;
    }
  }
}

/**
 * Initialize and run the Google Maps directions screenshot process
 */
async function InitializeGoogleMapsDirectionsScreenshot(csvFilePath, options = {}) {
  const screenshotProcessor = new GoogleMapsDirectionsScreenshot({
    headless: options.headless !== undefined ? options.headless : false, // Default to non-headless for bounding box visibility
    timeout: options.timeout || 45000,
    delay: options.delay || 3000,
    screenshotPath: options.screenshotPath || "./screenshots/gmaps_directions_screenshots/",
    startingPoint: options.startingPoint || "New York",
    showBoundingBox: options.showBoundingBox !== false, // Default to true
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
    showBoundingBox: true, // Enable bounding box by default
    headless: false // Make sure we can see the browser
  })
    .then(() => {
      console.log("\n🎉 Google Maps directions screenshot process completed successfully!");
    })
    .catch((error) => {
      console.error("Process failed:", error);
      process.exit(1);
    });
}