"use server";

import { revalidatePath } from "next/cache";
import { UnauthenticatedError } from "@/lib/auth/session";
import { assertCanWriteDeck, getDeckById } from "@/lib/data/decks";
import {
  QuizError,
  answerQuiz,
  closeQuiz,
  giveQuiz,
  handInQuiz,
  logQuizFocus,
  setQuizAccommodation,
  startQuizAttempt,
  type QuizAnswerSaved,
  type QuizHandedIn,
} from "@/lib/data/quizzes";
import {
  MAX_QUESTION_SECONDS,
  MAX_QUIZ_ATTEMPTS,
  MAX_QUIZ_MINUTES,
  MIN_QUESTION_SECONDS,
  QUIZ_UNREADY,
  opensAtInstant,
  quickQuizSettings,
  quizMode,
  type QuizSettingsInput,
} from "@/lib/quiz";

export type QuizActionResult = { ok: true } | { ok: false; error: string };
export type QuizAnswerResult = ({ ok: true } & QuizAnswerSaved) | { ok: false; error: string };
export type QuizHandInResult = ({ ok: true } & QuizHandedIn) | { ok: false; error: string };

export type GiveQuizForm = {
  dueDate: string;
  opensAt: string;
  latePolicy: string;
  timerMode: string;
  timeLimitMinutes: string;
  questionSeconds: string;
  maxAttempts: string;
  shuffleQuestions: boolean;
  shuffleChoices: boolean;
  allowBack: boolean;
  resultsAfterDue: boolean;
};

export type GiveQuizResult = { ok: true; quizId: string } | { ok: false; error: string };

export async function giveClassQuiz(deckId: string, form: GiveQuizForm): Promise<GiveQuizResult> {
  const settings = readSettings(form);
  if (typeof settings === "string") return { ok: false, error: settings };
  return give(deckId, (form.dueDate ?? "").trim(), settings);
}

/** One click: open now until the teacher closes it, shuffled, one attempt, no timer. */
export async function giveQuickQuiz(deckId: string): Promise<GiveQuizResult> {
  return give(deckId, "", quickQuizSettings());
}

async function give(deckId: string, dueDate: string, settings: QuizSettingsInput): Promise<GiveQuizResult> {
  try {
    const deck = await getDeckById(deckId);
    if (!deck?.classId) return { ok: false, error: "Only the teacher of this class can give a quiz." };
    await assertCanWriteDeck(deckId);
    if (!quizMode(deck.cards)) return { ok: false, error: QUIZ_UNREADY };
    const quizId = await giveQuiz(deckId, dueDate, settings);
    revalidateQuiz(deck.classId, deckId, quizId);
    return { ok: true, quizId };
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

export async function startQuizAction(quizId: string): Promise<QuizActionResult> {
  try {
    await startQuizAttempt(quizId);
    revalidatePath(`/quizzes/${quizId}`);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: quizActionError(error, "This quiz could not be started. Please try again.") };
  }
}

export async function setQuizAccommodationAction(
  quizId: string,
  studentId: string,
  dueDate: string,
  extra: string,
  unit: "minutes" | "seconds",
): Promise<QuizActionResult> {
  const amount = extra.trim() === "" ? 0 : Number(extra);
  if (unit === "seconds") {
    if (!Number.isInteger(amount) || amount < 0 || amount > MAX_QUESTION_SECONDS) {
      return { ok: false, error: "Choose up to 600 extra seconds for each question." };
    }
  } else if (!Number.isInteger(amount) || amount < 0 || amount > MAX_QUIZ_MINUTES) {
    return { ok: false, error: "Choose up to 240 extra minutes." };
  }
  try {
    await setQuizAccommodation(quizId, studentId, dueDate.trim(), unit === "seconds" ? amount : amount * 60);
    revalidatePath(`/quizzes/${quizId}`);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: quizActionError(error, "This change could not be saved. Please try again.") };
  }
}

export async function submitQuizAnswer(
  quizId: string,
  cardId: string,
  given: string,
  timeout = false,
): Promise<QuizAnswerResult> {
  try {
    const saved = await answerQuiz(quizId, cardId, given, timeout === true);
    if (saved.finished) revalidateFinished(quizId);
    return { ok: true, ...saved };
  } catch (error) {
    return { ok: false, error: quizActionError(error, "Your answer could not be saved. Please try again.") };
  }
}

export async function handInQuizAction(quizId: string): Promise<QuizHandInResult> {
  try {
    const handedIn = await handInQuiz(quizId);
    revalidateFinished(quizId);
    return { ok: true, ...handedIn };
  } catch (error) {
    return { ok: false, error: quizActionError(error, "This quiz could not be handed in. Please try again.") };
  }
}

export async function logQuizFocusAction(quizId: string, away: boolean): Promise<void> {
  try {
    await logQuizFocus(quizId, away === true);
  } catch {
    // A missed note must never interrupt the quiz.
  }
}

function revalidateFinished(quizId: string) {
  revalidatePath("/dashboard");
  revalidatePath("/classes");
  revalidatePath(`/quizzes/${quizId}`);
}

function readSettings(form: GiveQuizForm): QuizSettingsInput | string {
  const opensAt = opensAtInstant(form.opensAt ?? "");
  if (opensAt === undefined) return "Choose an open time within a year.";

  const timerMode = form.timerMode === "quiz" || form.timerMode === "question" ? form.timerMode : "none";

  let minutes: number | null = null;
  if (timerMode === "quiz") {
    minutes = Number((form.timeLimitMinutes ?? "").trim());
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > MAX_QUIZ_MINUTES) {
      return "Choose a time limit from 1 to 240 minutes.";
    }
  }

  let seconds: number | null = null;
  if (timerMode === "question") {
    seconds = Number((form.questionSeconds ?? "").trim());
    if (!Number.isInteger(seconds) || seconds < MIN_QUESTION_SECONDS || seconds > MAX_QUESTION_SECONDS) {
      return "Choose from 10 to 600 seconds for each question.";
    }
  }

  const attempts = Number((form.maxAttempts ?? "1").trim() || "1");
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > MAX_QUIZ_ATTEMPTS) {
    return "Choose from 1 to 10 attempts.";
  }

  return {
    opensAt,
    latePolicy: form.latePolicy === "accept" ? "accept" : "block",
    timerMode,
    timeLimitMinutes: minutes,
    questionSeconds: seconds,
    maxAttempts: attempts,
    shuffleQuestions: form.shuffleQuestions === true,
    shuffleChoices: form.shuffleChoices === true,
    allowBack: timerMode !== "question" && form.allowBack === true,
    resultsAfterDue: form.resultsAfterDue === true,
  };
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
