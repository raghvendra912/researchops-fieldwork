alter table public.clients
  add column if not exists redirect_variables jsonb not null default '[
    {"name":"respondent_id","source":"URL_PARAM","defaultValue":"","required":true},
    {"name":"project_id","source":"SYSTEM","defaultValue":"","required":true}
  ]'::jsonb;

alter table public.clients drop constraint if exists clients_redirect_variables_valid;
alter table public.clients add constraint clients_redirect_variables_valid check (
  jsonb_typeof(redirect_variables) = 'array'
  and jsonb_array_length(redirect_variables) between 1 and 8
);

comment on column public.clients.redirect_variables is
  'Client-facing masked redirect variable definitions. Final destinations are configured outside the client directory.';
