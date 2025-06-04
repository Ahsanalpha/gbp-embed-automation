const { GBPIframeScraper } = require('./scraper.js');
const fs = require('fs');

// Example usage script
async function runExamples() {
    console.log('=== GBP Iframe Scraper Examples ===\n');
    
    const scraper = new GBPIframeScraper({
        headless: true,
        timeout: 30000,
        delay: 2000
    });

    try {
        // Example 1: Create a sample CSV file for testing
        console.log('1. Creating sample CSV file...');
        createSampleCsv();
        
        // Example 2: Scrape from CSV file
        console.log('2. Scraping from CSV file...');
        await scraper.scrape('sample_urls.csv', { 
            columnName: 'Address', 
            outputPath: 'gbp_results.csv' 
        });
        
        console.log('\n3. Example completed! Check gbp_results.csv for results.');
        
    } catch (error) {
        console.error('Error during scraping:', error);
    }
}

// Create a sample CSV file for testing
function createSampleCsv() {
    const sampleData = `Address
https://squeegeedetail.com/car-detailing-portland
`;

    fs.writeFileSync('sample_urls.csv', sampleData);
    console.log('✓ Created sample_urls.csv');
}

// Alternative usage examples
async function alternativeUsageExamples() {
    const scraper = new GBPIframeScraper();
    
    // Example 1: Single URL
    console.log('\n=== Single URL Example ===');
    try {
        await scraper.scrape('https://squeegeedetail.com/car-detailing-portland', {
            outputPath: 'single_url_results.csv'
        });
    } catch (error) {
        console.error('Single URL scraping failed:', error);
    }
    
    // Example 2: Array of URLs
    console.log('\n=== Array of URLs Example ===');
    try {
        const urls = [
            'https://squeegeedetail.com/car-detailing-portland',
        ];
        
        await scraper.scrape(urls, {
            outputPath: 'array_urls_results.csv'
        });
    } catch (error) {
        console.error('Array URLs scraping failed:', error);
    }
}

// Custom configuration example
async function customConfigExample() {
    console.log('\n=== Custom Configuration Example ===');
    
    const customScraper = new GBPIframeScraper({
        headless: false, // Show browser window
        timeout: 60000,  // Longer timeout
        delay: 3000,     // Longer delay between requests
        maxRetries: 5,   // More retries
        userAgent: 'Custom Bot 1.0'
    });
    
    try {
        await customScraper.scrape(['https://example.com'], {
            outputPath: 'custom_config_results.csv'
        });
    } catch (error) {
        console.error('Custom config scraping failed:', error);
    }
}

// Run the examples
if (require.main === module) {
    runExamples()
        .then(() => {
            console.log('\nAll examples completed!');
            process.exit(0);
        })
        .catch((error) => {
            console.error('Examples failed:', error);
            process.exit(1);
        });
}