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

-- ─────────────────────────────────────────────────────────────────────────────
-- Card Game (page 2)
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.games (
  id          text        primary key,        -- room code e.g. 'DEMO'
  deck        jsonb       not null default '[]'::jsonb,  -- remaining undealt cards
  hands       jsonb       not null default '{}'::jsonb,  -- { playerId: [cards] }
  updated_at  timestamptz not null default now()
);

alter table public.games enable row level security;

create policy "anon_all" on public.games
  for all to anon using (true) with check (true);

alter publication supabase_realtime add table public.games;

-- ─────────────────────────────────────────────────────────────────────────────
-- Shuffle Demo (page 1)
-- ─────────────────────────────────────────────────────────────────────────────

-- 4. Enable Realtime — required for postgres_changes subscriptions
--    In the dashboard: Table Editor → rooms → Enable Realtime toggle
--    OR run this:
alter publication supabase_realtime add table public.rooms;
