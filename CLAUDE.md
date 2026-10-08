# Counterpart — working notes for Claude

HR26 Agnes hackathon, problem HR26-AI-02 (Marketing Campaigns). Product: an agentic "marketing employee" for a small café (demo business `kaapi-kone`, Jayanagar, Bengaluru). The pitch is that the SYSTEM (locked facts, guard, attribution, experiments, ledger) is the product; the LLM is a swappable component.

## Layout
- `supabase/migrations/` — the only schema source (14 tables, RLS on, offer_facts immutability trigger). Applied by `backend/scripts/migrate.py`.
- `backend/app/` — FastAPI modular monolith
  - `domain/` pure logic, no I/O: `facts.py` (slots + deterministic guard L1/L2), `audit.py` (L3 LLM check), `stats.py`, `economics.py`, `impact.py`
  - `services.py` — all DB business operations; used by BOTH the API and agent tools. Put rules here, not in prompts or routes.
  - `agent/` — `tools.py` (registry: args model, effect class, preconditions), `runtime.py` (policy gate + loop + inbox decisions), `situation.py` (snapshot + deterministic detectors), `prompts.py`
  - `providers/` — role-based `ModelRouter`; Agnes via `openai_compat.py`; `replay.py`; `ratelimit.py`
  - `api/owner.py` (owner routes, `require_owner`), `api/public.py` (QR landing, no auth)
- `frontend/` — Next.js 15 App Router. `app/api/[...path]/route.ts` proxies to the backend and adds the owner token server-side. `lib/api.ts` has `api()`, `useResource()` (refetch on ledger SSE) and `useLedgerEvents()`.
- `data/seed/kaapi_kone.json` — synthetic demo data; `demo_new_reviews` is the on-stage batch that triggers the complaint-spike detector.

## Invariants (do not weaken)
- Model output never contains offer values; only `{{fact_key}}` slots. L1 blocks any digit authored outside slots (allowed_phrases in business profile are the only exception).
- Locked offer facts change only by locking a new version; DB trigger enforces it. Seed/reset purges use `set local counterpart.allow_purge = 'on'`.
- Facts drafts carry `wording_check` (reset on every save): deterministic script sanity + same numbers as English, then an LLM back-translation. Locking is refused while it is `failed` or missing; `unchecked` (no model) is allowed and shown.
- L1 also blocks malformed Kannada/Devanagari letter sequences and Latin-inside-Indic words (`facts.malformed_words`). Built-in `BASELINE_FORBIDDEN` (en/kn/hi) applies on top of each campaign's list.
- `generate_copy` does one in-tool repair round with the guard's exact reasons. Story/poster limits count visible letters (`visible_len`).
- Owner decisions and direct locks resume the agent in the background (`resume`, default true; tests pass false).
- Tools with effect `customer_facing` or `fact` become inbox approvals unless `ctx.approved`.
- Asset approval requires validation passed against the CURRENT locked facts version and L3 not pending/failed (`services.approvable`).
- No LLM call inside an open DB transaction (read → call model → write).
- Secrets (Agnes key, Supabase service role, owner token) only in `backend/.env` / server-side Next env. Only `NEXT_PUBLIC_BUSINESS_SLUG` is public.
- Synthetic/replayed data is always labelled in the UI.

## Commands
PATH: `export PATH=~/.local/opt/node/bin:~/.local/bin:$PATH`
- Backend: `cd backend && uv run uvicorn app.main:app --reload --port 8000`; tests `uv run pytest`; lint `uv run ruff check .`
- DB: `uv run python -m scripts.migrate [--reset]`, `scripts.seed`, `scripts.set_db_password` (hidden prompt, URL-encodes, tests, writes .env), `scripts.sample_campaign`, local PG `scripts.dev_db`
- Frontend: `cd frontend && npm run dev`; `npm run typecheck`; `npm run build`

## Design system (frontend)
Tokens in `frontend/app/globals.css`: paper `#f2f3ef`, ink `#201a16`, leaf (verified/primary), turmeric (needs owner), kumkum (blocked). Fonts: Bricolage Grotesque (headings), Hanken Grotesk (UI), IBM Plex Mono (receipt log only), Noto Sans Kannada/Devanagari. The receipt-roll activity log is the one bold element; keep everything else quiet (hairlines, few cards, no gradients, sentence case, no all-caps labels outside the receipt).

## Agnes behaviour seen live (2026-10-09)
- Sends object/array tool arguments as JSON strings (runtime decodes on validation failure).
- Sometimes announces the next step in prose and stops (runtime nudges once).
- Kannada output is unreliable (invented words, wrong meaning such as "night" for pm, "cancellation" for off) and its own back-translation check is lenient. The guard catches much of it; how to get correct Kannada is an open team decision.
- Playwright plugin needs Google Chrome (not installed). Use the cached Chromium: `uv run --no-project --with playwright==1.63.0 python script.py`.

## Agnes API facts (checked 2026-10-08)
- Base `https://apihub.agnes-ai.com/v1`; chat is OpenAI-compatible with `tools`; no JSON mode (use `router.chat_json`).
- Images: `size` "1K"/"2K", `ratio` e.g. "3:4"; `response_format` goes inside `extra_body`; reference images in `extra_body.image` (URLs or data URIs).
- Free plan: text 10 RPM, image 1K 10 RPM, video 1 RPM.
