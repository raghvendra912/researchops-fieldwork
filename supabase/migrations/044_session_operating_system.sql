-- Coarse operating-system family supports respondent operations without storing raw user agents.

alter table public.survey_sessions
  add column if not exists os_type text not null default 'UNKNOWN';

alter table public.survey_sessions drop constraint if exists survey_sessions_os_type_check;
alter table public.survey_sessions add constraint survey_sessions_os_type_check
  check (os_type in ('WINDOWS','MAC','LINUX','ANDROID','IOS','OTHER','UNKNOWN'));

create or replace function public.capture_session_browser_type()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.event_type='START' then
    update public.survey_sessions
    set browser_type=case
          when upper(coalesce(new.metadata->>'browserType','')) in ('CHROME','FIREFOX','SAFARI','EDGE','OPERA','BRAVE','OTHER','UNKNOWN') then upper(new.metadata->>'browserType')
          else browser_type
        end,
        os_type=case
          when upper(coalesce(new.metadata->>'osType','')) in ('WINDOWS','MAC','LINUX','ANDROID','IOS','OTHER','UNKNOWN') then upper(new.metadata->>'osType')
          else os_type
        end
    where id=new.session_id;
  end if;
  return new;
end $$;

comment on column public.survey_sessions.os_type is
  'Privacy-safe operating-system family captured at launch; raw user-agent values are not stored.';
