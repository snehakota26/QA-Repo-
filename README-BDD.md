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

## Microsoft authentication

There are two different auth problems here, and conflating them is what caused the expiring-session failures. Neither solution below has anything that expires.

### 1. Service Bus / Blob Storage - GitHub OIDC federated identity

The SDK-based tests never use a user session. The job requests a short-lived token from GitHub and exchanges it with Entra at run time (`specs/support/azure-credential.js`). Nothing is stored, so nothing can go stale. Client secrets are still accepted as a fallback, but they expire (24 months max), so OIDC is preferred.

One-time setup on the app registration:

```powershell
az ad app federated-credential create --id <APP_OBJECT_ID> --parameters '{
  "name": "github-agenticai-main",
  "issuer": "https://token.actions.githubusercontent.com",
  "subject": "repo:<owner>/<repo>:ref:refs/heads/main",
  "audiences": ["api://AzureADTokenExchange"]
}'
```

Add a second credential with `"subject": "repo:<owner>/<repo>:pull_request"` so PR runs work too. Then set `AZURE_CLIENT_ID` and `AZURE_TENANT_ID` as repository variables (no secret needed) and grant the service principal `Azure Service Bus Data Sender` on the queue and `Storage Blob Data Reader` on the container. The workflow already declares `permissions: id-token: write`.

### 2. Azure Portal UI - TOTP

The portal scenario needs a real user, so it signs in with a dedicated automation account and generates a fresh RFC 6238 code per run (`specs/support/totp.js`). There is no captured session, so there is nothing to refresh.

Set `AZURE_PORTAL_USERNAME`, `AZURE_PORTAL_PASSWORD` and `TOTP_SECRET` as secrets. The account must have:

- the **Software OATH token** (authenticator app) MFA method enrolled - capture the base32 secret shown during enrollment and store it as `TOTP_SECRET`;
- a password set to **never expire**;
- **exclusion from Conditional Access policies** that require a compliant or hybrid-joined device, or a named IP range - GitHub-hosted runners satisfy neither. This is the most common cause of a green local run and a red CI run.

Sign-in failures now surface the on-screen Entra message (forced MFA re-registration, expired password, push-notification enforcement, Conditional Access block) instead of timing out after 60 seconds with no explanation.

The captured storage state (`npm run auth:azure-portal`) still exists as a local-development convenience so you don't re-authenticate on every local run. CI refuses to use it - it expires within hours, so relying on it guarantees a red build eventually.

### 3. Fallback when you don't have Entra admin rights

Creating an app registration is usually self-service, but granting it RBAC on the Service Bus namespace and storage account is not. If you can't get that done, the SDK steps accept long-lived shared secrets instead:

- `SERVICE_BUS_CONNECTION` - a Service Bus connection string.
- `STORAGE_SAS_URL` - the blob endpoint with a SAS query string appended, or `STORAGE_CONNECTION_STRING`.

This is a deliberate trade-down: unlike OIDC these are bearer secrets that live in GitHub until someone rotates them. Scope them as tightly as the resource allows - a **Send-only** Service Bus authorization rule rather than `RootManageSharedAccessKey`, and a **container-scoped, read/list-only** SAS rather than the storage account key. Move to OIDC once an admin can assign the roles.

## CI/CD (GitHub Actions)

A single workflow, **`.github/workflows/ci.yml`**, runs all jobs (`copilot-setup-steps.yml`
is separate - it's the file GitHub's Copilot coding agent uses to prep its own sandbox, not
a test job).

Every test job runs on each push/PR to `main`, plus a nightly run at 06:00 UTC to catch
environment drift on quiet days.

- **`unit`** - `npm run test:unit` (`node --test`) over `test/`. Pure logic: TOTP code
  generation against the RFC 4226/4648 vectors, Service Bus payload building.
- **`bdd`** - `npm run test:validate`, a Cucumber `--dry-run` that parses every feature file
  and binds each step to a definition without executing it, so undefined/ambiguous/renamed
  steps fail the build. Then runs the non-`@integration` scenarios.
- **`integration`** - MCP server + `pipeline-function` contract tests. Needs `ORG_REPO_TOKEN`
  (read access to the private `allata-llc/mcp-server` and `allata-llc/pipeline-function`
  repos); skips rather than fails when absent, e.g. on fork PRs.
- **`cope-pipeline-e2e`** - `test:integration:cope-e2e`, the browserless end-to-end scenario
  (Service Bus -> Foundry -> Blob) over the Azure SDK with OIDC auth. No browser, no user
  sign-in, no MFA, no stored secret. This is the job that actually proves the pipeline works.
- **`azure-portal-e2e`** - the `@azure-portal` scenario, driving the real Portal UI headless
  with TOTP sign-in. Adds UI coverage on top of the headless job.
- **`live-pipeline`** - manual only, via `workflow_dispatch` with the `run_live_pipeline`
  input checked. Publishes a real message to the `cope-requests` queue.

A **`preflight`** job reports which credential sets are configured and publishes them as job
outputs; credential-dependent jobs gate on those outputs, so an unconfigured job is
**skipped** (a skipped job does not fail the run) instead of failing with a
missing-credentials error. This indirection is necessary because the `secrets` context is
not available in job or step `if:` conditions. Nothing uses `continue-on-error` - a failing
test always fails its job.

Workflows set default values for `SERVICE_BUS_NAMESPACE_FQDN` and `STORAGE_ACCOUNT_URL`,
overridable with repository variables of the same names.

All jobs read an `environment` input (`dev`/`stage`/`prod`, default `dev`) so
environment-specific variables/secrets can be configured per GitHub Environment (Settings >
Environments) without editing the workflow.
