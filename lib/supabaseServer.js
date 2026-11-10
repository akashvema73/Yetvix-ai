import { createClient } from "@supabase/supabase-js";

// Har request par user ke token se client banta hai, taaki RLS user ke data tak hi limit rahe.
export function supabaseForToken(token) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  return createClient(
    url.startsWith("http") ? url : "https://placeholder.supabase.co",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "placeholder-key",
    { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false } }
  );
}
