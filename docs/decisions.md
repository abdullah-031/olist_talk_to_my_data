# Decisions log — artefact_talk_to_my_data

Two logs on purpose: **business** (stakeholder / product intent) and **technical** (how we implemented under real constraints).

**Current track (from 2026-09-19):** personal sandboxes `olist_oltp_abd` / `olist_olap_abd`. Schemas are replicas of shared `olist_oltp` / `olist_olap` (only DB names differ). Shared DBs are seed/reference only — not the write target for this demo track.

---

## 1. Business / stakeholder decisions

| # | Decision | Why | Circumstances |
|---|----------|-----|---------------|
| B1 | Use Brazilian Olist ecommerce data as the demo dataset | Familiar relational commerce domain; supports “talk to my data” Q&A (sales, products, sellers, customers) | Artefact zip provided as project source |
| B2 | Host OLTP + OLAP on Azure PostgreSQL (`tgsdb`) | Matches a realistic cloud analytics story for the product demo | Azure Postgres already available |
| B3 | Build a warehouse shaped for a RAG / talk-to-my-data product demo | Demo must answer natural-language analytics questions with clear grain and rich descriptors | Explicit product-demo framing, not a full enterprise BI program |
| B4 | One fact only: order line item (`fact_order_item`) | Best single grain for revenue / product / seller / customer questions without multi-fact complexity | Compared order-level, payment-level, review-level; user chose minimal facts |
| B5 | Dimension layer includes category and geography as their own tables (not only attributes) | Stakeholders see category and place as first-class analysis paths (“by category”, “by region”), not buried fields | User rejected lean 4-dim fold; chose option C (add `dim_category` + `dim_geography`) |
| B6 | Defer payments and reviews as facts for now | Keeps v1 scope demo-shippable; those grains are order-level and need allocation / separate facts | User locked 1 fact; payment/review called out as poor fit for item grain |
| B7 | Document decisions as Decision / Why / Circumstances, split business vs technical | Artefact must explain *what* we chose for stakeholders and *how* we executed under constraints | User requested two tables after the modeling discussion |
| B8 | Prefer KNIME for transformation workflows (business-visible ETL story) | Low-code lineage is easier to show in a demo than opaque scripts | User required transformations inside KNIME |
| B9 | Use KNIME to orchestrate the OLTP→OLAP star build for the demo | Stakeholder-visible lineage for the warehouse refresh | User: go ahead with OLAP and KNIME workflows |
| B10 | One KNIME workflow per dim and for the fact; OLAP populated only by running those pipelines | Demo shows explicit transform lineage; prevents silent backdoor loads | User: build workflows for each dim & fact; only populate OLAP via workflow |
| B11 | Build OLAP loads as iterative KNIME DB workflows (Connector → observe/transform → DB Writer), one dim at a time | Stakeholder-visible lineage and correct transforms need looking at data, not opaque shell dumps | User feedback: iterate on canvas; lock goal then trial-and-error |
| B12 | Use warehouse surrogate keys (KNIME Counter Generation) on dims except smart `date_key` on dim_date; use Joiner when a dim/fact needs multiple OLTP tables | Standard DW practice: stable integer SKs for facts, visible join lineage on canvas | User: Counter Generation for indexes; think like seasoned DE; Joiner for multi-table |
| B13 | Run this demo track on personal sandboxes `olist_oltp_abd` + `olist_olap_abd` (not shared) | Isolates loads from shared team DBs; safe to truncate/reload | User: abd-only sandbox; schemas identical to shared |

---

## 2. Technical decisions

