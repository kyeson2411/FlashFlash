"use server";

import { redirect } from "next/navigation";
import {
  AUTH_WINDOW_MS,
  LOGIN_ATTEMPT_LIMIT,
  REGISTER_ATTEMPT_LIMIT,
} from "@/lib/limits";
import {
  readLoginForm,
  readRegisterForm,
  registerMetadata,
  safeNextPath,
  validateLogin,
  validateRegister,
  type FieldErrors,
} from "@/lib/auth/validate";
import { clientKey, tooManyAttempts } from "@/lib/rate-limit";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";

export type AuthState = {
  errors?: FieldErrors;
  message?: string;
};

const GENERIC_REGISTER =
  "We couldn't create this account. If you already have one, sign in instead.";
const GENERIC_LOGIN = "Email or password is incorrect.";
const SLOW_DOWN = "Too many attempts. Please wait a few minutes and try again.";
const NOT_CONFIGURED = "The study database is not configured yet. Please contact the site owner.";

export async function register(_prev: AuthState | undefined, formData: FormData): Promise<AuthState> {
  if (!isSupabaseConfigured()) return { message: NOT_CONFIGURED };

  if (tooManyAttempts(await clientKey("register"), REGISTER_ATTEMPT_LIMIT, AUTH_WINDOW_MS)) {
    return { message: SLOW_DOWN };
  }

  const input = readRegisterForm(formData);
  const errors = validateRegister(input);
  if (Object.keys(errors).length > 0) return { errors };

  try {
    const supabase = await createClient();
    const origin = await appOrigin();
    const { data, error } = await supabase.auth.signUp({
      email: input.email,
      password: input.password,
      options: {
        data: registerMetadata(input),
        emailRedirectTo: `${origin}/auth/confirm`,
      },
    });

    if (error) {
      console.error("[auth] signUp:", error.name, error.message);
      return { message: mapRegisterError(error.message) };
    }

    // Email confirmation is on: there is no session yet.
    if (!data.session) {
      return {
        message: "Check your email to confirm your account, then sign in.",
      };
    }

    redirect("/dashboard");
  } catch (error) {
    if (isRedirect(error)) throw error;
    console.error("[auth] register failed:", error instanceof Error ? error.message : "unknown");
    return { message: GENERIC_REGISTER };
  }
}

export async function login(_prev: AuthState | undefined, formData: FormData): Promise<AuthState> {
  if (!isSupabaseConfigured()) return { message: NOT_CONFIGURED };

  if (tooManyAttempts(await clientKey("login"), LOGIN_ATTEMPT_LIMIT, AUTH_WINDOW_MS)) {
    return { message: SLOW_DOWN };
  }

  const input = readLoginForm(formData);
  const errors = validateLogin(input);
  if (Object.keys(errors).length > 0) return { errors };

  const next = safeNextPath(formData.get("next"));

  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.signInWithPassword({
      email: input.email,
      password: input.password,
    });

    if (error) {
      console.error("[auth] signIn:", error.name, error.message);
      if (/rate limit|too many/i.test(error.message)) return { message: SLOW_DOWN };
      return { message: GENERIC_LOGIN };
    }

    redirect(next);
  } catch (error) {
    if (isRedirect(error)) throw error;
    console.error("[auth] login failed:", error instanceof Error ? error.message : "unknown");
    return { message: GENERIC_LOGIN };
  }
}

export async function logout() {
  if (isSupabaseConfigured()) {
    try {
      const supabase = await createClient();
      await supabase.auth.signOut();
    } catch (error) {
      console.error("[auth] signOut:", error instanceof Error ? error.message : "unknown");
    }
  }
  redirect("/");
}

function mapRegisterError(message: string): string {
  if (/rate limit|too many/i.test(message)) return SLOW_DOWN;
  // Unique school ID, duplicate email, and check violations all become the same
  // sentence so the form cannot be used to discover existing accounts.
  return GENERIC_REGISTER;
}

async function appOrigin(): Promise<string> {
  const { headers } = await import("next/headers");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.includes("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

function isRedirect(error: unknown): boolean {
  return typeof error === "object" && error !== null && "digest" in error
    && typeof (error as { digest: unknown }).digest === "string"
    && String((error as { digest: string }).digest).startsWith("NEXT_REDIRECT");
}
