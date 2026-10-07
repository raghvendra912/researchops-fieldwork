-- Reference-workflow fields used by the client, supplier and survey setup screens.
alter table public.clients
  add column if not exists country_code text check (country_code is null or country_code ~ '^[A-Z]{2}$'),
  add column if not exists sales_user text;

alter table public.suppliers
  add column if not exists supplier_variable text,
  add column if not exists flamingo_enabled boolean not null default false;

alter table public.projects
  add column if not exists segment text,
  add column if not exists survey_multi_link boolean not null default false,
  add column if not exists campaign_banner text not null default 'HIDE',
  add column if not exists security_controls jsonb not null default '{}'::jsonb,
  add column if not exists prescreening_questions jsonb not null default '[]'::jsonb;

alter table public.projects drop constraint if exists projects_campaign_banner_check;
alter table public.projects add constraint projects_campaign_banner_check
  check (campaign_banner in ('HIDE','SHOW'));

alter table public.projects drop constraint if exists projects_prescreening_questions_valid;
alter table public.projects add constraint projects_prescreening_questions_valid check (
  jsonb_typeof(prescreening_questions) = 'array'
  and jsonb_array_length(prescreening_questions) <= 5
);

comment on column public.projects.prescreening_questions is
  'Up to five operator-authored screening prompts and answer types shown alongside executable eligibility rules.';
