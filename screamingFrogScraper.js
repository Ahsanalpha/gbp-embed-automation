const { exec } = require('child_process');
const os = require('os');
require('dotenv').config();

/**
 * Runs Screaming Frog SEO Spider with the given config and site.
 * @param {string} url - The URL to crawl.
 * @param {string} configPath - Path to the SEO Spider config file.
 * @returns {Promise<string>} - Resolves with stdout or rejects on error.
 */
function runScreamingFrog(url = '',export_tab_command = 'Internal:All',export_tab='export-tabs',configPath = process.env.SCREAMING_FROG_CONFIG) {
    let screamingFrogPath;
    const platform = os.platform(); 
    switch(platform) {
        case 'win32':
            screamingFrogPath = process.env.SCREAMING_FROG_PATH_WINDOWS;
            break;
        case "linux":
            screamingFrogPath = process.env.SCREAMING_FROG_PATH_LINUX;
            break;
        case "darwin":
            screamingFrogPath = process.env.SCREAMING_FROG_PATH_MACOS;
    }


  const command = `"${screamingFrogPath}" \
    --crawl "${url}" \
    --headless \
    --${export_tab} "${export_tab_command}" \
    --export-format csv \
    `;

  return new Promise((resolve, reject) => {
    exec(command, (error, stdout, stderr) => {
      if (error) {
      
        reject(new Error(`❌ Error: ${error.message}`));
        return;
      }

      if (stderr) {
        console.warn(`⚠️ STDERR: ${stderr}`);
      }

      resolve(stdout);
    });
  });
}

if(require.main === module) {
    runScreamingFrog('https://tantrumsportfishing.com')
}

module.exports = { runScreamingFrog };