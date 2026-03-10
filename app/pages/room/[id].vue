<script setup lang="ts">
import type { RealtimeChannel } from '@supabase/supabase-js'

// ─── Types ───────────────────────────────────────────────────────────────────
type Card = string
type PresenceEntry = { name: string; player_id: string; joined_at: string }
type FlowStep = 'idle' | 'calling' | 'broadcasting'

// ─── Route & Identity ────────────────────────────────────────────────────────
const route = useRoute()
const roomId = (route.params.id as string).toUpperCase()

const playerName = useState<string>('playerName', () => 'Player')
const playerId = useState<string>('playerId', () => `p-${Math.random().toString(36).slice(2, 8)}`)

// ─── Supabase ─────────────────────────────────────────────────────────────────
const supabase = useSupabaseClient()
const config = useRuntimeConfig()

// ─── State ────────────────────────────────────────────────────────────────────
const deck = ref<Card[]>([])
const shuffledAt = ref<string | null>(null)
const flowStep = ref<FlowStep>('idle')
const isConnected = ref(false)
const players = ref<Record<string, PresenceEntry[]>>({})
const shuffleError = ref<string | null>(null)

let channel: RealtimeChannel | null = null

// ─── Deck helpers ─────────────────────────────────────────────────────────────
const SUITS = ['♠', '♥', '♦', '♣'] as const
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'] as const

function createDeck(): Card[] {
  return SUITS.flatMap(suit => RANKS.map(rank => `${rank}${suit}`))
}

function isRed(card: Card): boolean {
  return card.endsWith('♥') || card.endsWith('♦')
}

// ─── DB: fetch current room state (late-join persistence) ─────────────────────
async function fetchRoom() {
  const { data } = await supabase
    .from('rooms')
    .select('deck, shuffled_at')
    .eq('id', roomId)
    .maybeSingle()

  if (data?.deck?.length) {
    deck.value = data.deck as Card[]
    shuffledAt.value = data.shuffled_at
  } else {
    deck.value = createDeck() // unshuffled placeholder until first shuffle
  }
}

// ─── Realtime ─────────────────────────────────────────────────────────────────
function subscribeToRoom() {
  channel = supabase.channel(`room:${roomId}`, {
    config: {
      presence: { key: playerId.value },
    },
  })

  channel
    .on(
      // DB change → Realtime pushes the new row to all subscribed clients
      'postgres_changes',
      { event: '*', schema: 'public', table: 'rooms', filter: `id=eq.${roomId}` },
      (payload) => {
        const row = payload.new as { deck: Card[]; shuffled_at: string }
        deck.value = row.deck
        shuffledAt.value = row.shuffled_at
        flowStep.value = 'broadcasting'
        setTimeout(() => { flowStep.value = 'idle' }, 1200)
      }
    )
    .on('presence', { event: 'sync' }, () => {
      players.value = channel!.presenceState<PresenceEntry>()
    })
    .subscribe(async status => {
      isConnected.value = status === 'SUBSCRIBED'
      if (status === 'SUBSCRIBED') {
        await channel!.track({
          player_id: playerId.value,
          name: playerName.value,
          joined_at: new Date().toISOString(),
        })
      }
    })
}

// ─── Shuffle via Edge Function ────────────────────────────────────────────────
// The client does NOT shuffle. It just requests the server to do it.
// Flow: POST /functions/v1/shuffle-deck
//       → Edge Fn: Fisher-Yates shuffle (server-side)
//       → UPDATE rooms (persisted to DB)
//       → POST /realtime/v1/api/broadcast (HTTP broadcast to all WebSocket clients)
//       → All subscribed clients receive 'deck-shuffled' and update simultaneously
async function shuffleDeck() {
  if (flowStep.value !== 'idle' || !isConnected.value) return
  shuffleError.value = null
  flowStep.value = 'calling'

  try {
    const res = await fetch(
      `${config.public.supabaseUrl}/functions/v1/shuffle-deck`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': config.public.supabaseAnonKey,
          'Authorization': `Bearer ${config.public.supabaseAnonKey}`,
        },
        body: JSON.stringify({ roomId }),
      }
    )

    if (!res.ok) {
      const { error } = await res.json()
      throw new Error(error ?? `HTTP ${res.status}`)
    }

    flowStep.value = 'idle'
    // deck update arrives via Realtime broadcast from the Edge Function
  } catch (e: unknown) {
    shuffleError.value = e instanceof Error ? e.message : 'Unknown error'
    flowStep.value = 'idle'
  }
}

