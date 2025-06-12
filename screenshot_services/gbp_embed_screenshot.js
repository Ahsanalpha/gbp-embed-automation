//gbp_embed_screenshot.js

const puppeteer = require("puppeteer");
const fs = require("fs").promises;
const path = require("path");
const csv = require("csv-parser");
const { createReadStream } = require("fs");

class GBPIframeProcessor {
  constructor(options = {}) {
    this.browser = null;
    this.outputDir = options.outputDir || "gbp_embed_screenshots";
    this.timeout = options.timeout || 45000;
    this.viewport = options.viewport || { width: 1920, height: 1080 };
    this.delay = options.delay || 3000; // Increased delay
    this.maxRetries = options.maxRetries || 3;
  }

  /**
   * Initialize the browser
   */
  async initialize() {
    try {
      console.log("Initializing browser...");

      this.browser = await puppeteer.launch({
        headless: "new",
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-accelerated-2d-canvas",
          "--no-first-run",
          "--disable-gpu",
          "--disable-web-security",
          "--disable-features=VizDisplayCompositor",
          "--disable-background-timer-throttling",
          "--disable-backgrounding-occluded-windows",
          "--disable-renderer-backgrounding",
          "--disable-ipc-flooding-protection",
        ],
      });

      // Wait for browser to stabilize
      await this.sleep(2000);

      // Create output directory
      await this.ensureDirectoryExists(this.outputDir);

      console.log("Browser initialized successfully");
    } catch (error) {
      throw new Error(`Failed to initialize browser: ${error.message}`);
    }
  }

  /**
   * Create a new page with proper initialization
   */
  async createNewPage() {
    try {
      console.log("Creating new page...");
      const page = await this.browser.newPage();

      // Wait for page to be ready
      await this.sleep(1000);

      // Set viewport and timeouts
      await page.setViewport(this.viewport);
      await page.setDefaultNavigationTimeout(this.timeout);
      await page.setDefaultTimeout(this.timeout);

      // Set user agent
      await page.setUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      );

      // Set extra HTTP headers
      await page.setExtraHTTPHeaders({
        "Accept-Language": "en-US,en;q=0.9",
      });

      console.log("New page created successfully");
      return page;
    } catch (error) {
      throw new Error(`Failed to create new page: ${error.message}`);
    }
  }

  /**
   * Sleep utility function
   */
  async sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Read and parse CSV file
   */
  async readCSV(filePath) {
    return new Promise((resolve, reject) => {
      const results = [];
      const stream = createReadStream(filePath);

      stream.on("error", (error) => {
        reject(new Error(`Failed to read CSV file: ${error.message}`));
      });

      stream
        .pipe(csv())
        .on("data", (data) => {
          // Validate required fields
          if (data.URL && data.GBP_Iframe_Source) {
            results.push({
              url: data.URL.trim(),
              gbpIframeSrc: data.GBP_Iframe_Source.trim(),
              index: results.length,
            });
          } else {
            console.warn(`Skipping row due to missing required fields:`, data);
          }
        })
        .on("end", () => {
          console.log(
            `Successfully parsed ${results.length} valid rows from CSV`
          );
          resolve(results);
        })
        .on("error", (error) => {
          reject(new Error(`Failed to parse CSV: ${error.message}`));
        });
    });
  }

  /**
   * Navigate to URL and find the specific iframe
   */
  async processURL(urlData, retryCount = 0) {
    const { url, gbpIframeSrc, index } = urlData;
    let page = null;

    try {
      console.log(`Processing URL ${index + 1}: ${url}`);

      // Create a fresh page for each URL to avoid state issues
      page = await this.createNewPage();

      // Navigate with multiple strategies
      console.log("Navigating to URL...");
      await this.navigateToPage(page, url);

      console.log("Page loaded, searching for iframe...");

      // Find the iframe with matching src
      const iframeInfo = await this.findTargetIframe(page, gbpIframeSrc);

      if (!iframeInfo) {
        throw new Error(
          `Iframe with src containing "${gbpIframeSrc}" not found`
        );
      }

      console.log(
        `Found iframe at position x:${iframeInfo.position.x}, y:${iframeInfo.position.y}`
      );

      // Scroll to iframe position
      await this.scrollToIframe(page, iframeInfo);

      // Wait for scroll and iframe to stabilize
      await this.sleep(3000);

      // Take screenshot
      const screenshotPath = await this.takeScreenshot(page, index, url);
      

      console.log("Successfully processed URL");

      return {
        success: true,
        url,
        scrollPosition: iframeInfo.scrollPosition,
        screenshotPath,
        iframeInfo: {
          src: iframeInfo.src,
          dimensions: iframeInfo.dimensions,
          position: iframeInfo.position,
        },
      };
    } catch (error) {
      console.error(`Error processing URL ${url}:`, error.message);

      if (retryCount < this.maxRetries) {
        console.warn(
          `Retry ${retryCount + 1}/${this.maxRetries} for URL: ${url}`
        );
        await this.sleep(this.delay * 2);
        return this.processURL(urlData, retryCount + 1);
      }

      return {
        success: false,
        url,
        error: error.message,
        scrollPosition: null,
        screenshotPath: null,
      };
    } finally {
      // Always close the page to prevent memory leaks
      if (page && !page.isClosed()) {
        try {
          await page.close();
        } catch (e) {
          console.warn("Error closing page:", e.message);
        }
      }
    }
  }

  /**
   * Navigate to page with multiple strategies
   */
  async navigateToPage(page, url) {
    const strategies = [
      {
        waitUntil: ["load", "domcontentloaded"],
        name: "load+domcontentloaded",
      },
      { waitUntil: "networkidle0", name: "networkidle0" },
      { waitUntil: "networkidle2", name: "networkidle2" },
      { waitUntil: "domcontentloaded", name: "domcontentloaded" },
    ];

    let lastError = null;

    for (const strategy of strategies) {
      try {
        console.log(`Trying navigation strategy: ${strategy.name}`);
        await page.goto(url, {
          waitUntil: strategy.waitUntil,
          timeout: this.timeout,
        });

        // Wait for page to stabilize
        await this.sleep(2000);

        // Verify page loaded
        const title = await page.title();
        if (title && !title.toLowerCase().includes("error")) {
          console.log(`Successfully loaded page: ${title}`);
          return;
        }
      } catch (error) {
        console.warn(
          `Navigation strategy ${strategy.name} failed:`,
          error.message
        );
        lastError = error;
        await this.sleep(1000);
      }
    }

    throw new Error(
      `All navigation strategies failed. Last error: ${
        lastError?.message || "Unknown error"
      }`
    );
  }

  /**
   * Find the target iframe on the page
   */
  async findTargetIframe(page, targetSrc) {
    try {
      // Wait for potential iframes to load
      await this.sleep(2000);

      const iframeInfo = await page.evaluate((targetSrc) => {
        const iframes = Array.from(document.querySelectorAll("iframe"));
        console.log(`Found ${iframes.length} iframes on page`);

        for (let i = 0; i < iframes.length; i++) {
          const iframe = iframes[i];
          const src =
            iframe.getAttribute("src") || iframe.getAttribute("data-src") || "";

          console.log(`Iframe ${i + 1} src:`, src);

          if (src.includes(targetSrc)) {
            const rect = iframe.getBoundingClientRect();

            return {
              src: src,
              position: {
                x: rect.left + window.pageXOffset,
                y: rect.top + window.pageYOffset,
              },
              dimensions: {
                width: rect.width,
                height: rect.height,
              },
              scrollPosition: {
                x: Math.max(0, rect.left + window.pageXOffset - 100),
                y: Math.max(0, rect.top + window.pageYOffset - 150),
              },
            };
          }
        }

        return null;
      }, targetSrc);

      return iframeInfo;
    } catch (error) {
      throw new Error(`Failed to find iframe: ${error.message}`);
    }
  }

  /**
   * Scroll to the iframe position
   */
  async scrollToIframe(page, iframeInfo) {
    try {
      await page.evaluate((scrollPos) => {
        window.scrollTo({
          left: scrollPos.x,
          top: scrollPos.y,
          behavior: "smooth",
        });
      }, iframeInfo.scrollPosition);

      // Wait for scroll to complete
      await this.sleep(2000);

      // Verify scroll position
      const currentPos = await page.evaluate(() => ({
        x: window.pageXOffset,
        y: window.pageYOffset,
      }));

      console.log(`Scrolled to position x:${currentPos.x}, y:${currentPos.y}`);
    } catch (error) {
      throw new Error(`Failed to scroll to iframe: ${error.message}`);
    }
  }

  /**
   * Take screenshot of the iframe area
   */
  async takeScreenshot(page, index, url) {
    try {
      const filename = `screenshot_${index + 1}_${this.sanitizeFilename(
        url
      )}.png`;
      const screenshotPath = path.resolve(__dirname, '..', 'screenshots',this.outputDir, filename);

      await page.screenshot({
        path: screenshotPath,
        type: "png",
        fullPage: false,
      });

      console.log(`Screenshot saved: ${screenshotPath}`);
      return screenshotPath;
    } catch (error) {
      throw new Error(`Failed to take screenshot: ${error.message}`);
    }
  }

  /**
   * Sanitize filename for cross-platform compatibility
   */
  sanitizeFilename(url) {
    try {
      const domain = new URL(url).hostname;
      return domain.replace(/[^a-z0-9]/gi, "_").toLowerCase();
    } catch {
      return url
        .replace(/[^a-z0-9]/gi, "_")
        .toLowerCase()
        .substring(0, 50);
    }
  }

  /**
   * Ensure directory exists
   */
  async ensureDirectoryExists(dirPath) {
    let currentPath = path.resolve(__dirname, "..", "screenshots", dirPath);
    try {
      await fs.access(currentPath);
    } catch {
      await fs.mkdir(currentPath, { recursive: true });
      console.log(`Created directory: ${dirPath}`);
    }
  }

  /**
   * Generate detailed report
   */
 async generateReport(results) {
  const reportDir = path.resolve(__dirname, '..', 'screenshots', this.outputDir);
  const reportFile = path.join(reportDir, 'processing_report.json');

  const summary = {
    totalProcessed: results.length,
    successful: results.filter((r) => r.success).length,
    failed: results.filter((r) => !r.success).length,
    timestamp: new Date().toISOString(),
    results: results,
  };

  await this.ensureDirectoryExists(this.outputDir); // Ensure dir exists
  await fs.writeFile(reportFile, JSON.stringify(summary, null, 2));
  console.log(`Report saved: ${reportFile}`);
  return summary;
}

  /**
   * Clean up resources
   */
  async cleanup() {
    if (this.browser) {
      try {
        await this.browser.close();
        console.log("Browser closed");
      } catch (error) {
        console.warn("Error closing browser:", error.message);
      }
    }
  }

  /**
   * Main processing function
   */
  async process(csvFilePath) {
    try {
      await this.initialize();

      const urlData = await this.readCSV(csvFilePath);

      if (urlData.length === 0) {
        throw new Error("No valid URLs found in CSV file");
      }

      console.log(`Starting processing of ${urlData.length} URLs...`);
      const results = [];

      for (let i = 0; i < urlData.length; i++) {
        console.log(`\n--- Processing ${i + 1}/${urlData.length} ---`);

        const result = await this.processURL(urlData[i]);
        results.push(result);

        if (result.success) {
          console.log(`✅ Success: ${result.url}`);
          console.log(
            `   Scroll Position: x=${result.scrollPosition.x}, y=${result.scrollPosition.y}`
          );
          console.log(`   Screenshot: ${result.screenshotPath}`);
        } else {
          console.log(`❌ Failed: ${result.url} - ${result.error}`);
        }

        // Add delay between requests
        if (i < urlData.length - 1) {
          console.log(`Waiting ${this.delay}ms before next request...`);
          await this.sleep(this.delay);
        }
      }

      const summary = await this.generateReport(results);

      console.log("\n=== PROCESSING SUMMARY ===");
      console.log(`Total URLs: ${summary.totalProcessed}`);
      console.log(`Successful: ${summary.successful}`);
      console.log(`Failed: ${summary.failed}`);
      console.log(
        `Success Rate: ${(
          (summary.successful / summary.totalProcessed) *
          100
        ).toFixed(1)}%`
      );

      return results;
    } catch (error) {
      console.error("Processing failed:", error.message);
      throw error;
    } finally {
      await this.cleanup();
    }
  }
}

// Usage function
async function InitializeGBPIframeProcessor(fileToProcess) {
  // const csvFilePath = process.argv[2] || './urls.csv';
  const csvFilePath = fileToProcess;

  if (!csvFilePath) {
    console.error("Please provide the CSV file path as an argument");
    console.error("Usage: node script.js <csv-file-path>");
    process.exit(1);
  }

  try {
    // Check if CSV file exists
    await fs.access(csvFilePath);

    const gbpEmbedProcessor = new GBPIframeProcessor({
      outputDir: "gbp_embed_screenshots",
      timeout: 45000,
      delay: 3000,
      maxRetries: 3,
      viewport: { width: 1920, height: 1080 },
    });

    const results = await gbpEmbedProcessor.process(csvFilePath);

    console.log("\nProcessing completed!");
    console.log(
      "Check the screenshots folder for captured images and processing report."
    );
  } catch (error) {
    console.error("Script execution failed:", error.message);
    process.exit(1);
  }
}

// Error handling for unhandled rejections
process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
  process.exit(1);
});

module.exports = {
  GBPIframeProcessor,
  InitializeGBPIframeProcessor,
};