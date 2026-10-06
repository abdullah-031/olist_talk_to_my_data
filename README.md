# Talk to the Olist data

A React conversation UI and FastAPI backend that forward questions to the
Microsoft Foundry agent `olist-agent`. The agent handles warehouse analysis and
calls its configured skills for specialized work. The app displays text and
Markdown tables and manages Foundry conversation history.

## Run locally

Requires Python 3.11-3.13, uv, Node.js 22+, Azure CLI, and Azure AI User access to
the Foundry project.

1. Copy `.env.example` to `.env` and set `FOUNDRY_PROJECT_ENDPOINT` and
   `FOUNDRY_AGENT_NAME`. Optionally pin `FOUNDRY_AGENT_VERSION`.
2. Sign in with `az login`.
3. Start the backend from the repository root:

   ```powershell
   uv sync --frozen --extra dev
   uv run python -m app
   ```

4. Start the frontend in another terminal:

   ```powershell
   cd frontend
   npm ci
   npm run dev
   ```

Open **http://127.0.0.1:5173**. Health is at
**http://127.0.0.1:8000/api/health** and API docs at `/api/docs`.

For one process, build the frontend with `npm run build`, start the backend, and
open **http://127.0.0.1:8000**. `docker compose up --build` serves the same app.
Containers need a service principal or managed identity for Foundry; see
[deployment instructions](docs/cloud.md).

## Agent and conversations

- Requests use `azure-ai-projects`, Microsoft Entra authentication, and an
  `agent_reference` containing the configured name and optional version.
- Foundry stores conversations. The backend checks caller and agent ownership
  before follow-ups, reads, and deletion. The browser keeps only the current
  conversation ID in `?c=...`.
- The UI supports questions, follow-ups, copy, retry, history, mobile navigation,
  and light/dark themes. Stop or Esc stops browser waiting; it does not explicitly
  cancel remote agent generation. Asking again submits a new stored question.
- Answers use Markdown/GFM tables with raw HTML and images disabled. The app
  performs no chart inference or generated-file retrieval. Visualization and
  export workflows belong entirely to the specialized skills configured on the
  Foundry agent, including their output delivery.
- Edit [agent_instructions.md](microsoft_foundry/agent_instructions.md), then
  apply it in Foundry and review the resulting version. Skills must be available
  to that agent through its configured tools; local Codex skills are not
  automatically installed on it. Repository edits do not update remote settings.
- Backend limits cover request bytes, question length, and concurrent chat calls.
  Production requires caller authentication: ACA built-in auth, or the shared
  username and password of `AUTH_MODE=shared_login` for demos. Errors do not echo questions or
  credentials. Incomplete answers and unsupported approval requests fail clearly.
  See [agent/tool requirements](docs/agent-safety.md).
- Health reports whether settings are configured; it does not probe Foundry.

## Validation

```powershell
uv run pytest
uv run ruff check backend scripts
cd frontend
npm test
npm run format:check
npm run build
npm run test:e2e
```

Browser tests require the built app running on port 8000 (or `BASE_URL`) and
Microsoft Edge. They use API fixtures; backend tests use mocked Foundry transport.
Neither test suite establishes live warehouse or skill correctness.
Maintenance regression tests use a fake `psql` and require Bash; they are skipped
when Bash is unavailable. They never connect to a database.

Optional audited sandbox checks use the `PG*` settings in `.env`:

```powershell
uv run --extra warehouse python scripts/verify_warehouse.py
uv run --extra warehouse python scripts/inspect_category_keys.py
```

These scripts read only `olist_olap_abd` and log queries in `logs/db_operations.md`.
The agent's instruction source targets shared `olist_olap` as a read-only
reference; sandbox verification is not ground truth for that database.

## Project map

- `backend/app/`: configuration, Foundry adapter, and API.
- `frontend/src/`: conversation UI and Markdown rendering.
- `microsoft_foundry/agent_instructions.md`: concise agent instruction source.
- `data/`, `sql/`, `knime/`: source data, sandbox schemas, and KNIME warehouse ETL.
- `scripts/`: sandbox provisioning/reset and audited read-only checks.
- `docs/cloud.md`, `docs/agent-safety.md`, `docs/decisions.md`: active operations
  and architecture documentation. `docs/archive/` preserves historical reviews.
