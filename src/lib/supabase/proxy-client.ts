import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseEnv, SESSION_COOKIE_OPTIONS } from "./env";

// Builds a Supabase client for proxy.ts. It can read and write the session cookie
// on the outgoing response so a refreshed token is stored before the page renders.

export function createProxyClient(request: NextRequest) {
  const env = getSupabaseEnv();
  if (!env) return { supabase: null, response: NextResponse.next({ request }) };

  let response = NextResponse.next({ request });

  const supabase = createServerClient(env.url, env.anonKey, {
    cookieOptions: SESSION_COOKIE_OPTIONS,
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, {
            ...options,
            ...SESSION_COOKIE_OPTIONS,
            maxAge: options.maxAge === 0 ? 0 : SESSION_COOKIE_OPTIONS.maxAge,
          });
        }
      },
    },
  });

  return { supabase, response };
}
