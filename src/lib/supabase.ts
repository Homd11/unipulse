import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// All database access goes through server routes and their cookie session checks.
export function getServiceSupabase(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key || url.includes("your-project-id") || key.startsWith("your-")) return null;
  return createClient(url, key, {
    db: { timeout: 10_000, retry: false },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: (input, init) => fetch(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(10_000) }) },
  });
}
