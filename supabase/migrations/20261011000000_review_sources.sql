-- Reviews the owner brings in: copied from their own website, or pasted from anywhere they are allowed to copy.
alter table customer_interactions drop constraint customer_interactions_source_check;
alter table customer_interactions add constraint customer_interactions_source_check
  check (source in ('google_review', 'instagram_comment', 'whatsapp', 'zomato_review', 'counter_note',
                    'website_review', 'pasted_review'));
