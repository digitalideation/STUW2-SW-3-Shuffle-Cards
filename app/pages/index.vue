<script setup lang="ts">
const playerName = useState<string>('playerName', () => '')
const roomCode = ref('DEMO')

function join() {
  const name = playerName.value.trim()
  const room = roomCode.value.trim().toUpperCase()
  if (!name || !room) return
  navigateTo(`/game/${room}`)
}
</script>

<template>
  <main class="min-h-screen bg-slate-900 flex items-center justify-center p-4">
    <div class="w-full max-w-sm">

      <div class="text-center mb-8">
        <div class="text-6xl mb-3">🃏</div>
        <h1 class="text-3xl font-bold text-white tracking-tight">Card Game</h1>
        <p class="text-slate-500 mt-1 text-sm">Realtime multiplayer · Supabase</p>
      </div>

      <form @submit.prevent="join" class="bg-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
        <div>
          <label class="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
            Your Name
          </label>
          <input
            v-model="playerName"
            type="text"
            placeholder="e.g. Alice"
            maxlength="20"
            autocomplete="off"
            autofocus
            class="w-full bg-slate-700 text-white placeholder-slate-500 rounded-lg px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-emerald-500 transition"
          />
        </div>

        <div>
          <label class="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
            Room Code
          </label>
          <input
            v-model="roomCode"
            type="text"
            placeholder="e.g. DEMO"
            maxlength="12"
            autocomplete="off"
            @input="roomCode = roomCode.toUpperCase()"
            class="w-full bg-slate-700 text-white placeholder-slate-500 rounded-lg px-4 py-2.5 text-sm font-mono outline-none focus:ring-2 focus:ring-emerald-500 transition tracking-widest"
          />
        </div>

        <button
          type="submit"
          :disabled="!playerName.trim() || !roomCode.trim()"
          class="w-full bg-emerald-700 hover:bg-emerald-600 disabled:bg-slate-700 disabled:text-slate-500 text-white font-bold rounded-xl py-3 text-sm transition-colors"
        >
          Join Room →
        </button>
      </form>

      <p class="text-center text-slate-600 text-xs mt-6">
        All players join the same room code, then hit Ready
      </p>
    </div>
  </main>
</template>
