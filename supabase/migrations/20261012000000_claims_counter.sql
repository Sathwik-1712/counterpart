-- Coupons that work like real coupons: one code per customer, used once, checked against the locked offer.

-- A customer taps "Get my code" on a post and gets their own code, still attributed to that post.
-- The same phone gets the same code back (device = random id kept in the customer's browser).
create table claims (
  code             text primary key,
  touchpoint_code  text not null references touchpoints on delete cascade,
  campaign_id      uuid not null references campaigns on delete cascade,
  asset_id         uuid references assets on delete set null,
  device           text,
  via              text not null default 'web' check (via in ('web', 'whatsapp')),
  status           text not null default 'claimed' check (status in ('claimed', 'redeemed')),
  created_at       timestamptz not null default now(),
  redeemed_at      timestamptz,
  bill_amount      numeric(10, 2) check (bill_amount >= 0),
  redeemed_by      text,
  outside_rules    text  -- the offer rules said no and staff redeemed anyway: why
);
create index claims_campaign on claims (campaign_id, status);
create index claims_touchpoint on claims (touchpoint_code);
create unique index claims_one_per_device on claims (campaign_id, device) where device is not null;

-- Staff phones without an account: the owner sets a counter PIN, a phone that enters it gets a session.
alter table businesses
  add column counter_pin_hash text,
  add column counter_pin_fails int not null default 0,
  add column counter_pin_locked_until timestamptz;

create table counter_sessions (
  token_hash   text primary key,
  business_id  uuid not null references businesses on delete cascade,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null
);
create index counter_sessions_business on counter_sessions (business_id);

-- The owner can approve, while locking the offer, every post written for that offer version that passes all
-- checks. Such posts go live without a second visit. Null = ask for each post.
alter table campaigns add column autopublish_version int;

alter table claims           enable row level security;
alter table counter_sessions enable row level security;
