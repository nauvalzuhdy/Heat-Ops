// Server-only Supabase client (§8). Uses the service_role key — bypasses RLS
// entirely, same guarantee as FORTYGUARD_API_KEY: this app has no auth system
// yet, and every Supabase read/write goes through a Next.js API route, never
// the client bundle.
import "server-only";
import { createClient } from "@supabase/supabase-js";

export const SITE_PHOTOS_BUCKET = "site-photos";

function supabaseUrl(): string {
  const url = process.env.SUPABASE_URL;
  if (!url) throw new Error("SUPABASE_URL is not set");
  return url;
}

function serviceRoleKey(): string {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
  return key;
}

export function getSupabaseServiceClient() {
  return createClient(supabaseUrl(), serviceRoleKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
    // supabase-js issues its requests through the ambient global `fetch`,
    // which Next.js patches to cache GET requests by URL. Without this, a
    // freshly saved `sites` row can be invisible to the very next read on
    // this same URL (e.g. the /analyst list right after Map View's save)
    // until some unrelated cache eviction — every table read here must
    // reflect the current DB state.
    global: { fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }) },
  });
}
