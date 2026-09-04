// One-time helper: launches a headed browser so you can sign in to the Azure Portal
// (including MFA) manually, then saves the authenticated session for reuse by the
// @azure-portal cucumber scenario. Run with: node scripts/capture-azure-storage-state.js
const path = require('node:path');
const readline = require('node:readline');
const { chromium } = require('playwright');

const outputPath = process.env.AZURE_PORTAL_STORAGE_STATE || path.join(__dirname, '..', '.auth', 'azure-portal-state.json');

async function waitForEnter(message) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  await new Promise(resolve => rl.question(message, resolve));
  rl.close();
}

(async () => {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('https://portal.azure.com/');

  await waitForEnter('Sign in to the Azure Portal in the opened browser window, then press Enter here once you land on the Home page...\n');

  await context.storageState({ path: outputPath });
  console.log(`Saved authenticated storage state to ${outputPath}`);
  console.log(`Set AZURE_PORTAL_STORAGE_STATE=${outputPath} before running: npm run test:integration:azure-portal`);

  await browser.close();
})();
