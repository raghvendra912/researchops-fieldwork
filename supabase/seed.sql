-- Run after creating a user in Supabase Auth. Replace the UUID below with that user id.
insert into public.organizations (id, name, slug)
values ('11111111-1111-4111-8111-111111111111', 'ResearchOps Labs', 'researchops-labs')
on conflict do nothing;

insert into public.clients (organization_id, name, code) values
  ('11111111-1111-4111-8111-111111111111', 'Northstar Bank', 'NORTHSTAR'),
  ('11111111-1111-4111-8111-111111111111', 'Arc Technologies', 'ARC')
on conflict do nothing;

insert into public.suppliers (organization_id, name, code, supplier_type) values
  ('11111111-1111-4111-8111-111111111111', 'CPX Research', 'CPX', 'PROGRAMMATIC'),
  ('11111111-1111-4111-8111-111111111111', 'BitLabs', 'BITLABS', 'PROGRAMMATIC'),
  ('11111111-1111-4111-8111-111111111111', 'PureSpectrum', 'PURESPECTRUM', 'PROGRAMMATIC')
on conflict do nothing;
