-- Accounts: any business can sign up. Users live in Supabase Auth (auth.users); the backend verifies their token
-- and checks membership on every owner route. No foreign key to auth.users so tests run on plain Postgres.
create table memberships (
  user_id      uuid not null,
  business_id  uuid not null references businesses on delete cascade,
  role         text not null default 'owner' check (role in ('owner', 'staff')),
  created_at   timestamptz not null default now(),
  primary key (user_id, business_id)
);
create index memberships_business on memberships (business_id);

-- The seeded café is a demo: reachable through "Try the demo", never listed for real owners.
alter table businesses add column is_demo boolean not null default false;
update businesses set is_demo = true where slug = 'kaapi-kone';

-- Photos of the business itself (its website, its Google Maps listing, owner uploads), read by a vision model
-- once, then matched to posts. 'generated' marks AI pictures kept as a fallback when the library is empty.
create table business_photos (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references businesses on delete cascade,
  source       text not null check (source in ('upload', 'website', 'google', 'generated')),
  source_url   text,
  attribution  text,
  image_key    text not null,
  width        int,
  height       int,
  caption      text,
  tags         text[] not null default '{}',
  kind         text,
  status       text not null default 'active' check (status in ('active', 'hidden')),
  created_at   timestamptz not null default now()
);
create index business_photos_active on business_photos (business_id) where status = 'active';
create unique index business_photos_source on business_photos (business_id, source_url) where source_url is not null;

alter table memberships     enable row level security;
alter table business_photos enable row level security;
