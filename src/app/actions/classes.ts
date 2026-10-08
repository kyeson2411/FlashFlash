"use server";

import { revalidatePath } from "next/cache";
import { UnauthenticatedError } from "@/lib/auth/session";
import { createClass, createClassDeck, joinClass } from "@/lib/data/classes";

export type ClassActionState = { error?: string; code?: string; classId?: string };

export async function createClassAction(
  _prev: ClassActionState | undefined,
  formData: FormData,
): Promise<ClassActionState> {
  try {
    const created = await createClass(String(formData.get("name") ?? ""));
    revalidatePath("/classes");
    return { code: created.code, classId: created.id };
  } catch (error) {
    return { error: classError(error, "Your class could not be created. Please try again.") };
  }
}

export async function joinClassAction(
  _prev: ClassActionState | undefined,
  formData: FormData,
): Promise<ClassActionState> {
  try {
    const classId = await joinClass(String(formData.get("code") ?? ""));
    revalidatePath("/decks");
    revalidatePath("/dashboard");
    revalidatePath("/classes");
    return { classId };
  } catch (error) {
    return { error: classError(error, "That class code was not found.") };
  }
}

export async function createClassDeckAction(
  _prev: ClassActionState | undefined,
  formData: FormData,
): Promise<ClassActionState> {
  const classId = String(formData.get("classId") ?? "");
  try {
    const deckId = await createClassDeck(classId, String(formData.get("title") ?? ""));
    revalidatePath("/classes");
    revalidatePath(`/classes/${classId}`);
    revalidatePath("/generate");
    return { classId: deckId };
  } catch (error) {
    return { error: classError(error, "Your deck could not be created. Please try again.") };
  }
}

function classError(error: unknown, fallback: string): string {
  if (error instanceof UnauthenticatedError) return "Your session ended. Sign in again.";
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}
