"use server";

import { revalidatePath } from "next/cache";
import { UnauthenticatedError } from "@/lib/auth/session";
import { assertCanWriteDeck, getDeckById } from "@/lib/data/decks";
import { QuizError, answerQuiz, closeQuiz, giveQuiz } from "@/lib/data/quizzes";
import { QUIZ_UNREADY, quizMode } from "@/lib/quiz";

export type QuizActionResult = { ok: true } | { ok: false; error: string };
export type QuizAnswerResult =
  | { ok: true; correct: boolean; expected: string; finished: boolean; correctCount: number | null; total: number | null }
  | { ok: false; error: string };

export async function giveClassQuiz(deckId: string, dueDate: string): Promise<QuizActionResult> {
  try {
    const deck = await getDeckById(deckId);
    if (!deck?.classId) return { ok: false, error: "Only the teacher of this class can give a quiz." };
    await assertCanWriteDeck(deckId);
    if (!quizMode(deck.cards)) return { ok: false, error: QUIZ_UNREADY };
    const quizId = await giveQuiz(deckId, dueDate.trim());
    revalidateQuiz(deck.classId, deckId, quizId);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: quizActionError(error, "This quiz could not be given. Please try again.") };
  }
}

export async function closeClassQuiz(quizId: string, classId: string, deckId: string): Promise<QuizActionResult> {
  try {
    await closeQuiz(quizId);
    revalidateQuiz(classId, deckId, quizId);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: quizActionError(error, "This quiz could not be closed. Please try again.") };
  }
}

export async function submitQuizAnswer(quizId: string, cardId: string, given: string): Promise<QuizAnswerResult> {
  try {
    const saved = await answerQuiz(quizId, cardId, given);
    if (saved.finished) {
      revalidatePath("/dashboard");
      revalidatePath("/classes");
      revalidatePath(`/quizzes/${quizId}`);
    }
    return { ok: true, ...saved };
  } catch (error) {
    return { ok: false, error: quizActionError(error, "Your answer could not be saved. Please try again.") };
  }
}

function revalidateQuiz(classId: string, deckId: string, quizId: string) {
  revalidatePath("/dashboard");
  revalidatePath("/classes");
  revalidatePath(`/classes/${classId}`);
  revalidatePath(`/decks/${deckId}`);
  revalidatePath(`/quizzes/${quizId}`);
}

function quizActionError(error: unknown, fallback: string): string {
  if (error instanceof UnauthenticatedError) return "Your session ended. Sign in again.";
  if (error instanceof QuizError) return error.message;
  return fallback;
}
