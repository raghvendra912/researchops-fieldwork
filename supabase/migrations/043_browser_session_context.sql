-- Browser family is operational session context. Raw IP addresses remain excluded.

alter table public.survey_sessions
  add column if not exists browser_type text not null default 'UNKNOWN';

alter table public.survey_sessions drop constraint if exists survey_sessions_browser_type_check;
alter table public.survey_sessions add constraint survey_sessions_browser_type_check
  check (browser_type in ('CHROME','FIREFOX','SAFARI','EDGE','OPERA','BRAVE','OTHER','UNKNOWN'));

create or replace function public.capture_session_browser_type()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.event_type='START' then
    update public.survey_sessions
    set browser_type=case
      when upper(coalesce(new.metadata->>'browserType','')) in ('CHROME','FIREFOX','SAFARI','EDGE','OPERA','BRAVE','OTHER','UNKNOWN')
        then upper(new.metadata->>'browserType')
      else browser_type
    end
    where id=new.session_id;
  end if;
  return new;
end $$;

drop trigger if exists survey_events_capture_browser_type on public.survey_events;
create trigger survey_events_capture_browser_type
after insert on public.survey_events
for each row execute function public.capture_session_browser_type();

comment on column public.survey_sessions.browser_type is
  'Privacy-safe browser family captured from the launch user agent; raw user-agent and IP values are not stored.';
