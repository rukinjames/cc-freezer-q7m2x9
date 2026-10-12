-- Wrong-passcode lockout, one row per network (IP address, stored only as a hash).
-- After 10 wrong passcodes in 15 minutes that network gets "locked" until the window ends.
create table if not exists public.inventory_auth_failures (
  ip_hash text primary key,
  failures int not null default 0,
  window_start timestamptz not null default now()
);
alter table public.inventory_auth_failures enable row level security;
revoke all on public.inventory_auth_failures from anon, authenticated;

-- Called by the edge function on every request, after it compares the passcode.
-- The advisory lock makes requests from one network take turns, so a burst of
-- parallel guesses can't slip past the limit. Returns 'ok', 'fail' or 'locked'.
create or replace function public.inventory_gate(p_key text, p_ok boolean, p_max int, p_window_seconds int)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  f int;
  ws timestamptz;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_key, 0));
  select failures, window_start into f, ws from inventory_auth_failures where ip_hash = p_key;
  if f is not null and ws < now() - make_interval(secs => p_window_seconds) then
    delete from inventory_auth_failures where ip_hash = p_key;
    f := null;
  end if;
  if coalesce(f, 0) >= p_max then
    return 'locked';
  end if;
  if p_ok then
    if f is not null then
      delete from inventory_auth_failures where ip_hash = p_key;
    end if;
    return 'ok';
  end if;
  insert into inventory_auth_failures as a (ip_hash, failures, window_start)
  values (p_key, 1, now())
  on conflict (ip_hash) do update set failures = a.failures + 1;
  return case when coalesce(f, 0) + 1 >= p_max then 'locked' else 'fail' end;
end;
$$;
revoke all on function public.inventory_gate(text, boolean, int, int) from public, anon, authenticated;
grant execute on function public.inventory_gate(text, boolean, int, int) to service_role;
