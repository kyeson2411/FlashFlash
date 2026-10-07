import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { safeNextPath } from "@/lib/auth/validate";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";

const OTP_TYPES = new Set<string>([
  "signup",
  "invite",
  "magiclink",
  "recovery",
  "email_change",
  "email",
]);

function loginUrl(request: NextRequest, params: Record<string, string>) {
  const url = new URL("/login", request.url);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return url;
}

// Completes email confirmation (token_hash) or the PKCE code exchange, then
// stores the session cookie. This route is public: the student is not signed in yet.
export async function GET(request: NextRequest) {
  const next = safeNextPath(request.nextUrl.searchParams.get("next"));

  if (!isSupabaseConfigured()) {
    return NextResponse.redirect(loginUrl(request, { next }));
  }

  const tokenHash = request.nextUrl.searchParams.get("token_hash");
  const type = request.nextUrl.searchParams.get("type");
  const code = request.nextUrl.searchParams.get("code");
  const authError = request.nextUrl.searchParams.get("error");

  if (authError) {
    return NextResponse.redirect(loginUrl(request, { error: "confirm" }));
  }

  try {
    const supabase = await createClient();

    if (code) {
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (error) {
        console.error("[auth] confirm code:", error.message);
      } else {
        return NextResponse.redirect(await afterConfirm(supabase, request, next));
      }
    } else if (tokenHash && type && OTP_TYPES.has(type)) {
      const { error } = await supabase.auth.verifyOtp({
        type: type as EmailOtpType,
        token_hash: tokenHash,
      });
      if (error) {
        console.error("[auth] confirm otp:", error.message);
      } else {
        return NextResponse.redirect(await afterConfirm(supabase, request, next));
      }
    }
  } catch (error) {
    console.error("[auth] confirm failed:", error instanceof Error ? error.message : "unknown");
  }

  return NextResponse.redirect(loginUrl(request, { error: "confirm" }));
}

async function afterConfirm(
  supabase: Awaited<ReturnType<typeof createClient>>,
  request: NextRequest,
  next: string,
) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) return new URL(next, request.url);
  return loginUrl(request, { confirmed: "1" });
}
