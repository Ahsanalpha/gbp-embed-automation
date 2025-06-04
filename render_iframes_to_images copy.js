const puppeteer = require("puppeteer");
const fs = require("fs");
const csv = require("csv-parser");
const path = require("path");

class GBPIframeRenderer {
  constructor(options = {}) {
    this.options = {
      // headless: options.headless !== false,
      headless: false,
      timeout: options.timeout || 30000,
      waitForNetworkIdle: options.waitForNetworkIdle || 3000,
      scrollDelay: options.scrollDelay || 2000,
      screenshotDelay: options.screenshotDelay || 1000,
      maxRetries: options.maxRetries || 3,
      userAgent:
        options.userAgent ||
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
      screenshotDir: options.screenshotDir || "gbp_screenshots",
      viewportWidth: 1920,
      viewportHeight: 1920,
      screenshotPadding: 1200, // Padding around iframe
    };
    this.results = [];
    this.errors = [];
  }

  /**
   * Ensure screenshot directory exists
   */
  ensureScreenshotDir() {
    if (!fs.existsSync(this.options.screenshotDir)) {
      fs.mkdirSync(this.options.screenshotDir, { recursive: true });
      console.log(`Created screenshot directory: ${this.options.screenshotDir}`);
    }
  }

  /**
   * Read GBP records from CSV file
   */
  async readGBPRecords(csvFilePath = "gbp_only_records.csv") {
    return new Promise((resolve, reject) => {
      const records = [];

      if (!fs.existsSync(csvFilePath)) {
        reject(new Error(`CSV file not found: ${csvFilePath}`));
        return;
      }

      fs.createReadStream(csvFilePath)
        .pipe(csv())
        .on("data", (row) => {
          // Handle different possible column names
          const url = row.URL || row.url;
          const iframeSrc = row.GBP_Iframe_Source || row.iframe_src;
          
          if (url && iframeSrc && url.trim() && iframeSrc.trim()) {
            records.push({
              url: url.trim(),
              iframeSrc: iframeSrc.trim(),
              originalRow: row
            });
          }
        })
        .on("end", () => {
          console.log(`Loaded ${records.length} GBP records from CSV`);
          resolve(records);
        })
        .on("error", (error) => {
          reject(error);
        });
    });
  }

