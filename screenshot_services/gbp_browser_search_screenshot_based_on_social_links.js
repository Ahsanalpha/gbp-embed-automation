const puppeteer = require('puppeteer');
const fs = require('fs').promises;
const path = require('path');
const csv = require('csv-parser');
const { createReadStream } = require('fs');

class GoogleBusinessProfileScraper {
  constructor(options = {}) {
    this.options = {
      headless: options.headless !== false, // Default to headless
      slowMo: options.slowMo || 0,
      timeout: options.timeout || 30000,
      screenshotDir:
        options.screenshotDir || "./screenshots/gbp_images_screenshots",
      maxRetries: options.maxRetries || 3,
      delayBetweenRequests: options.delayBetweenRequests || 2000,
      ...options,
    };
    this.browser = null;
    this.page = null;
    this.results = {
      "gbp-images": [],
      "gbp-reviews": [],
      "gbp-social-links": [] // ADD THIS LINE
    };
    // this.results = [];
  }

  /**
   * Ensures that a folder exists. Creates it if it doesn't.
   * @param {string} folderPath - Absolute or relative path to the folder.
   */
  async ensureFolderExists(folderPath) {
    try {
      await fs.mkdir(folderPath, { recursive: true });
      // Directory now exists (was created or already present)
    } catch (err) {
      console.error(`Failed to ensure folder exists at ${folderPath}:`, err);
      throw err;
    }
  }

  async initialize() {
    try {
      console.log("🚀 Initializing browser...");

      // Ensure screenshots directory exists
      // await fs.mkdir(this.options.screenshotDir, { recursive: true });

      // Get default Chrome profile path
      const defaultProfilePath = this.getDefaultProfilePath();

      this.browser = await puppeteer.launch({
        headless: this.options.headless,
        slowMo: this.options.slowMo,
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
          "--start-fullscreen",
        ],
      });

      this.page = await this.browser.newPage();

      // Set viewport and user agent to appear more natural
      await this.page.setViewport({ width: 1920, height: 1200 });
      await this.page.setUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      );

