// app/composables/useSupabaseClient.ts
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

export const useSupabaseClient = () => {
  if (client) return client;

  const config = useRuntimeConfig();
  client = createClient(
    config.public.supabaseUrl,
    config.public.supabaseAnonKey,
  );
  return client;
};
