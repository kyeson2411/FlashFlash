"use server";

import { revalidatePath } from "next/cache";
import { UnauthenticatedError } from "@/lib/auth/session";
import type { CardState, Flashcard } from "@/lib/deck";
import { CARD_STATES } from "@/lib/deck";
import {
  CardTextError,
  createEmptyDeck,
  insertCard,
  removeCard,
  resetDeckProgress,
  setCardState as persistCardState,
  updateCardText,
} from "@/lib/data/decks";
import { isStudyMode, type StudyMode } from "@/lib/study-mode";

export type MutationResult = { ok: true } | { ok: false; error: string };
export type CardWriteResult = { ok: true; card: Flashcard } | { ok: false; error: string };

const SAVE_ERROR = "Your progress could not be saved. Check your connection and try again.";
const SESSION_ERROR = "Your session ended. Sign in again to save your progress.";

function asResult(error: unknown): MutationResult {
  if (error instanceof UnauthenticatedError) return { ok: false, error: SESSION_ERROR };
  return { ok: false, error: SAVE_ERROR };
}

function cardTextResult(error: unknown): { ok: false; error: string } {
  if (error instanceof UnauthenticatedError) return { ok: false, error: SESSION_ERROR };
  if (error instanceof CardTextError) return { ok: false, error: error.message };
  return { ok: false, error: "This card could not be saved. Please try again." };
}

function revalidateStudySurfaces() {
  revalidatePath("/dashboard");
  revalidatePath("/decks", "layout");
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
    if (!ok) return { ok: false, error: "That card is no longer in this deck." };
    revalidateStudySurfaces();
    return { ok: true };
  } catch (error) {
    return asResult(error);
  }
}

export async function addCard(deckId: string, question: string, answer: string): Promise<CardWriteResult> {
  try {
    const card = await insertCard(deckId, question, answer);
    revalidateStudySurfaces();
    return { ok: true, card };
  } catch (error) {
    return cardTextResult(error);
  }
}

export async function updateCard(cardId: string, question: string, answer: string): Promise<MutationResult> {
  try {
    const ok = await updateCardText(cardId, question, answer);
    if (!ok) return { ok: false, error: "That card is no longer in this deck." };
    revalidateStudySurfaces();
    return { ok: true };
  } catch (error) {
    return cardTextResult(error);
  }
}

export async function deleteCard(cardId: string): Promise<MutationResult> {
  try {
    const ok = await removeCard(cardId);
    if (!ok) return { ok: false, error: "That card is no longer in this deck." };
    revalidateStudySurfaces();
    return { ok: true };
  } catch (error) {
    return asResult(error);
  }
}

export async function createDeck(title: string): Promise<MutationResult> {
  try {
    await createEmptyDeck(title);
    revalidatePath("/decks");
    revalidatePath("/dashboard");
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
    if (!ok) return { ok: false, error: SAVE_ERROR };
    revalidateStudySurfaces();
    return { ok: true };
  } catch (error) {
    return asResult(error);
  }
}
