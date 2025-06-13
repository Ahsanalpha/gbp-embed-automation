//scraper.js

const puppeteer = require("puppeteer");
const fs = require("fs");
const csv = require("csv-parser");
const createCsvWriter = require("csv-writer").createObjectCsvWriter;
const path = require("path");
const { InitializeGBPIframeProcessor } = require("../screenshot_services/gbp_embed_screenshot.js");

class GBPIframeScraper {
  constructor(options = {}) {
    this.options = {
      headless: options.headless !== false, // Default to headless
      // headless: false, // Default to headless
      timeout: options.timeout || 30000,
      waitForNetworkIdle: options.waitForNetworkIdle || 2000,
      maxRetries: options.maxRetries || 3,
      delay: options.delay || 1000, // Delay between requests
      userAgent:
        options.userAgent ||
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
    };
    this.results = [];
    this.errors = [];
    this.onlyGBPSuccessRecords = [];
  }

  /**
   * Check if a URL contains Google Maps embed pattern
   */
  isGoogleMapsEmbed(url) {
    if (!url) return false;

    const patterns = [
      /^https?:\/\/www\.google\.com\/maps\/embed/i,
      /^https?:\/\/maps\.google\.com\/maps/i,
    ];

    return patterns.some((pattern) => pattern.test(url));
  }

