import { createBrowserClient } from "@supabase/ssr";
import { createNoopSupabaseClient, getSupabaseConfigErrorMessage } from "./no-op";

export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !anonKey) {
    console.warn(getSupabaseConfigErrorMessage());
    return createNoopSupabaseClient();
  }

  return createBrowserClient(url, anonKey);
}
