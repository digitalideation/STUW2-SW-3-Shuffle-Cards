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

-- ─────────────────────────────────────────────────────────────────────────────
-- Atomic play-card function (no race condition)
-- ─────────────────────────────────────────────────────────────────────────────
-- This runs entirely inside one Postgres transaction.
-- SELECT ... FOR UPDATE locks the row so no other call can read or write it
-- until this transaction commits. Two simultaneous discards are serialised:
-- the second one blocks at the SELECT until the first finishes, then sees
-- the already-updated deck and cannot draw the same card.

create or replace function play_card(
  p_room_id   text,
  p_player_id text,
  p_card      text
)
returns jsonb
language plpgsql
as $$
declare
  v_game     games%rowtype;
  v_hand     jsonb;
  v_deck     jsonb;
  v_card_idx int;
  v_drawn    text;
begin
  -- Lock the row for the duration of this transaction.
  -- Any concurrent call to play_card for the same room blocks here.
  select * into v_game
  from games
  where id = p_room_id
  for update;

  if not found then
    raise exception 'Game not found: %', p_room_id;
  end if;

  v_hand := v_game.hands -> p_player_id;
  v_deck := v_game.deck;

  if v_hand is null then
    raise exception 'Player % has no hand', p_player_id;
  end if;

  -- Find the 0-based index of the card in the player's hand array
  select (ordinality - 1)::int into v_card_idx
  from jsonb_array_elements_text(v_hand) with ordinality as t(card, ordinality)
  where card = p_card
  limit 1;

  if v_card_idx is null then
    raise exception 'Card % not in hand', p_card;
  end if;

  -- Remove the played card from the hand
  v_hand := v_hand - v_card_idx;

  -- Draw a replacement from the top of the deck (if any remain)
  if jsonb_array_length(v_deck) > 0 then
    v_drawn := v_deck ->> 0;                           -- get top card as text
    v_deck  := v_deck - 0;                             -- remove it from deck
    v_hand  := v_hand || jsonb_build_array(v_drawn);   -- append to hand
  end if;

  -- Write back — lock is released when this transaction commits
  update games
  set
    hands      = jsonb_set(v_game.hands, array[p_player_id], v_hand),
    deck       = v_deck,
    updated_at = now()
  where id = p_room_id;

  return jsonb_build_object(
    'drew',           v_drawn,
    'deck_remaining', jsonb_array_length(v_deck)
  );
end;
$$;
