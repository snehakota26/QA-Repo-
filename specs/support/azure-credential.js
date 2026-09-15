const { ClientAssertionCredential, DefaultAzureCredential } = require('@azure/identity');

// Machine-to-machine auth for Service Bus / Blob Storage. Deliberately never uses a user
// session: sessions expire, federated tokens are minted per run and cannot go stale.
//
// Preference order:
//   1. GitHub OIDC federated identity - no secret stored anywhere, nothing to rotate or
//      refresh. Requires a federated credential on the app registration (see README-BDD.md).
//   2. DefaultAzureCredential - client secret via env, Azure CLI locally, managed identity.
//      Client secrets still expire (max 24 months), so OIDC is preferred in CI.
async function fetchGithubOidcToken() {
  const url = process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
  const requestToken = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;

  // api://AzureADTokenExchange is the audience Entra expects for federated credentials.
  const response = await fetch(`${url}&audience=api%3A%2F%2FAzureADTokenExchange`, {
    headers: { Authorization: `Bearer ${requestToken}` }
  });

  if (!response.ok) {
    throw new Error(
      `Failed to fetch GitHub OIDC token (${response.status}). ` +
        'Ensure the workflow job grants "permissions: id-token: write".'
    );
  }

  const { value } = await response.json();
  return value;
}

function usesGithubOidc(env) {
  return Boolean(
    env.AZURE_CLIENT_ID &&
      env.AZURE_TENANT_ID &&
      env.ACTIONS_ID_TOKEN_REQUEST_URL &&
      env.ACTIONS_ID_TOKEN_REQUEST_TOKEN &&
      !env.AZURE_CLIENT_SECRET
  );
}

function createAzureCredential(env = process.env) {
  if (usesGithubOidc(env)) {
    return new ClientAssertionCredential(env.AZURE_TENANT_ID, env.AZURE_CLIENT_ID, fetchGithubOidcToken);
  }
  return new DefaultAzureCredential();
}

module.exports = { createAzureCredential, usesGithubOidc };
