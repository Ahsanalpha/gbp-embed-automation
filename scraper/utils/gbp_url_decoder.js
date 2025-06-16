// enhanced_gbp_url_decoder.js

const fs = require("fs");
const csv = require("csv-parser");
const createCsvWriter = require("csv-writer").createObjectCsvWriter;

class EnhancedGBPUrlDecoder {
  constructor(options = {}) {
    this.options = {
      debug: options.debug || false,
      validateResults: options.validateResults !== false,
      fallbackToAlternativeMethods: options.fallbackToAlternativeMethods !== false
    };
    this.decodedResults = [];
  }

  /**
   * Debug logging function
   */
  log(message, data = null) {
    if (this.options.debug) {
      console.log(`[DEBUG] ${message}`);
      if (data) console.log(data);
    }
  }

  /**
   * Multiple-level URL decoding to handle nested encoding
   */
  deepDecodeUrl(encoded) {
    if (!encoded || typeof encoded !== 'string') return '';
    
    let decoded = encoded;
    let attempts = 0;
    const maxAttempts = 5;
    
    try {
      while (attempts < maxAttempts) {
        const newDecoded = decodeURIComponent(decoded);
        if (newDecoded === decoded) break; // No more decoding needed
        decoded = newDecoded;
        attempts++;
      }
    } catch (error) {
      this.log(`Deep decode error: ${error.message}`);
      return encoded; // Return original if decoding fails
    }
    
    return decoded;
  }

  /**
   * Parse the pb parameter structure more accurately
   */
  parsePbParameter(pb) {
    if (!pb) return null;
    
    try {
      // Multiple levels of decoding
      const decoded = this.deepDecodeUrl(pb);
      this.log('Decoded pb parameter:', decoded);
      
      // Split by exclamation marks to get segments
      const segments = decoded.split('!').filter(segment => segment.length > 0);
      this.log('PB segments:', segments);
      
      const result = {
        businessName: '',
        placeId: '',
        coordinates: { lat: '', lng: '' },
        address: '',
        segments: segments,
        rawPb: decoded
      };
      
      // Parse segments with more sophisticated logic
      for (let i = 0; i < segments.length; i++) {
        const segment = segments[i];
        
        // Business name patterns (multiple possible formats)
        if (segment.match(/^2s.+/)) {
          const nameCandidate = segment.substring(2);
          if (this.isValidBusinessName(nameCandidate)) {
            result.businessName = this.deepDecodeUrl(nameCandidate);
          }
        }
        
        // Place ID patterns (more comprehensive)
        if (segment.match(/^1s0x[a-f0-9]+%3A0x[a-f0-9]+/i) || 
            segment.match(/^1s0x[a-f0-9]+:0x[a-f0-9]+/i)) {
          const placeIdRaw = segment.substring(2);
          result.placeId = this.deepDecodeUrl(placeIdRaw);
        }
        
        // Coordinate patterns - look for precise business coordinates
        if (segment.match(/^3d-?\d+\.?\d*/)) {
          const lat = segment.substring(2);
          // Look ahead for corresponding longitude
          if (i + 1 < segments.length && segments[i + 1].match(/^4d-?\d+\.?\d*/)) {
            const lng = segments[i + 1].substring(2);
            if (this.areValidCoordinates(lat, lng)) {
              result.coordinates = { lat, lng };
            }
          }
        }
        
        // Address information (alternative business name source)
        if (segment.match(/^4s.+/) && !result.businessName) {
          const addressCandidate = segment.substring(2);
          if (this.isValidBusinessName(addressCandidate)) {
            result.address = this.deepDecodeUrl(addressCandidate);
          }
        }
      }
      
      return result;
      
    } catch (error) {
      this.log(`PB parsing error: ${error.message}`);
      return null;
    }
  }