  normalizeUrl(url) {
    if (!url || typeof url !== "string") return "";
    return url.trim().replace(/^["']|["']$/g, ""); // Remove leading/trailing single or double quotes
  }

  /**
   * Extract all iframe src attributes from HTML content
   */
  extractIframeSources(html) {
    const iframeSources = [];

    // Multiple regex patterns to catch different iframe formats
    const iframePatterns = [
      /<iframe[^>]+src\s*=\s*["']([^"']+)["'][^>]*>/gi,
      /<iframe[^>]+src\s*=\s*([^\s>]+)[^>]*>/gi,
    ];

    iframePatterns.forEach((pattern) => {
      let match;
      while ((match = pattern.exec(html)) !== null) {
        const src = match[1];
        if (src && this.isGoogleMapsEmbed(src)) {
          iframeSources.push(src);
        }
      }
    });

    return [...new Set(iframeSources)]; // Remove duplicates
  }

  /**
   * Scrape a single URL for GBP iframes
   */
  async scrapeUrl(url, browser) {
    const page = await browser.newPage();

    try {
      // Set user agent and viewport
      await page.setUserAgent(this.options.userAgent);
      await page.setViewport({ width: 1366, height: 768 });

      // Block unnecessary resources to speed up loading
      await page.setRequestInterception(true);
      page.on("request", (req) => {
        const resourceType = req.resourceType();
        if (["image", "stylesheet", "font", "media"].includes(resourceType)) {
          req.abort();
        } else {
          req.continue();
        }
      });

      console.log(`Scraping: ${url}`);

      // Navigate to the page
      await page.goto(url, {
        waitUntil: "networkidle2",
        timeout: this.options.timeout,
      });

      // Wait for any dynamic content to load
      await page.waitForTimeout(this.options.waitForNetworkIdle);

      // Get the full HTML content
      const html = await page.content();

      // Extract iframe sources using regex
      const regexSources = this.extractIframeSources(html);

      // Also use Puppeteer to find iframes in the DOM
      const domSources = await page.evaluate(() => {
        const iframes = document.querySelectorAll("iframe");
        const sources = [];

        iframes.forEach((iframe) => {
          const src = iframe.src || iframe.getAttribute("src");
          if (src) {
            sources.push(src);
          }
        });

        return sources;
      });

      // Combine and filter results
      const allSources = [...regexSources, ...domSources];
      const gbpSources = allSources.filter((src) =>
        this.isGoogleMapsEmbed(src)
      );
      const uniqueSources = [...new Set(gbpSources)];

      if (uniqueSources.length > 0) {
        console.log(`✓ Found ${uniqueSources.length} GBP iframe(s) on ${url}`);
        // Extract full iframe elements via DOM for matching GBP src
        const matchingIframes = await page.evaluate(() => {
          const iframes = Array.from(document.querySelectorAll("iframe"));
          return iframes
            .map((iframe) => {
              const src = iframe.getAttribute("src") || "";
              return {
                src,
              };
            })
            .filter(
              ({ src }) =>
                src.startsWith("https://www.google.com/maps/embed") ||
                src.startsWith("https://maps.google.com/maps")
            );
        });

        matchingIframes.forEach(({ src }) => {
          const normalizedURL = this.normalizeUrl(src);
          if (src.length > 0) {
            this.results.push({
              url: url,
              iframe_src: normalizedURL,
              found_at: new Date().toISOString(),
              status: "success",
            });
          }
        });
      } else {
        console.log(`✗ No GBP iframes found on ${url}`);
        this.results.push({
          url: url,
          iframe_src: "",
          found_at: new Date().toISOString(),
          status: "no_iframe_found",
        });
      }
    } catch (error) {
      console.error(`Error scraping ${url}:`, error.message);
      this.errors.push({
        url: url,
        error: error.message,
        timestamp: new Date().toISOString(),
      });

      this.results.push({
        url: url,
        iframe_src: "",
        found_at: new Date().toISOString(),
        status: "error",
      });
    } finally {
      await page.close();
    }
  }

  /**
   * Read URLs from CSV file
   */
  async readUrlsFromCsv(csvFilePath, columnName = "Address") {
    return new Promise((resolve, reject) => {
      const urls = [];

      if (!fs.existsSync(csvFilePath)) {
        reject(new Error(`CSV file not found: ${csvFilePath}`));
        return;
      }

      fs.createReadStream(csvFilePath)
        .pipe(csv())
        .on("data", (row) => {
          const url = row[Object.keys(row)[0]];
          if (url && url.trim()) {
            // Ensure URL has protocol
            let cleanUrl = url.trim();
            if (
              !cleanUrl.startsWith("http://") &&
              !cleanUrl.startsWith("https://")
            ) {
              cleanUrl = "https://" + cleanUrl;
            }
            urls.push(cleanUrl);
          }
        })
        .on("end", () => {
          console.log(`Loaded ${urls.length} URLs from CSV`);
          resolve(urls);
        })
        .on("error", (error) => {
          reject(error);
        });
    });
  }

  /**
   * Save results to CSV file
   */
  async saveResultsToCsv(outputPath) {
    const csvWriter = createCsvWriter({
      path: outputPath,
      header: [
        { id: "url", title: "URL" },
        { id: "iframe_src", title: "GBP_Iframe_Source" },
        { id: "found_at", title: "Scraped_At" },
        { id: "status", title: "Status" },
      ],
    });

    await csvWriter.writeRecords(this.results);
    console.log(`\n✓ Results saved to ${outputPath}`);

    this.onlyGBPSuccessRecords = this.results.filter((result) => {
      return result.iframe_src.length > 0;
    });

    // Also save errors if any
    if (this.errors.length > 0) {
      const errorCsvWriter = createCsvWriter({
        path: "./gbp_logs/gbp_scraping_errors.csv",
        header: [
          { id: "url", title: "URL" },
          { id: "error", title: "Error" },
          { id: "timestamp", title: "Timestamp" },
        ],
      });

      await errorCsvWriter.writeRecords(this.errors);
      console.log(`✓ Errors saved to gbp_scraping_errors.csv`);
    }
  }

  /**
   * Main scraping function
   */
  async scrape(input,options = {}) {
    let urls = [];

    // Determine input type and get URLs
    if (typeof input === "string") {
      if (input.endsWith(".csv")) {
        // Input is CSV file
        urls = await this.readUrlsFromCsv(
          input,
          options.columnName || "Address"
        );
      } else {
        // Input is a single URL
        urls = [input];
      }
    } else if (Array.isArray(input)) {
      // Input is an array of URLs
      urls = input;
    } else {
      throw new Error(
        "Input must be a URL string, CSV file path, or array of URLs"
      );
    }

    if (urls.length === 0) {
      throw new Error("No URLs found to scrape");
    }

    console.log(`Starting to scrape ${urls.length} URL(s)...`);

    // Launch browser
    const browser = await puppeteer.launch({
      headless: this.options.headless,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-blink-features=AutomationControlled",
        "--disable-features=VizDisplayCompositor",
      ],
    });

    try {
      // Process URLs with concurrency control
      const concurrency = 3; // Process 3 URLs at a time

      for (let i = 0; i < urls.length; i += concurrency) {
        const batch = urls.slice(i, i + concurrency);
        const promises = batch.map((url) => this.scrapeUrl(url, browser));

        await Promise.all(promises);

        // Add delay between batches
        if (i + concurrency < urls.length) {
          await new Promise((resolve) =>
            setTimeout(resolve, this.options.delay)
          );
        }
      }

      // Save results
      await this.saveResultsToCsv(options.outputPath);

      // Print summary
      const successCount = this.results.filter(
        (r) => r.status === "success"
      ).length;
      const errorCount = this.errors.length;

      console.log("\n=== SCRAPING SUMMARY ===");
      console.log(`Total URLs processed: ${urls.length}`);
      console.log(`GBP iframes found: ${successCount}`);
      console.log(`Errors encountered: ${errorCount}`);
      console.log(
        `Results saved to: ${options.outputPath || "gbp_scraping_results.csv"}`
      );

      // Trigger screenshot rendering if GBP records were found
      if (this.onlyGBPSuccessRecords.length > 0) {
        console.log(`\nFound ${this.onlyGBPSuccessRecords.length} GBP records. Starting screenshot rendering...`);
        try {
          await InitializeGBPIframeProcessor("./gbp_output_data/gbp_only_records.csv");
        } catch (renderError) {
          console.error("Screenshot rendering failed:", renderError.message);
          console.log("Scraping completed successfully, but screenshot rendering encountered errors.");
        }
      } else {
        console.log("\nNo GBP iframes found. Skipping screenshot rendering.");
      }
    } finally {
      await browser.close();
    }

    return this.results;
  }
}

/**
 * Main execution function
 */
async function InitializeGBPIframeScraper() {
  // Check if gbp_output_data directory exists, create if it doesn't
  if (!fs.existsSync("gbp_output_data")) {
    fs.mkdirSync("gbp_output_data");
    console.log("📁 Created gbp_output_data directory");
  }

  const scraper = new GBPIframeScraper({
    headless: true,
    timeout: 30000,
    delay: 2000,
  });

  try {
    // Scrape from CSV file
    await scraper.scrape("gbp_input_data/internal_all.csv", {
      columnName: "Address",
      outputPath: "gbp_output_data/gbp_only_records.csv",
    });

    console.log("\n🎉 Process completed successfully!");
    console.log("📁 Check the following files for results:");
    console.log("   - gbp_only_records.csv (all scraping results)");
    console.log("   - gbp_screenshots/ folder (screenshots of GBP iframes)");
    console.log("   - gbp_screenshot_results.csv (screenshot processing results)");

  } catch (error) {
    console.error("Process failed:", error);
    process.exit(1);
  }
}

// Export for use as module
module.exports = { InitializeGBPIframeScraper };

// Run if called directly
if (require.main === module) {
  InitializeGBPIframeScraper();
}