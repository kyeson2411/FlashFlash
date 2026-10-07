import "server-only";
import { cache } from "react";
import { io } from "next/cache";
import { redirect } from "next/navigation";
import { createClient, NotConfiguredError } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";

export type Student = {
  id: string;
  email: string;
  schoolId: string;
  fullName: string;
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

    const { data: profile } = await supabase
      .from("profiles")
      .select("school_id, full_name")
      .eq("id", data.user.id)
      .maybeSingle();

    if (!profile) return null;

    return {
      id: data.user.id,
      email: data.user.email ?? "",
      schoolId: profile.school_id,
      fullName: profile.full_name,
    };
  } catch (error) {
    if (error instanceof NotConfiguredError) return null;
    throw error;
  }
});

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

export function firstName(fullName: string): string {
  const part = fullName.trim().split(/\s+/)[0];
  return part || "Student";
}