  /**
   * Validate if extracted business name seems legitimate
   */
  isValidBusinessName(name) {
    if (!name || typeof name !== 'string') return false;
    
    const decoded = this.deepDecodeUrl(name);
    
    // Check for common invalid patterns
    const invalidPatterns = [
      /^[0-9]+$/, // Only numbers
      /^[^a-zA-Z]*$/, // No letters at all
      /^.{1,2}$/, // Too short (1-2 characters)
      /^(true|false|null|undefined)$/i, // Common programming literals
      /^https?:\/\//, // URLs
      /^[0-9]{1,2}[dwmy]$/ // Time patterns like "1d", "2w"
    ];
    
    if (invalidPatterns.some(pattern => pattern.test(decoded))) {
      return false;
    }
    
    // Must contain at least one letter
    if (!/[a-zA-Z]/.test(decoded)) {
      return false;
    }
    
    // Reasonable length bounds
    if (decoded.length < 2 || decoded.length > 200) {
      return false;
    }
    
    return true;
  }

  /**
   * Validate coordinates
   */
  areValidCoordinates(lat, lng) {
    const latNum = parseFloat(lat);
    const lngNum = parseFloat(lng);
    
    return !isNaN(latNum) && !isNaN(lngNum) && 
           latNum >= -90 && latNum <= 90 &&
           lngNum >= -180 && lngNum <= 180;
  }

  /**
   * Alternative parsing method using different approaches
   */
  alternativeParsing(url) {
    try {
      const urlObj = new URL(url);
      const result = {
        businessName: '',
        placeId: '',
        coordinates: { lat: '', lng: '' },
        address: ''
      };
      
      // Check for query parameters that might contain business info
      const queryParams = urlObj.searchParams;
      
      // Look for 'q' parameter (query)
      const qParam = queryParams.get('q');
      if (qParam && this.isValidBusinessName(qParam)) {
        result.businessName = this.deepDecodeUrl(qParam);
      }
      
      // Look for direct coordinate parameters
      const coordsMatch = url.match(/@(-?\d+\.?\d*),(-?\d+\.?\d*)/);
      if (coordsMatch && this.areValidCoordinates(coordsMatch[1], coordsMatch[2])) {
        result.coordinates = { lat: coordsMatch[1], lng: coordsMatch[2] };
      }
      
      // Look for place parameter
      const placeMatch = url.match(/place\/([^\/]+)/);
      if (placeMatch && this.isValidBusinessName(placeMatch[1])) {
        result.businessName = this.deepDecodeUrl(placeMatch[1]);
      }
      
      return result;
      
    } catch (error) {
      this.log(`Alternative parsing error: ${error.message}`);
      return null;
    }
  }

  /**
   * Enhanced URL decoding with multiple methods and validation
   */
  decodeGBPUrl(iframeUrl) {
    try {
      if (!iframeUrl || typeof iframeUrl !== 'string') {
        return this.createErrorResult('Invalid URL provided');
      }

      this.log('Decoding URL:', iframeUrl);

      const url = new URL(iframeUrl);
      const pb = url.searchParams.get('pb') || url.searchParams.get('pb');
      
      if (!pb) {
        this.log('No pb parameter found, trying alternative methods');
        const altResult = this.alternativeParsing(iframeUrl);
        if (altResult && (altResult.businessName || altResult.coordinates.lat)) {
          return this.createSuccessResult(altResult, iframeUrl);
        }
        return this.createErrorResult('No pb parameter found and alternative parsing failed');
      }

      // Primary parsing method
      const pbResult = this.parsePbParameter(pb);
      
      if (!pbResult) {
        this.log('PB parsing failed, trying alternative methods');
        if (this.options.fallbackToAlternativeMethods) {
          const altResult = this.alternativeParsing(iframeUrl);
          if (altResult && (altResult.businessName || altResult.coordinates.lat)) {
            return this.createSuccessResult(altResult, iframeUrl);
          }
        }
        return this.createErrorResult('PB parameter parsing failed');
      }

      // Validate and enhance results
      const validatedResult = this.validateAndEnhanceResult(pbResult, iframeUrl);
      
      if (this.options.validateResults && !this.isResultValid(validatedResult)) {
        this.log('Result validation failed, trying alternative methods');
        if (this.options.fallbackToAlternativeMethods) {
          const altResult = this.alternativeParsing(iframeUrl);
          if (altResult && this.isResultValid(this.createSuccessResult(altResult, iframeUrl))) {
            return this.createSuccessResult(altResult, iframeUrl);
          }
        }
        return this.createErrorResult('Decoded result failed validation');
      }

      return validatedResult;

    } catch (error) {
      this.log(`Main decoding error: ${error.message}`);
      return this.createErrorResult(`Decoding error: ${error.message}`);
    }
  }

