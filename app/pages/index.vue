<script setup lang="ts">
const username = useState<string>("username", () => "");

function goToChatroom() {
  console.log(username.value);
  if (!username.value.trim()) return;
  navigateTo("/chatroom");
}
</script>

<template>
  <main class="max-w-md mx-auto p-4">
    <h1 class="text-2xl font-bold mb-4">HSLU Chat</h1>

    <form action="" @submit.prevent="goToChatroom">
      <label class="block text-sm font-medium text-gray-700" for="username"
        >Enter Your Username</label
      >
      <input
        class="border-2 border-gray-300 rounded-md p-2"
        v-model="username"
        type="text"
      />
      <button class="bg-blue-500 text-white rounded-md p-2" type="submit">
        Submit
      </button>
    </form>
  </main>
</template>
