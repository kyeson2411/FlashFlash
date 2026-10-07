import "server-only";

// Supabase connection settings. Both values are read on the server only: the browser
// never talks to Supabase directly, so neither one is ever sent to the client.
//
// SUPABASE_ANON_KEY is the project's public "anon" / "publishable" key. It is safe
// by design because Row Level Security decides what a signed-in student can reach.
// The service-role key is deliberately NOT used anywhere in this app.

export type SupabaseEnv = { url: string; anonKey: string };

export function getSupabaseEnv(): SupabaseEnv | null {
  const url = process.env.SUPABASE_URL?.trim();
  const anonKey = process.env.SUPABASE_ANON_KEY?.trim();
  if (!url || !anonKey) return null;

  try {
    new URL(url);
  } catch {
    return null;
  }

  return { url, anonKey };
}

export function isSupabaseConfigured(): boolean {
  return getSupabaseEnv() !== null;
}

// The session cookie. HttpOnly keeps it out of reach of page scripts. It lasts 7 days
// and is renewed while the student keeps using the app, because school computers are
// often shared and the default (400 days) is far too long.
export const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

export const SESSION_COOKIE_OPTIONS = {
  path: "/",
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  maxAge: SESSION_MAX_AGE_SECONDS,
};
