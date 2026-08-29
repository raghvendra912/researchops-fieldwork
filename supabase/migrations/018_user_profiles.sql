create table public.user_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (length(trim(display_name)) between 1 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.user_profiles(id, display_name)
select id, coalesce(nullif(trim(raw_user_meta_data->>'full_name'), ''), nullif(split_part(email, '@', 1), ''), 'Team member')
from auth.users
on conflict (id) do nothing;

create or replace function public.sync_user_profile()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  insert into public.user_profiles(id, display_name)
  values(new.id, coalesce(nullif(trim(new.raw_user_meta_data->>'full_name'), ''), nullif(split_part(new.email, '@', 1), ''), 'Team member'))
  on conflict(id) do update set display_name=excluded.display_name, updated_at=now();
  return new;
end $$;

create trigger auth_users_sync_profile after insert or update of email,raw_user_meta_data on auth.users
for each row execute function public.sync_user_profile();

alter table public.user_profiles enable row level security;
create policy "workspace members read teammate profiles" on public.user_profiles
for select to authenticated using (
  exists (
    select 1 from public.organization_members mine
    join public.organization_members teammate on teammate.organization_id=mine.organization_id
    where mine.user_id=auth.uid() and teammate.user_id=user_profiles.id
  )
);

alter table public.projects add constraint projects_manager_profile_fkey
foreign key(project_manager_id) references public.user_profiles(id) on delete set null;

grant select on public.user_profiles to authenticated;
