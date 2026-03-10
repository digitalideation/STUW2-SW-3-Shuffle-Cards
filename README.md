# Realtime Multiplayer Card Game — Supabase + Nuxt 3

A teaching project demonstrating **server-authoritative state**, **Supabase Realtime**, and **Edge Functions** through a multiplayer card game. Players join a lobby, ready up simultaneously, receive a dealt hand, and discard cards from a shared deck — all in real time across any number of browser tabs or devices.

---

## Table of Contents

1. [What You Will Learn](#1-what-you-will-learn)
2. [Tech Stack](#2-tech-stack)
3. [Architecture Overview](#3-architecture-overview)
4. [The Core Problem: Why Not Just Use the Client?](#4-the-core-problem-why-not-just-use-the-client)
5. [Database Design](#5-database-design)
6. [How Supabase Realtime Works](#6-how-supabase-realtime-works)
7. [Edge Functions — Explained One by One](#7-edge-functions--explained-one-by-one)
8. [Client Architecture](#8-client-architecture)
9. [Game Flow — Step by Step](#9-game-flow--step-by-step)
10. [Project Structure](#10-project-structure)
11. [Setup Guide](#11-setup-guide)
12. [Key Concepts & Gotchas](#12-key-concepts--gotchas)
13. [Possible Extensions](#13-possible-extensions)

---

## 1. What You Will Learn

| Concept | Where it appears |
|---|---|
| **Server-authoritative state** | Edge Functions own all game logic; clients only display |
| **Supabase Realtime** (`postgres_changes`) | Every DB write is broadcast to all subscribed clients |
| **Supabase Edge Functions** | Deno-based serverless functions deployed at the edge |
| **JSONB columns as documents** | Storing dynamic game state (hands, players, ready map) |
| **Row-Level Security (RLS)** | Controlling who can read/write the `games` table |
| **Race conditions & why they matter** | The dealing problem: two clients must not draw the same card |
| **Lobby pattern** | Synchronising multiple players before a game begins |
| **Nuxt 3 Composition API** | `useState`, `useRuntimeConfig`, `onMounted`, `computed` |

---

## 2. Tech Stack

| Layer | Technology | Why |
|---|---|---|
| Frontend framework | [Nuxt 3](https://nuxt.com) (Vue 3) | SSR-capable, file-based routing, composables |
| Language | TypeScript | Type safety across client and edge functions |
| Styling | Tailwind CSS v4 | Utility-first, no build step for CSS |
| Backend / DB | [Supabase](https://supabase.com) | Postgres + Realtime + Edge Functions in one platform |
| Edge runtime | Deno (inside Supabase Edge Functions) | Fast cold starts, standard Web APIs |
| Realtime transport | WebSocket (managed by Supabase) | Sub-100ms delivery of DB change events |

---

## 3. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        BROWSER (Client)                         │
│                                                                 │
│  Nuxt 3 / Vue 3                                                 │
│  ┌──────────────┐    HTTP POST     ┌──────────────────────────┐ │
│  │  game/[id]   │ ───────────────▶ │   Supabase Edge Function │ │
│  │  .vue        │                  │   (join-game / set-ready  │ │
│  │              │ ◀─────────────── │    / play-card)           │ │
│  │              │    JSON response  └───────────┬──────────────┘ │
│  │              │                               │ UPDATE games    │
│  │              │                               ▼                 │
│  │              │              ┌────────────────────────────────┐ │
│  │              │◀─────────────│        Supabase Postgres       │ │
│  │              │  Realtime    │        games table             │ │
│  │              │  WebSocket   └────────────────────────────────┘ │
│  └──────────────┘    event                                        │
└─────────────────────────────────────────────────────────────────┘

        ┌──────────┐         ┌──────────┐         ┌──────────┐
        │ Player A │         │ Player B │         │ Player C │
        │ browser  │         │ browser  │         │ browser  │
        └────┬─────┘         └────┬─────┘         └────┬─────┘
             │                   │                     │
             └───────────────────┴─────────────────────┘
                         All subscribe to the same
                         postgres_changes channel
                         on the games table
```

### The golden rule

> **Clients never mutate game state directly. They call an Edge Function, which reads + validates + writes the DB. The DB write fires a Realtime event that updates every client simultaneously.**

This means:
- There is exactly **one source of truth**: the `games` row in Postgres
- No client can cheat by sending a fake deck or claiming cards they do not have
- Late-joining clients always get the correct state by reading from the DB

---

## 4. The Core Problem: Why Not Just Use the Client?

When you first think about a card game, the obvious approach is:

```
Client A shuffles → sends result to Client B via WebSocket
```

This breaks in multiple ways.

### Problem 1: No persistence

If Client B refreshes the page, the WebSocket message is gone. There is no state stored anywhere. The game is lost.

### Problem 2: No authority

Who decides what a valid shuffle is? If Client A sends a deck with 53 cards, or two Ace of Spades, Client B has no way to verify it. The server must be the referee.

### Problem 3: Race conditions in dealing

Imagine both players click "Draw a card" at the same millisecond. Without server-side serialisation, they could both read the same top card from the deck and take it. Now two players hold the same card.

### The solution: server-authoritative Edge Functions

```
Client A clicks "Draw" ──▶ POST /play-card
                                │
                         Edge Function reads deck from DB
                         removes card from deck atomically
                         adds card to player's hand
                         writes updated state back to DB
                                │
                         DB triggers Realtime event
                                │
                    ┌───────────┴───────────┐
                    ▼                       ▼
              Client A updates         Client B updates
```

The Edge Function is the only thing that ever writes to the `games` table. Clients only ever *read* (via Realtime) and *request actions* (via HTTP POST).

---

## 5. Database Design

### The `games` table

```sql
create table public.games (
  id          text        primary key,           -- e.g. 'DEMO'
  status      text        not null default 'lobby',
  players     jsonb       not null default '{}',
  ready       jsonb       not null default '{}',
  deck        jsonb       not null default '[]',
  hands       jsonb       not null default '{}',
  updated_at  timestamptz not null default now()
);
```

### Why JSONB instead of separate tables?

A natural first instinct is to normalise this into multiple tables:

```sql
-- "Normalised" approach — more complex, not better here
create table players   (id text, game_id text, name text);
create table hands     (player_id text, card text, position int);
create table deck_cards(game_id text, card text, position int);
```

The normalised approach would require:
- **52 rows** inserted/deleted per shuffle
- **Transactional updates** across three tables on every card play
- **JOIN queries** every time you read the game state

The JSONB approach treats the entire game state as **one atomic document** per room. Since you always read the whole state and write the whole state, this is both simpler and faster.

Use a separate table when you need to **query individual items** (e.g. "find all games containing the Ace of Spades"). Use JSONB when you always operate on the **collection as a whole**.

### What the data actually looks like

A game in progress in the `games` table:

```json
{
  "id": "DEMO",
  "status": "playing",
  "players": {
    "p-abc123": "Alice",
    "p-xyz789": "Bob"
  },
  "ready": {
    "p-abc123": true,
    "p-xyz789": true
  },
  "deck": ["3♣","8♥","Q♦","2♠","J♣","7♥","..."],
  "hands": {
    "p-abc123": ["A♠","K♥","7♦","3♣","Q♠","9♥","2♦"],
    "p-xyz789": ["5♣","J♥","4♦","8♠","10♣","6♥","A♦"]
  },
  "updated_at": "2026-03-10T14:23:01.000Z"
}
```

A game in the lobby:

```json
{
  "id": "DEMO",
  "status": "lobby",
  "players": { "p-abc123": "Alice" },
  "ready": {},
  "deck": [],
  "hands": {},
  "updated_at": "2026-03-10T14:22:55.000Z"
}
```

### Row-Level Security (RLS)

RLS is Postgres's mechanism for controlling which rows a client can access. Even with a public-facing API key, a client can only do what the policies allow.

```sql
alter table public.games enable row level security;

create policy "anon_all" on public.games
  for all            -- applies to SELECT, INSERT, UPDATE, DELETE
  to anon            -- for unauthenticated (anonymous) users
  using (true)       -- all rows are readable
  with check (true); -- all writes are allowed
```

In this demo, we allow everything for anonymous users. In a production game you would restrict this — for example, only allowing a player to update their own hand row, or only allowing authenticated users.

> **Important**: RLS applies to the **PostgREST API** (what the Supabase JS client uses). It does **not** apply inside Edge Functions that use the `service_role` key — those bypass RLS entirely. This is intentional: Edge Functions are trusted server code.

### Enabling Realtime

Supabase Realtime uses Postgres **logical replication** to watch for changes. You opt tables into replication explicitly:

```sql
alter publication supabase_realtime add table public.games;
```

Without this line, `postgres_changes` subscriptions will not receive events for the `games` table, and the client will never update.

---

## 6. How Supabase Realtime Works

### The plumbing

```
Your app writes to Postgres
        │
        ▼
Postgres writes to its Write-Ahead Log (WAL)
        │
        ▼ (logical replication)
Supabase Realtime server reads the WAL
        │
        ▼
Realtime server finds all active WebSocket connections
subscribed to changes on this table/row
        │
        ▼
Pushes the new row data to every matching subscriber
```

The Write-Ahead Log (WAL) is Postgres's internal audit trail. Every insert, update, and delete is recorded there before it takes effect. Supabase Realtime tails this log and turns it into WebSocket messages.

### How the client subscribes

```typescript
const channel = supabase.channel('game:DEMO')

channel
  .on(
    'postgres_changes',
    {
      event: '*',               // INSERT, UPDATE, or DELETE
      schema: 'public',
      table: 'games',
      filter: `id=eq.DEMO`     // only this room's row
    },
    (payload) => {
      // payload.new = the full updated row
      // payload.old = the row before the change
      game.value = payload.new as GameState
    }
  )
  .subscribe()
```

Every time any Edge Function writes to the `games` row for room `DEMO`, every subscribed client (in any browser, on any device) immediately receives `payload.new` — the complete updated row — and re-renders.

### Why this is powerful for demos

The key insight to demonstrate: **the client does not poll**. There is no `setInterval(() => fetchFromDB(), 1000)`. The update arrives within milliseconds of the DB write, pushed over a persistent WebSocket connection. Open four browser tabs in the same room and watch all four hands update simultaneously when someone discards a card.

---

## 7. Edge Functions — Explained One by One

Edge Functions are TypeScript/Deno functions deployed globally on Supabase's infrastructure. They run close to the user (low latency) and have access to `SUPABASE_SERVICE_ROLE_KEY`, which bypasses RLS — giving them full trusted access to the database.

### How Edge Functions are called from the client

```typescript
const res = await fetch(`${SUPABASE_URL}/functions/v1/join-game`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'apikey': SUPABASE_ANON_KEY,
    'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
  },
  body: JSON.stringify({ roomId, playerId, playerName }),
})
```

### CORS preflight

Browsers send an HTTP `OPTIONS` request before every cross-origin POST. Edge Functions must handle this explicitly:

```typescript
if (req.method === 'OPTIONS') {
  return new Response('ok', {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    }
  })
}
```

Without this, every fetch call from the browser will fail with a CORS error before the actual request is even sent.

---

### `join-game`

**Purpose**: Register a player in the room. Called on page load when a player navigates to `/game/DEMO`.

**Input**:
```json
{ "roomId": "DEMO", "playerId": "p-abc123", "playerName": "Alice" }
```

**Logic**:
```
Does the games row for this roomId exist?
│
├── No  → INSERT new row:
│         status = 'lobby'
│         players = { "p-abc123": "Alice" }
│         ready = {}, deck = [], hands = {}
│
└── Yes → Is status still 'lobby'?
          │
          ├── Yes → Merge this player into the existing players map:
          │         players = { ...existing.players, "p-abc123": "Alice" }
          │         UPDATE games SET players = ...
          │
          └── No  → Game already started; do nothing (spectator)
```

**Why merge instead of replace?**

A naive upsert (`INSERT ... ON CONFLICT DO UPDATE SET players = '{"p-abc123":"Alice"}'`) would overwrite the `players` JSONB and erase Bob who joined first. The edge function reads the existing map, adds the new player, and writes the merged result back.

**Output**: `{ "ok": true }`

The DB write triggers a Realtime event → all lobby clients see the new player appear.

---

### `set-ready`

**Purpose**: Mark a player as ready. If every registered player is now ready (and there are at least two), deal cards and start the game.

**Input**:
```json
{ "roomId": "DEMO", "playerId": "p-abc123" }
```

**Logic**:
```
Read full game state from DB

Mark this player ready:
  ready = { ...existing.ready, "p-abc123": true }

Are ALL players in `players` also in `ready` with value true?
AND is the player count >= 2?
│
├── No  → UPDATE games SET ready = ...
│         (Realtime fires → lobby shows updated ready indicators)
│
└── Yes →
      1. Create a fresh 52-card deck
      2. Fisher-Yates shuffle (server-side randomness)
      3. Deal 7 cards to each player:
            hands["p-abc123"] = deck.splice(0, 7)
            hands["p-xyz789"] = deck.splice(0, 7)
            (deck now has 52 - 14 = 38 cards remaining)
      4. UPDATE games SET
            status = 'playing',
            ready  = ...,
            deck   = [...38 cards],
            hands  = { "p-abc123": [...7], "p-xyz789": [...7] }
      (ONE Realtime event fires → ALL clients switch from lobby to game view)
```

**The Fisher-Yates shuffle** (server-side):

```typescript
function fisherYates(arr: string[]): string[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}
```

This is a mathematically fair shuffle — every permutation of 52 cards is equally probable. Running it server-side means the client has zero influence over the randomness and cannot predict or manipulate the outcome.

**Dealing cards**:

```typescript
const deck = fisherYates(createDeck())  // shuffled array of 52 strings

for (const id of playerIds) {
  hands[id] = deck.splice(0, 7)  // removes first 7 from array, returns them
}
// deck now contains only the remaining undealt cards
```

`Array.splice(0, 7)` mutates the array in place — after dealing to all players, `deck` is the draw pile.

**Output**: `{ "ok": true, "started": true | false }`

---

### `play-card`

**Purpose**: A player discards one card from their hand and draws a replacement from the top of the shared deck.

**Input**:
```json
{ "roomId": "DEMO", "playerId": "p-abc123", "card": "A♠" }
```

**Logic**:
```
Read current game state (deck + hands) from DB

Is "A♠" in hands["p-abc123"]?
│
└── No → return 400 Bad Request
         (player cannot play a card they do not hold — server validates this)

Remove "A♠" from the player's hand:
  hand.splice(hand.indexOf("A♠"), 1)

Is the deck non-empty?
│
├── Yes → draw = deck.shift()       // remove and return first element
│         hand.push(draw)           // add drawn card to hand
│         hand still has 7 cards
│
└── No  → no replacement drawn
          hand now has 6 cards (deck exhausted)

Write updated hands + deck to DB:
  UPDATE games SET hands = ..., deck = ...

Realtime fires → all clients update simultaneously
```

**Read-modify-write pattern** — the full code:

```typescript
const deck  = game.deck  as string[]
const hands = game.hands as Record<string, string[]>
const hand  = hands[playerId]

// Validate
const idx = hand.indexOf(card)
if (idx === -1) return error('Card not in hand')

// Discard
hand.splice(idx, 1)

// Draw
const drawn = deck.length > 0 ? deck.shift()! : null
if (drawn) hand.push(drawn)

hands[playerId] = hand

// Persist — triggers Realtime for all clients
await supabase.from('games').update({ deck, hands }).eq('id', roomId)
```

> **Race condition note**: If two players discard simultaneously, two Edge Function invocations run in parallel. Both may read the same deck state and draw the same top card. For a teaching demo this is acceptable. In production, use a Postgres stored procedure with `SELECT ... FOR UPDATE` to lock the row for the duration of the operation.

**Output**: `{ "ok": true, "drew": "3♣", "deckRemaining": 23 }`

---

## 8. Client Architecture

### State management

The entire game state lives in one reactive ref, populated from the DB:

```typescript
const game = ref<GameState | null>(null)

// 1. Subscribe first (so no events are missed)
subscribe()

// 2. Fetch current state from DB (handles page refreshes and late joiners)
const { data } = await supabase.from('games').select('*').eq('id', roomId).maybeSingle()
if (data) game.value = data as GameState

// 3. Register player (causes a DB write → Realtime event → all clients update)
await joinGame()
```

The Realtime handler simply replaces the entire local state with the new row:

```typescript
channel.on('postgres_changes', { event: '*', ... }, (payload) => {
  game.value = payload.new as GameState  // full row, not a diff
})
```

### Computed properties

All derived state is computed from `game.value` — nothing is stored separately:

```typescript
const myHand       = computed(() => game.value?.hands[playerId.value] ?? [])
const deckSize     = computed(() => game.value?.deck.length ?? 0)
const amIReady     = computed(() => !!game.value?.ready[playerId.value])
const playerList   = computed(() =>
  Object.entries(game.value?.players ?? {}).map(([id, name]) => ({
    id,
    name,
    isReady: !!game.value?.ready[id],
    cardCount: game.value?.hands[id]?.length ?? 0,
  }))
)
```

Because `game.value` is reactive, Vue automatically re-runs every computed value and re-renders the UI whenever the Realtime event updates it.

### Player identity

Each browser session generates a random player ID on first load:

```typescript
const playerId = useState<string>(
  'playerId',
  () => `p-${Math.random().toString(36).slice(2, 8)}`
)
```

`useState` in Nuxt is like Vue's `ref` but shared across all components during the same page session. It is **not** persisted across page refreshes — a refresh creates a new player ID. In a real app you would save this to `localStorage` (see Extensions).

### The two views: lobby and game

The single page component renders two completely different UIs based on `game.status`:

```vue
<template>
  <!-- Lobby: player list, ready indicators, Ready button -->
  <template v-if="!game || game.status === 'lobby'">
    ...
  </template>

  <!-- Game: your hand, other players face-down, deck counter -->
  <template v-else>
    ...
  </template>
</template>
```

The transition from lobby to game is **automatic**: when `set-ready` sets `status = 'playing'`, the Realtime event arrives and Vue reactively switches every client's view at the same moment — no page reload, no manual navigation.

---

## 9. Game Flow — Step by Step

### Phase 1: Joining

```
Player types "Alice" + room code "DEMO" → clicks Join
        │
navigateTo('/game/DEMO')
        │ onMounted
        ├── subscribe() — open WebSocket, listen for postgres_changes on games row
        ├── fetch current games row from DB (may not exist yet)
        └── POST /functions/v1/join-game
              { roomId:'DEMO', playerId:'p-abc', playerName:'Alice' }
                    │
             Edge Function:
             No existing row → INSERT new game (status='lobby')
                    │
             Realtime fires for all subscribers
                    │
             All clients: players = { "p-abc": "Alice" }
             Lobby shows: Alice — Waiting...
```

### Phase 2: Second player joins

```
Bob opens /game/DEMO in a different tab or device
Same flow → POST /functions/v1/join-game { playerId:'p-xyz', playerName:'Bob' }
        │
Edge Function:
Row exists, status='lobby' → merge Bob into players map
UPDATE games SET players = { "p-abc":"Alice", "p-xyz":"Bob" }
        │
Realtime fires
        │
Both Alice's and Bob's browsers:
  playerList = [{ name:'Alice', isReady:false }, { name:'Bob', isReady:false }]
```

### Phase 3: Ready system

```
Alice clicks "I'm Ready"
        │
POST /functions/v1/set-ready { playerId:'p-abc' }
        │
Edge Function: ready = { "p-abc": true }
Not all ready → UPDATE games SET ready = { "p-abc": true }
        │
Realtime fires
        │
Both browsers: Alice shows ✓ Ready, Bob shows Waiting...

Bob clicks "I'm Ready"
        │
POST /functions/v1/set-ready { playerId:'p-xyz' }
        │
Edge Function:
  ready = { "p-abc": true, "p-xyz": true }
  ALL players ready AND count >= 2
  → Fisher-Yates shuffle → deal 7 each
  UPDATE games SET
    status = 'playing',
    deck   = [38 remaining cards],
    hands  = { "p-abc": [7 cards], "p-xyz": [7 cards] }
        │
ONE Realtime event reaches ALL clients simultaneously
        │
Alice's browser → game view, myHand = [A♠, K♥, 7♦, ...]
Bob's browser   → game view, myHand = [5♣, J♥, 4♦, ...]
```

### Phase 4: Playing cards

```
Alice clicks card "A♠"
        │
playingCard.value = 'A♠'  ← card dims with spinner (loading state)
        │
POST /functions/v1/play-card { playerId:'p-abc', card:'A♠' }
        │
Edge Function:
  Validates: 'A♠' is in hands['p-abc'] ✓
  Removes 'A♠' from Alice's hand
  Draws '3♣' from top of deck
  hands['p-abc'] = [K♥, 7♦, 3♣, Q♠, 9♥, 2♦, 3♣]  ← still 7 cards
  deck now has 37 cards
  UPDATE games SET hands = ..., deck = ...
        │
Realtime fires
        │
Alice's browser: hand refreshes (A♠ gone, new card appeared)
Bob's browser:   Alice's card count still shows 7 in header
playingCard.value = null  ← spinner disappears
```

### Phase 5: Play again

```
Either player clicks "Play again"
        │
supabase.from('games').update({
  status: 'lobby',
  ready: {},
  deck: [],
  hands: {}
})
        │
Realtime fires
        │
ALL browsers: game.status = 'lobby' → lobby view renders
players map unchanged: Alice and Bob still registered
Both click Ready to start a new round
```

---

## 10. Project Structure

```
/
├── app/
│   ├── assets/css/
│   │   └── main.css              # Tailwind v4 import
│   ├── composables/
│   │   └── useSupabaseClient.ts  # Singleton Supabase JS client
│   ├── pages/
│   │   ├── index.vue             # Join form: name + room code
│   │   └── game/
│   │       └── [id].vue          # Lobby + game (one page, two views)
│   └── app.vue                   # Root layout: <NuxtPage />
│
├── supabase/
│   ├── schema.sql                # Run once in SQL editor to create DB
│   └── functions/
│       ├── join-game/
│       │   └── index.ts          # Register player in room
│       ├── set-ready/
│       │   └── index.ts          # Mark ready → auto-deal when all ready
│       └── play-card/
│           └── index.ts          # Discard + draw from shared deck
│
├── nuxt.config.ts                # Tailwind plugin, runtimeConfig for keys
├── .env                          # SUPABASE_URL + SUPABASE_ANON_KEY
└── package.json
```

---

## 11. Setup Guide

### Prerequisites

- Node.js 18+
- A [Supabase](https://supabase.com) project (free tier works fine)

### Step 1: Install dependencies

```bash
npm install
```

### Step 2: Configure environment variables

```bash
cp .env.example .env
```

Edit `.env`:
```env
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_ANON_KEY=sb_publishable_...
```

Find these in your Supabase dashboard under **Project Settings → API**.

### Step 3: Set up the database

In the Supabase dashboard, open the **SQL Editor** and run the full contents of `supabase/schema.sql`. This will:

- Drop and recreate the `games` table with all required columns
- Enable Row-Level Security with a permissive anon policy
- Add the table to the Realtime publication

> The `alter publication supabase_realtime add table public.games` line is critical. Without it, Realtime events will never fire.

### Step 4: Deploy Edge Functions

In the Supabase dashboard, go to **Edge Functions → New Function**.

For each function below:
1. Create it with the exact name listed
2. Paste the file contents into the online editor
3. Click **Deploy**
4. Open the function's **Settings** tab and **disable JWT verification**

| Function name | Source file |
|---|---|
| `join-game` | `supabase/functions/join-game/index.ts` |
| `set-ready` | `supabase/functions/set-ready/index.ts` |
| `play-card` | `supabase/functions/play-card/index.ts` |

> **Why disable JWT verification?**
> Supabase Edge Functions default to expecting a JWT Bearer token signed with your project's secret. The current Supabase anon key format (`sb_publishable_...`) is **not** a JWT — it is an opaque string. Disabling JWT verification allows the function to accept requests authenticated with the anon key. For production, you would use Supabase Auth to issue real JWTs and re-enable this setting.

### Step 5: Run locally

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Step 6: Test with two players

Open **two browser tabs** (or two different browsers/devices). Enter different names but the **same room code**. Both tabs should see each other in the lobby within a second. Click "I'm Ready" in both tabs and watch the game start simultaneously across both screens.

---

## 12. Key Concepts & Gotchas

### Subscribe before fetching

In `onMounted`:
```typescript
subscribe()                       // 1. open WebSocket subscription first
const { data } = await fetchDB()  // 2. fetch current state
await joinGame()                  // 3. register (causes a DB write → Realtime event)
```

If you fetch first and subscribe second, you risk missing the Realtime event that fires during `joinGame()`. By subscribing first, you are guaranteed to receive every update.

### `postgres_changes` sends the full row, not a diff

```typescript
channel.on('postgres_changes', { event: '*', ... }, (payload) => {
  game.value = payload.new as GameState  // entire updated row
})
```

You replace the entire local state with `payload.new`. You do not need to merge or diff — Supabase sends the complete row every time.

### JSONB merge requires read-then-write — it is not atomic

The pattern used in `join-game` and `play-card`:

```typescript
const existing = await db.select()   // read
const merged   = { ...existing, newField }  // modify in memory
await db.update(merged)              // write
```

Two concurrent requests could read the same state and one could overwrite the other's changes. For this demo, player registrations are infrequent enough that this is safe in practice. Card plays could theoretically collide if two players act within the same millisecond. See the Extensions section for the proper fix using Postgres row locking.

### The `service_role` key bypasses RLS — never expose it in the browser

```typescript
// Inside Edge Function — correct, server-side only
const supabase = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

// In the browser — NEVER do this
const supabase = createClient(url, 'eyJhbGciOiJ...service_role_key...')  // ❌
```

The service role key has unrestricted access to your entire database. It must only ever exist in server-side code. The anon key is the only key that should ever appear in client-side code.

### Player identity is lost on page refresh

`useState` in Nuxt persists state within the same JavaScript session. If a player refreshes the page, a new random `playerId` is generated and they appear as a new player in the lobby. The original player ID remains in the `players` JSONB but is now orphaned. For a classroom demo this is acceptable; for a real product, persist the ID in `localStorage`.

### Realtime filter uses PostgREST syntax

```typescript
filter: `id=eq.${roomId}`
```

This is the same filter syntax as the PostgREST query API. Other operators include `gt`, `lt`, `neq`, `in`, `is`. Complex filters (multiple conditions) are not yet supported in `postgres_changes` — you filter on one column only.

---

## 13. Possible Extensions

These are left as exercises.

### 1. Persist player identity across refreshes

Store `playerId` in `localStorage` so a player who refreshes the page can rejoin their hand:

```typescript
const stored = localStorage.getItem('playerId')
const playerId = ref(stored ?? `p-${Math.random().toString(36).slice(2, 8)}`)
localStorage.setItem('playerId', playerId.value)
```

### 2. Add Supabase Auth

Replace random player IDs with anonymous auth sessions:

```typescript
const { data } = await supabase.auth.signInAnonymously()
const playerId = data.user!.id  // stable UUID, persists across refreshes
```

Then tighten RLS policies so each player can only read their own hand, not others'.

### 3. Fix the race condition with a Postgres function

Replace the read-modify-write in `play-card` with a Postgres stored procedure that uses row locking:

```sql
create or replace function play_card(
  p_room_id   text,
  p_player_id text,
  p_card      text
) returns void language plpgsql as $$
declare
  game games%rowtype;
  hand jsonb;
  new_card text;
begin
  -- Lock the row for the duration of this transaction
  select * into game from games where id = p_room_id for update;

  hand := game.hands -> p_player_id;

  -- Validate card is in hand
  if not (hand ? p_card) then
    raise exception 'Card not in hand';
  end if;

  -- Remove card, draw replacement...
  -- update games set ...
end;
$$;
```

Called from the Edge Function as `supabase.rpc('play_card', { p_room_id, p_player_id, p_card })`.

### 4. Add game rules

The current `play-card` accepts any card at any time. Add validation for a specific game:

```typescript
// Example: must match suit or rank of top discard
const topDiscard = game.discard_pile.at(-1)
const validPlay  =
  card.slice(-1) === topDiscard.slice(-1) ||  // same suit
  card.slice(0, -1) === topDiscard.slice(0, -1) // same rank

if (!validPlay) return error('Invalid play — must match suit or rank')
```

### 5. Turn enforcement

Add `current_turn: string` (a player ID) to the games table. `play-card` checks `playerId === game.current_turn` before allowing the action, then rotates to the next player:

```typescript
const playerIds = Object.keys(game.players)
const currentIdx = playerIds.indexOf(game.current_turn)
const nextTurn = playerIds[(currentIdx + 1) % playerIds.length]
await db.update({ current_turn: nextTurn, ... })
```

### 6. Spectator mode

Players who navigate to a room with `status = 'playing'` currently see nothing useful. Show them a read-only view: deck size, each player's card count, and a live discard pile — powered by the same `postgres_changes` subscription they already have.

### 7. Reconnection handling

WebSocket connections drop occasionally on mobile networks. Handle reconnection gracefully:

```typescript
channel.subscribe((status) => {
  if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
    setTimeout(() => {
      channel.unsubscribe()
      subscribe()  // reconnect
    }, 2000)
  }
})
```

---

## Summary

This project demonstrates that real-time multiplayer is not fundamentally complex. It requires:

1. **One database row** as the single source of truth for all game state
2. **Server-side functions** that own all logic and are the only things that write to that row
3. **Realtime subscriptions** that push every DB change to every connected client instantly

The client's job is deliberately simple: display what the server says, and send requests when the user acts. Everything else — shuffling, dealing, validating, distributing — is the server's responsibility.

```
Client   =  display state  +  send requests
Server   =  validate       +  compute        +  persist
Database =  source of truth
Realtime =  delivery mechanism
```