// ─── Computed ─────────────────────────────────────────────────────────────────
const playerList = computed(() =>
  Object.values(players.value)
    .flat()
    .sort((a, b) => a.joined_at.localeCompare(b.joined_at))
)

const lastShuffledLabel = computed(() =>
  shuffledAt.value ? new Date(shuffledAt.value).toLocaleTimeString() : null
)

// ─── Lifecycle ────────────────────────────────────────────────────────────────
onMounted(async () => {
  await fetchRoom()
  subscribeToRoom()
})

onUnmounted(() => {
  channel?.unsubscribe()
})
</script>

<template>
  <div class="min-h-screen bg-slate-900 text-white flex flex-col">

    <!-- Header -->
    <header class="flex items-center justify-between px-4 py-3 bg-slate-800 border-b border-slate-700 shrink-0">
      <div class="flex items-center gap-3">
        <NuxtLink to="/" class="text-slate-400 hover:text-white transition-colors text-sm">← Back</NuxtLink>
        <span class="text-slate-600">|</span>
        <span class="font-mono font-bold text-indigo-400 tracking-widest text-sm">{{ roomId }}</span>
      </div>

      <!-- Player presence badges -->
      <div class="flex items-center gap-2">
        <div
          v-for="p in playerList" :key="p.player_id"
          class="flex items-center gap-1.5 bg-slate-700 rounded-full px-2.5 py-1"
        >
          <span class="w-2 h-2 rounded-full bg-emerald-400 shrink-0"></span>
          <span class="text-xs font-medium text-slate-200">{{ p.name }}</span>
        </div>
        <span v-if="!playerList.length" class="text-xs text-slate-500">Connecting…</span>
      </div>

      <!-- Connection indicator -->
      <div class="flex items-center gap-1.5 text-xs">
        <span
          class="w-2 h-2 rounded-full shrink-0"
          :class="isConnected ? 'bg-emerald-400' : 'bg-yellow-400 animate-pulse'"
        ></span>
        <span class="text-slate-400">{{ isConnected ? 'Live' : 'Connecting' }}</span>
      </div>
    </header>

    <!-- Architecture flow diagram -->
    <div class="bg-slate-800/60 border-b border-slate-700/50 px-4 py-3">
      <div class="max-w-5xl mx-auto flex items-center justify-center gap-1 text-xs flex-wrap">

        <div
          class="flex items-center gap-1.5 px-3 py-1.5 rounded-full font-medium transition-all duration-300"
          :class="flowStep !== 'idle'
            ? 'bg-indigo-600 text-white'
            : 'bg-slate-700 text-slate-400'"
        >
          <span>🖱️</span> Click Shuffle
        </div>

        <span class="text-slate-600 font-mono">──POST──▶</span>

        <div
          class="flex items-center gap-1.5 px-3 py-1.5 rounded-full font-medium transition-all duration-300"
          :class="flowStep === 'calling'
            ? 'bg-amber-500 text-white'
            : 'bg-slate-700 text-slate-400'"
        >
          <span v-if="flowStep === 'calling'" class="w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin inline-block"></span>
          <span v-else>⚡</span>
          Edge Function
        </div>

        <span class="text-slate-600 font-mono">──▶</span>

        <div
          class="flex items-center gap-1.5 px-3 py-1.5 rounded-full font-medium transition-all duration-300"
          :class="flowStep === 'calling'
            ? 'bg-emerald-600 text-white'
            : 'bg-slate-700 text-slate-400'"
        >
          <span>🗄️</span> DB persisted
        </div>

        <span class="text-slate-600 font-mono">──▶</span>

        <div
          class="flex items-center gap-1.5 px-3 py-1.5 rounded-full font-medium transition-all duration-300"
          :class="flowStep === 'broadcasting'
            ? 'bg-purple-600 text-white animate-pulse'
            : 'bg-slate-700 text-slate-400'"
        >
          <span>📡</span> Realtime broadcast
        </div>

        <span class="text-slate-600 font-mono">──▶</span>

        <div
          class="flex items-center gap-1.5 px-3 py-1.5 rounded-full font-medium transition-all duration-300"
          :class="flowStep === 'broadcasting'
            ? 'bg-indigo-600 text-white'
            : 'bg-slate-700 text-slate-400'"
        >
          <span>👥</span> All {{ playerList.length }} clients update
        </div>
      </div>
    </div>

    <!-- Card grid -->
    <main class="flex-1 overflow-auto p-4 md:p-6">
      <div class="max-w-5xl mx-auto">

        <div class="flex items-center justify-between mb-4 text-xs text-slate-500">
          <span>{{ deck.length }} cards · position = shuffle order · shuffle runs server-side</span>
          <span v-if="lastShuffledLabel">Last shuffled at {{ lastShuffledLabel }}</span>
        </div>

        <!-- FLIP animation via TransitionGroup -->
        <TransitionGroup
          name="card"
          tag="div"
          class="grid gap-1.5"
          style="grid-template-columns: repeat(13, minmax(0, 1fr))"
        >
          <div
            v-for="card in deck"
            :key="card"
            class="aspect-[5/7] bg-white rounded-md shadow-md flex flex-col items-start justify-between p-1 select-none"
            :class="isRed(card) ? 'text-red-600' : 'text-slate-900'"
          >
            <div class="leading-none text-center w-full">
              <div class="text-[0.55rem] font-black leading-tight">{{ card.slice(0, -1) }}</div>
              <div class="text-[0.5rem] leading-tight">{{ card.slice(-1) }}</div>
            </div>
            <div class="text-[0.75rem] font-bold w-full text-center leading-none">
              {{ card.slice(-1) }}
            </div>
            <div class="rotate-180 leading-none text-center w-full">
              <div class="text-[0.55rem] font-black leading-tight">{{ card.slice(0, -1) }}</div>
              <div class="text-[0.5rem] leading-tight">{{ card.slice(-1) }}</div>
            </div>
          </div>
        </TransitionGroup>
      </div>
    </main>

    <!-- Footer -->
    <footer class="shrink-0 px-4 py-4 bg-slate-800 border-t border-slate-700 flex flex-col items-center gap-2">
      <div class="flex items-center gap-4">
        <button
          @click="shuffleDeck"
          :disabled="flowStep !== 'idle' || !isConnected"
          class="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-700 disabled:text-slate-500 text-white font-bold rounded-xl px-8 py-3 text-sm transition-colors shadow-lg"
        >
          <span v-if="flowStep === 'calling'" class="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
          <span v-else>🔀</span>
          {{ flowStep === 'calling' ? 'Asking server…' : flowStep === 'broadcasting' ? 'Broadcasting…' : 'Shuffle Deck' }}
        </button>

        <p class="text-slate-500 text-xs max-w-xs">
          Shuffle runs in a <strong class="text-slate-300">Supabase Edge Function</strong> —
          result is persisted to DB, then broadcast to all {{ playerList.length }}
          player{{ playerList.length !== 1 ? 's' : '' }} via Realtime WebSocket
        </p>
      </div>

      <p v-if="shuffleError" class="text-red-400 text-xs">Error: {{ shuffleError }}</p>
    </footer>
  </div>
</template>

<style scoped>
.card-move {
  transition: transform 0.5s cubic-bezier(0.25, 0.46, 0.45, 0.94);
}
.card-enter-active {
  transition: all 0.3s ease;
}
.card-leave-active {
  transition: all 0.2s ease;
  position: absolute;
}
.card-enter-from {
  opacity: 0;
  transform: scale(0.85);
}
.card-leave-to {
  opacity: 0;
}
</style>
