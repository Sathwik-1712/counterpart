# Counterpart

**The marketing employee behind your counter.** HR26-AI-02 (Marketing Campaigns), Agentic AI track.

A café owner says what she wants customers to hear. Counterpart writes the offer down as locked facts, plans and writes multilingual campaign pieces that cannot misstate the offer, gives each piece a tracking code, measures what actually brings people in, and comes back with the next move. The model writes; the system guarantees, measures and remembers.

## What makes it more than an LLM wrapper

| System feature | Where it lives |
|---|---|
| Offer facts are versioned and **immutable once locked** (enforced by a Postgres trigger) | `supabase/migrations/…_init.sql`, `backend/app/services.py` |
| Copy carries offer values only as `{{fact}}` slots; a 3-layer **Fact Guard** blocks anything else (numbers the model typed, in any script; missing facts; forbidden claims; LLM meaning check) | `backend/app/domain/facts.py`, `domain/audit.py` |
| Changing a fact marks **only the dependent pieces** stale; approved, unaffected pieces stay approved | `backend/app/domain/impact.py` |
| Agent picks its own tools; **policy gate** turns anything customer-facing or fact-changing into an owner approval | `backend/app/agent/runtime.py`, `agent/tools.py` |
| Deterministic **detectors** decide what needs attention (stale pieces, complaint spikes, upcoming events, decidable experiments) | `backend/app/agent/situation.py` |
| Per-piece **QR / counter codes**: real attribution of scans, claims and redemptions | `backend/app/api/public.py`, `/counter` screen |
| **Small-sample Bayesian experiments** (Beta-Binomial, Thompson sampling, expected-loss stopping, priors pooled from the café's own history) | `backend/app/domain/stats.py` |
| **Offer economics** from real menu costs (break-even before a discount is locked) | `backend/app/domain/economics.py` |
| **Model-agnostic** provider router: roles → provider chains, rate limiting, circuit breaker, record/replay with labelled saved outputs | `backend/app/providers/` |
| Append-only **ledger** of everything owner, agent and customers did | `ledger_events`, the receipt-roll log in the UI |

## Stack

- **Frontend**: Next.js 15 (App Router) + TypeScript + Tailwind CSS 4. Browser talks only to Next; a server-side proxy forwards to the API and adds the owner token.
- **Backend**: FastAPI (Python 3.12, uv), psycopg 3 async pool, plain SQL.
- **Database**: Supabase Postgres (any Postgres 15+ works). RLS on, no policies: the public Supabase keys can read nothing.
- **Files**: local disk in development, Supabase Storage when deployed (`STORAGE_BACKEND`).
- **Models**: Agnes 3.0 Flash (reasoning, generation, verification), Agnes Image 2.5 Flash (pictures without text). Optional second OpenAI-compatible LLM. Voice: browser Web Speech API. Embeddings: local, no API.

## Run it

First-time accounts and keys (Agnes, Supabase, GitHub, Claude Code plugins): see [docs/SETUP.md](docs/SETUP.md).

Prerequisites: Node 20+ and [uv](https://docs.astral.sh/uv/). (On this machine both live in `~/.local`: `export PATH=~/.local/opt/node/bin:~/.local/bin:$PATH`.)

```bash
# 1. Backend
cd backend
cp .env.example .env              # fill DATABASE_URL and AGNES_API_KEY
uv sync
uv run python -m scripts.migrate  # creates the schema (add --reset to start over)
uv run python -m scripts.seed     # loads the synthetic demo café
uv run uvicorn app.main:app --reload --port 8000

# 2. Frontend (another terminal)
cd frontend
cp .env.example .env.local
npm install
npm run dev                       # http://localhost:3000
```

No Supabase yet? `uv run python -m scripts.dev_db` starts a local Postgres 16 (no Docker) and prints a `DATABASE_URL`.
No Agnes key yet? `uv run python -m scripts.sample_campaign` builds a hand-written sample campaign through the real services so every screen has data.

### Supabase

1. Create a project. In **Project Settings → Database → Connection string**, copy the **Session pooler** URI (IPv4, port 5432) into `DATABASE_URL`.
2. `uv run python -m scripts.migrate && uv run python -m scripts.seed`. (`supabase db push` also works with the same migration files.)
3. When deploying, set `STORAGE_BACKEND=supabase`, `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in the **backend** env. The bucket is created on startup.

The service-role key and the Agnes key exist only in `backend/.env`. The frontend never receives them.

## Tests

```bash
cd backend && uv run pytest     # embedded Postgres 16 + scripted LLM; no network, no keys
cd backend && uv run ruff check .
cd frontend && npm run typecheck && npm run build
```

The end-to-end test walks the whole loop: brief → agent drafts facts → lock is gated to the owner → owner approves → copy generated and guarded (a model-typed number is blocked) → meaning check → owner types “30% off” and is blocked → publish issues a code → customer scans and claims → counter redemption → experiment with history prior → “Sunday only” marks exactly the date-dependent pieces stale.

## Demo data

Everything in `data/seed/` is synthetic and labelled as such in the UI (“Imported history”, “Synthetic demo data”). Replayed model outputs are labelled “Saved output”. Live QR scans and counter redemptions are the only data presented as real.
