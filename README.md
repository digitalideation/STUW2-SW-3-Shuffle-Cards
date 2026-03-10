# Supabase Realtime Live Chat (Single Room)

A minimal teaching demo using **Nuxt 4 + TypeScript + Tailwind CSS + Supabase Realtime**.

- **Broadcast** for real-time chat messages
- **Presence** for real-time online users
- **One fixed room only** (`#classroom`) to keep the example focused

> Messages are not persisted in the database. This is intentional for a clean Realtime-only demonstration.

---

## What Students Learn

1. How to connect a Nuxt app to Supabase with env variables
2. How to create and subscribe to a Realtime channel
3. How Broadcast and Presence differ
4. How to clean up channel subscriptions safely

---

## Step-by-Step Setup (Supabase GUI + Code)

### 1) Create a Supabase project (GUI)

1. Open [https://supabase.com](https://supabase.com)
2. Click **New Project**
3. Fill project details and create it

### 2) Copy project credentials (GUI)

In Supabase, go to **Settings → API** and copy:

- **Project URL** (example: `https://abcxyz.supabase.co`)
- **anon / public key**

### 3) Clone and install

```bash
git clone <your-repo-url>
cd STUW2-SW-2-Supabase-Realtime
pnpm install
```

### 4) Configure environment variables

```bash
cp .env.example .env
```

Then update `.env`:

```env
SUPABASE_URL=https://YOUR_PROJECT_ID.supabase.co
SUPABASE_ANON_KEY=your-anon-key-here
```

### 5) Run the app

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

### 6) Test in two tabs

1. Open two browser tabs
2. Enter different usernames
3. Join the same app (single fixed room `#classroom`)
4. Send messages and watch them appear in both tabs
5. Close one tab and see Presence update online users

---

## Minimal Architecture

```
app/
├── app.vue                        # Root shell
├── assets/css/main.css            # Tailwind import
├── components/
│   └── RealtimeChatRoom.vue       # Chat UI component
├── composables/
│   ├── useSupabase.ts             # Supabase client singleton
│   └── useClassroomChat.ts        # Realtime channel logic
└── pages/
    ├── index.vue                  # Username page
    └── chatroom.vue               # Dedicated chatroom page
nuxt.config.ts                     # Exposes SUPABASE_* in runtimeConfig
.env.example                       # Env template
```

---

## Core Realtime Flow

Inside `app/composables/useClassroomChat.ts`:

1. Create a channel:
   - `supabase.channel('room:classroom', ...)`
2. Listen for Broadcast messages:
   - `channel.on('broadcast', { event: 'message' }, ...)`
3. Listen for Presence sync:
   - `channel.on('presence', { event: 'sync' }, ...)`
4. Subscribe:
   - `channel.subscribe(...)`
5. Track user presence after subscribed:
   - `channel.track({ user, online_at })`
6. Send chat messages:
   - `channel.send({ type: 'broadcast', event: 'message', payload })`
7. Cleanup on leave/unmount:
   - `channel.unsubscribe()`

---

## Best-Practice Notes (Beginner Friendly)

- Keep the demo to one room so students focus on Realtime concepts first
- Use TypeScript interfaces for message and presence payloads
- Use a unique Presence key per browser tab/session
- Always unsubscribe in `onUnmounted` to avoid stale subscriptions
- Keep Broadcast payload shape small and predictable

---

## Troubleshooting

- **Missing env keys**: check `.env` and restart dev server
- **No realtime messages**: ensure both tabs are joined and connected
- **Online users wrong**: wait 1-2 seconds for Presence sync and check browser console
