// Verifies STORAGE_SAS_URL can actually list and read the output container, so a
// wrong-scoped or under-permissioned SAS is caught here instead of as a 403 deep inside CI.
// Usage: $env:STORAGE_SAS_URL="<value>"; npm run verify:storage
const { BlobServiceClient } = require('@azure/storage-blob');
const { createAzureCredential } = require('../specs/support/azure-credential');
require('dotenv').config();

const containerName = process.env.COPE_OUTPUT_CONTAINER || 'cope-agent-responses';

function buildClient() {
  const sasUrl = process.env.STORAGE_SAS_URL?.trim();
  if (sasUrl) {
    const url = new URL(sasUrl);
    if (url.pathname && url.pathname !== '/') url.pathname = '';
    const params = new URLSearchParams(url.search);
    console.log(`Using STORAGE_SAS_URL (sr=${params.get('sr') || '?'}, sp=${params.get('sp') || '?'}, se=${params.get('se') || '?'})`);
    if (params.get('sr') !== 'c') {
      console.warn('Warning: expected sr=c (container-scoped). A blob-scoped SAS cannot list the container.');
    }
    if (!(params.get('sp') || '').includes('l')) {
      console.warn('Warning: expected "l" (list) in sp. Without it, polling for the output blob fails.');
    }
    return new BlobServiceClient(url.toString());
  }
  const connection = process.env.STORAGE_CONNECTION_STRING?.trim();
  if (connection) {
    console.log('Using STORAGE_CONNECTION_STRING');
    return BlobServiceClient.fromConnectionString(connection);
  }
  const accountUrl = process.env.STORAGE_ACCOUNT_URL;
  if (!accountUrl) {
    console.error('Set STORAGE_SAS_URL, STORAGE_CONNECTION_STRING, or STORAGE_ACCOUNT_URL first.');
    process.exit(1);
  }
  console.log('Using Azure identity (OIDC / az login)');
  return new BlobServiceClient(accountUrl, createAzureCredential());
}

(async () => {
  const container = buildClient().getContainerClient(containerName);
  let count = 0;
  for await (const blob of container.listBlobsFlat()) {
    if (count === 0) console.log(`First blob: ${blob.name}`);
    if (++count >= 3) break;
  }
  console.log(`OK - listed ${count} blob(s) in "${containerName}". This credential works.`);
})().catch(error => {
  console.error(`FAILED to list "${containerName}": ${error.message}`);
  if (String(error.statusCode) === '403') {
    console.error('403 usually means the SAS lacks list permission (need sp=rl) or is scoped to a single blob (need sr=c).');
  }
  if (String(error.statusCode) === '404') {
    console.error('404 usually means the container name is wrong, or the container path was included twice in the URL.');
  }
  process.exit(1);
});
