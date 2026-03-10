<script setup lang="ts">
import type { RealtimeChannel } from '@supabase/supabase-js'

// ─── Types ───────────────────────────────────────────────────────────────────
type GameState = { deck: string[]; hands: Record<string, string[]> }
type PresenceEntry = { name: string; player_id: string; joined_at: string }

// ─── Route & Identity ────────────────────────────────────────────────────────
const route = useRoute()
const roomId = (route.params.id as string).toUpperCase()

const playerName = useState<string>('playerName', () => 'Player')
const playerId = useState<string>('playerId', () => `p-${Math.random().toString(36).slice(2, 8)}`)

// ─── Supabase ─────────────────────────────────────────────────────────────────
const supabase = useSupabaseClient()
const config = useRuntimeConfig()

// ─── State ────────────────────────────────────────────────────────────────────
const game = ref<GameState | null>(null)
const players = ref<Record<string, PresenceEntry[]>>({})
const isConnected = ref(false)
const isDealing = ref(false)
const playingCard = ref<string | null>(null)
const actionError = ref<string | null>(null)

let channel: RealtimeChannel | null = null

// ─── Helpers ──────────────────────────────────────────────────────────────────
function isRed(card: string) {
  return card.endsWith('♥') || card.endsWith('♦')
}

// ─── DB: fetch current game state ─────────────────────────────────────────────
async function fetchGame() {
  const { data } = await supabase
    .from('games')
    .select('deck, hands')
    .eq('id', roomId)
    .maybeSingle()

  if (data) game.value = data as GameState
}

// ─── Realtime ─────────────────────────────────────────────────────────────────
function subscribeToRoom() {
  channel = supabase.channel(`game:${roomId}`, {
    config: { presence: { key: playerId.value } },
  })

  channel
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'games', filter: `id=eq.${roomId}` },
      (payload) => {
        game.value = payload.new as GameState
      }
    )
    .on('presence', { event: 'sync' }, () => {
      players.value = channel!.presenceState<PresenceEntry>()
    })
    .subscribe(async (status) => {
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

// ─── Deal hands ───────────────────────────────────────────────────────────────
async function dealHands() {
  if (isDealing.value || !isConnected.value) return
  isDealing.value = true
  actionError.value = null

  // Collect current player IDs from presence
  const playerIds = playerList.value.map(p => p.player_id)

  try {
    const res = await fetch(`${config.public.supabaseUrl}/functions/v1/deal-hands`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': config.public.supabaseAnonKey,
        'Authorization': `Bearer ${config.public.supabaseAnonKey}`,
      },
      body: JSON.stringify({ roomId, playerIds }),
    })
    if (!res.ok) {
      const { error } = await res.json()
      throw new Error(error ?? `HTTP ${res.status}`)
    }
  } catch (e: unknown) {
    actionError.value = e instanceof Error ? e.message : 'Deal failed'
  } finally {
    isDealing.value = false
  }
}

// ─── Play a card ──────────────────────────────────────────────────────────────
async function playCard(card: string) {
  if (playingCard.value || !isConnected.value) return
  playingCard.value = card
  actionError.value = null

  try {
    const res = await fetch(`${config.public.supabaseUrl}/functions/v1/play-card`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': config.public.supabaseAnonKey,
        'Authorization': `Bearer ${config.public.supabaseAnonKey}`,
      },
      body: JSON.stringify({ roomId, playerId: playerId.value, card }),
    })
    if (!res.ok) {
      const { error } = await res.json()
      throw new Error(error ?? `HTTP ${res.status}`)
    }
  } catch (e: unknown) {
    actionError.value = e instanceof Error ? e.message : 'Play failed'
  } finally {
    playingCard.value = null
  }
}

// ─── Computed ─────────────────────────────────────────────────────────────────
const playerList = computed(() =>
  Object.values(players.value).flat().sort((a, b) => a.joined_at.localeCompare(b.joined_at))
)

