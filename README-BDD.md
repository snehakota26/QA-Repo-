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
- **`integration-tests.yml`** - manual (`workflow_dispatch`) until the `ORG_REPO_TOKEN`
  secret is added (a PAT with read access to the private `allata-llc/mcp-server` and
  `allata-llc/pipeline-function` repos). Checks out both repos as siblings, starts the
  `mcp-server` Functions host, then runs `test:integration:mcp` and
  `test:integration:pipeline` (non-live). Once the secret exists, add `push`/`pull_request`
  triggers to run it automatically.
- **`live-tests.yml`** - manual only, always. Publishes a real message to the
  `cope-requests` Service Bus queue via `test:integration:pipeline:live`. Requires the
  `SERVICE_BUS_CONNECTION` secret.

Not automated in any workflow:
- `test:integration:azure-portal` and `test:integration:cope-e2e` - both drive the real
  Azure Portal UI and are tagged `@manual-auth`. They depend on a storage-state file
  captured interactively (`npm run auth:azure-portal`) that expires within hours, so they
  can only be run locally by a signed-in operator.

