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
      questionsScreenshotPath: options.questionsScreenshotPath || ".screenshots/gmaps_questions_screenshots/", // New path for questions screenshots
      startingPoint: options.startingPoint || "New York",
      showBoundingBox: options.showBoundingBox !== false, // Default to true
      boundingBoxDelay: options.boundingBoxDelay || 5000 // How long to show bounding box (5 seconds default)
    };
    this.results = [];
    this.questionsResults = []; // New array for questions-specific results
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
   * Capture "More questions" screenshot
   */
  async captureQuestionsScreenshot(record, page) {
    const businessName = record.businessName || 'Unknown';
    const sanitizedBusinessName = businessName.replace(/[^a-zA-Z0-9\s]/g, '').replace(/\s+/g, '_');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const questionsScreenshotPath = path.join(this.options.questionsScreenshotPath, `${sanitizedBusinessName}_${timestamp}_questions.png`);

    try {
      console.log(`❓ Looking for "More questions" button for: ${businessName}`);

      // Wait for the page to be fully loaded and rendered
      await page.waitForSelector('#searchboxinput, .widget-pane', { 
        visible: true, 
        timeout: 20000 
      });

      // Look for "More questions" button with multiple selectors
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
            // Continue to next selector if current one fails
          }
        }

        // Fallback: look for any button containing "question" text
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
        console.log(`⚠️  "More questions" button not found for ${businessName}`);
        return false;
      });

      if (!moreQuestionsFound) {
        console.log(`⏭️  Skipping questions screenshot for ${businessName} - button not available`);
        return { success: false, reason: 'More questions button not found' };
      }

      // Scroll the button into view and click it
      const clickSuccess = await page.evaluate(() => {
        const selectors = [
          'button[aria-label*="More questions" i]',
          'button[data-value*="questions" i]',
          'button[aria-label*="Questions" i]'
        ];
        
        let targetButton = null;
        
        // Try specific selectors first
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

        // Fallback to any button with "question" in text or aria-label
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
          // Scroll into view
          targetButton.scrollIntoView({ behavior: 'smooth', block: 'center' });
          
          // Click the button
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

      // Wait for the UI to update after clicking
      // await page.waitForTimeout(2000);
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Wait for questions content to load
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
        console.log(`⚠️  Questions content may not have loaded completely for ${businessName}`);
      });

      // Additional wait for UI to settle
      await page.waitForTimeout(1500);

      // Ensure all content is rendered
      await page.waitForFunction(() => {
        return document.fonts.ready;
      }, { timeout: 5000 }).catch(() => console.log('Font loading timeout'));

      console.log(`📸 Taking questions screenshot for: ${businessName}`);

      // Take screenshot of the questions area
      const screenshotArea = {
        x: 72,
        y: 60,
        width: 408,
        height: 1065 * 0.5
      };

      await page.screenshot({
        path: questionsScreenshotPath,
        fullPage: false,
        clip: screenshotArea,
        type: 'png'
      });

      console.log(`✅ Questions screenshot saved: ${questionsScreenshotPath}`);

      // Record successful questions result
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

      // NEW: Use browser back button to return to main view
      console.log(`🔙 Using browser back navigation to return to main view for: ${businessName}`);

      // Wait a moment before navigating back
      await page.waitForTimeout(1000);

      try {
        // Use browser's back functionality
        await page.goBack({ 
          waitUntil: 'networkidle2',
          timeout: 15000 
        });

        console.log(`✅ Successfully navigated back using browser back for: ${businessName}`);
        
        // Wait for the main view to be restored
        await page.waitForSelector('#searchboxinput, [data-value="Directions"], .widget-pane', { 
          visible: true, 
          timeout: 15000 
        });
        
        // Additional wait for UI to settle after navigation
        await page.waitForTimeout(2000);
        
        // Wait for fonts and styles to load completely after back navigation
        await page.evaluate(() => {
          return document.fonts.ready;
        }).catch(() => console.log('Font loading timeout after back navigation'));
        
        console.log(`🔄 Successfully returned to main view for: ${businessName}`);

      } catch (error) {
        console.log(`⚠️  Browser back navigation failed for ${businessName}: ${error.message}`);
        console.log(`🔄 Attempting to reload the original URL...`);
        
        // Fallback: reload the original search URL if back navigation fails
        try {
          await page.goto(record.searchUrl, {
            waitUntil: "networkidle2",
            timeout: 20000,
          });
          
          // Wait for page to fully load after reload
          await page.waitForSelector('#searchboxinput, [data-value="Directions"], .widget-pane', { 
            visible: true, 
            timeout: 15000 
          });
          
          await page.waitForTimeout(3000);
          
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
      
      // Record questions error result
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
    let screenshotPath = '';
    let questionsResult = { success: false, screenshot_path: '', reason: 'Not attempted' };
    
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

      // NEW: Capture "More questions" screenshot first
      questionsResult = await this.captureQuestionsScreenshot(record, page);

      // After questions screenshot, ensure we're back to the main view
      if (questionsResult.success) {
        console.log(`🔄 Ensuring we're on the main view before proceeding with directions for: ${businessName}`);
        
        // Wait for the main UI to be ready for directions
        await page.waitForTimeout(1000);
        
        // Verify main view elements are present, if not try to navigate back
        const mainViewReady = await page.$('#searchboxinput, [data-value="Directions"], .widget-pane');
        if (!mainViewReady) {
          console.log(`⚠️  Main view not ready, attempting to restore for: ${businessName}`);
          // Additional wait and check
          await page.waitForTimeout(2000);
        }
      }

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

      console.log(`📸 Taking directions screenshot for: ${businessName}`);

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

      console.log(`✅ Directions screenshot saved: ${screenshotPath}`);

      // Record successful result with questions info
      this.results.push({
        url: record.url,
        business_name: businessName,
        search_url: record.searchUrl,
        screenshot_path: screenshotPath,
        questions_screenshot_path: questionsResult.screenshot_path,
        questions_screenshot_status: questionsResult.success ? 'success' : 'error',
        questions_error_message: questionsResult.success ? '' : questionsResult.reason,
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
        questions_screenshot_path: questionsResult.screenshot_path,
        questions_screenshot_status: questionsResult.success ? 'success' : 'error',
        questions_error_message: questionsResult.success ? '' : questionsResult.reason,
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

  /**
   * Main processing function
   */
  async processDirectionsScreenshots(csvFilePath, outputPath) {
    try {
      // Ensure screenshot directories exist
      this.ensureDirectoryExists(this.options.screenshotPath);
      this.ensureDirectoryExists(this.options.questionsScreenshotPath); // New directory for questions

      // Read records from CSV
      const records = await this.readEnhancedCsv(csvFilePath);

      if (records.length === 0) {
        throw new Error("No records with Search URLs found in the CSV file");
      }

      console.log(`🚀 Starting screenshot process for ${records.length} business(es)...`);
      console.log(`📍 Starting point: ${this.options.startingPoint}`);
      console.log(`🖥️  Headless mode: ${this.options.headless ? 'Enabled' : 'Disabled'}`);
      console.log(`📂 Directions screenshots: ${this.options.screenshotPath}`);
      console.log(`❓ Questions screenshots: ${this.options.questionsScreenshotPath}`);

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
        this.generateReport(this.results, outputPath);

        // Generate separate questions report in the questions screenshots folder
        const questionsOutputPath = path.join(this.options.questionsScreenshotPath, "questions_processing_report.json");
        this.generateQuestionsReport(this.questionsResults, questionsOutputPath);

        // Print summary
        const successCount = this.results.filter(r => r.screenshot_status === 'success').length;
        const questionsSuccessCount = this.questionsResults.filter(r => r.screenshot_status === 'success').length;
        const errorCount = this.errors.length;

        console.log("\n=== SCREENSHOT SUMMARY ===");
        console.log(`Total businesses processed: ${records.length}`);
        console.log(`Successful directions screenshots: ${successCount}`);
        console.log(`Successful questions screenshots: ${questionsSuccessCount}`);
        console.log(`Errors encountered: ${errorCount}`);
        console.log(`Directions screenshots saved to: ${this.options.screenshotPath}`);
        console.log(`Questions screenshots saved to: ${this.options.questionsScreenshotPath}`);
        console.log(`Results saved to: ${outputPath}`);
        console.log(`Questions results saved to: ${path.join(this.options.questionsScreenshotPath, "questions_processing_report.json")}`);

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
    headless: options.headless !== undefined ? options.headless : false, // Default to non-headless for bounding box visibility
    timeout: options.timeout || 45000,
    delay: options.delay || 3000,
    screenshotPath: options.screenshotPath || "./screenshots/gmaps_directions_screenshots/",
    questionsScreenshotPath: options.questionsScreenshotPath || "./screenshots/gmaps_questions_screenshots/", // New option
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
      console.log("\n🎉 Google Maps screenshot process completed successfully!");
    })
    .catch((error) => {
      console.error("Process failed:", error);
      process.exit(1);
    });
}