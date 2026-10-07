import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getSupabaseEnv, SESSION_COOKIE_OPTIONS } from "./env";

export class NotConfiguredError extends Error {
  constructor() {
    super("Supabase is not configured (SUPABASE_URL / SUPABASE_ANON_KEY are missing).");
    this.name = "NotConfiguredError";
  }
}

// A Supabase client that acts as the signed-in student, using the session cookie of
// the current request. Row Level Security is enforced for everything it does.
//
// Create one per request (never share it between requests). Reading cookies is
// request-time data, so callers must be inside a <Suspense> boundary, a Server
// Action, or a Route Handler.
export async function createClient() {
  const env = getSupabaseEnv();
  if (!env) throw new NotConfiguredError();

  const cookieStore = await cookies();

  return createServerClient(env.url, env.anonKey, {
    cookieOptions: SESSION_COOKIE_OPTIONS,
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, { ...options, ...SESSION_COOKIE_OPTIONS, maxAge: options.maxAge === 0 ? 0 : SESSION_COOKIE_OPTIONS.maxAge });
          }
        } catch {
          // Called from a Server Component, where cookies cannot be written.
          // That is fine: proxy.ts refreshes the session on every request.
        }
      },
    },
  });
}
