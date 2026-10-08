-- Counterpart schema. Plain Postgres 15+, compatible with Supabase.
--
-- Access model: the FastAPI backend connects with a privileged role (DATABASE_URL).
-- RLS is enabled on every table with NO policies, so Supabase's public anon /
-- authenticated roles cannot read or write anything through PostgREST. The
-- browser never talks to the database directly.

-- ---------------------------------------------------------------- businesses
create table businesses (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique,
  name        text not null,
  locality    text not null,
  city        text not null,
  timezone    text not null default 'Asia/Kolkata',
  languages   text[] not null default '{en}',
  -- hours, channels, menu (price + unit cost), baseline covers, allowed_numbers
  profile     jsonb not null default '{}',
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------- brand_dna
-- Versioned brand memory. Exactly one active version per business.
create table brand_dna (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references businesses on delete cascade,
  version      int  not null,
  status       text not null check (status in ('active', 'proposed', 'superseded', 'rejected')),
  dna          jsonb not null,
  rationale    text,
  created_by   text not null check (created_by in ('owner', 'agent', 'seed')),
  created_at   timestamptz not null default now(),
  unique (business_id, version)
);
create unique index brand_dna_one_active on brand_dna (business_id) where status = 'active';

-- ---------------------------------------------------------------- campaigns
create table campaigns (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid not null references businesses on delete cascade,
  name           text not null,
  status         text not null default 'draft'
                 check (status in ('draft', 'planned', 'active', 'concluded', 'archived')),
  brief          text,                         -- the owner's own words (voice transcript)
  goal           jsonb not null default '{}',  -- {statement, kpi: {metric, target, window_days}}
  plan           jsonb,                        -- audience x channel x language matrix, hypotheses
  intent         jsonb,                        -- {core_message, cta, must_say, must_not_say, tone}
  starts_on      date,
  ends_on        date,
  is_historical  boolean not null default false,  -- imported / synthetic history
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index campaigns_business_idx on campaigns (business_id, created_at desc);

-- ---------------------------------------------------------------- offer_facts
-- What customers are told to expect. Versioned; a locked version is immutable
-- (enforced by trigger below). Changing a fact means superseding the locked
-- version with a new one, which the owner must approve.
--
-- facts: [{key, label, type, value, display: {en, kn, hi}, required}]
create table offer_facts (
  id                uuid primary key default gen_random_uuid(),
  campaign_id       uuid not null references campaigns on delete cascade,
  version           int  not null,
  status            text not null check (status in ('draft', 'locked', 'superseded')),
  facts             jsonb not null,
  forbidden_claims  jsonb not null default '{}',  -- {en: [...], kn: [...], hi: [...]}
  change_reason     text,
  locked_at         timestamptz,
  locked_by         text,
  created_at        timestamptz not null default now(),
  unique (campaign_id, version)
);
create unique index offer_facts_one_locked on offer_facts (campaign_id) where status = 'locked';
create unique index offer_facts_one_draft  on offer_facts (campaign_id) where status = 'draft';

create function offer_facts_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    -- Deliberate purges (demo reset) must opt in for their transaction: set local counterpart.allow_purge = 'on'
    if old.status <> 'draft' and coalesce(current_setting('counterpart.allow_purge', true), '') <> 'on' then
      raise exception 'offer_facts v% is % and cannot be deleted', old.version, old.status;
    end if;
    return old;
  end if;
  if old.status in ('locked', 'superseded') then
    if new.facts is distinct from old.facts
       or new.forbidden_claims is distinct from old.forbidden_claims
       or new.version <> old.version
       or new.campaign_id <> old.campaign_id then
      raise exception 'offer_facts v% is % and immutable; create a new version', old.version, old.status;
    end if;
    if not (new.status = old.status or (old.status = 'locked' and new.status = 'superseded')) then
      raise exception 'illegal offer_facts transition % -> %', old.status, new.status;
    end if;
  end if;
  return new;
end $$;

create trigger offer_facts_immutable
  before update or delete on offer_facts
  for each row execute function offer_facts_guard();

-- ---------------------------------------------------------------- customers
create table customer_interactions (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references businesses on delete cascade,
  source       text not null check (source in ('google_review', 'instagram_comment', 'whatsapp', 'zomato_review', 'counter_note')),
  language     text not null,
  segment      text,
  rating       smallint check (rating between 1 and 5),
  body         text not null,
  occurred_at  timestamptz not null,
  -- set once at ingestion, never recomputed
  sentiment    real check (sentiment between -1 and 1),
  themes       text[] not null default '{}',
  embedding    real[],
  analyzed_at  timestamptz,
  is_synthetic boolean not null default false,
  created_at   timestamptz not null default now()
);
create index customer_interactions_business_idx on customer_interactions (business_id, occurred_at desc);
create index customer_interactions_themes_idx on customer_interactions using gin (themes);

-- themes, segments, local events, summaries
create table customer_insights (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references businesses on delete cascade,
  kind          text not null check (kind in ('theme', 'segment', 'event', 'summary')),
  key           text not null,
  period_start  date,
  period_end    date,
  data          jsonb not null default '{}',
  created_at    timestamptz not null default now(),
  unique nulls not distinct (business_id, kind, key, period_start)
);

-- ---------------------------------------------------------------- experiments
create table experiments (
  id           uuid primary key default gen_random_uuid(),
  campaign_id  uuid not null references campaigns on delete cascade,
  hypothesis   text not null,
  dimension    text not null,                       -- what differs between arms (hook, language, ...)
  trial_type   text not null default 'scan',        -- outcome_events.type counted as a trial
  success_type text not null default 'redeem',      -- outcome_events.type counted as a success
  status       text not null default 'draft' check (status in ('draft', 'running', 'decided', 'stopped')),
  decision     jsonb,
  created_at   timestamptz not null default now(),
  decided_at   timestamptz
);
create index experiments_campaign_idx on experiments (campaign_id);

-- ---------------------------------------------------------------- assets
create table assets (
  id                uuid primary key default gen_random_uuid(),
  campaign_id       uuid not null references campaigns on delete cascade,
  segment           text not null,
  channel           text not null check (channel in ('instagram_post', 'instagram_story', 'whatsapp', 'poster')),
  language          text not null,
  variant           text,
  experiment_id     uuid references experiments on delete set null,
  status            text not null default 'draft'
                    check (status in ('draft', 'invalid', 'valid', 'approved', 'live', 'stale', 'retired', 'rejected')),
  current_revision  int,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index assets_campaign_idx on assets (campaign_id);
create index assets_experiment_idx on assets (experiment_id);

-- content: {headline, body, cta, hashtags} where each field is a list of
--          segments [{text, sources: ["fact:discount", "insight:...", ...]}]
--          and offer values appear only as {{fact_key}} slots.
-- rendered: the exact customer-facing strings after slot substitution.
create table asset_revisions (
  id             uuid primary key default gen_random_uuid(),
  asset_id       uuid not null references assets on delete cascade,
  n              int  not null,
  content        jsonb not null,
  rendered       jsonb,
  fact_keys      text[] not null default '{}',  -- dependency edges for change propagation
  facts_version  int,
  brand_version  int,
  image_key      text,                          -- storage key, never a blob
  features       jsonb,
  validation     jsonb,
  prediction     jsonb,
  created_by     text not null check (created_by in ('agent', 'owner')),
  reason         text,
  created_at     timestamptz not null default now(),
  unique (asset_id, n)
);

-- ---------------------------------------------------------------- attribution
create table touchpoints (
  code         text primary key,
  campaign_id  uuid not null references campaigns on delete cascade,
  asset_id     uuid references assets on delete cascade,
  kind         text not null check (kind in ('qr', 'whatsapp_keyword', 'counter_code', 'link')),
  created_at   timestamptz not null default now()
);
create index touchpoints_asset_idx on touchpoints (asset_id);
create index touchpoints_campaign_idx on touchpoints (campaign_id);

create table outcome_events (
  id               bigint generated always as identity primary key,
  campaign_id      uuid not null references campaigns on delete cascade,
  asset_id         uuid references assets on delete set null,
  touchpoint_code  text references touchpoints on delete set null,
  type             text not null check (type in ('impression', 'scan', 'click', 'reply', 'redeem')),
  qty              int  not null default 1 check (qty > 0),
  source           text not null check (source in ('live', 'counter', 'import', 'simulated')),
  occurred_at      timestamptz not null default now(),
  meta             jsonb not null default '{}'
);
create index outcome_events_campaign_idx on outcome_events (campaign_id, type);
create index outcome_events_asset_idx on outcome_events (asset_id, type);
create index outcome_events_touchpoint_idx on outcome_events (touchpoint_code);

-- ---------------------------------------------------------------- memory
create table memories (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references businesses on delete cascade,
  campaign_id  uuid references campaigns on delete set null,
  kind         text not null check (kind in ('learning', 'brand_rule', 'edit_signal', 'preference', 'note')),
  status       text not null default 'active' check (status in ('active', 'proposed', 'rejected', 'archived')),
  content      text not null,
  scope        jsonb not null default '{}',   -- {segment, channel, language, hook}
  evidence     jsonb not null default '{}',
  confidence   real check (confidence between 0 and 1),
  created_by   text not null check (created_by in ('agent', 'owner', 'seed')),
  created_at   timestamptz not null default now()
);
create index memories_business_idx on memories (business_id, kind, status);
create index memories_campaign_idx on memories (campaign_id);

-- ---------------------------------------------------------------- inbox
-- Everything that needs the owner: approvals, recommendations, findings.
-- payload.tool / payload.args describe exactly what runs if approved.
create table inbox_items (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references businesses on delete cascade,
  campaign_id  uuid references campaigns on delete cascade,
  kind         text not null check (kind in ('approval', 'recommendation', 'finding', 'notice')),
  title        text not null,
  body         text,
  payload      jsonb not null default '{}',
  status       text not null default 'pending'
               check (status in ('pending', 'approved', 'rejected', 'dismissed', 'expired')),
  priority     smallint not null default 2,
  created_at   timestamptz not null default now(),
  decided_at   timestamptz,
  decision     jsonb
);
create index inbox_items_business_idx on inbox_items (business_id, status, created_at desc);
create index inbox_items_campaign_idx on inbox_items (campaign_id);

-- ---------------------------------------------------------------- ledger
-- Append-only record of everything the owner, the agent and customers did.
create table ledger_events (
  id           bigint generated always as identity primary key,
  business_id  uuid not null references businesses on delete cascade,
  campaign_id  uuid references campaigns on delete cascade,
  actor        text not null check (actor in ('owner', 'agent', 'system', 'customer')),
  type         text not null,
  summary      text not null,
  payload      jsonb not null default '{}',
  created_at   timestamptz not null default now()
);
create index ledger_events_business_idx on ledger_events (business_id, id desc);
create index ledger_events_campaign_idx on ledger_events (campaign_id, id desc);

-- ---------------------------------------------------------------- RLS
alter table businesses            enable row level security;
alter table brand_dna             enable row level security;
alter table campaigns             enable row level security;
alter table offer_facts           enable row level security;
alter table customer_interactions enable row level security;
alter table customer_insights     enable row level security;
alter table experiments           enable row level security;
alter table assets                enable row level security;
alter table asset_revisions       enable row level security;
alter table touchpoints           enable row level security;
alter table outcome_events        enable row level security;
alter table memories              enable row level security;
alter table inbox_items           enable row level security;
alter table ledger_events         enable row level security;
