-- Result of checking each translated fact wording against the English before the owner locks it.
-- {status: passed|failed|unchecked, issues: [...], back_translations: {...}, note}. Reset on every draft save.
alter table offer_facts add column wording_check jsonb;
