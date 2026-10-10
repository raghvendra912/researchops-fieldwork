alter table public.clients
  add column if not exists respondent_parameter text;

alter table public.clients drop constraint if exists clients_respondent_parameter_valid;
alter table public.clients add constraint clients_respondent_parameter_valid check (
  respondent_parameter is null
  or respondent_parameter ~ '^[A-Za-z][A-Za-z0-9_]{0,39}$'
);

comment on column public.clients.respondent_parameter is
  'Preferred client survey query parameter that receives the ResearchOps session/attempt UUID.';