  /**
   * Validate the final result
   */
  isResultValid(result) {
    // Must have either a business name or coordinates
    const hasBusinessName = result.businessName && result.businessName.trim().length > 0;
    const hasCoordinates = result.coordinates && result.coordinates.lat && result.coordinates.lng;
    
    return hasBusinessName || hasCoordinates;
  }

  /**
   * Validate and enhance the parsing result
   */
  validateAndEnhanceResult(pbResult, originalUrl) {
    const result = {
      businessName: pbResult.businessName || '',
      placeId: pbResult.placeId || '',
      coordinates: pbResult.coordinates || { lat: '', lng: '' },
      address: pbResult.address || '',
      error: ''
    };

    // Clean business name
    if (result.businessName) {
      result.businessName = result.businessName
        .replace(/\+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    }

    // Use address as business name if business name is empty and address looks like a business name
    if (!result.businessName && result.address && this.isValidBusinessName(result.address)) {
      result.businessName = result.address;
    }

    // Generate search URLs
    result.searchUrl = this.generateSearchUrl(result.businessName, result.placeId, result.coordinates);

    // Add debugging info in debug mode
    if (this.options.debug) {
      result.debugInfo = {
        rawPb: pbResult.rawPb,
        segments: pbResult.segments,
        originalUrl: originalUrl
      };
    }

    return result;
  }

  /**
   * Create standardized success result
   */
  createSuccessResult(data, originalUrl) {
    return {
      businessName: data.businessName || '',
      searchUrl: this.generateSearchUrl(data.businessName, data.placeId, data.coordinates),
      placeId: data.placeId || '',
      coordinates: data.coordinates || { lat: '', lng: '' },
      error: ''
    };
  }

  /**
   * Create standardized error result
   */
  createErrorResult(errorMessage) {
    return {
      businessName: '',
      searchUrl: '',
      placeId: '',
      coordinates: { lat: '', lng: '' },
      error: errorMessage
    };
  }

  /**
   * Generate search URLs with improved logic
   */
  generateSearchUrl(businessName, placeId, coordinates) {
    try {
      // Priority: Place ID > Business Name > Coordinates
      if (placeId && placeId.includes(':')) {
        // Format place ID for Google Maps API
        const cleanPlaceId = placeId.replace(':', '%3A');
        if (businessName) {
          return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(businessName)}&query_place_id=${cleanPlaceId}`;
        } else {
          return `https://www.google.com/maps/place/?q=place_id:${cleanPlaceId}`;
        }
      } else if (businessName && businessName.trim().length > 0) {
        return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(businessName)}`;
      } else if (coordinates && coordinates.lat && coordinates.lng) {
        return `https://www.google.com/maps/search/?api=1&query=${coordinates.lat},${coordinates.lng}`;
      } else {
        return 'Unable to generate search URL - insufficient data';
      }
    } catch (error) {
      this.log(`Search URL generation error: ${error.message}`);
      return 'Search URL generation failed';
    }
  }

  /**
   * Process CSV file with enhanced error handling and validation
   */
  async processCSVFile(inputCsvPath, outputCsvPath, options = {}) {
    const {
      urlColumnName = 'GBP_Iframe_Source',
      preserveOriginalColumns = true,
      batchSize = 100
    } = options;

    return new Promise((resolve, reject) => {
      const results = [];
      let processedCount = 0;

      if (!fs.existsSync(inputCsvPath)) {
        reject(new Error(`Input CSV file not found: ${inputCsvPath}`));
        return;
      }

      console.log(`📖 Reading CSV file: ${inputCsvPath}`);
      console.log(`🔍 URL column: ${urlColumnName}`);
      console.log(`🐛 Debug mode: ${this.options.debug ? 'ON' : 'OFF'}`);

      fs.createReadStream(inputCsvPath)
        .pipe(csv())
        .on('data', (row) => {
          const iframeUrl = row[urlColumnName];
          
          // Decode the GBP URL with enhanced method
          const decodedInfo = this.decodeGBPUrl(iframeUrl);
          
          // Create enhanced row
          const newRow = preserveOriginalColumns ? { ...row } : {};
          
          // Add decoded fields with validation
          newRow.Business_Name = decodedInfo.businessName || 'Not found';
          newRow.Search_URL = decodedInfo.searchUrl || 'Unable to generate';
          newRow.Place_ID = decodedInfo.placeId || 'Not found';
          newRow.Latitude = decodedInfo.coordinates?.lat || 'Not found';
          newRow.Longitude = decodedInfo.coordinates?.lng || 'Not found';
          newRow.Decoding_Status = decodedInfo.error ? 'Error' : 'Success';
          newRow.Decoding_Error = decodedInfo.error || '';
          newRow.Confidence_Score = this.calculateConfidenceScore(decodedInfo);
          newRow.Processed_At = new Date().toISOString();

          // Add debug info if enabled
          if (this.options.debug && decodedInfo.debugInfo) {
            newRow.Debug_Info = JSON.stringify(decodedInfo.debugInfo);
          }

          results.push(newRow);
          processedCount++;

          // Progress logging
          if (processedCount % batchSize === 0) {
            console.log(`📊 Processed ${processedCount} records...`);
          }
        })
        .on('end', async () => {
          try {
            await this.saveEnhancedResults(results, outputCsvPath);
            
            // Detailed summary
            const successCount = results.filter(r => r.Decoding_Status === 'Success').length;
            const errorCount = results.filter(r => r.Decoding_Status === 'Error').length;
            const highConfidenceCount = results.filter(r => parseFloat(r.Confidence_Score) >= 0.8).length;
            
            console.log('\n=== ENHANCED GBP DECODING SUMMARY ===');
            console.log(`📊 Total records processed: ${results.length}`);
            console.log(`✅ Successfully decoded: ${successCount}`);
            console.log(`❌ Decoding errors: ${errorCount}`);
            console.log(`🎯 High confidence results: ${highConfidenceCount}`);
            console.log(`💾 Enhanced CSV saved to: ${outputCsvPath}`);
            
            resolve(results);
          } catch (error) {
            reject(error);
          }
        })
        .on('error', (error) => {
          reject(error);
        });
    });
  }

  /**
   * Calculate confidence score based on extracted data quality
   */
  calculateConfidenceScore(decodedInfo) {
    let score = 0.0;
    
    // Business name quality (40% of score)
    if (decodedInfo.businessName) {
      if (decodedInfo.businessName.length > 2) score += 0.2;
      if (decodedInfo.businessName.length > 5) score += 0.1;
      if (/[a-zA-Z]/.test(decodedInfo.businessName)) score += 0.1;
    }
    
    // Place ID presence (25% of score)
    if (decodedInfo.placeId && decodedInfo.placeId.includes(':')) {
      score += 0.25;
    }
    
    // Coordinates presence and validity (25% of score)
    if (decodedInfo.coordinates && decodedInfo.coordinates.lat && decodedInfo.coordinates.lng) {
      if (this.areValidCoordinates(decodedInfo.coordinates.lat, decodedInfo.coordinates.lng)) {
        score += 0.25;
      }
    }
    
    // No errors (10% of score)
    if (!decodedInfo.error) {
      score += 0.1;
    }
    
    return score.toFixed(2);
  }

  /**
   * Save enhanced results with better formatting
   */
  async saveEnhancedResults(results, outputPath) {
    if (results.length === 0) {
      throw new Error('No results to save');
    }

    // Get all unique keys from all result objects
    const allKeys = [...new Set(results.flatMap(obj => Object.keys(obj)))];
    
    // Create header configuration with proper ordering
    const priorityColumns = [
      'URL', 'GBP_Iframe_Source', 'Business_Name', 'Search_URL', 
      'Place_ID', 'Latitude', 'Longitude', 'Confidence_Score',
      'Decoding_Status', 'Decoding_Error', 'Processed_At'
    ];
    
    const orderedKeys = [
      ...priorityColumns.filter(col => allKeys.includes(col)),
      ...allKeys.filter(col => !priorityColumns.includes(col))
    ];
    
    const header = orderedKeys.map(key => ({
      id: key,
      title: key
    }));

    const csvWriter = createCsvWriter({
      path: outputPath,
      header: header
    });

    await csvWriter.writeRecords(results);
    console.log(`✅ Enhanced results saved to ${outputPath}`);
  }

  /**
   * Process an array of GBP URLs directly with enhanced features
   */
  processUrlArray(urls) {
    console.log(`🔄 Processing ${urls.length} GBP URLs with enhanced decoder...`);
    
    const results = urls.map((url, index) => {
      const decodedInfo = this.decodeGBPUrl(url);
      
      return {
        Index: index + 1,
        Original_URL: url,
        Business_Name: decodedInfo.businessName || 'Not found',
        Search_URL: decodedInfo.searchUrl || 'Unable to generate',
        Place_ID: decodedInfo.placeId || 'Not found',
        Latitude: decodedInfo.coordinates?.lat || 'Not found',
        Longitude: decodedInfo.coordinates?.lng || 'Not found',
        Confidence_Score: this.calculateConfidenceScore(decodedInfo),
        Decoding_Status: decodedInfo.error ? 'Error' : 'Success',
        Decoding_Error: decodedInfo.error || '',
        Processed_At: new Date().toISOString()
      };
    });

    return results;
  }
}

