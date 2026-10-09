import { buildChoices, deckSupportsChoices } from "@/lib/choices";
import type { Flashcard } from "@/lib/deck";
import { manilaDateKey } from "@/lib/progress-summary";
import { isTypeableAnswer, normalizeTypedAnswer } from "@/lib/typeable";

export const QUIZ_UNREADY =
  "This deck needs short answers, or at least four cards with different answers, before it can be a quiz.";

export type QuizSchedule = {
  dueAt: string | null;
  closedAt: string | null;
};

export type QuizAnswerMode = "choice" | "typing";

export type QuizCardView = {
  id: string;
  question: string;
  options: string[] | null;
};

export type DeckQuizOffer =
  | { available: false }
  | {
      available: true;
      ready: boolean;
      minDate: string;
      maxDate: string;
      openQuiz: { id: string; dueLabel: string | null } | null;
    };

/** Multiple choice when the deck can build four options, otherwise typing. */
export function quizMode(cards: Flashcard[]): QuizAnswerMode | null {
  if (cards.length === 0) return null;
  if (deckSupportsChoices(cards)) return "choice";
  if (cards.every((card) => isTypeableAnswer(card.answer))) return "typing";
  return null;
}

export function answersMatch(given: string, expected: string): boolean {
  return normalizeTypedAnswer(given) === normalizeTypedAnswer(expected);
}

/** The instant a Manila calendar day ends: midnight at the start of the next day. */
export function dueCloseInstant(dateKey: string, now = new Date()): string | null {
  if (!isDateKey(dateKey)) return null;
  const today = manilaDateKey(now);
  if (dateKey < today || dateKey > shiftDateKey(today, 366)) return null;
  const close = new Date(`${shiftDateKey(dateKey, 1)}T00:00:00+08:00`);
  if (Number.isNaN(close.getTime())) return null;
  return close.toISOString();
}

export function dueDayLabel(dueAt: string | null): string | null {
  if (!dueAt) return null;
  const end = new Date(dueAt);
  if (Number.isNaN(end.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "Asia/Manila",
  }).format(new Date(end.getTime() - 1));
}

export function quizIsOpen(quiz: QuizSchedule, now = new Date()): boolean {
  if (quiz.closedAt) return false;
  if (quiz.dueAt && new Date(quiz.dueAt).getTime() <= now.getTime()) return false;
  return true;
}

export function quizStatusLabel(quiz: QuizSchedule, now = new Date()): string {
  const due = dueDayLabel(quiz.dueAt);
  if (!quizIsOpen(quiz, now)) return due ? `Closed · Due ${due}` : "Closed";
  return due ? `Due ${due}` : "Open";
}

export function choiceTexts(card: Flashcard, cards: Flashcard[]): string[] | null {
  const choices = buildChoices(card, cards);
  if (!choices) return null;
  return choices.map((choice) => choice.text);
}

function isDateKey(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const probe = new Date(Date.UTC(year, month - 1, day));
  return probe.getUTCFullYear() === year && probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day;
}

function shiftDateKey(key: string, days: number): string {
  const [year, month, day] = key.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
