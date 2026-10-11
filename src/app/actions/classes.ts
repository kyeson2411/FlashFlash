"use server";

import { revalidatePath } from "next/cache";
import { UnauthenticatedError } from "@/lib/auth/session";
import {
  approveClassMember,
  createClass,
  createClassDeck,
  joinClass,
  regenerateClassCode,
  removeClassMember,
  revokeClassCode,
  setClassApproval,
} from "@/lib/data/classes";

export type ClassActionState = { error?: string; code?: string; classId?: string; pending?: boolean };
export type ClassMutationResult = { ok: true } | { ok: false; error: string };

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
    const joined = await joinClass(String(formData.get("code") ?? ""));
    revalidatePath("/decks");
    revalidatePath("/dashboard");
    revalidatePath("/classes");
    revalidatePath(`/classes/${joined.classId}`);
    return { classId: joined.classId, pending: joined.pending };
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

export async function regenerateClassCodeAction(classId: string): Promise<ClassMutationResult> {
  return mutate(classId, () => regenerateClassCode(classId));
}

export async function revokeClassCodeAction(classId: string): Promise<ClassMutationResult> {
  return mutate(classId, () => revokeClassCode(classId));
}

export async function setClassApprovalAction(classId: string, required: boolean): Promise<ClassMutationResult> {
  return mutate(classId, () => setClassApproval(classId, required));
}

export async function approveStudentAction(classId: string, studentId: string): Promise<ClassMutationResult> {
  return mutate(classId, () => approveClassMember(classId, studentId));
}

export async function removeStudentAction(classId: string, studentId: string): Promise<ClassMutationResult> {
  return mutate(classId, () => removeClassMember(classId, studentId));
}

async function mutate(classId: string, run: () => Promise<void>): Promise<ClassMutationResult> {
  try {
    await run();
    revalidatePath("/classes");
    revalidatePath(`/classes/${classId}`);
    revalidatePath("/decks");
    revalidatePath("/dashboard");
    return { ok: true };
  } catch (error) {
    return { ok: false, error: classError(error, "That change could not be saved. Please try again.") };
  }
}

function classError(error: unknown, fallback: string): string {
  if (error instanceof UnauthenticatedError) return "Your session ended. Sign in again.";
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}
