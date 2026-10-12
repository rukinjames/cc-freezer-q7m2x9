-- Campus Creamery inventory app storage.
-- One table of small JSON documents. Row level security is on with no policies,
-- so only the inventory edge function (service role) can read or write it.
create table if not exists public.inventory_docs (
  collection text not null check (collection in ('config', 'counts', 'deliveries', 'orders')),
  id text not null,
  data jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (collection, id)
);
alter table public.inventory_docs enable row level security;
revoke all on public.inventory_docs from anon, authenticated;
comment on table public.inventory_docs is 'Campus Creamery inventory app. Read and written only by the inventory edge function.';
