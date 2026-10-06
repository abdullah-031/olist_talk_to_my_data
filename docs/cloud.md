# Deploying to Azure

The app is one stateless container: FastAPI serves the built React UI and forwards each
question to the Foundry agent. Chat history is stored only in Foundry conversations. The earlier OpenRouter/PostgreSQL design is archived in
[archive/cloud.md](archive/cloud.md).

## Already implemented

- Configuration from environment; no secrets in the repository or the browser.
- Microsoft Entra ID to Foundry through `DefaultAzureCredential` (managed identity in Azure).
- Caller authentication mode for Azure Container Apps (ACA) built-in auth, enforced by a
  startup guard: `APP_ENV=production` refuses to start unless `AUTH_MODE=azure_container_apps`
  and `ALLOWED_HOSTS` is explicit.
- Streaming request byte limit (`MAX_REQUEST_BYTES`), a 4,000-character question limit, and a
  per-process concurrency gate (`MAX_CONCURRENT_REQUESTS`) that answers 429 when saturated.
- Conversation history is scoped to the signed-in caller: conversations carry
  `metadata.user_id` = `x-ms-client-principal-id`, and every read, follow-up and delete checks it.
  This makes ACA authentication (step 2) a requirement for privacy, not only for access.
- Request IDs, no question text in logs or validation errors, non-root container, health check.

## Deployment sequence

1. Build and test the image, push it to Azure Container Registry, and deploy it to ACA on
   port 8000 with HTTPS-only ingress.
2. Enable **ACA built-in authentication** with the Microsoft Entra provider, require
   authentication, and reject unauthenticated requests. Restrict allowed users or app roles.
   The API trusts `x-ms-client-principal-id` only in `AUTH_MODE=azure_container_apps`; ACA
   strips client-supplied identity headers, so ACA must be the only ingress path. Never use
   that mode on a bare public server. Test signed-in and anonymous requests before exposure.
3. Set `APP_ENV=production`, `AUTH_MODE=azure_container_apps`, and exact `ALLOWED_HOSTS`
   (include `localhost` for the health check).
4. Give the container app a **managed identity** and assign it **Azure AI User** on the
   Foundry project, nothing broader. Caller sign-in and the backend's Foundry identity are
   separate: callers never receive Foundry tokens.
5. Pin `FOUNDRY_AGENT_VERSION` to a reviewed agent version (see
   [agent-safety.md](agent-safety.md)) instead of following the latest version in production.
6. Add per-user quotas and budget alerts at an authenticated gateway such as API Management.
   The in-process gate is overload protection only and is per replica.
7. Send stdout to Azure Monitor / Application Insights and alert on 429, 502–504 rates and
   latency. Use Foundry tracing and evaluations for agent quality.
8. Prefer private networking between the container environment, Foundry and PostgreSQL.

## Current deployment (demo, 2026-10-06)

Deployed with `AUTH_MODE=shared_login` (see below), subscription "Azure subscription 1",
East US, tenant b90e9d5f….

| Resource | Name | Notes |
| --- | --- | --- |
| Container app | `olist-ttmd` in `rg-olist-ttmd` | HTTPS only, port 8000, 0–1 replicas, 0.5 CPU / 1 GiB |
| Container Apps environment | `cae-olist-ttmd` in `rg-olist-ttmd` | Consumption |
| Container registry | `olistttmdreg2141` in `rg-tgs-project` | Basic; image `olist-ttmd:<commit>` |
| Foundry project | `ttmd-agent` / `proj-default` in `rg-tgs-project` | Agent `olist-agent` |

- Public URL: https://olist-ttmd.gentleplant-2134e3a7.eastus.azurecontainerapps.io
- The app's system-assigned identity has **AcrPull** on the registry and **Azure AI User**
  (shown as "Foundry User") on the Foundry project, nothing broader. The registry lives in
  `rg-tgs-project` because the deploying account can grant roles only there.
- `SHARED_LOGIN_PASSWORD` and `SESSION_SECRET` are container app secrets referenced with
  `secretref:`; their values are not recorded here.

Update to a new commit from the repo root:

```powershell
$tag = git rev-parse --short HEAD
az acr build -r olistttmdreg2141 -t olist-ttmd:$tag .
az containerapp update -g rg-olist-ttmd -n olist-ttmd --image olistttmdreg2141.azurecr.io/olist-ttmd:$tag
```

Change the demo password without a rebuild:

```powershell
az containerapp secret set -g rg-olist-ttmd -n olist-ttmd --secrets shared-login-password=<new>
az containerapp revision restart -g rg-olist-ttmd -n olist-ttmd --revision (az containerapp show -g rg-olist-ttmd -n olist-ttmd --query properties.latestRevisionName -o tsv)
```

## Demo sign-in: one shared username and password

For a presentation where the audience should open a link and start asking questions,
`AUTH_MODE=shared_login` replaces Entra sign-in with one credential pair read out to the
room. Everything still runs in Azure; only the sign-in step changes.

- Set `APP_ENV=production`, `AUTH_MODE=shared_login`, `SHARED_LOGIN_USERNAME`,
  `SHARED_LOGIN_PASSWORD` (at least 8 characters), `SESSION_SECRET` and exact
  `ALLOWED_HOSTS` in the container app's settings. Keep the credentials out of the
  repository; store the password as a container app secret.
- The shared credentials cannot identify anyone, so each browser that signs in is given a
  random visitor ID in a signed, HTTP-only session cookie (`SESSION_HOURS`, default 12).
  Conversations are tagged with that ID, so visitors do not see each other's history.
  History does not follow a visitor to another browser or device, and clearing cookies
  starts over.
- Without `SESSION_SECRET` each process signs with its own generated secret, so a restart
  or a second replica signs everyone out. Set it, and keep `--max-replicas 1` for a demo.
- Failed sign-ins are counted per client address and cool off after 10 attempts in five
  minutes. The counter is per replica, like the concurrency gate.
- A public link plus a spoken password is not a privacy boundary: a token-per-minute limit
  on the model deployment and an Azure budget alert protect the Foundry spend, and the
  password should be changed after the demo (a settings update, no rebuild).
- Switching to real customer sign-in later is a settings change: set
  `AUTH_MODE=azure_container_apps`, enable ACA built-in auth (step 2 above), and add
  Microsoft Entra External ID for accounts outside the tenant. The code path for ACA is
  unchanged.
