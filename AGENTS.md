# Repository Guidelines

## Project Structure & Module Organization

This repository supports an Olist ecommerce analytics demo using Azure PostgreSQL and KNIME.

- `data/`: nine source CSVs; `data/README.md` documents provenance and expected counts.
- `sql/`: numbered DDL files for `olist_oltp_abd` and `olist_olap_abd`.
- `knime/`: seven numbered `.knwf` workflows, one per dimension or fact.
- `scripts/`: Bash database provisioning and OLTP seeding.
- `docs/decisions.md`: business and technical decisions, including the warehouse model.
- `logs/`: database operation records and connection diagnostics.

The warehouse contains six dimensions, `fact_order_item` at order-line grain, and `dq_report`.

## Build, Test, and Development Commands

Use Bash (WSL or Git Bash on Windows), PostgreSQL `psql`, and KNIME Analytics Platform. No application build or package manager is configured.

- `bash -n scripts/create_abd_databases.sh`: check shell syntax without connecting to PostgreSQL.
- `bash scripts/create_abd_databases.sh`: recreate sandbox databases, apply DDL, and copy OLTP data from shared `olist_oltp`; requires `PGPASSWORD` and network access. **Destructive:** drops both `_abd` databases and legacy `_abdullah` databases.
- `psql -d olist_oltp_abd -v ON_ERROR_STOP=1 -f sql/01_olist_oltp_abd_schema.sql`: apply OLTP DDL to an existing sandbox.

The OLAP DDL drops existing warehouse tables. Import KNIME workflows and execute in numbered order, `01_Dim_Date` through `07_Fact_Order_Item`, after configuring sandbox connections.

## Coding Style & Naming Conventions

Follow existing SQL: uppercase keywords, lowercase `snake_case` identifiers, four-space column indentation, and `dim_`, `fact_`, and `idx_` prefixes. Preserve source-compatible names such as `product_name_lenght`. Keep numbered SQL and workflow filenames. Bash uses two-space indentation and `set -euo pipefail`. No formatter or linter configuration is present.

## Testing Guidelines

No automated test framework or coverage threshold is configured. Validate sandbox row counts against `data/README.md`, including the documented 99,224 deduplicated reviews. For workflow changes, check key uniqueness, foreign-key matches, and fact grain; record validation queries and outcomes in `logs/db_operations.md`.

## Commit & Pull Request Guidelines

This checkout has no Git metadata, so commit conventions cannot be inferred. Use concise imperative subjects, such as `Fix category dimension mapping`. PRs should describe affected schemas/workflows, validation results, and reload requirements; link relevant issues and include KNIME canvas screenshots for transformation changes.

## Security & Architecture Constraints

Keep `.env`, passwords, and tokens out of commits and logs. Write only to personal sandbox databases; shared databases are read-only references. Populate OLAP through KNIME workflows. Log every database interaction in `logs/db_operations.md` and update `docs/decisions.md` when modeling decisions change.
