// enhanced_scraper.js

const puppeteer = require("puppeteer");
const fs = require("fs");
const csv = require("csv-parser");
const createCsvWriter = require("csv-writer").createObjectCsvWriter;
const path = require("path");
const {
  InitializeGBPIframeProcessor,
} = require("../screenshot_services/gbp_embed_screenshot.js");
const { EnhancedGBPUrlDecoder } = require("./utils/gbp_url_decoder.js"); // Import the decoder
const {
  InitializeGoogleMapsDirectionsScreenshot,
} = require("../screenshot_services/gbp_location_screenshot.js");
const {
  InitializeGBPBrowserSearchScreenshot,
} = require("../screenshot_services/gbp_browser_search_screenshot.js");

class EnhancedGBPIframeScraper {
  constructor(options = {}) {
    this.options = {
      headless: options.headless !== false,
      timeout: options.timeout || 30000,
      waitForNetworkIdle: options.waitForNetworkIdle || 2000,
      maxRetries: options.maxRetries || 3,
      delay: options.delay || 1000,
      userAgent:
        options.userAgent ||
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
      enableDecoding: options.enableDecoding !== false, // Enable decoding by default
    };
    this.results = [];
    this.errors = [];
    this.onlyGBPSuccessRecords = [];
    this.decoder = new EnhancedGBPUrlDecoder(); // Initialize decoder
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
    return url.trim().replace(/^["']|["']$/g, "");
  }

  /**
   * Extract all iframe src attributes from HTML content
   */
  extractIframeSources(html) {
    const iframeSources = [];

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

    return [...new Set(iframeSources)];
  }

  /**
   * Scrape a single URL for GBP iframes
   */
  async scrapeUrl(url, browser) {
    const page = await browser.newPage();

    try {
      await page.setUserAgent(this.options.userAgent);
      await page.setViewport({ width: 1366, height: 768 });

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

      await page.goto(url, {
        waitUntil: "networkidle2",
        timeout: this.options.timeout,
      });

      await new Promise(resolve => setTimeout(resolve, this.options.waitForNetworkIdle));

      const html = await page.content();
      const regexSources = this.extractIframeSources(html);

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

      const allSources = [...regexSources, ...domSources];
      const gbpSources = allSources.filter((src) =>
        this.isGoogleMapsEmbed(src)
      );
      const uniqueSources = [...new Set(gbpSources)];

      if (uniqueSources.length > 0) {
        console.log(`✓ Found ${uniqueSources.length} GBP iframe(s) on ${url}`);

        const matchingIframes = await page.evaluate(() => {
          const iframes = Array.from(document.querySelectorAll("iframe"));
          return iframes
            .map((iframe) => {
              const src = iframe.getAttribute("src") || "";
              return { src };
            })
            .filter(
              ({ src }) =>
                src.startsWith("https://www.google.com/maps/embed") ||
                src.startsWith("https://maps.google.com/maps")
            );
        });

        for (const { src } of matchingIframes) {
          const normalizedURL = this.normalizeUrl(src);
          if (normalizedURL.length > 0) {
            try {
              // Decode GBP URL if decoding is enabled
              let decodedInfo = {};
              if (this.options.enableDecoding) {
                decodedInfo = await this.decoder.decodeGBPUrl(normalizedURL);
                console.log("decoded info:::", decodedInfo);
              }

              const result = {
                url: url,
                iframe_src: normalizedURL,
                found_at: new Date().toISOString(),
                status: "success",
                business_name: this.options.enableDecoding
                  ? decodedInfo.businessName || ""
                  : "",
                place_id: decodedInfo.placeId,
                city: decodedInfo.city,
                address: this.options.enableDecoding
                  ? decodedInfo.address || ""
                  : "",
                name_and_address: `${decodedInfo.businessName}, ${decodedInfo.address}`,
                latitude: decodedInfo.coordinates.latitude || "",
                longitude: decodedInfo.coordinates.longitude || "",
                nearby_place_name:decodedInfo.nearbyPlaceName||"",
                nearby_place_address:decodedInfo.nearbyPlaceAddress||"",
                nearby_place_latitude:decodedInfo.nearbyPlaceLatitude||"",
                nearby_place_longitude:decodedInfo.nearbyPlaceLongitude||"",
                search_url: this.options.enableDecoding ? decodedInfo.searchUrl || '' : '',
                gmaps_search_url: this.options.enableDecoding
                  ? decodedInfo.gmapsSearchUrl || ""
                  : "",
                decoding_status: this.options.enableDecoding
                  ? decodedInfo.error
                    ? "Error"
                    : "Success"
                  : "Disabled",
                decoding_error: this.options.enableDecoding
                  ? decodedInfo.error || ""
                  : "",
              };

              this.results.push(result);
            } catch (innerError) {
              console.error(
                `Error processing iframe src: ${normalizedURL}`,
                innerError.message
              );

              this.results.push({
                url: url,
                iframe_src: normalizedURL,
                found_at: new Date().toISOString(),
                status: "error",
                city: "",
                place_id: "",
                name_and_address: "",
                nearby_place_name:"",
                nearby_place_address:"",
                nearby_place_latitude:"",
                nearby_place_longitude:"",
                latitude: "",
                longitude: "",
                business_name: "",
                address: "",
                gmaps_search_url: "",
                decoding_status: "Error",
                decoding_error: innerError.message,
              });
            }
          }
        }
      } else {
        console.log(`✗ No GBP iframes found on ${url}`);
        this.results.push({
          url: url,
          iframe_src: "",
          found_at: new Date().toISOString(),
          status: "no_iframe_found",
          name_and_address: "",
          nearby_place_name:"",
          nearby_place_address:"",
          nearby_place_latitude:"",
          nearby_place_longitude:"",
          latitude: "",
          longitude: "",
          city: "",
          business_name: "",
          address: "",
          gmaps_search_url: "",
          place_id: "",
          // place_id: '',
          // latitude: '',
          // longitude: '',
          decoding_status: "N/A",
          decoding_error: "",
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
        name_and_address: "",
        nearby_place_name:"",
        nearby_place_address:"",
        nearby_place_latitude:"",
        nearby_place_longitude:"",
        latitude: "",
        longitude: "",
        place_id: "",
        city: "",
        business_name: "",
        address: "",
        gmaps_search_url: "",
        // place_id: '',
        // latitude: '',
        // longitude: '',
        decoding_status: "Error",
        decoding_error: error.message,
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

  getUniqueBusinessesByName(data) {
    const seen = new Set();
    return data.filter((entry) => {
      if (seen.has(entry.business_Name)) {
        return false;
      }
      seen.add(entry.business_Name);
      return true;
    });
  }

  /**
   * Save enhanced results to CSV file
   */
  async saveResultsToCsv(outputPath) {
    const csvWriter = createCsvWriter({
      path: outputPath,
      header: [
        { id: "url", title: "URL" },
        { id: "iframe_src", title: "GBP_Iframe_Source" },
        { id: "business_name", title: "Business_Name" },
        { id: "name_and_address", title: "Name_Address" },
        { id: "city", title: "City" },
        { id: "address", title: "Business_Address" },
        {id:"latitude", title: 'Latitude'},
        {id:"longitude", title: "Longitude"},
        {id:"nearby_place_name", title:"Nearby_Place_Name"},
        {id:"nearby_place_address", title:"Nearby_Place_Address"},
        {id: "nearby_place_latitude", title:"Nearby_Place_Latitude"},
        {id: "nearby_place_longitude", title:"Nearby_Place_longitude"},
        { id: "search_url", title: "Search_URL" },
        { id: "gmaps_search_url", title: "Gmaps_Search_URL" },
        { id:"place_id", title:'Place_Id' },
        { id: "found_at", title: "Scraped_At" },
        { id: "status", title: "Status" },
        { id: "decoding_status", title: "Decoding_Status" },
        { id: "decoding_error", title: "Decoding_Error" },
      ],
    });

    this.onlyGBPSuccessRecords = this.results.filter((result) => {
      return result.iframe_src.length > 0;
    });

    //  const uniqueRecords = this.getUniqueBusinessesByName(this.onlyGBPSuccessRecords);

    const uniqueKeys = [];
    const uniqueEle = [];
    this.onlyGBPSuccessRecords.forEach((e) => {
      if (!uniqueKeys.includes(e.business_name)) {
        uniqueEle.push(e);
        uniqueKeys.push(e.business_name);
      }
    });

    await csvWriter.writeRecords(uniqueEle);
    console.log(`\n✅ Enhanced results saved to ${outputPath}`);

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
      console.log(`✅ Errors saved to gbp_scraping_errors.csv`);
    }
  }

  /**
   * Main scraping function with enhanced decoding
   */
  async scrape(input, options = {}) {
    let urls = [];

    if (typeof input === "string") {
      if (input.endsWith(".csv")) {
        urls = await this.readUrlsFromCsv(
          input,
          options.columnName || "Address"
        );
      } else {
        urls = [input];
      }
    } else if (Array.isArray(input)) {
      urls = input;
    } else {
      throw new Error(
        "Input must be a URL string, CSV file path, or array of URLs"
      );
    }

    if (urls.length === 0) {
      throw new Error("No URLs found to scrape");
    }

    console.log(`🚀 Starting to scrape ${urls.length} URL(s)...`);
    if (this.options.enableDecoding) {
      console.log(`📋 GBP URL decoding is ENABLED`);
    } else {
      console.log(`📋 GBP URL decoding is DISABLED`);
    }

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
      const concurrency = 3;

      for (let i = 0; i < urls.length; i += concurrency) {
        const batch = urls.slice(i, i + concurrency);
        const promises = batch.map((url) => this.scrapeUrl(url, browser));

        await Promise.all(promises);

        if (i + concurrency < urls.length) {
          await new Promise((resolve) =>
            setTimeout(resolve, this.options.delay)
          );
        }
      }

      await this.saveResultsToCsv(options.outputPath);

      // Enhanced summary
      const successCount = this.results.filter(
        (r) => r.status === "success"
      ).length;
      const errorCount = this.errors.length;
      const decodedCount = this.results.filter(
        (r) => r.decoding_status === "Success"
      ).length;

      console.log("\n=== ENHANCED SCRAPING SUMMARY ===");
      console.log(`Total URLs processed: ${urls.length}`);
      console.log(`GBP iframes found: ${successCount}`);
      console.log(`Business names decoded: ${decodedCount}`);
      console.log(`Errors encountered: ${errorCount}`);
      console.log(
        `Results saved to: ${options.outputPath || "gbp_enhanced_results.csv"}`
      );

      // Trigger screenshot rendering if GBP records were found
      if (this.onlyGBPSuccessRecords.length > 0) {
        console.log(
          `\n📸 Found ${this.onlyGBPSuccessRecords.length} GBP records. Starting screenshot rendering...`
        );
        try {
          const inputCSVFilePath = "./gbp_output_data/gbp_enhanced_records.csv";
          await Promise.allSettled([
            // InitializeGBPIframeProcessor(inputCSVFilePath),
            // InitializeGoogleMapsDirectionsScreenshot(inputCSVFilePath),
            // InitializeGBPBrowserSearchScreenshot(inputCSVFilePath),
          ]);

          // await InitializeGBPIframeProcessor(options.outputPath || "./gbp_output_data/gbp_enhanced_records.csv");
        } catch (renderError) {
          console.error("Screenshot rendering failed:", renderError.message);
          console.log(
            "Scraping completed successfully, but screenshot rendering encountered errors."
          );
        }
      } else {
        console.log(
          "\n📸 No GBP iframes found. Skipping screenshot rendering."
        );
      }
    } finally {
      await browser.close();
    }

    return this.results;
  }
}

/**
 * Main execution function with enhanced features
 */
async function InitializeEnhancedGBPScraper() {
  if (!fs.existsSync("gbp_output_data")) {
    fs.mkdirSync("gbp_output_data");
    console.log("📁 Created gbp_output_data directory");
  }

  const scraper = new EnhancedGBPIframeScraper({
    headless: true,
    timeout: 30000,
    delay: 2000,
    enableDecoding: true, // Enable GBP URL decoding
  });

  try {
    await scraper.scrape("gbp_input_data/internal_all.csv", {
      columnName: "Address",
      outputPath: "gbp_output_data/gbp_enhanced_records.csv",
    });

    console.log("\n🎉 Enhanced process completed successfully!");
    console.log("📁 Check the following files for results:");
    console.log(
      "   - gbp_enhanced_records.csv (enhanced scraping results with decoded business info)"
    );
    console.log("   - gbp_screenshots/ folder (screenshots of GBP iframes)");
    console.log(
      "   - gbp_screenshot_results.csv (screenshot processing results)"
    );
  } catch (error) {
    console.error("Process failed:", error);
    process.exit(1);
  }
}

// Export for use as module
module.exports = { InitializeEnhancedGBPScraper, EnhancedGBPIframeScraper };

// Run if called directly
if (require.main === module) {
  InitializeEnhancedGBPScraper();
}
