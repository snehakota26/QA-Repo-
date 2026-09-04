const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright');
const { Given, When, Then, After } = require('@cucumber/cucumber');
const { AzurePortalPage } = require('../pages/azure-portal.page');

const defaultStorageStatePath = path.join(__dirname, '..', '..', '.auth', 'azure-portal-state.json');

// Azure AD sign-in requires MFA and can't be scripted, so this reuses a pre-authenticated
// Playwright storage state (see https://playwright.dev/docs/auth) captured after a manual login
// via `npm run auth:azure-portal`. Falls back to the default path so the env var doesn't need
// to be set in every terminal session; override with AZURE_PORTAL_STORAGE_STATE if needed.
Given('I am signed in to the Azure Portal', { timeout: 120 * 1000 }, async function () {
  const storageStatePath = process.env.AZURE_PORTAL_STORAGE_STATE || defaultStorageStatePath;
  assert.ok(
    require('node:fs').existsSync(storageStatePath),
    `No storage state found at ${storageStatePath}. Run "npm run auth:azure-portal" to sign in once and capture it.`
  );

  // Headed by default so the navigation is visible; set AZURE_PORTAL_HEADLESS=true to run headless.
  // --disable-http2: ARM's batch endpoint (used by the Storage Browser blade) intermittently
  // fails with net::ERR_HTTP2_PROTOCOL_ERROR on this network, which silently hangs the blade's
  // "Loading..." state forever; forcing HTTP/1.1 avoids that failure mode.
  this.azureBrowser = await chromium.launch({
    headless: process.env.AZURE_PORTAL_HEADLESS === 'true',
    slowMo: 250,
    args: ['--disable-http2']
  });
  this.azureContext = await this.azureBrowser.newContext({ storageState: storageStatePath });
  this.azurePage = await this.azureContext.newPage();
  // Azure Portal's React blades can take a while to load, so allow more than the 30s default
  // (kept below the 120s per-step Cucumber timeout so a real failure surfaces Playwright's own error).
  this.azurePage.setDefaultTimeout(100 * 1000);
  this.azurePortal = new AzurePortalPage(this.azurePage);
  await this.azurePortal.gotoPortal();
});

When('I select the subscription {string}', { timeout: 120 * 1000 }, async function (subscriptionId) {
  await this.azurePortal.selectSubscription(subscriptionId);
});

When('I navigate to the resource group {string}', { timeout: 120 * 1000 }, async function (resourceGroupName) {
  await this.azurePortal.openResourceGroup(resourceGroupName);
});

When('I open the Service Bus namespace {string}', { timeout: 120 * 1000 }, async function (namespaceName) {
  await this.azurePortal.openResource(namespaceName);
});

When('I open {string} under the {string} section', { timeout: 120 * 1000 }, async function (entityLabel, sectionLabel) {
  await this.azurePortal.openEntitiesSection(entityLabel, sectionLabel);
});

When('I select the queue {string}', { timeout: 120 * 1000 }, async function (queueName) {
  await this.azurePortal.selectQueue(queueName);
});

Then('I should land on the {string} queue Overview page', { timeout: 120 * 1000 }, async function (queueName) {
  await this.azurePortal.assertOnQueueOverview(queueName);
});

When('I open the Service Bus Explorer for the queue', { timeout: 120 * 1000 }, async function () {
  await this.azurePortal.openServiceBusExplorer();
});

When('I show the property request payload in the Service Bus Explorer for correlation id {string}, source system {string}, address line1 {string}, city {string}, state {string} and zip code {string}',
  { timeout: 60 * 1000 }, async function (correlationId, sourceSystem, line1, city, state, zipCode) {
    await this.azurePortal.showPropertyRequestPayload({ correlationId, sourceSystem, line1, city, state, zipCode });
  });

When('I peek the published message in the Service Bus Explorer', { timeout: 60 * 1000 }, async function () {
  await this.azurePortal.peekPublishedMessage();
});

When('I refresh the queue Overview page to see the published message', { timeout: 120 * 1000 }, async function () {
  await this.azurePortal.refreshQueueOverview();
});

When('I open the output blob in storage account {string} in the Azure Portal', { timeout: 300 * 1000 }, async function (storageAccountName) {
  assert.ok(this.copeOutputContainerName, 'Output container name not set - run the blob polling step first');
  assert.ok(this.copeOutputBlobName, 'Output blob name not set - run the blob polling step first');
  await this.azurePortal.openStorageContainer(storageAccountName, this.copeOutputContainerName);
  await this.azurePortal.openBlob(this.copeOutputBlobName);
  await this.azurePortal.viewBlobContent();
});

After({ tags: '@azure-portal' }, async function () {
  // Keep the final blob content visible for a while instead of closing immediately.
  if (this.azurePage) await this.azurePage.waitForTimeout(45 * 1000);
  if (this.azureContext) await this.azureContext.close();
  if (this.azureBrowser) await this.azureBrowser.close();
});
