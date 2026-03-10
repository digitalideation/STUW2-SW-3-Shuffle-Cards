-- ─────────────────────────────────────────────────────────────────────────────
-- Run this in the Supabase SQL editor (fresh setup)
-- ─────────────────────────────────────────────────────────────────────────────

-- Drop and recreate if migrating from the old schema
drop table if exists public.games;
drop table if exists public.rooms;

create table public.games (
  id          text        primary key,           -- room code e.g. 'DEMO'
  status      text        not null default 'lobby',  -- 'lobby' | 'playing'
  players     jsonb       not null default '{}', -- { playerId: name }
  ready       jsonb       not null default '{}', -- { playerId: true }
  deck        jsonb       not null default '[]', -- remaining undealt cards
  hands       jsonb       not null default '{}', -- { playerId: [cards] }
  updated_at  timestamptz not null default now()
);

alter table public.games enable row level security;

create policy "anon_all" on public.games
  for all to anon using (true) with check (true);

-- Required for postgres_changes subscriptions
alter publication supabase_realtime add table public.games;
