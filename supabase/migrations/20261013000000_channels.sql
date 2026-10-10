-- WhatsApp (Cloud API) and Instagram (Instagram API with Instagram Login), connected per business.

-- One connection per business and channel. external_id: the WhatsApp phone number id, or the Instagram user id.
-- The token never leaves the backend. (Stored as text; move it to Supabase Vault before real customers.)
create table channel_accounts (
  business_id       uuid not null references businesses on delete cascade,
  channel           text not null check (channel in ('whatsapp', 'instagram')),
  external_id       text not null,
  display           text,
  token             text not null,
  token_expires_at  timestamptz,
  meta              jsonb not null default '{}',
  connected_at      timestamptz not null default now(),
  primary key (business_id, channel)
);
create unique index channel_accounts_external on channel_accounts (channel, external_id);

-- People who messaged the business on WhatsApp. Messaging first is consent to a reply; STOP opts out of offers.
create table wa_contacts (
  business_id      uuid not null references businesses on delete cascade,
  phone            text not null,  -- digits with country code, as WhatsApp sends it
  name             text,
  language         text,
  first_seen_at    timestamptz not null default now(),
  last_inbound_at  timestamptz,
  opted_out_at     timestamptz,
  primary key (business_id, phone)
);

-- Every WhatsApp message in or out, with delivery status from the webhook. ref goes into tracked links (?m=)
-- so a link open can be tied to the message that carried it.
create table channel_messages (
  id            text primary key,  -- WhatsApp message id (wamid)
  business_id   uuid not null references businesses on delete cascade,
  campaign_id   uuid references campaigns on delete set null,
  asset_id      uuid references assets on delete set null,
  phone         text not null,
  direction     text not null check (direction in ('in', 'out')),
  kind          text not null check (kind in ('inbound', 'claim_reply', 'help', 'broadcast', 'template')),
  body          text,
  ref           text unique,
  status        text not null check (status in ('received', 'sent', 'delivered', 'read', 'failed')),
  error         text,
  created_at    timestamptz not null default now(),
  delivered_at  timestamptz,
  read_at       timestamptz
);
create index channel_messages_asset on channel_messages (asset_id, direction);
create index channel_messages_business on channel_messages (business_id, created_at desc);

-- Instagram posts tied to a Counterpart post (published from here, or an existing post the owner linked),
-- with the latest insights.
create table instagram_media (
  media_id      text primary key,
  business_id   uuid not null references businesses on delete cascade,
  asset_id      uuid references assets on delete set null,
  permalink     text,
  caption       text,
  media_type    text,
  posted_at     timestamptz,
  published_by  text not null check (published_by in ('counterpart', 'owner')),
  metrics       jsonb,
  metrics_at    timestamptz
);
create index instagram_media_asset on instagram_media (asset_id);

alter table channel_accounts enable row level security;
alter table wa_contacts      enable row level security;
alter table channel_messages enable row level security;
alter table instagram_media  enable row level security;
