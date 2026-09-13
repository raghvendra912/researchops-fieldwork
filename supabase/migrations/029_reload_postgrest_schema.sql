-- Migration 028 adds and replaces RPCs consumed immediately by the deployed Worker.
-- Explicitly refresh PostgREST's schema cache so newly deployed routes resolve them.
select pg_notify('pgrst', 'reload schema');