      // Remove webdriver property to avoid detection
      await this.page.evaluateOnNewDocument(() => {
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
      await this.page.evaluateOnNewDocument(() => {
        const originalQuery = window.navigator.permissions.query;
        return (window.navigator.permissions.query = (parameters) =>
          parameters.name === "notifications"
            ? Promise.resolve({ state: Notification.permission })
            : originalQuery(parameters));
      });

      // Set default timeout
      this.page.setDefaultTimeout(this.options.timeout);

      console.log("✅ Browser initialized successfully with default profile");
    } catch (error) {
      console.error("❌ Failed to initialize browser:", error.message);
      throw error;
    }
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

  async readCsvFile(filePath) {
    return new Promise((resolve, reject) => {
      const results = [];
      const stream = createReadStream(filePath)
        .pipe(csv())
        .on("data", (data) => results.push(data))
        .on("end", () => {
          console.log(
            `📁 Successfully loaded ${results.length} records from CSV`
          );
          resolve(results);
        })
        .on("error", reject);
    });
  }

  async searchGoogleBusiness(
    nameAddress,
    retryCount = 0,
    index,
    searchTerm,
    record
  ) {
    try {
      console.log(`🔍 Searching for: ${nameAddress}`);

      // Navigate to Google
      await this.page.goto("https://www.google.com", {
        waitUntil: "networkidle0",
        timeout: this.options.timeout,
      });

      // Accept cookies if present
      await this.handleCookieConsent();

      // Perform search without quotes to appear more natural
      const searchQuery = nameAddress;

      // Clear any existing text and type naturally
      const searchInput = await this.page.$(
        'textarea[name="q"], input[name="q"]'
      );
      await searchInput.click({ clickCount: 3 }); // Select all existing text
      await this.page.keyboard.press("Backspace"); // Clear

      // Type with human-like delays
      await this.page.type('textarea[name="q"], input[name="q"]', searchQuery, {
        delay: 100,
      });
      await this.page.waitForTimeout(500); // Brief pause before pressing Enter
      await this.page.keyboard.press("Enter");

      // Wait for search results to load
      await this.page.waitForSelector("#search", {
        timeout: this.options.timeout,
      });

      // Additional wait for business profile to render
      await this.page.waitForTimeout(3000);

      // // Look for "See photos" and handle photo modal (only screenshot)
      // const gbpImageScreenshot = await this.handleSeePhotos(nameAddress);
      // const screenshotResult = this.createProcessedObject(
      //   'gbp-images',
      //   gbpImageScreenshot,
      //   index,
      //   searchTerm,
      //   record
      // );
      // this.results["gbp-images"].push(screenshotResult);

      //  //take GBP Reviews screenshot
      // const gbpReviewsScreenshot = await this.handleReviewsScreenshot(
      //   nameAddress
      // );
      // const reviewsScreenshotResult = this.createProcessedObject(
      //   'gbp-reviews',
      //   gbpReviewsScreenshot,
      //   index,
      //   searchTerm,
      //   record
      // );
      // this.results["gbp-reviews"].push(reviewsScreenshotResult);

      // ADD THIS NEW METHOD CALL - Capture social media links
      const gbpSocialLinksResult = await this.handleCaptureLinks(nameAddress);
      const socialLinksResult = this.createProcessedObject(
      'gbp-social-links',
      gbpSocialLinksResult,
      index,
      searchTerm,
      record
    );
    this.results["gbp-social-links"].push(socialLinksResult);
    } catch (error) {
      console.error(`❌ Error searching for ${nameAddress}:`, error.message);

      if (retryCount < this.options.maxRetries) {
        console.log(
          `🔄 Retrying... (${retryCount + 1}/${this.options.maxRetries})`
        );
        await this.page.waitForTimeout(5000); // Wait before retry
        return await this.searchGoogleBusiness(
          nameAddress,
          3,
          retryCount + 1,
          index
        );
      }

      throw error;
    }
  }

  createProcessedObject(entityType, result, passedIndex, searchTerm, record) {
    const processedResult = {
      index: passedIndex + 1,
      name_address: searchTerm,
      business_name: record.Business_Name,
      url: record.URL,
      place_id: record.Place_ID,
      processed_at: new Date().toISOString(),
      screenshot: result,
      // TYPE
      status: result.success ? "success" : "failed",
    };
    return processedResult;
  }

  //take GBP reviews screenshot
  async handleReviewsScreenshot(nameAddress) {
    try {
      const gbpReviewsDirectory = "./screenshots/gbp_reviews_screenshots";
      const gbpReviewsClipDimension = {
        x: 950,
        y: 150,
        width: 510,
        height: 280,
      };
      const photoScreenshot = await this.startScreenshotOperation(
        nameAddress,
        gbpReviewsDirectory,
        gbpReviewsClipDimension,
        "gbp_review"
      );
      return photoScreenshot;
    } catch (error) {
      console.error("❌ Error handling see photos:", error.message);

      // Try to close any open modal
      try {
        await this.page.keyboard.press("Escape");
        await this.page.waitForTimeout(500);
      } catch (closeError) {
        // Ignore close errors
      }

      return {
        success: false,
        error: error.message,
      };
    }
  }

  //take GBP links
  // Add this method to the GoogleBusinessProfileScraper class

// Add this method to the GoogleBusinessProfileScraper class

// Add this method to the GoogleBusinessProfileScraper class

async handleCaptureLinks(nameAddress) {
  try {
    console.log('🔍 Looking for social media links...');

    // Define social media patterns to search for (Facebook, YouTube, Instagram only)
    const socialMediaPatterns = [
      {
        name: 'Facebook',
        textPattern: 'facebook',
        linkPatterns: ['facebook.com/profile.php', 'facebook.com/', 'fb.com/'],
        priority: 1
      },
      {
        name: 'Instagram', 
        textPattern: 'instagram',
        linkPatterns: ['instagram.com/', 'instagr.am/'],
        priority: 2
      },
      {
        name: 'YouTube',
        textPattern: 'youtube',
        linkPatterns: ['youtube.com/channel', 'youtube.com/c/', 'youtube.com/user/', 'youtu.be/'],
        priority: 3
      }
    ];

    let foundSocialLinks = [];

    // Search for each social media pattern
    for (const pattern of socialMediaPatterns) {
      console.log(`🔎 Searching for ${pattern.name} links...`);
      
      const foundElements = await this.page.evaluate((pattern) => {
        const allElements = document.querySelectorAll('a, div, span, p, li, button');
        const foundItems = [];
        
        for (const element of allElements) {
          const elementText = element.textContent?.toLowerCase() || '';
          const elementHref = element.href?.toLowerCase() || '';
          const parentElement = element.parentElement;
          const parentText = parentElement?.textContent?.toLowerCase() || '';
          
          // Check if element or its parent contains the text pattern
          const hasText = elementText.includes(pattern.textPattern) || 
                         parentText.includes(pattern.textPattern) ||
                         element.getAttribute('aria-label')?.toLowerCase().includes(pattern.textPattern);
          
          // Check if element has any of the link patterns
          let hasLink = false;
          let matchedLinkPattern = '';
          
          for (const linkPattern of pattern.linkPatterns) {
            if (elementHref.includes(linkPattern.toLowerCase())) {
              hasLink = true;
              matchedLinkPattern = linkPattern;
              break;
            }
          }
          
          // Also check for links in nearby elements (siblings or children)
          let hasNearbyLink = false;
          let nearbyLinkHref = '';
          
          if (hasText && !hasLink) {
            // Check siblings
            const siblings = parentElement?.children || [];
            for (const sibling of siblings) {
              const siblingHref = sibling.href?.toLowerCase() || '';
              for (const linkPattern of pattern.linkPatterns) {
                if (siblingHref.includes(linkPattern.toLowerCase())) {
                  hasNearbyLink = true;
                  nearbyLinkHref = sibling.href;
                  matchedLinkPattern = linkPattern;
                  break;
                }
              }
              if (hasNearbyLink) break;
            }
            
            // Check children
            if (!hasNearbyLink) {
              const childLinks = element.querySelectorAll('a');
              for (const childLink of childLinks) {
                const childHref = childLink.href?.toLowerCase() || '';
                for (const linkPattern of pattern.linkPatterns) {
                  if (childHref.includes(linkPattern.toLowerCase())) {
                    hasNearbyLink = true;
                    nearbyLinkHref = childLink.href;
                    matchedLinkPattern = linkPattern;
                    break;
                  }
                }
                if (hasNearbyLink) break;
              }
            }
          }
          
          // If we found both text and link (either direct or nearby)
          if (hasText && (hasLink || hasNearbyLink)) {
            const rect = element.getBoundingClientRect();
            
            // Only include visible elements
            if (rect.width > 0 && rect.height > 0) {
              foundItems.push({
                element: {
                  tagName: element.tagName,
                  text: element.textContent?.trim().substring(0, 100),
                  href: element.href || nearbyLinkHref || 'N/A',
                  matchedPattern: matchedLinkPattern,
                  rect: {
                    x: rect.x,
                    y: rect.y,
                    width: rect.width,
                    height: rect.height,
                    top: rect.top,
                    left: rect.left
                  }
                },
                socialMedia: pattern.name,
                priority: pattern.priority
              });
            }
          }
        }
        
        return foundItems;
      }, pattern);

      if (foundElements.length > 0) {
        console.log(`✅ Found ${foundElements.length} ${pattern.name} link(s)`);
        foundSocialLinks.push(...foundElements);
      } else {
        console.log(`ℹ️ No ${pattern.name} links found`);
      }
    }

    if (foundSocialLinks.length === 0) {
      console.log('ℹ️ No social media links found');
      return {
        success: false,
        reason: "No social media links found",
        socialLinksFound: [],
        totalLinksFound: 0,
        screenshotTaken: false
      };
    }

    // Sort found links by priority (lower number = higher priority)
    foundSocialLinks.sort((a, b) => a.priority - b.priority);

    console.log(`🎯 Found total ${foundSocialLinks.length} social media links:`);
    foundSocialLinks.forEach((link, index) => {
      console.log(`   ${index + 1}. ${link.socialMedia}: ${link.element.href}`);
    });

    // Take screenshot of only the first (highest priority) social media link
    const firstSocialLink = foundSocialLinks[0];
    console.log(`📸 Taking screenshot of: ${firstSocialLink.socialMedia}`);
    
    let screenshotResult = null;
    
    try {
      // Scroll to center the element in the viewport
      await this.page.evaluate((elementRect) => {
        const elementCenterY = elementRect.top + window.scrollY + (elementRect.height / 2);
        const viewportCenterOffset = window.innerHeight / 2;
        const targetScrollY = elementCenterY - viewportCenterOffset;
        
        window.scrollTo({
          top: Math.max(0, targetScrollY),
          behavior: 'smooth'
        });
      }, firstSocialLink.element.rect);

      // Wait for smooth scroll to complete
      await this.page.waitForTimeout(2000);

      // Re-locate the element after scrolling to get accurate viewport coordinates
      const currentElementRect = await this.page.evaluate((originalText, socialMedia) => {
        const allElements = document.querySelectorAll('a, div, span, p, li, button');
        const pattern = socialMedia.toLowerCase();
        
        for (const element of allElements) {
          const elementText = element.textContent?.toLowerCase() || '';
          const elementHref = element.href?.toLowerCase() || '';
          const parentText = element.parentElement?.textContent?.toLowerCase() || '';
          
          // Try to find the same element by matching text and social media pattern
          if ((elementText.includes(pattern) || parentText.includes(pattern)) &&
              (elementHref.includes(pattern) || elementText.includes(originalText.toLowerCase().substring(0, 20)))) {
            const rect = element.getBoundingClientRect();
            return {
              x: rect.x,
              y: rect.y,
              width: rect.width,
              height: rect.height,
              centerX: rect.x + rect.width / 2,
              centerY: rect.y + rect.height / 2
            };
          }
        }
        return null;
      }, firstSocialLink.element.text, firstSocialLink.socialMedia);

      // Get viewport dimensions
      const viewport = await this.page.viewport();
      
      // Use current element position if found, otherwise fallback to viewport center
      const elementCenterX = currentElementRect ? currentElementRect.centerX : viewport.width / 2;
      const elementCenterY = currentElementRect ? currentElementRect.centerY : viewport.height / 2;

      // Calculate small rectangular screenshot area around the centered element
      const smallRectWidth = 300;  // Fixed small rectangle width
      const smallRectHeight = 150; // Fixed small rectangle height
      
      const clipDimensions = {
        x: Math.max(0, elementCenterX - (smallRectWidth / 2)),
        y: Math.max(0, elementCenterY - (smallRectHeight / 2)),
        width: smallRectWidth,
        height: smallRectHeight
      };

      // Ensure the clip dimensions don't go outside viewport bounds
      clipDimensions.x = Math.min(clipDimensions.x, viewport.width - smallRectWidth);
      clipDimensions.y = Math.min(clipDimensions.y, viewport.height - smallRectHeight);

      // Add visual bounding box to show screenshot area
      await this.addBoundingBox(clipDimensions);
      await this.page.waitForTimeout(1000); // Show bounding box briefly

      // Remove bounding box before taking screenshot
      await this.removeBoundingBox();

      // Take screenshot of the social media link
      const gbpLinksDirectory = "./screenshots/gbp_social_links_screenshots";
      screenshotResult = await this.startScreenshotOperation(
        `${nameAddress}_${firstSocialLink.socialMedia}`,
        gbpLinksDirectory,
        clipDimensions,
        `social_${firstSocialLink.socialMedia.toLowerCase()}`
      );

      console.log(`✅ Screenshot taken for ${firstSocialLink.socialMedia}`);

    } catch (error) {
      console.error(`❌ Error taking screenshot of ${firstSocialLink.socialMedia}:`, error.message);
      screenshotResult = {
        success: false,
        error: error.message
      };
    }

    // Prepare detailed report of all found links
    const socialLinksReport = foundSocialLinks.map((link, index) => ({
      rank: index + 1,
      socialMedia: link.socialMedia,
      priority: link.priority,
      text: link.element.text,
      href: link.element.href,
      matchedPattern: link.element.matchedPattern,
      screenshotTaken: index === 0 // Only first link gets screenshot
    }));

    return {
      success: screenshotResult ? screenshotResult.success : false,
      socialLinksFound: socialLinksReport,
      totalLinksFound: foundSocialLinks.length,
      screenshotTaken: screenshotResult ? screenshotResult.success : false,
      screenshotDetails: screenshotResult,
      primarySocialMedia: firstSocialLink.socialMedia,
      error: screenshotResult && !screenshotResult.success ? screenshotResult.error : null
    };

  } catch (error) {
    console.error("❌ Error in handleCaptureLinks:", error.message);
    return {
      success: false,
      error: error.message,
      socialLinksFound: [],
      totalLinksFound: 0,
      screenshotTaken: false
    };
  }
}


  //take GBP Images screenshot
  async handleSeePhotos(nameAddress) {
    try {
      console.log('🔍 Looking for "See photos" button...');

      // Look for "See photos" button with various selectors
      const seePhotosSelectors = [
        'button:has-text("See photos")',
        // 'a:has-text("See photos")',
        '[role="button"]:has-text("See photos")',
      ];

      let seePhotosButton = null;

      // Try each selector
      for (const selector of seePhotosSelectors) {
        try {
          seePhotosButton = await this.page.$(selector);
          if (seePhotosButton) {
            // Verify it's actually clickable and visible
            const isVisible = await seePhotosButton.isIntersectingViewport();
            if (isVisible) {
              console.log('📸 Found "See photos" button:::', selector);
              break;
            } else {
              seePhotosButton = null;
            }
          }
        } catch (error) {
          // Continue to next selector
        }
      }

      // Alternative approach: look for text content
      if (!seePhotosButton) {
        seePhotosButton = await this.page.evaluateHandle(() => {
          const elements = Array.from(
            document.querySelectorAll('button, [role="button"]')
          );
          return elements.find(
            (el) => el.textContent?.toLowerCase().includes("see photos")
            //  ||
            // el.textContent?.toLowerCase().includes('photos') ||
            // el.getAttribute('aria-label')?.toLowerCase().includes('photos')
          );
        });

        if (seePhotosButton && seePhotosButton.asElement()) {
          console.log("📸 Found photos button via text search");
        } else {
          seePhotosButton = null;
        }
      }

      if (!seePhotosButton) {
        console.log('ℹ️ No "See photos" button found');
        return { success: false, reason: "No see photos button found" };
      }

      // Click the "See photos" button
      await seePhotosButton.click();
      console.log('✅ Clicked "See photos" button');

      // Wait for modal to appear
      await this.page.waitForTimeout(2000);

      // Wait for photo modal/gallery to load
      await this.page
        .waitForSelector(
          '[role="dialog"], .modal, [data-testid="photo-modal"]',
          {
            timeout: 10000,
          }
        )
        .catch(() => {
          console.log("⚠️ Photo modal selector not found, proceeding anyway");
        });

      // Extended wait for all images to load and render completely
      console.log("⏳ Waiting for images to load and render...");
      await this.page.waitForTimeout(10000); // Increased delay for image rendering

      const gbpImagesDirectory = "./screenshots/gbp_images_screenshots";
      const gbpImagesClipDimension = {
        x: 420,
        y: 220,
        width: 1070,
        height: 750,
      };
      const photoScreenshot = await this.startScreenshotOperation(
        nameAddress,
        gbpImagesDirectory,
        gbpImagesClipDimension,
        "gbp_image"
      );

      // Close modal with Esc key
      await this.page.keyboard.press("Escape");
      console.log("✅ Closed photo modal with Escape key");

      // Wait for modal to close
      await this.page.waitForTimeout(1000);

      return photoScreenshot;
    } catch (error) {
      console.error("❌ Error handling see photos:", error.message);

      // Try to close any open modal
      try {
        await this.page.keyboard.press("Escape");
        await this.page.waitForTimeout(500);
      } catch (closeError) {
        // Ignore close errors
      }

      return {
        success: false,
        error: error.message,
      };
    }
  }

  async handleCookieConsent() {
    try {
      // Wait for cookie consent button and click if present
      await this.page.waitForTimeout(1000); // Wait for page to settle

      const cookieSelectors = [
        'button[id*="accept"]',
        'button[id*="consent"]',
        'button:has-text("Accept all")',
        'button:has-text("I agree")',
        "#L2AGLb", // Google's "Accept all" button ID
        'button[jsname="b3VHJd"]', // Another Google consent button
      ];

      for (const selector of cookieSelectors) {
        try {
          const cookieButton = await this.page.$(selector);
          if (cookieButton) {
            await cookieButton.click();
            await this.page.waitForTimeout(1000);
            console.log("🍪 Accepted cookie consent");
            return;
          }
        } catch (error) {
          // Continue to next selector
        }
      }
    } catch (error) {
      // Cookie consent not present or already handled
    }
  }

  async startScreenshotOperation(
    nameAddress,
    storageDirectoryPath,
    screenshotDimensions,
    imageCategory
  ) {
    await this.ensureFolderExists(storageDirectoryPath);
    const photoScreenshot = await this.takeViewportScreenshot(
      nameAddress,
      imageCategory,
      screenshotDimensions,
      storageDirectoryPath
    );

    return photoScreenshot;
  }

  async takeViewportScreenshot(
    nameAddress,
    screenshotType = "photos",
    clipDimensions,
    screenshotDirectory
  ) {
    try {
      const sanitizedName = nameAddress
        .replace(/[^a-zA-Z0-9\s]/g, "")
        .replace(/\s+/g, "_");
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const filename = `${sanitizedName}_${screenshotType}_${timestamp}.png`;
      const filepath = path.join(screenshotDirectory, filename);

      // Get viewport dimensions
      const viewport = await this.page.viewport();

      // Add bounding box overlay to show screenshot bounds
      await this.addBoundingBox(clipDimensions);
      await this.page.waitForTimeout(2000);

      // Remove bounding box after brief appearance
      await this.removeBoundingBox();

      // Take viewport-only screenshot (what's currently visible)
      await this.page.screenshot({
        path: filepath,
        fullPage: false, // Only capture the visible viewport
        type: "png",
        clip: clipDimensions,
      });

      console.log(`📸 ${screenshotType} screenshot saved: ${filename}`);
      console.log(
        `📐 Viewport dimensions: ${viewport.width}x${viewport.height}`
      );

      return {
        success: true,
        filepath: filepath,
        filename: filename,
        type: screenshotType,
        dimensions: {
          width: viewport.width,
          height: viewport.height,
          type: "viewport",
        },
      };
    } catch (error) {
      console.error(
        `❌ Failed to take ${screenshotType} screenshot:`,
        error.message
      );
      return {
        success: false,
        error: error.message,
        type: screenshotType,
      };
    }
  }

  async addBoundingBox(clipDimensions) {
    try {
      await this.page.evaluate((clipDimensions) => {
        // Remove any existing bounding box
        const existingBox = document.getElementById("puppeteer-bounding-box");
        if (existingBox) {
          existingBox.remove();
        }

        // Create bounding box element
        const boundingBox = document.createElement("div");
        boundingBox.id = "puppeteer-bounding-box";
        boundingBox.style.cssText = `
                    position: fixed;
                    top: 0;
                    left: 0;
                    width: ${clipDimensions.width}px;
                    height: ${clipDimensions.height}px;
                    border: 3px solid #ff0000;
                    box-sizing: border-box;
                    pointer-events: none;
                    z-index: 999999;
                    background: transparent;
                `;

        // Add corner markers
        const corners = [
          "top-left",
          "top-right",
          "bottom-left",
          "bottom-right",
        ];
        corners.forEach((corner) => {
          const marker = document.createElement("div");
          marker.style.cssText = `
                        position: absolute;
                        width: 20px;
                        height: 20px;
                        background: #ff0000;
                        pointer-events: none;
                    `;

          switch (corner) {
            case "top-left":
              marker.style.top = "-3px";
              marker.style.left = "-3px";
              break;
            case "top-right":
              marker.style.top = "-3px";
              marker.style.right = "-3px";
              break;
            case "bottom-left":
              marker.style.bottom = "-3px";
              marker.style.left = "-3px";
              break;
            case "bottom-right":
              marker.style.bottom = "-3px";
              marker.style.right = "-3px";
              break;
          }

          boundingBox.appendChild(marker);
        });

        document.body.appendChild(boundingBox);
      }, clipDimensions);

      // Wait a moment for the box to render
      await this.page.waitForTimeout(500);
    } catch (error) {
      console.log("⚠️ Could not add bounding box:", error.message);
    }
  }

  async removeBoundingBox() {
    try {
      await this.page.evaluate(() => {
        const boundingBox = document.getElementById("puppeteer-bounding-box");
        if (boundingBox) {
          boundingBox.remove();
        }
      });
    } catch (error) {
      console.log("⚠️ Could not remove bounding box:", error.message);
    }
  }

  async processRecord(record, index) {
    try {
      console.log(
        `\n🔄 Processing record ${index + 1}: ${
          record.Name_Address || record.Business_Name
        }`
      );

      // Use Name_Address field, fallback to Business_Name if not available
      const searchTerm = record.Name_Address || record.Business_Name;

      if (!searchTerm) {
        throw new Error(
          "No Name_Address or Business_Name field found in record"
        );
      }

      const result = await this.searchGoogleBusiness(
        searchTerm,
        3,
        index,
        searchTerm,
        record
      );
      // const {gbpImageScreenshot} = await this.searchGoogleBusiness(searchTerm);

      // const processedResult = {
      //   index: index + 1,
      //   name_address: searchTerm,
      //   business_name: record.Business_Name,
      //   url: record.URL,
      //   place_id: record.Place_ID,
      //   processed_at: new Date().toISOString(),
      //   screenshot: result,
      //   // TYPE
      //   status: result.success ? "success" : "failed",
      // };

      // this.results.push(processedResult);

      // Add delay between requests to be respectful
      // if (index < this.results.length - 1) {
      //   console.log(
      //     `⏳ Waiting ${this.options.delayBetweenRequests}ms before next request...`
      //   );
      //   await this.page.waitForTimeout(this.options.delayBetweenRequests);
      // }
      if (index < Object.keys(this.results).length - 1) {
        console.log(
          `⏳ Waiting ${this.options.delayBetweenRequests}ms before next request...`
        );
        await this.page.waitForTimeout(this.options.delayBetweenRequests);
      }

      // return processedResult;
    } catch (error) {
      console.error(`❌ Failed to process record ${index + 1}:`, error.message);

      const errorResult = {
        index: index + 1,
        name_address: record.Name_Address || "N/A",
        business_name: record.Business_Name || "N/A",
        url: record.URL,
        place_id: record.Place_ID,
        processed_at: new Date().toISOString(),
        screenshot: { success: false, error: error.message },
        status: "error",
        error: error.message,
      };

      // this.results.push(errorResult); //unresolved
      return errorResult;
    }
  }

  async saveResults() {
    const gbpEntities = Object.keys(this.results);

    for (const entity of gbpEntities) {
      let screenshotDir;

      switch (entity) {
        case "gbp-images":
          screenshotDir = "./screenshots/gbp_images_screenshots";
          break;
        case "gbp-reviews":
          screenshotDir = "./screenshots/gbp_reviews_screenshots";
          break;
        case "gbp-social-links": // ADD THIS CASE
          screenshotDir = "./screenshots/gbp_social_links_screenshots";
          break;
        default:
          console.warn(`⚠️ No screenshotDir found for entity: ${entity}`);
          continue; // skip this iteration if no matching case
      }

      try {
        const resultsFile = path.join(screenshotDir, "processing_report.json");
        await fs.writeFile(
          resultsFile,
          JSON.stringify(this.results[entity], null, 2)
        );
        console.log(`💾 Results for ${entity} saved to: ${resultsFile}`);
      } catch (error) {
        console.error("❌ Failed to save results:", error.message);
      }
    }
  }

  async processAllRecords(csvFilePath) {
    try {
      console.log("🎯 Starting batch processing...");

      const records = await this.readCsvFile(csvFilePath);

      if (records.length === 0) {
        console.log("⚠️ No records found in CSV file");
        return;
      }

      console.log(`📋 Processing ${records.length} records...`);

      for (let i = 0; i < records.length; i++) {
        await this.processRecord(records[i], i);
      }

      // Final save
      await this.saveResults();

      console.log("\n🎉 Batch processing completed!");
      // console.log(
      //   `✅ Successfully processed: ${
      //     this.results.filter((r) => r.status === "success").length
      //   }`
      // );
      // console.log(
      //   `❌ Failed: ${
      //     this.results.filter(
      //       (r) => r.status === "failed" || r.status === "error"
      //     ).length
      //   }`
      // );
      return this.results;
    } catch (error) {
      console.error("❌ Batch processing failed:", error.message);
      throw error;
    }
  }

  async cleanup() {
    try {
      if (this.page) {
        await this.page.close();
      }
      if (this.browser) {
        await this.browser.close();
      }
      console.log("🧹 Cleanup completed");
    } catch (error) {
      console.error("❌ Cleanup failed:", error.message);
    }
  }
}

// Main execution function
async function InitializeGBPBrowserSearchScreenshot() {
    const scraper = new GoogleBusinessProfileScraper({
        headless: false, // Set to true for production
        timeout: 45000, // Increased timeout for profile loading
        screenshotDir: './screenshots/gbp_images_screenshots',
        maxRetries: 3,
        delayBetweenRequests: 5000 // 5 seconds between requests to appear more human
    });

    try {
        await scraper.initialize();
        const results = await scraper.processAllRecords('./gbp_output_data/gbp_enhanced_records.csv');
        console.log("gbp_browser_output:::",results)
        return results;
    } catch (error) {
        console.error('❌ Script execution failed:', error.message);
    } finally {
        // await scraper.cleanup();
    }
}

// Handle process termination gracefully
process.on('SIGINT', async () => {
    console.log('\n🛑 Received SIGINT, shutting down gracefully...');
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('\n🛑 Received SIGTERM, shutting down gracefully...');
    process.exit(0);
});

// Run the script
if (require.main === module) {
    InitializeGBPBrowserSearchScreenshot();
}

module.exports = {InitializeGBPBrowserSearchScreenshot,GoogleBusinessProfileScraper};











        // // Save intermediate results every 10 records
        // if ((i + 1) % 10 === 0) {
        //   await this.saveResults();
        //   console.log(
        //     `💾 Intermediate save completed (${i + 1}/${records.length})`
        //   );
        // }