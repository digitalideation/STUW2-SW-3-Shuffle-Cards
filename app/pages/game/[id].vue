<script setup lang="ts">
import type { RealtimeChannel } from "@supabase/supabase-js";

// ─── Types ───────────────────────────────────────────────────────────────────
type GameState = {
  id: string;
  status: "lobby" | "playing";
  players: Record<string, string>; // playerId → name
  ready: Record<string, boolean>; // playerId → isReady
  deck: string[];
  hands: Record<string, string[]>; // playerId → cards
};

// ─── Identity ─────────────────────────────────────────────────────────────────
const route = useRoute();
const roomId = (route.params.id as string).toUpperCase();
const playerName = useState<string>("playerName", () => "Player");
const playerId = useState<string>(
  "playerId",
  () => `p-${Math.random().toString(36).slice(2, 8)}`,
);

// ─── Supabase ─────────────────────────────────────────────────────────────────
const supabase = useSupabaseClient();
const config = useRuntimeConfig();

// ─── State ────────────────────────────────────────────────────────────────────
const game = ref<GameState | null>(null);
const isConnected = ref(false);
const isJoining = ref(true);
const isSettingReady = ref(false);
const playingCard = ref<string | null>(null);
const actionError = ref<string | null>(null);

let channel: RealtimeChannel | null = null;

// ─── Helpers ──────────────────────────────────────────────────────────────────
function isRed(card: string) {
  return card.endsWith("♥") || card.endsWith("♦");
}

async function callFn(name: string, body: Record<string, unknown>) {
  const res = await fetch(`${config.public.supabaseUrl}/functions/v1/${name}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: config.public.supabaseAnonKey,
      Authorization: `Bearer ${config.public.supabaseAnonKey}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

// ─── Computed ─────────────────────────────────────────────────────────────────
const playerList = computed(() =>
  Object.entries(game.value?.players ?? {}).map(([id, name]) => ({
    id,
    name: name as string,
    isReady: !!game.value?.ready[id],
    cardCount: game.value?.hands[id]?.length ?? 0,
  })),
);

const myHand = computed(() => game.value?.hands[playerId.value] ?? []);
const amIReady = computed(() => !!game.value?.ready[playerId.value]);
const deckSize = computed(() => game.value?.deck.length ?? 0);
const readyCount = computed(
  () => playerList.value.filter((p) => p.isReady).length,
);
const otherPlayers = computed(() =>
  playerList.value.filter((p) => p.id !== playerId.value),
);
const needMorePlayers = computed(() => playerList.value.length < 2);

// ─── Actions ──────────────────────────────────────────────────────────────────
async function joinGame() {
  isJoining.value = true;
  actionError.value = null;
  try {
    await callFn("join-game", {
      roomId,
      playerId: playerId.value,
      playerName: playerName.value,
    });
  } catch (e: unknown) {
    actionError.value = e instanceof Error ? e.message : "Could not join";
  } finally {
    isJoining.value = false;
  }
}

async function setReady() {
  if (isSettingReady.value || amIReady.value) return;
  isSettingReady.value = true;
  actionError.value = null;
  try {
    await callFn("set-ready", { roomId, playerId: playerId.value });
  } catch (e: unknown) {
    actionError.value = e instanceof Error ? e.message : "Could not ready up";
  } finally {
    isSettingReady.value = false;
  }
}

async function playCard(card: string) {
  if (playingCard.value) return;
  playingCard.value = card;
  actionError.value = null;
  try {
    await callFn("play-card", { roomId, playerId: playerId.value, card });
  } catch (e: unknown) {
    actionError.value = e instanceof Error ? e.message : "Could not play card";
  } finally {
    playingCard.value = null;
  }
}

async function playAgain() {
  // Reset to lobby — all clients update via Realtime
  await supabase
    .from("games")
    .update({
      status: "lobby",
      ready: {},
      deck: [],
      hands: {},
      updated_at: new Date().toISOString(),
    })
    .eq("id", roomId);
}

// ─── Realtime ─────────────────────────────────────────────────────────────────
function subscribe() {
  channel = supabase.channel(`game:${roomId}`);

  channel
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "games",
        filter: `id=eq.${roomId}`,
      },
      (payload) => {
        game.value = payload.new as GameState;
      },
    )
    .subscribe((status) => {
      isConnected.value = status === "SUBSCRIBED";
    });
}

// ─── Lifecycle ────────────────────────────────────────────────────────────────
onMounted(async () => {
  // Subscribe first so we don't miss the join-game DB write
  subscribe();
  const { data } = await supabase
    .from("games")
    .select("*")
    .eq("id", roomId)
    .maybeSingle();
  if (data) game.value = data as GameState;
  await joinGame();
});

