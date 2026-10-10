-- Comments on the business's Instagram posts, read as reviews: each one is sorted into a category (praise, complaint,
-- question, suggestion, mention of a friend, spam) and gets the same mood, topics and English reading as a review.
alter table customer_interactions
  add column external_id  text,   -- the Instagram comment id, so a comment is stored once and can be replied to
  add column author       text,   -- the commenter's public Instagram username
  add column category     text check (category in ('praise', 'complaint', 'question', 'suggestion', 'mention', 'spam'));

create unique index customer_interactions_external on customer_interactions (business_id, source, external_id)
  where external_id is not null;