| # | Decision | Why | Circumstances |
|---|----------|-----|---------------|
| T1 | Land OLTP as near-source tables (9 CSVs → 9 tables) before OLAP | Fast, auditable source of truth; separate modeling from ingestion | User: OLTP schema + load first; pause before OLAP design |
| T2 | Auth with password role `tgsteam` (not Azure AD device code) | AAD device login could not be completed for the bot | Initial recipe used `az` access tokens; bot had no interactive AAD path |
| T3 | Require Azure Postgres firewall allowlist for bot egress IPs + public access | Without it, TCP/5432 timed out; no DDL/load possible | Bot egress not on allowlist; user doesn’t manage networking — needed copy-paste portal steps |
| T4 | Log every DB hit in `logs/db_operations.md` | Traceability for the artefact and demos | Explicit user requirement |
| T5 | OLTP `order_reviews` primary key `(review_id, order_id)` | Source has duplicate `review_id` values; single-column PK breaks COPY | First reviews load failed on unique violation |
| T6 | OLTP load via `psql` `\copy`; reserve KNIME for OLTP→OLAP transforms | Minimal steps to fill empty OLTP; KNIME kept for the value-add modeling path | User: minimal ops + KNIME for transformations |
| T7 | OLAP v1: `fact_order_item` + 6 dims: `dim_date`, `dim_customer`, `dim_product`, `dim_seller`, `dim_category`, `dim_geography` | Implements business picks B4–B5 in a classic star | Locked after 5-vs-7 fact discussion and dim-richness option C |
| T8 | Conforming `dim_geography` keyed by zip prefix (shared by customer & seller) | One geo spine avoids duplicated city/state logic and supports “region” filters | Option C; geo existed only as attributes on customer/seller in lean design |
| T9 | `dim_category` from category translation (PT + EN); product points to category key | Category becomes sliceable without denormalizing every product attribute query | Option C; was previously folded into `dim_product` |
| T10 | `order_status` stays degenerate on the fact (not `dim_order_status`) | Low-cardinality status; avoids extra dim until stakeholders ask for status history SCD | Still in “more dimensions?” set but not selected in option C |
| T11 | Keep a running dual decision log (this file) as scope changes | Prevents losing rationale when grain/dim choices iterate | User asked for durable documentation mid-modeling |
| T12 ~~superseded~~ | ~~Star load via External Tool + SQL under `sql/olap/`~~ | — | Archived under `archive/`; not used on abd track |
| T13 ~~superseded~~ | ~~Truncate shared `olist_olap` + External Tool step scripts~~ | — | Archived; abd OLAP is empty and KNIME-only |
| T14 | Prefer Connector + DB Writer over External Tool for KNIME loads | Aligns with KNIME best practice and canvas observability | User: deprecate one-shot External Tool path |
| T15 | Fresh KNIME docs: DE_APPROACH.md + CONNECTIONS.md; rebuild dims iteratively | Clean restart for Connector→transform→Writer method | User opening firewall during reorganize |
| T16–T17 | Archive leftover External Tool / one-shot SQL artefacts | Clear workspace of deprecated paths | User cleanup requests |
| T18 | Personal sandboxes `olist_oltp_abd` + `olist_olap_abd` with checked-in DDL; OLTP seeded from shared (read-only); OLAP empty for KNIME | Isolates demo loads; reproducible create path | User: `*_abd` names, document, load OLTP, log ops |
| T19 | Abd OLAP surrogate keys must be SERIAL (`nextval` sequences), not `GENERATED … AS IDENTITY` | Live information_schema must match shared exactly | Diff found IDENTITY vs SERIAL; DDL + live abd recreated to match |

## Locked OLAP shape (current)

| Type | Tables |
|------|--------|
| Fact (1) | `fact_order_item` |
| Dimensions (6) | `dim_date`, `dim_customer`, `dim_product`, `dim_seller`, `dim_category`, `dim_geography` |
| **Total** | **7 tables** (+ `dq_report`) |

## Active databases (this track)

| Role | Database |
|------|----------|
| Source | `olist_oltp_abd` |
| Target | `olist_olap_abd` |

## 2026-09-22 — Local warehouse agent

Added a React/TypeScript UI and FastAPI API using GPT-4.1 nano. The final provider is
OpenRouter (`OPENROUTER_API_KEY`, model `openai/gpt-4.1-nano`) following the user's
credential clarification; direct OpenAI and Azure adapters remain available.
The app compiles validated aggregate plans into parameterized,
read-only PostgreSQL queries. The warehouse model and KNIME loading ownership remain unchanged.
See [the archived engineering decision table](archive/agent-decisions.md) for options, rationale,
scaling paths, tradeoffs, weaknesses and official Azure/PostgreSQL sources.

Live verification found all 112,650 `fact_order_item.category_key` values NULL and
no product-to-category matches. Other fact dimension joins passed. This contradicts
the older all-keys-present operational note. The app now checks category coverage
and declines category questions until KNIME repairs the links; it does not invent
a fallback or modify the warehouse. Revenue/state/time analytics remain available.

## 2026-10-03 — Backend routes to a Microsoft Foundry agent

The FastAPI backend no longer plans or runs SQL. It forwards each conversation to the
Foundry agent `olist-agent` through the project's Responses API, using
`azure-ai-projects` with an `agent_reference` (name and optional version from env).
Authentication is Microsoft Entra ID only, as Foundry agents do not accept API keys.
The browser keeps the conversation and sends it with every question, so the backend
stays stateless. The OpenRouter planner, SQL compiler and warehouse adapter were removed; warehouse access
and data rules now live in the agent. Caller authentication, request byte and conversation
limits and a concurrency gate stay in the backend. The warehouse check scripts and reader
role are kept, the earlier design docs are archived under `docs/archive/`, and the agent's
tool requirements are in `docs/agent-safety.md`.

## 2026-10-03 — Chat history lives in Foundry conversations