onUnmounted(() => channel?.unsubscribe());
</script>

<template>
  <div class="min-h-screen bg-slate-900 text-white flex flex-col">
    <!-- ── LOBBY ─────────────────────────────────────────────────────────── -->
    <template v-if="!game || game.status === 'lobby'">
      <div class="flex-1 flex items-center justify-center p-4">
        <div class="w-full max-w-sm space-y-6">
          <!-- Room badge -->
          <div class="text-center">
            <p class="text-slate-500 text-xs uppercase tracking-widest mb-1">
              Room
            </p>
            <h1
              class="text-4xl font-black font-mono text-white tracking-widest"
            >
              {{ roomId }}
            </h1>
            <p class="text-slate-500 text-xs mt-2">
              Share this code so others can join
            </p>
          </div>

          <!-- Player list -->
          <div class="bg-slate-800 rounded-2xl overflow-hidden">
            <div class="px-4 py-3 border-b border-slate-700">
              <p
                class="text-xs font-semibold text-slate-400 uppercase tracking-wider"
              >
                Players ({{ playerList.length }})
              </p>
            </div>

            <div
              v-if="isJoining"
              class="px-4 py-6 text-center text-slate-500 text-sm"
            >
              Joining…
            </div>

            <ul v-else class="divide-y divide-slate-700/50">
              <li
                v-for="p in playerList"
                :key="p.id"
                class="flex items-center justify-between px-4 py-3"
              >
                <div class="flex items-center gap-2">
                  <span
                    class="w-2 h-2 rounded-full shrink-0"
                    :class="p.isReady ? 'bg-emerald-400' : 'bg-slate-600'"
                  ></span>
                  <span class="text-sm font-medium">
                    {{ p.name }}
                    <span
                      v-if="p.id === playerId"
                      class="text-slate-500 text-xs"
                      >(you)</span
                    >
                  </span>
                </div>
                <span
                  class="text-xs font-semibold px-2 py-0.5 rounded-full"
                  :class="
                    p.isReady
                      ? 'bg-emerald-900 text-emerald-400'
                      : 'bg-slate-700 text-slate-500'
                  "
                >
                  {{ p.isReady ? "Ready ✓" : "Waiting…" }}
                </span>
              </li>

              <li
                v-if="!playerList.length"
                class="px-4 py-4 text-slate-500 text-sm text-center"
              >
                Connecting…
              </li>
            </ul>
          </div>

          <!-- Status message -->
          <p class="text-center text-sm text-slate-500">
            <template v-if="needMorePlayers">
              Need at least 2 players to start
            </template>
            <template v-else-if="readyCount < playerList.length">
              {{ readyCount }} / {{ playerList.length }} ready — waiting for
              everyone…
            </template>
            <template v-else> All players ready — starting… </template>
          </p>

          <!-- Ready button -->
          <button
            @click="setReady"
            :disabled="amIReady || isSettingReady || isJoining || !isConnected"
            class="w-full py-3 rounded-xl font-bold text-sm transition-all"
            :class="
              amIReady
                ? 'bg-emerald-900 text-emerald-400 cursor-default'
                : 'bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 disabled:text-slate-500 text-white'
            "
          >
            <span
              v-if="isSettingReady"
              class="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin mr-2"
            ></span>
            {{ amIReady ? "✓ You are ready" : "I'm Ready" }}
          </button>

          <p v-if="actionError" class="text-red-400 text-xs text-center">
            {{ actionError }}
          </p>

          <!-- Connection indicator -->
          <div
            class="flex items-center justify-center gap-1.5 text-xs text-slate-600"
          >
            <span
              class="w-1.5 h-1.5 rounded-full"
              :class="
                isConnected ? 'bg-emerald-500' : 'bg-yellow-500 animate-pulse'
              "
            ></span>
            {{ isConnected ? "Connected" : "Connecting…" }}
          </div>
        </div>
      </div>
    </template>

    <!-- ── GAME ──────────────────────────────────────────────────────────── -->
    <template v-else>
      <!-- Header -->
      <header
        class="flex items-center justify-between px-4 py-3 bg-emerald-950/80 border-b border-white/10 shrink-0"
      >
        <span
          class="font-mono font-bold text-emerald-400 tracking-widest text-sm"
          >{{ roomId }}</span
        >

        <!-- Other players card counts -->
        <div class="flex items-center gap-3">
          <div
            v-for="p in otherPlayers"
            :key="p.id"
            class="flex items-center gap-1.5 text-sm"
          >
            <span class="text-white/50">{{ p.name }}:</span>
            <span class="font-bold">{{ p.cardCount }}</span>
            <span class="text-white/30 text-xs">cards</span>
          </div>
        </div>

        <!-- Deck -->
        <div class="flex items-center gap-2 text-sm">
          <span class="text-white/40">Deck</span>
          <span
            class="font-bold tabular-nums px-2 py-0.5 rounded"
            :class="
              deckSize === 0
                ? 'text-red-400 bg-red-950'
                : 'text-white bg-white/10'
            "
            >{{ deckSize }}</span
          >
        </div>
      </header>

      <!-- Table -->
      <main
        class="flex-1 bg-emerald-950 flex flex-col items-center justify-center gap-8 p-6 overflow-auto"
      >
        <!-- Other players face-down hands -->
        <div v-if="otherPlayers.length" class="flex gap-8">
          <div
            v-for="p in otherPlayers"
            :key="p.id"
            class="flex flex-col items-center gap-2"
          >
            <span class="text-xs text-white/40 font-medium">{{ p.name }}</span>
            <div class="flex gap-1">
              <div
                v-for="i in p.cardCount"
                :key="i"
                class="w-12 h-[4.5rem] rounded-lg border border-white/10 shadow"
                style="
                  background: repeating-linear-gradient(
                    135deg,
                    #14532d,
                    #14532d 4px,
                    #166534 4px,
                    #166534 8px
                  );
                "
              ></div>
              <span
                v-if="p.cardCount === 0"
                class="text-white/20 text-xs self-center"
                >no cards</span
              >
            </div>
          </div>
        </div>

        <!-- Deck visual -->
        <div class="flex flex-col items-center gap-1">
          <div class="relative w-14 h-[4.5rem]">
            <div
              v-for="i in Math.min(deckSize, 5)"
              :key="i"
              class="absolute inset-0 rounded-lg border border-white/10"
              style="
                background: repeating-linear-gradient(
                  135deg,
                  #14532d,
                  #14532d 4px,
                  #166534 4px,
                  #166534 8px
                );
              "
              :style="{ transform: `translateY(${-(i - 1) * 1.5}px)` }"
            ></div>
            <div
              v-if="deckSize === 0"
              class="inset-0 absolute flex items-center justify-center"
            >
              <span class="text-white/20 text-xl">∅</span>
            </div>
          </div>
          <span class="text-xs text-white/30">{{ deckSize }} left</span>
        </div>

        <!-- My hand -->
        <div class="flex flex-col items-center gap-3">
          <p class="text-xs text-white/30 uppercase tracking-wider">
            Your hand — tap to discard &amp; draw
          </p>

          <div class="flex gap-2 flex-wrap justify-center">
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
                    : 'hover:-translate-y-4 hover:shadow-2xl cursor-pointer',
              ]"
            >
              <div class="text-xs font-black leading-none">
                <div>{{ card.slice(0, -1) }}</div>
                <div class="text-[10px]">{{ card.slice(-1) }}</div>
              </div>
              <div class="text-lg font-bold w-full text-center leading-none">
                {{ card.slice(-1) }}
              </div>
              <div class="rotate-180 text-xs font-black leading-none">
                <div>{{ card.slice(0, -1) }}</div>
                <div class="text-[10px]">{{ card.slice(-1) }}</div>
              </div>

              <div
                v-if="playingCard === card"
                class="absolute inset-0 flex items-center justify-center rounded-xl bg-white/60"
              >
                <span
                  class="w-5 h-5 border-2 border-slate-400 border-t-slate-800 rounded-full animate-spin"
                ></span>
              </div>
              <div
                v-else
                class="absolute inset-x-0 bottom-0 h-6 flex items-center justify-center rounded-b-xl opacity-0 group-hover:opacity-100 transition-opacity bg-black/5"
              >
                <span class="text-[9px] font-bold text-current opacity-50"
                  >DISCARD</span
                >
              </div>
            </button>
          </div>

          <p v-if="myHand.length === 0" class="text-white/20 text-sm">
            No cards in hand
          </p>
          <p
            v-if="deckSize === 0 && myHand.length > 0"
            class="text-amber-400/70 text-xs"
          >
            Deck empty — discarded cards are gone
          </p>
        </div>
      </main>

      <!-- Footer -->
      <footer
        class="shrink-0 px-4 py-3 bg-emerald-950/80 border-t border-white/10 flex items-center justify-between"
      >
        <p v-if="actionError" class="text-red-400 text-xs">{{ actionError }}</p>
        <p v-else class="text-white/20 text-xs">
          {{ playerList.length }} players · {{ deckSize }} cards in deck
        </p>

        <button
          @click="playAgain"
          class="text-xs text-white/30 hover:text-white/60 transition-colors underline underline-offset-2"
        >
          Play again
        </button>
      </footer>
    </template>
  </div>
</template>
