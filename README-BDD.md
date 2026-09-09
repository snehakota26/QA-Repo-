Setup and run Cucumber + Playwright BDD

Prerequisites
- Node.js 16+

Install dependencies:

```bash
npm install
```

Install Playwright browsers:

```bash
npm run install-browsers
```

Run the BDD scenarios (Cucumber):

```bash
npm run test:bdd
```

Browser scenarios have been replaced by the Azure Service Bus / Blob integration
scenarios, which are opt-in via the `@integration` tag.

Install the integration dependencies and create local configuration:

```powershell
npm install
Copy-Item .env.example .env
```

Start the MCP server from its cloned repository:

```powershell
cd ..\mcp-server
hatch env create
hatch run start
```

The MCP integration expects:

```text
MCP_SERVER_URL=http://127.0.0.1:7071/mcp
```

Run MCP scenarios with:

```powershell
cd ..\AgenticAI
npm run test:integration:mcp
```

`pipeline-function` is a Service Bus queue-triggered function, not an HTTP
API. Its source contract can be checked locally without Azure credentials:

```powershell
npm run test:integration:pipeline
```

The live queue scenario requires these `.env` values:

```text
SERVICE_BUS_CONNECTION=<Service Bus connection string>
PIPELINE_QUEUE_NAME=cope-requests
PIPELINE_FUNCTION_REPO=../pipeline-function
```

Run it with:

```powershell
npm run test:integration:pipeline:live
```

Publishing a message only verifies that Service Bus accepted it. End-to-end
processing additionally requires the pipeline function, `AzureWebJobsStorage`,
Azure AI Foundry settings, and credentials described in the pipeline
repository's README.

Notes
- Feature files live in `specs/`.
- Cucumber World is `specs/support/world.js` which wires Playwright and page objects.
- Step definitions are in `specs/steps/`; integration steps are isolated in `integration.steps.js`.

## CI/CD (GitHub Actions)

Three workflows live in `.github/workflows/`:

- **`bdd-tests.yml`** - runs on every push/PR to `main`. Executes all non-`@integration`
  scenarios. No external dependencies, no secrets required.
- **`integration-tests.yml`** - runs on every push/PR to `main`, plus manual dispatch.
  Requires the `ORG_REPO_TOKEN` secret (a PAT with read access to the private
  `allata-llc/mcp-server` and `allata-llc/pipeline-function` repos). Checks out both repos
  as siblings, starts the `mcp-server` Functions host, then runs `test:integration:mcp` and
  `test:integration:pipeline` (non-live).
- **`live-tests.yml`** - manual only, always. Publishes a real message to the
  `cope-requests` Service Bus queue via `test:integration:pipeline:live`. Requires the
  `SERVICE_BUS_CONNECTION` secret.

Not automated in any workflow:
- `test:integration:cope-e2e` - the full end-to-end scenario (Service Bus -> Foundry -> Blob),
  which is only exercised via the Azure Portal UI scenario below.

Runs on `workflow_dispatch` only, using a secret instead of pure local execution:
- **`azure-portal-e2e.yml`** - runs `test:integration:azure-portal` (the `@azure-portal`
  scenario in `cope-pipeline-e2e.feature`) headless in CI. Azure AD sign-in needs MFA and
  can't be scripted, so it reuses a Playwright storage state captured locally
  (`npm run auth:azure-portal`) and committed as `.auth/azure-portal-state.enc.b64`, then
  decrypted in CI with the `AZURE_PORTAL_STATE_PASSPHRASE` secret. The workflow also sets
  default values for `SERVICE_BUS_NAMESPACE_FQDN` and `STORAGE_ACCOUNT_URL` (and allows
  overriding them with repository variables of the same names). The session expires within
  hours, so re-capture and re-encrypt the state before each run - it is not scheduled or
  triggered on push.
