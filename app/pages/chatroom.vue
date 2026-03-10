<script setup lang="ts">
import type { RealtimeChannel } from "@supabase/supabase-js";

interface ChatMessage {
  username: string;
  text: string;
  createdAt: string;
}

const username = useState<string>("username", () => "");
const messageText = useState<string>("messageText", () => "");
const messages = ref<ChatMessage[]>([]);
const realtimechannel = ref<RealtimeChannel | null>(null);
const connectionStatus = ref<string>("disconnected");
const onlineUsers = ref<{ username: string; onlineAt: string }[]>([]);
const supabase = useSupabaseClient();

async function sendMessage() {
  const text = messageText.value.trim();
  if (!text || !realtimechannel.value) return;

  const payload: ChatMessage = {
    username: username.value,
    text,
    createdAt: new Date().toISOString(),
  };

  // ✅ CHANGED: broadcast + insert at the same time
  await Promise.all([
    realtimechannel.value.send({
      type: "broadcast",
      event: "message",
      payload,
    }),
    supabase.from("messages").insert({
      username: payload.username,
      text: payload.text,
      created_at: payload.createdAt,
    }),
  ]);

  messageText.value = "";
}

onMounted(async () => {
  if (!username.value) {
    await navigateTo("/");
    return;
  }

  // ✅ NEW: fetch message history
  const { data } = await supabase
    .from("messages")
    .select("*")
    .order("created_at", { ascending: true })
    .limit(50);
  messages.value = (data ?? []).map((row) => ({
    username: row.username,
    text: row.text,
    createdAt: row.created_at,
  }));

  //configure channel object (behavior in the ref)
  realtimechannel.value = supabase
    .channel("room:classroom", { config: { broadcast: { self: true } } })
    .on("broadcast", { event: "message" }, ({ payload }) => {
      messages.value.push(payload as ChatMessage);
      console.log(messages.value);
    })
    .on("presence", { event: "sync" }, () => {
      const state = realtimechannel.value?.presenceState<{
        username: string;
        onlineAt: string;
      }>();
      console.log(state);
      onlineUsers.value = Object.values(state ?? {}).flat();
      console.log(onlineUsers.value);
    })
    .subscribe((status) => {
      connectionStatus.value = status;
      if (status === "SUBSCRIBED") {
        realtimechannel.value?.track({
          username: username.value,
          onlineAt: new Date().toISOString(),
        });
      }
    });
});

onUnmounted(() => {
  realtimechannel.value?.unsubscribe();
});
</script>

<template>
  <div>{{ onlineUsers.length }} online</div>
  <div v-for="user in onlineUsers" :key="user.username">
    {{ user.username }}
  </div>
  <div class="max-w-md mx-auto p-4">
    <h1 class="text-2xl font-bold mb-4">Chatroom</h1>
    <p class="text-sm text-gray-500 mb-4">Welcome, {{ username }}!</p>

    <div>{{ messages.length }} messages</div>
    <div v-for="message in messages" :key="message.createdAt">
      <p>{{ message.username }}: {{ message.text }}</p>
    </div>

    <form @submit.prevent="sendMessage">
      <input
        class="border-2 border-gray-300 rounded-md p-2"
        v-model="messageText"
        type="text"
      />
      <button class="bg-blue-500 text-white rounded-md p-2" type="submit">
        Send
      </button>
    </form>
  </div>
</template>