const myHand = computed(() => game.value?.hands[playerId.value] ?? [])

const otherPlayers = computed(() =>
  playerList.value
    .filter(p => p.player_id !== playerId.value)
    .map(p => ({ ...p, hand: game.value?.hands[p.player_id] ?? [] }))
)

const deckSize = computed(() => game.value?.deck.length ?? 0)
const gameDealt = computed(() => game.value !== null && Object.keys(game.value.hands).length > 0)
const deckEmpty = computed(() => gameDealt.value && deckSize.value === 0)

// ─── Lifecycle ────────────────────────────────────────────────────────────────
onMounted(async () => {
  await fetchGame()
  subscribeToRoom()
})

onUnmounted(() => channel?.unsubscribe())
</script>

<template>
  <div class="min-h-screen bg-emerald-950 text-white flex flex-col select-none">

    <!-- Header -->
    <header class="flex items-center justify-between px-4 py-3 bg-black/30 border-b border-white/10 shrink-0">
      <div class="flex items-center gap-3">
        <NuxtLink to="/" class="text-white/40 hover:text-white transition-colors text-sm">← Back</NuxtLink>
        <span class="text-white/20">|</span>
        <span class="font-mono font-bold text-emerald-400 tracking-widest text-sm">{{ roomId }}</span>
      </div>

      <!-- Deck counter -->
      <div class="flex items-center gap-2 text-sm">
        <span class="text-white/40">Deck</span>
        <span
          class="font-bold tabular-nums px-2 py-0.5 rounded"
          :class="deckEmpty ? 'text-red-400 bg-red-950' : 'text-white bg-white/10'"
        >
          {{ deckSize }} cards
        </span>
        <span v-if="deckEmpty" class="text-red-400 text-xs">empty!</span>
      </div>

      <!-- Connection + players -->
      <div class="flex items-center gap-2">
        <div v-for="p in playerList" :key="p.player_id"
          class="flex items-center gap-1.5 bg-white/10 rounded-full px-2.5 py-1"
          :class="p.player_id === playerId ? 'ring-1 ring-emerald-400' : ''"
        >
          <span class="w-2 h-2 rounded-full bg-emerald-400 shrink-0"></span>
          <span class="text-xs font-medium">{{ p.name }}</span>
          <span v-if="p.player_id === playerId" class="text-[10px] text-emerald-400">(you)</span>
        </div>
        <div class="flex items-center gap-1.5 text-xs ml-2">
          <span class="w-2 h-2 rounded-full"
            :class="isConnected ? 'bg-emerald-400' : 'bg-yellow-400 animate-pulse'"></span>
          <span class="text-white/40">{{ isConnected ? 'Live' : 'Connecting' }}</span>
        </div>
      </div>
    </header>

    <!-- Main table -->
    <main class="flex-1 flex flex-col overflow-hidden">

      <!-- Other players (top half) -->
      <div class="flex-1 flex items-start justify-center gap-8 p-6 overflow-auto">
        <div v-if="otherPlayers.length === 0 && !gameDealt"
          class="text-white/20 text-sm mt-8 text-center">
          <p class="text-4xl mb-3">🃏</p>
          <p>Waiting for players to join…</p>
          <p class="text-xs mt-1">Share the room code <span class="font-mono text-emerald-400">{{ roomId }}</span></p>
        </div>

        <div v-for="player in otherPlayers" :key="player.player_id" class="flex flex-col items-center gap-3">
          <span class="text-sm font-medium text-white/60">{{ player.name }}</span>

          <!-- Face-down hand -->
          <div class="relative" :style="{ width: `${Math.max(1, player.hand.length) * 18 + 56}px`, height: '80px' }">
            <div
              v-for="(_, i) in (player.hand.length ? player.hand : [])"
              :key="i"
              class="absolute w-14 h-20 rounded-lg border border-white/20 shadow-lg"
              style="background: repeating-linear-gradient(45deg, #1e3a5f, #1e3a5f 4px, #1a3255 4px, #1a3255 8px)"
              :style="{ left: `${i * 18}px` }"
            ></div>
            <div v-if="!player.hand.length" class="text-white/20 text-xs pt-6">no cards</div>
          </div>

          <span class="text-xs text-white/40">{{ player.hand.length }} card{{ player.hand.length !== 1 ? 's' : '' }}</span>
        </div>
      </div>

      <!-- Divider -->
      <div class="border-t border-white/10 mx-6"></div>

      <!-- My hand (bottom half) -->
      <div class="flex flex-col items-center gap-4 p-6">
        <p class="text-xs text-white/40 font-medium uppercase tracking-wider">Your hand — click to discard &amp; draw</p>

        <div v-if="!gameDealt" class="text-white/30 text-sm">
          No cards yet — deal to start
        </div>

        <div v-else-if="myHand.length === 0" class="text-white/30 text-sm">
          Your hand is empty
        </div>

        <div v-else class="flex gap-2 flex-wrap justify-center">
          <button
            v-for="card in myHand"
            :key="card"
            @click="playCard(card)"
            :disabled="!!playingCard || !isConnected"
            class="group relative w-16 h-24 bg-white rounded-xl shadow-xl flex flex-col items-start justify-between p-1.5 transition-all duration-150"
            :class="[
              isRed(card) ? 'text-red-600' : 'text-slate-900',
              playingCard === card
                ? 'opacity-40 scale-95'
                : playingCard
                  ? 'opacity-60'
                  : 'hover:-translate-y-3 hover:shadow-2xl hover:shadow-black/50 cursor-pointer'
            ]"
          >
            <!-- Card face -->
            <div class="text-xs font-black leading-none">
              <div>{{ card.slice(0, -1) }}</div>
              <div class="text-[10px]">{{ card.slice(-1) }}</div>
            </div>
            <div class="text-xl font-bold w-full text-center leading-none">{{ card.slice(-1) }}</div>
            <div class="rotate-180 text-xs font-black leading-none">
              <div>{{ card.slice(0, -1) }}</div>
              <div class="text-[10px]">{{ card.slice(-1) }}</div>
            </div>

            <!-- Spinner overlay while playing -->
            <div v-if="playingCard === card"
              class="absolute inset-0 flex items-center justify-center rounded-xl bg-white/60">
              <span class="w-5 h-5 border-2 border-slate-400 border-t-slate-800 rounded-full animate-spin"></span>
            </div>

            <!-- "Play" hover label -->
            <div v-else
              class="absolute inset-x-0 bottom-0 flex items-center justify-center h-7 rounded-b-xl bg-black/0 group-hover:bg-black/10 transition-colors">
              <span class="text-[10px] font-bold opacity-0 group-hover:opacity-60 transition-opacity">PLAY</span>
            </div>
          </button>
        </div>
      </div>
    </main>

    <!-- Footer -->
    <footer class="shrink-0 px-4 py-3 bg-black/30 border-t border-white/10 flex items-center justify-between">
      <p v-if="actionError" class="text-red-400 text-xs">{{ actionError }}</p>
      <p v-else-if="deckEmpty" class="text-amber-400 text-xs">Deck is empty — played cards are discarded</p>
      <p v-else class="text-white/30 text-xs">
        {{ playerList.length }} player{{ playerList.length !== 1 ? 's' : '' }} ·
        {{ deckSize }} cards remaining in deck
      </p>

      <button
        @click="dealHands"
        :disabled="isDealing || !isConnected || playerList.length === 0"
        class="flex items-center gap-2 bg-emerald-700 hover:bg-emerald-600 disabled:bg-white/10 disabled:text-white/30 text-white font-bold rounded-xl px-6 py-2 text-sm transition-colors"
      >
        <span v-if="isDealing" class="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
        <span v-else>🃏</span>
        {{ gameDealt ? 'Redeal' : 'Deal Hands' }}
      </button>
    </footer>
  </div>
</template>
