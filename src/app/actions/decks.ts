"use server";

import { revalidatePath } from "next/cache";
import { UnauthenticatedError } from "@/lib/auth/session";
import type { CardState, Flashcard } from "@/lib/deck";
import { CARD_STATES } from "@/lib/deck";
import {
  CardTextError,
  QuotaError,
  assertCanWriteDeck,
  assertGenerationQuota,
  createEmptyDeck,
  getDeckById,
  insertCard,
  persistGeneratedDeck,
  recordGeneration,
  removeCard,
  resetDeckProgress,
  setCardState as persistCardState,
  undoLastReview,
  updateCardText,
} from "@/lib/data/decks";
import { prepareGeneratedCards } from "@/lib/quality";
import { isStudyMode, type StudyMode } from "@/lib/study-mode";
import type { GeneratedCard } from "@/lib/flashcards";

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

export type SavedCardsResult =
  | { ok: true; deckId: string; added: number; skipped: number }
  | { ok: false; error: string };

export async function saveGeneratedCards(deckId: string, cards: GeneratedCard[]): Promise<SavedCardsResult> {
  if (!Array.isArray(cards) || cards.length < 1 || cards.length > 20) {
    return { ok: false, error: "Keep at least one card." };
  }
  if (cards.some((card) => !card || typeof card.question !== "string" || typeof card.answer !== "string")) {
    return { ok: false, error: "Check each card, then save again." };
  }

  try {
    await assertGenerationQuota();
    const deck = await getDeckById(deckId);
    if (!deck) return { ok: false, error: "That deck is no longer available. Choose another one." };
    await assertCanWriteDeck(deckId);
    const prepared = prepareGeneratedCards(cards, deck.cards.map((card) => card.question));
    if (prepared.cards.length === 0) {
      return {
        ok: false,
        error: "Keep at least one card with a short answer that is not already in this deck.",
      };
    }
    const saved = await persistGeneratedDeck({ title: deck.title, cards: prepared.cards }, deck.title, deckId);
    await recordGeneration();
    revalidateStudySurfaces();
    revalidatePath("/generate");
    return {
      ok: true,
      deckId: saved.deck.id,
      added: saved.added,
      skipped: prepared.skipped + saved.skipped,
    };
  } catch (error) {
    if (error instanceof UnauthenticatedError) return { ok: false, error: SESSION_ERROR };
    if (error instanceof QuotaError) return { ok: false, error: error.message };
    const message = error instanceof Error ? error.message : "";
    if (
      message.includes("already in this deck") ||
      message.includes("200 cards") ||
      message.includes("no longer available") ||
      message.includes("Only the teacher") ||
      message.includes("Choose a deck")
    ) {
      return { ok: false, error: message.includes("200 cards") ? "This deck already has as many cards as it can hold." : message };
    }
    return { ok: false, error: "Your flashcards could not be saved. Please try again." };
  }
}

export async function undoCardReview(cardId: string): Promise<MutationResult> {
  try {
    await undoLastReview(cardId);
    revalidateStudySurfaces();
    return { ok: true };
  } catch (error) {
    if (error instanceof UnauthenticatedError) return { ok: false, error: SESSION_ERROR };
    if (error instanceof Error && error.message) return { ok: false, error: error.message };
    return asResult(error);
  }
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