Users can reopen past conversations. Instead of adding a database, the backend creates a
Foundry conversation on the first question (metadata: caller ID, agent name, title) and
answers every turn with `conversation=<id>`, so Foundry holds the context and the transcript.
The browser keeps only the open conversation's ID (in the URL). History is read back with the
conversation items API; the list comes from Foundry's project-wide conversation list filtered
by metadata in the backend, because Foundry has no owner filter. The browser-side history
budget (`MAX_CONVERSATION_CHARS`) was removed. Trade-off: listing scans the project's
conversations (capped at 1,000), which suits one team, not a large multi-tenant deployment.

## 2026-10-03 — Version 16 agent source and generated visualizations (superseded)

The user-supplied `olist-agent:16` export is the basis for the editable prompt-agent
YAML. Keep one Markdown instruction source and embed it with the offline sync script;
Foundry assigns the deployed version. Preserve the supplied model, MCP connection,
read-only shared reference database, and automatic Code Interpreter container. Narrow
the local MCP allowlist to the three analytics read tools. No warehouse model or ETL
change is involved, and no database interaction was made during this implementation.

Code Interpreter produces PNG charts and aggregate CSVs from verified query results.
The backend translates trusted assistant file citations into same-origin links for
both immediate answers and history. File retrieval checks conversation owner, agent,
and exact citation before reading Foundry container content; it is bounded to 10 MB
and the existing concurrency limit. Generated files stay in Foundry and may expire.
The UI shows failed-preview guidance and download links. Incomplete responses and
unsupported approval requests are errors rather than completed business answers.

The enhanced draft adds period comparisons, repeat-buyer metrics, mapping coverage,
bounded query correction, and export instructions. These prompt policies still require
live evaluation and server-side enforcement where appropriate. The repo source does
not automatically deploy or pin a new remote version; apply and review it in Foundry
before updating `FOUNDRY_AGENT_VERSION`.


## 2026-10-04 — Core chat and skill ownership

The user assigned all visualization and export work to specialized skills and
requested light agent instructions. The local prompt now keeps essential
warehouse definitions and evidence rules, and delegates specialized work to
available skills. Skill setup and execution belong to the configured Foundry
agent; the app continues forwarding questions without a local skill router.

Removed automatic table charts, generated-file citation rewriting, container
downloads, image previews, download routes, and their dedicated tests. The app
retains concise text and ordinary tables, follow-ups, history, and access controls.
Incomplete answers and unsupported approval requests still fail clearly.

Removed the incompatible live evaluator and alternate ADF exports. Kept the
canonical sandbox SQL, KNIME-only transformations, audited maintenance scripts,
source data, and reader-role provisioner. Duplicate schemas and reset snippets
were removed after checking script and KNIME archive references. The warehouse
model and database identities did not change; no database operations occurred.

The local instruction source still targets the shared read-only `olist_olap`;
all warehouse maintenance targets the personal `_abd` sandboxes. The two scopes
must not be compared as numerical ground truth. Remote instructions, skill/tool
configuration, and the reviewed version must be applied in Foundry separately.

Validation: 33 backend tests, the retained frontend history test, and 14 Edge
browser tests passed. Ruff, frontend formatting, TypeScript/Vite build, local
documentation links, and Git whitespace checks passed. Browser tests used API
fixtures with an unconfigured backend; no live Foundry or database calls occurred.

## 2026-10-04 — Reduce runtime and maintenance overhead

Docker now includes only API sources and frontend build inputs; local outputs,
tests, caches, and unrelated projects stay outside the build context. Runtime
copies only `backend/app/`. The UI shares one conversation request controller and
status, and one theme choice between desktop and mobile controls. Removed bundled
fonts, elapsed-time tracking, shimmer placeholders, the decorative page glow, and
the standalone table wrapper file. Ordinary accessible tables remain supported.

Common response headers now wrap early authentication and body-limit errors.
Provisioning and reset share audit setup and write an initial entry before any
database command; reset records failed attempts. Warehouse checks use python-dotenv
instead of a custom parser. Repository guidance now describes the actual app and
test commands. Warehouse schemas, KNIME loads, and Foundry settings are unchanged.

Validation: 37 Python tests (including fake-psql maintenance checks), one frontend
unit test, and 15 Edge browser tests passed. Ruff, formatting, Bash syntax, and
TypeScript/Vite build passed. Docker image execution was unavailable because the
local engine was stopped. No live Foundry or database calls occurred.

## 2026-10-06 — Charts shown inline again

Salah asked for Code Interpreter charts to appear in the chat as well as download.
This brings back the 2026-10-03 file handling that the 2026-10-04 cleanup removed:
the backend rewrites sandbox links that match a real `container_file_citation` into
same-origin links, and serves the file only after checking the conversation's owner,
agent, and that exact citation (PNG and CSV, 10 MB cap). Every cited PNG is shown
inline below the answer with one download link under it, whether or not the agent
wrote its own image markdown. The agent's own link to the same file is dropped (or
reduced to its text mid-sentence) so each file has a single download link. The browser only loads images from these
routes. Files stay in the Foundry container and may expire; the UI then says so.
No agent instruction change is needed.
