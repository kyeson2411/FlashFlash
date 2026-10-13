import "server-only";
import { cache } from "react";
import { io } from "next/cache";
import { redirect } from "next/navigation";
import { createClient, NotConfiguredError } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";

export type AccountRole = "student" | "teacher";

export type Student = {
  id: string;
  email: string;
  fullName: string;
  role: AccountRole;
};

export { isSupabaseConfigured };

/** The signed-in student, or null if there is no valid session. */
export const getStudent = cache(async (): Promise<Student | null> => {
  if (!isSupabaseConfigured()) return null;

  // getUser() compares the JWT expiry with Date.now(). Cache Components forbids
  // that during prerender of the layout shell, so wait for a real request first.
  await io();

  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) return null;

    const profile = await readProfile(supabase, data.user.id);
    if (profile) {
      return {
        id: data.user.id,
        email: data.user.email ?? "",
        fullName: profile.fullName,
        role: profile.role,
      };
    }

    // The profile table can reject the read when class rules loop. The sign-in
    // record still has the name and role, so the dashboard can open.
    return accountFromAuthUser(data.user);
  } catch (error) {
    if (error instanceof NotConfiguredError) return null;
    throw error;
  }
});

type AuthUser = {
  id: string;
  email?: string | null;
  user_metadata?: Record<string, unknown>;
};

function accountFromAuthUser(user: AuthUser): Student {
  const meta = user.user_metadata ?? {};
  const name = typeof meta.full_name === "string" ? meta.full_name.trim() : "";
  return {
    id: user.id,
    email: user.email ?? "",
    fullName: name || user.email || "Student",
    role: meta.role === "teacher" ? "teacher" : "student",
  };
}

async function readProfile(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<{ fullName: string; role: AccountRole } | null> {
  const withRole = await supabase
    .from("profiles")
    .select("full_name, role")
    .eq("id", userId)
    .maybeSingle();

  if (!withRole.error && withRole.data) {
    return {
      fullName: withRole.data.full_name,
      role: withRole.data.role === "teacher" ? "teacher" : "student",
    };
  }

  if (withRole.error) {
    console.error("[auth] profile:", withRole.error.message);
  }

  if (!withRole.error || !missingClassColumn(withRole.error)) return null;

  const basic = await supabase.from("profiles").select("full_name").eq("id", userId).maybeSingle();
  if (basic.error || !basic.data) {
    if (basic.error) console.error("[auth] profile:", basic.error.message);
    return null;
  }
  return { fullName: basic.data.full_name, role: "student" };
}

/** Use in Server Components. Sends the student to sign-in when there is no session. */
export async function requireStudent(): Promise<Student> {
  const student = await getStudent();
  if (!student) redirect("/login");
  return student;
}

export class UnauthenticatedError extends Error {
  constructor() {
    super("Please sign in.");
    this.name = "UnauthenticatedError";
  }
}

/** Use in the Data Access Layer and Route Handlers that must return JSON, not a redirect. */
export async function needStudent(): Promise<Student> {
  const student = await getStudent();
  if (!student) throw new UnauthenticatedError();
  return student;
}

function missingClassColumn(error: { message: string } | null): boolean {
  return !!error && /role|class_id|schema cache|column/i.test(error.message);
}

export function firstName(fullName: string): string {
  const part = fullName.trim().split(/\s+/)[0];
  return part || "Student";
}
