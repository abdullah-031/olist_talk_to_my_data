# Verification record — 2026-09-22

## Confirmed

- 28 offline backend tests pass: strict query contract, parameter binding, unreviewed identifiers,
  read-only/timeout setup, audit failure behavior, redacted errors, request limits, data-quality guard,
  independent warehouse readiness, and the OpenRouter SDK wire format using an HTTP fixture.
- Python lint and TypeScript checks pass. React production build succeeds; npm installation reported
  zero dependency vulnerabilities. Built bundle approximately 76 KB JavaScript / 4 KB CSS gzipped.
- Real browser loads the built UI, connects to the live Azure warehouse, shows counts and the category
  warning, and reports no JavaScript errors in the manual check.
- The first automated browser run passed error handling and mobile width checks. Two test assertions
  failed on locale-dependent number formatting and an ambiguous chart selector. Both were corrected;
  that initial run is not recorded as a fully passing browser suite.
- Fixed read-only verification SQL successfully reached `olist_olap_abd`; no DDL/DML was executed.
  Transaction read-only mode was verified as `on`. All interactions are audited in
  `logs/db_operations.md`; detailed local reports are in ignored `artifacts/`.

| Live warehouse measurement | Result |
|---|---:|
| Order items | 112,650 |
| Distinct orders with items | 98,666 |
| Merchandise revenue, all statuses | BRL 13,591,643.70 |
| Freight | BRL 2,251,909.54 |
| Item value including freight | BRL 15,843,553.24 |
| Duplicate fact grain | 0 |
| Unmatched date/customer/product/seller joins | 0 |
| Invalid YYYYMMDD date keys | 0 |
| `item_total != price + freight_value` | 0 |
| Missing fact category links | 112,650 |
| Matched product-to-category fallback links | 0 |
| Categories / date rows / customers / sellers / products / geography rows | 74 / 634 / 99,441 / 3,095 / 32,951 / 19,177 |
| PostgreSQL version | 18.6 |
| Query Store capture mode | `none` |
| Installed extensions | `plpgsql` only |

A reviewed 2018 aggregate probe completed at approximately 54.8 ms database execution time in one
EXPLAIN ANALYZE run; this is not an end-to-end latency benchmark or a category-quality validation.
It scanned roughly 61,416 qualifying fact rows and used cached buffers. The observed sequential scan
is reasonable for a broad date range; no speculative index change was made.

## Current limitations

The warehouse validation script deliberately exits nonzero because category keys are missing.
This is a real upstream data-quality failure. The app displays it and prevents category analytics.
Repair must happen through the KNIME product/fact category mapping, followed by a reload and
revalidation. The metadata cache detects the correction within 60 seconds.

Initial live model checks returned `401 invalid_api_key` at the direct OpenAI endpoint. The user
then clarified that their key is from OpenRouter. The adapter has been switched accordingly and its
wire contract tested without external calls. Live OpenRouter verification is pending the user saving
`OPENROUTER_API_KEY` in `.env`. No successful live model answers are claimed until that check passes.

Docker image execution, Azure managed identity, Container Apps authentication, PgBouncer on port
6432, and Azure Monitor export have not been tested in a deployed Azure environment. Packaging and
configuration support are provided; no cloud resources were provisioned.
