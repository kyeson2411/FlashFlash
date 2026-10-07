"use server";

import { revalidatePath } from "next/cache";
import { UnauthenticatedError } from "@/lib/auth/session";
import type { CardState } from "@/lib/deck";
import { CARD_STATES } from "@/lib/deck";
import { createEmptyDeck, removeCard, resetDeckProgress, setCardState as persistCardState } from "@/lib/data/decks";
import { isStudyMode, type StudyMode } from "@/lib/study-mode";

export type MutationResult = { ok: true } | { ok: false; error: string };

const SAVE_ERROR = "Your progress could not be saved. Check your connection and try again.";
const SESSION_ERROR = "Your session ended. Sign in again to save your progress.";

function asResult(error: unknown): MutationResult {
  if (error instanceof UnauthenticatedError) return { ok: false, error: SESSION_ERROR };
  return { ok: false, error: SAVE_ERROR };
}

export async function markCard(
  cardId: string,
  state: CardState,
  mode: StudyMode = "flip",
): Promise<MutationResult> {
  if (!CARD_STATES.includes(state)) return { ok: false, error: SAVE_ERROR };
  if (state !== "unreviewed" && !isStudyMode(mode)) return { ok: false, error: SAVE_ERROR };
  try {
    const ok = await persistCardState(cardId, state, mode);
    return ok ? { ok: true } : { ok: false, error: "That card is no longer in this deck." };
  } catch (error) {
    return asResult(error);
  }
}

export async function deleteCard(cardId: string): Promise<MutationResult> {
  try {
    const ok = await removeCard(cardId);
    return ok ? { ok: true } : { ok: false, error: "That card is no longer in this deck." };
  } catch (error) {
    return asResult(error);
  }
}

export async function createDeck(title: string): Promise<MutationResult> {
  try {
    await createEmptyDeck(title);
    revalidatePath("/decks");
    revalidatePath("/");
    return { ok: true };
  } catch (error) {
    if (error instanceof UnauthenticatedError) return { ok: false, error: SESSION_ERROR };
    if (error instanceof Error && error.message.startsWith("Enter a deck name")) {
      return { ok: false, error: error.message };
    }
    return { ok: false, error: "Your deck could not be created. Please try again." };
  }
}

export async function resetProgress(deckId: string): Promise<MutationResult> {
  try {
    const ok = await resetDeckProgress(deckId);
    return ok ? { ok: true } : { ok: false, error: SAVE_ERROR };
  } catch (error) {
    return asResult(error);
  }
}