  /**
   * Generate a safe filename from URL
   */
  generateFilename(url, index) {
    const cleanUrl = url
      .replace(/https?:\/\//, "")
      .replace(/[^a-zA-Z0-9]/g, "_")
      .substring(0, 50);
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    return `gbp_${index + 1}_${cleanUrl}_${timestamp}.png`;
  }

  /**
   * Find iframe element that matches the GBP source
   */
  async findMatchingIframe(page, targetSrc) {
    return await page.evaluate((targetSrc) => {
      const iframes = Array.from(document.querySelectorAll("iframe"));
      
      for (let iframe of iframes) {
        const src = iframe.src || iframe.getAttribute("src") || "";
        
        // Check for exact match or partial match (in case of URL variations)
        if (src === targetSrc || 
            (src.includes("google.com/maps/embed") && targetSrc.includes("google.com/maps/embed")) ||
            (src.includes("maps.google.com") && targetSrc.includes("maps.google.com"))) {
          
          const rect = iframe.getBoundingClientRect();
          return {
            found: true,
            element: {
              tagName: iframe.tagName,
              src: src,
              width: rect.width,
              height: rect.height,
              top: rect.top,
              left: rect.left,
              visible: rect.width > 0 && rect.height > 0
            }
          };
        }
      }
      
      return { found: false };
    }, targetSrc);
  }

  /**
   * Scroll element into view and center it
   */
  async scrollToIframe(page, targetSrc) {
    return await page.evaluate((targetSrc) => {
      const iframes = Array.from(document.querySelectorAll("iframe"));
      
      for (let iframe of iframes) {
        const src = iframe.src || iframe.getAttribute("src") || "";
        
        if (src === targetSrc || 
            (src.includes("google.com/maps/embed") && targetSrc.includes("google.com/maps/embed")) ||
            (src.includes("maps.google.com") && targetSrc.includes("maps.google.com"))) {
          
          // Scroll iframe into view with center alignment
          iframe.scrollIntoView({
            behavior: 'smooth',
            block: 'center',
            inline: 'center'
          });
          
          return { success: true, message: "Iframe scrolled into view" };
        }
      }
      
      return { success: false, message: "Iframe not found for scrolling" };
    }, targetSrc);
  }

  /**
   * Capture screenshot of iframe and surrounding content
   */
  async captureIframeScreenshot(page, scrollToY, targetSrc, filename) {
    // Get iframe position and dimensions
    await this.page.evaluate(() => window.scrollTo(0, scrollToY));
    const iframeInfo = await page.evaluate((targetSrc) => {
      const iframes = Array.from(document.querySelectorAll("iframe"));
      
      for (let iframe of iframes) {
        const src = iframe.src || iframe.getAttribute("src") || "";
        
        if (src === targetSrc || 
            (src.includes("google.com/maps/embed") && targetSrc.includes("google.com/maps/embed")) ||
            (src.includes("maps.google.com") && targetSrc.includes("maps.google.com"))) {
          
          const rect = iframe.getBoundingClientRect();
          return {
            found: true,
            x: rect.left,
            y: scrollToY,
            width: rect.width,
            height: rect.height
          };
        }
      }
      
      return { found: false };
    }, targetSrc);

    if (!iframeInfo.found) {
      throw new Error("Iframe not found for screenshot");
    }

    // Calculate screenshot area with padding
    const padding = this.options.screenshotPadding;
    const clip = {
      x: iframeInfo.x,
      y: iframeInfo.y,
      width: iframeInfo.width + (padding * 2),
      height: iframeInfo.height + (padding * 2)
    };

    // Ensure clip doesn't exceed viewport
    const viewport = page.viewport();
    clip.width = Math.min(clip.width, viewport.width - clip.x);
    clip.height = Math.min(clip.height, viewport.height - clip.y);

    const screenshotPath = path.join(this.options.screenshotDir, filename);
    
    await page.screenshot({
      path: screenshotPath,
      clip: clip,
      type: 'png'
    });

    return screenshotPath;
  }

  /**
   * Process a single GBP record
   */
  async processGBPRecord(record, index, browser) {
    const page = await browser.newPage();
    
    try {
      console.log(`\n[${index + 1}] Processing: ${record.url}`);
      
      // Set user agent and viewport
      await page.setUserAgent(this.options.userAgent);
      await page.setViewport({ 
        width: this.options.viewportWidth, 
        height: this.options.viewportHeight 
      });

      // Enable request interception for performance
      await page.setRequestInterception(true);
      page.on("request", (req) => {
        const resourceType = req.resourceType();
        // Allow iframes and essential resources, block heavy assets for faster loading
        if (["font", "media"].includes(resourceType)) {
          req.abort();
        } else {
          req.continue();
        }
      });

      // Navigate to the page
      console.log(`  → Navigating to page...`);
      await page.goto(record.url, {
        waitUntil: "networkidle2",
        timeout: this.options.timeout,
      });

      // Wait for dynamic content to load
      console.log(`  → Waiting for content to load...`);
      await page.waitForTimeout(this.options.waitForNetworkIdle);

      // Check if iframe exists on page
      console.log(`  → Searching for GBP iframe...`);
      const iframeResult = await this.findMatchingIframe(page, record.iframeSrc);
      
      if (!iframeResult.found) {
        throw new Error("GBP iframe not found on page");
      }

      console.log(`  → Found iframe: ${iframeResult.element.width}x${iframeResult.element.height}`);

      // Scroll iframe into view
      console.log(`  → Scrolling iframe into view...`);
      const scrollResult = await this.scrollToIframe(page, record.iframeSrc);
      
      if (!scrollResult.success) {
        throw new Error("Failed to scroll iframe into view");
      }

      // Wait for scroll animation and content stabilization
      await page.waitForTimeout(this.options.scrollDelay);

      // Additional wait for iframe content to load
      console.log(`  → Waiting for iframe content...`);
      await page.waitForTimeout(this.options.screenshotDelay);
      const scrollYPosition = await page.evaluate(() => window.scrollY);
      // Generate filename and capture screenshot
      const filename = this.generateFilename(record.url, index);
      console.log(`  → Capturing screenshot...`);
      const screenshotPath = await this.captureIframeScreenshot(page, scrollYPosition ,record.iframeSrc, filename);

      console.log(`  ✓ Screenshot saved: ${screenshotPath}`);

      this.results.push({
        ...record,
        screenshot_path: screenshotPath,
        filename: filename,
        status: "success",
        processed_at: new Date().toISOString()
      });

    } catch (error) {
      console.error(`  ✗ Error processing ${record.url}:`, error.message);
      
      this.errors.push({
        ...record,
        error: error.message,
        status: "error",
        processed_at: new Date().toISOString()
      });

      this.results.push({
        ...record,
        screenshot_path: "",
        filename: "",
        status: "error",
        processed_at: new Date().toISOString()
      });
    } finally {
      await page.close();
    }
  }

  /**
   * Save processing results to CSV
   */
  async saveResults(outputPath = "gbp_screenshot_results.csv") {
    const createCsvWriter = require("csv-writer").createObjectCsvWriter;
    
    const csvWriter = createCsvWriter({
      path: outputPath,
      header: [
        { id: "url", title: "URL" },
        { id: "iframeSrc", title: "GBP_Iframe_Source" },
        { id: "screenshot_path", title: "Screenshot_Path" },
        { id: "filename", title: "Screenshot_Filename" },
        { id: "status", title: "Status" },
        { id: "processed_at", title: "Processed_At" }
      ],
    });

    await csvWriter.writeRecords(this.results);
    console.log(`\n✓ Results saved to ${outputPath}`);

    // Save errors if any
    if (this.errors.length > 0) {
      const errorCsvWriter = createCsvWriter({
        path: "gbp_screenshot_errors.csv",
        header: [
          { id: "url", title: "URL" },
          { id: "iframeSrc", title: "GBP_Iframe_Source" },
          { id: "error", title: "Error" },
          { id: "processed_at", title: "Processed_At" }
        ],
      });

      await errorCsvWriter.writeRecords(this.errors);
      console.log(`✓ Errors saved to gbp_screenshot_errors.csv`);
    }
  }

  /**
   * Main rendering function
   */
  async renderAll(csvFilePath = "gbp_only_records.csv") {
    try {
      // Ensure screenshot directory exists
      this.ensureScreenshotDir();

      // Read GBP records from CSV
      const records = await this.readGBPRecords(csvFilePath);
      
      if (records.length === 0) {
        console.log("No GBP records found to process");
        return;
      }

      console.log(`Starting to process ${records.length} GBP record(s)...`);

      // Launch browser
      const browser = await puppeteer.launch({
        headless: this.options.headless,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-blink-features=AutomationControlled",
          "--disable-features=VizDisplayCompositor",
          "--disable-web-security",
          "--disable-features=site-per-process"
        ],
      });

      try {
        // Process records sequentially to avoid overwhelming the target sites
        for (let i = 0; i < records.length; i++) {
          await this.processGBPRecord(records[i], i, browser);
          
          // Add delay between requests to be respectful to target sites
          if (i < records.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        }

        // Save results
        await this.saveResults();

        // Print summary
        const successCount = this.results.filter(r => r.status === "success").length;
        const errorCount = this.errors.length;

        console.log("\n=== SCREENSHOT RENDERING SUMMARY ===");
        console.log(`Total records processed: ${records.length}`);
        console.log(`Screenshots captured: ${successCount}`);
        console.log(`Errors encountered: ${errorCount}`);
        console.log(`Screenshots saved to: ${this.options.screenshotDir}/`);

      } finally {
        await browser.close();
      }

    } catch (error) {
      console.error("Screenshot rendering failed:", error);
      throw error;
    }
  }
}

/**
 * Main function to render all GBP iframe screenshots
 * This function is called from the main scraper after successful scraping
 */
async function RenderAllImages() {
  console.log("\n=== STARTING SCREENSHOT RENDERING ===");
  
  const renderer = new GBPIframeRenderer({
    headless: false,
    timeout: 30000,
    waitForNetworkIdle: 3000,
    scrollDelay: 2000,
    screenshotDelay: 1500,
    screenshotDir: "gbp_screenshots",
    screenshotPadding: 50
  });

  try {
    await renderer.renderAll("gbp_only_records.csv");
    console.log("✓ Screenshot rendering completed successfully");
  } catch (error) {
    console.error("✗ Error in RenderAllImages:", error);
    throw error;
  }
}

// Export classes and functions
module.exports = { 
  GBPIframeRenderer, 
  RenderAllImages 
};

// Run if called directly
if (require.main === module) {
  RenderAllImages();
}