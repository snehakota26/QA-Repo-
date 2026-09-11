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

The live queue scenario requires either a connection string or Azure SDK credentials:

```text
SERVICE_BUS_CONNECTION=<Service Bus connection string>
# or:
SERVICE_BUS_NAMESPACE_FQDN=cope-pocsb.servicebus.windows.net
AZURE_CLIENT_ID=<app registration client id>
AZURE_CLIENT_SECRET=<app registration client secret>
AZURE_TENANT_ID=<tenant id>
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

A single workflow, **`.github/workflows/ci.yml`**, runs all jobs (`copilot-setup-steps.yml`
is separate - it's the file GitHub's Copilot coding agent uses to prep its own sandbox, not
a test job):

- **`bdd`** - runs on every push/PR to `main`. Executes all non-`@integration` scenarios. No
  external dependencies, no secrets required.
- **`integration`** - runs on every push/PR to `main`. Requires the `ORG_REPO_TOKEN` secret
  (a PAT with read access to the private `allata-llc/mcp-server` and
  `allata-llc/pipeline-function` repos). Checks out both repos as siblings, starts the
  `mcp-server` Functions host, then runs `test:integration:mcp` and
  `test:integration:pipeline` (non-live).
- **`azure-portal-e2e`** - manual only, via `workflow_dispatch` with the
  `run_azure_portal_e2e` input checked. Runs `test:integration:azure-portal` (the
  `@azure-portal` scenario in `cope-pipeline-e2e.feature`) headless in CI. Azure AD sign-in
  needs MFA and can't be scripted, so it reuses a Playwright storage state captured locally
  (`npm run auth:azure-portal`) and committed as `.auth/azure-portal-state.enc.b64`, then
  decrypted in CI with the `AZURE_PORTAL_STATE_PASSPHRASE` secret. The workflow also sets
  default values for `SERVICE_BUS_NAMESPACE_FQDN` and `STORAGE_ACCOUNT_URL` (and allows
  overriding them with repository variables of the same names). For Azure SDK auth, it
  accepts either split `AZURE_CLIENT_ID` / `AZURE_CLIENT_SECRET` / `AZURE_TENANT_ID`
  secrets/vars or the standard `AZURE_CREDENTIALS` JSON secret. The session expires within
  hours, so re-capture and re-encrypt the state before each run.
- **`live-pipeline`** - manual only, via `workflow_dispatch` with the `run_live_pipeline`
  input checked. Publishes a real message to the `cope-requests` Service Bus queue via
  `test:integration:pipeline:live`. Accepts either the `SERVICE_BUS_CONNECTION` secret/variable or
  the same Azure SDK credentials used by `azure-portal-e2e` plus a
  `SERVICE_BUS_NAMESPACE_FQDN` secret/variable in the selected GitHub Environment.

All jobs read a `environment` input (`dev`/`stage`/`prod`, default `dev`) so
environment-specific variables/secrets can be configured per GitHub Environment (Settings >
Environments) without editing the workflow.

Not automated in any job:
- `test:integration:cope-e2e` - the full end-to-end scenario (Service Bus -> Foundry -> Blob),
  which is only exercised via the Azure Portal UI scenario above.