/**
 * Initialize enhanced GBP decoder with comprehensive options
 */
async function InitializeEnhancedGBPDecoder(inputCsvPath, outputCsvPath, options = {}) {
  const decoder = new EnhancedGBPUrlDecoder({
    debug: options.debug || false,
    validateResults: options.validateResults !== false,
    fallbackToAlternativeMethods: options.fallbackToAlternativeMethods !== false
  });
  
  try {
    console.log('🚀 Starting enhanced GBP URL decoding process...');
    
    const results = await decoder.processCSVFile(inputCsvPath, outputCsvPath, {
      urlColumnName: options.urlColumnName || 'GBP_Iframe_Source',
      preserveOriginalColumns: options.preserveOriginalColumns !== false,
      batchSize: options.batchSize || 100
    });
    
    console.log('🎉 Enhanced GBP URL decoding completed successfully!');
    return results;
    
  } catch (error) {
    console.error('❌ Enhanced GBP decoding failed:', error.message);
    throw error;
  }
}

// Export for use as module
module.exports = { 
  EnhancedGBPUrlDecoder, 
  InitializeEnhancedGBPDecoder 
};

// Example usage if run directly
if (require.main === module) {
  // Example with debug mode enabled
  InitializeEnhancedGBPDecoder(
    'gbp_output_data/gbp_only_records.csv',
    'gbp_output_data/gbp_enhanced_records.csv',
    {
      urlColumnName: 'GBP_Iframe_Source',
      preserveOriginalColumns: true,
      debug: true, // Enable debug logging
      validateResults: true,
      fallbackToAlternativeMethods: true
    }
  );
}