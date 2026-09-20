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
