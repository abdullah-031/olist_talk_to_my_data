# Olist agent: prioritized improvements (Foundry version)

Reviewed on 2026-10-03 against `main` at 20fc5a5 ("Route the backend to the Microsoft Foundry olist-agent").

**How it works now:** the FastAPI backend is a thin, stateless proxy. `backend/app/foundry.py:28-33` sends the browser-held conversation to the Foundry agent `olist-agent` through the Responses API and returns `output_text` only. The agent's instructions, model, and warehouse tools live in Foundry, **not in this repo**. Safety controls that used to be enforced in code (SQL allowlist, read-only transactions, timeouts, audit, category guard) are now requirements to verify on the agent side (`docs/agent-safety.md:1-8`).

Caveat: this review is based on the repository only, not the Foundry agent's instructions or tool setup. Items about the agent itself are inferred from what the repo shows and from the archived design.

## P1: control and quality of the agent itself

### 1. Put the agent definition in the repo
- Nothing in git says what the agent's instructions, model, or tools are. `FOUNDRY_AGENT_VERSION` is optional and defaults to "latest" (`config.py:17`, `foundry.py:17-18`). Anyone editing the agent in the portal changes production behavior with no review, diff, or rollback.
- **Fix:** add `agent/instructions.md` + `agent/definition.py` (or YAML) and a `scripts/deploy_agent.py` that calls `AIProjectClient.agents.create_version(...)`. Flow: edit in a PR → deploy new version → run evals → pin `FOUNDRY_AGENT_VERSION`. `docs/agent-safety.md:20` already asks for this; it isn't implemented.

### 2. Give the agent a semantic-layer tool instead of free SQL
- The old backend had a reviewed metric catalog and compiler (`docs/archive/`, previously `catalog.py`/`query.py`): fixed definitions of revenue (excl. freight), orders (distinct), AOV, joins and date filters. If the Foundry agent writes its own SQL, every answer re-derives those definitions and can silently differ (e.g. revenue with freight, `COUNT(*)` as orders).
- **Fix:** expose the old compiler as a function/OpenAPI tool, e.g. `query_metrics(metrics, dimensions, filters, sort, limit)` → rows + SQL, and keep raw SQL as a fallback tool or remove it. Accuracy and safety come back from code; the agent focuses on understanding the question and explaining results. The code is still in git history (`60afb2f:backend/app/query.py`).

### 3. Category questions can't work until the data is fixed
- `docs/decisions.md:77-81` records that all 112,650 `fact_order_item.category_key` values are NULL. The old guard that declined category questions is gone; it only survives as an eval case marked "review" (`scripts/evaluate_agent.py:88`). The agent may answer "top categories" with everything in "Unknown", or join via `dim_product` and get a different answer.
- **Fix:** repair the product→category mapping in the KNIME workflow (`knime/04_Dim_Product.knwf`, `07_Fact_Order_Item.knwf`). Until then, say so in the agent instructions.

## P2: evaluation and observability

### 4. Make the eval harness actually grade
- 5 of 8 cases have no check and always come back "review" (`scripts/evaluate_agent.py:67-88`, `:102`), so an injection that succeeds in words still exits 0. Only one accuracy question exists (`:57-66`).
- **Fix:**
  - Add ~20 numeric cases with SQL ground truth from `scripts/warehouse.py`: monthly revenue for 2018, top 5 customer states by orders, revenue by status, AOV, freight share, a two-turn follow-up ("only delivered").
  - Grade refusals automatically: an LLM judge with a rubric, or Foundry's built-in evaluators, instead of "review".
  - Record agent version, latency and tokens per case; run before every version pin (item 1).

### 5. Log what the agent did
- The backend keeps only `output_text` (`foundry.py:33`) and logs only error types (`main.py:133-137`). No response id, agent version, tokens, latency, or which tools/SQL ran. When an answer is wrong you can't trace why.
- **Fix:** log `response.id`, `response.usage`, latency, and the tool-call items from `response.output` (names only, no rows). Re-enable Azure Monitor / Foundry tracing (the old `configure_azure_monitor` hook was removed with the old `main.py`).

### 6. Handle incomplete responses explicitly
- A Responses call can finish with `status="incomplete"` (e.g. max output tokens, content filter) and still have partial or empty text. Today an empty one becomes "returned an empty answer" (`main.py:172-173`), and a partial one is shown as if complete.
- **Fix:** check `response.status` / `incomplete_details` in `FoundryAgent.ask` and map to a clear message, or append "(answer was cut off)".

## P3: user experience

### 7. Stream the answer
- Timeout is 60 s (`config.py:18`) and the UI waits for the whole answer. Agents that run tools often take 10–30 s.
- **Fix:** `responses.create(..., stream=True)` and stream text deltas to the browser (SSE). Showing tool steps ("querying warehouse…") helps too.

### 8. Show how the number was produced
- The old UI showed the SQL, parameters, definitions, a table and a chart. Now it's Markdown only (`frontend/src/Answer.tsx`). For a data assistant, "how did you get this?" is part of trust.
- **Fix:** return the tool calls/SQL from item 5 in `ChatResponse` and render a collapsible "How this was computed" section. With item 2, return the rows too and bring back the chart.

### 9. Consider Foundry conversations instead of resending history
- The browser resends up to 20 messages / 24k chars each time and truncates long answers (`frontend/src/history.ts`, `config.py:24`). That's a reasonable stateless choice; the cost is that tool results from earlier turns are lost, so follow-ups re-run queries. Foundry conversations (`conversation=` id) keep them. Only worth it if follow-ups prove slow or inconsistent in evals.

## Smaller notes
- `/api/docs` and `openapi.json` are now on in production too (`main.py:80-82`); the old app disabled them outside local. Low risk behind ACA auth, but easy to restore.
- The caller's identity isn't passed to Foundry; sending a hashed `x-ms-client-principal-id` as request metadata/`user` makes per-user abuse tracing and quotas possible (`docs/cloud.md` step 6).
- Tests pass (22) but cover only the proxy; agent behavior is covered solely by the live harness, which makes item 4 the main quality gate.
