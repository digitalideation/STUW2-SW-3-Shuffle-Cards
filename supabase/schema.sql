-- Run this in your Supabase SQL editor before using the app.

-- 1. Create the rooms table
create table if not exists public.rooms (
  id          text        primary key,         -- e.g. 'DEMO'
  deck        jsonb       not null default '[]'::jsonb,  -- ordered array of card strings
  shuffled_at timestamptz not null default now()
);

-- 2. Enable Row Level Security
alter table public.rooms enable row level security;

-- 3. Allow anonymous read/write (demo — no auth required)
create policy "anon_all" on public.rooms
  for all
  to anon
  using (true)
  with check (true);

-- 4. Enable Realtime — required for postgres_changes subscriptions
--    In the dashboard: Table Editor → rooms → Enable Realtime toggle
--    OR run this:
alter publication supabase_realtime add table public.rooms;
