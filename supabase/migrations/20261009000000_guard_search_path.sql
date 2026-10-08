-- Supabase security advisor 0011: pin the trigger function's search_path (it only uses built-ins).
alter function public.offer_facts_guard() set search_path = '';
