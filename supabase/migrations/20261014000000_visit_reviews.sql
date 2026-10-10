-- Reviews from people who actually came in: asked after their code is redeemed, on their code page or on WhatsApp.
-- One review per redeemed code, so every one is a verified visit tied to the post that brought them.
alter table customer_interactions drop constraint customer_interactions_source_check;
alter table customer_interactions add constraint customer_interactions_source_check
  check (source in ('google_review', 'instagram_comment', 'whatsapp', 'zomato_review', 'counter_note',
                    'website_review', 'pasted_review', 'visit_review'));

alter table customer_interactions
  add column claim_code   text references claims on delete set null,
  add column campaign_id  uuid references campaigns on delete set null,
  add column asset_id     uuid references assets on delete set null,
  add column translation  text,          -- English reading of a Kannada or Hindi review, for the owner
  add column reply        text,          -- the owner's reply (drafted by the model, edited and approved by the owner)
  add column replied_at   timestamptz;

create unique index customer_interactions_one_per_visit on customer_interactions (claim_code) where claim_code is not null;
create index customer_interactions_asset on customer_interactions (asset_id) where asset_id is not null;

-- When the WhatsApp bot asked a customer for a review, so their next message is read as the answer.
alter table claims add column review_asked_at timestamptz;

alter table channel_messages drop constraint channel_messages_kind_check;
alter table channel_messages add constraint channel_messages_kind_check
  check (kind in ('inbound', 'claim_reply', 'help', 'broadcast', 'template', 'review_ask', 'review_thanks', 'review_reply'));
