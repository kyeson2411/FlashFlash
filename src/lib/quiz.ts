import { buildChoices, deckSupportsChoices } from "@/lib/choices";
import type { Flashcard } from "@/lib/deck";
import { manilaDateKey } from "@/lib/progress-summary";
import { isTypeableAnswer, normalizeTypedAnswer } from "@/lib/typeable";

export const QUIZ_UNREADY =
  "This deck needs short answers, or at least four cards with different answers, before it can be a quiz.";

export type QuizSchedule = {
  dueAt: string | null;
  closedAt: string | null;
  opensAt?: string | null;
  latePolicy?: QuizLatePolicy;
};

export type QuizLatePolicy = "block" | "accept";

/** Whether a student may answer right now. The database makes the same decision for every answer. */
export type QuizWindow = "not_open" | "open" | "late" | "closed";

/** One timer for the whole quiz, or one for each question. */
export type QuizTimerMode = "none" | "quiz" | "question";

export type QuizSettingsInput = {
  opensAt: string | null;
  latePolicy: QuizLatePolicy;
  timerMode: QuizTimerMode;
  timeLimitMinutes: number | null;
  questionSeconds: number | null;
  maxAttempts: number;
  shuffleQuestions: boolean;
  shuffleChoices: boolean;
  allowBack: boolean;
  resultsAfterDue: boolean;
};

export type QuizSettings = {
  opensAt: string | null;
  latePolicy: QuizLatePolicy;
  timerMode: QuizTimerMode;
  /** Whole-quiz timer only. */
  timeLimitSeconds: number | null;
  /** Per-question timer only. */
  questionSeconds: number | null;
  maxAttempts: number;
  shuffleQuestions: boolean;
  shuffleChoices: boolean;
  allowBack: boolean;
  resultsAfterDue: boolean;
};

export const MAX_QUIZ_ATTEMPTS = 10;
export const MAX_QUIZ_MINUTES = 240;
export const MIN_QUESTION_SECONDS = 10;
export const MAX_QUESTION_SECONDS = 600;

export type QuizAnswerMode = "choice" | "typing";

/** The one question the server has given this student. */
export type QuizQuestion = {
  cardId: string;
  position: number;
  total: number;
  answeredCount: number;
  question: string;
  options: string[] | null;
  /** With going back, the answer already saved for this question. */
  given: string | null;
  /** Question deadline with a per-question timer, otherwise the quiz deadline. */
  deadline: string | null;
  questionTimer: boolean;
  allowBack: boolean;
  /** Show right or wrong after each answer. */
  feedback: boolean;
  late: boolean;
};

export type DeckQuizOffer =
  | { available: false }
  | {
      available: true;
      ready: boolean;
      /** Multiple choice decks can shuffle their answer choices. */
      choice: boolean;
      minDate: string;
      maxDate: string;
      openQuiz: { id: string; status: string } | null;
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

export function quizWindow(quiz: QuizSchedule, now = new Date()): QuizWindow {
  if (quiz.closedAt) return "closed";
  if (quiz.opensAt && new Date(quiz.opensAt).getTime() > now.getTime()) return "not_open";
  if (!quiz.dueAt || new Date(quiz.dueAt).getTime() > now.getTime()) return "open";
  return quiz.latePolicy === "accept" ? "late" : "closed";
}

/** Not closed yet: still waiting to open, open, or taking late work. */
export function quizIsOpen(quiz: QuizSchedule, now = new Date()): boolean {
  return quizWindow(quiz, now) !== "closed";
}

export function quizStatusLabel(quiz: QuizSchedule, now = new Date(), window = quizWindow(quiz, now)): string {
  const due = dueDayLabel(quiz.dueAt);
  if (window === "closed") return due ? `Closed · Due ${due}` : "Closed";
  if (window === "not_open") {
    const opens = opensLabel(quiz.opensAt ?? null);
    return [opens ? `Opens ${opens}` : "Not open yet", due ? `Due ${due}` : null].filter(Boolean).join(" · ");
  }
  if (window === "late") return due ? `Late work accepted · Was due ${due}` : "Late work accepted";
  return due ? `Due ${due}` : "Open";
}

export function opensLabel(opensAt: string | null): string | null {
  if (!opensAt) return null;
  const when = new Date(opensAt);
  if (Number.isNaN(when.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Asia/Manila",
  }).format(when);
}

export function minutesLabel(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  return minutes === 1 ? "1 minute" : `${minutes} minutes`;
}

export function secondsLabel(seconds: number): string {
  return seconds === 1 ? "1 second" : `${seconds} seconds`;
}

/** Settings for the one-click quiz: open now until the teacher closes it, shuffled, one attempt. */
export function quickQuizSettings(): QuizSettingsInput {
  return {
    opensAt: null,
    latePolicy: "block",
    timerMode: "none",
    timeLimitMinutes: null,
    questionSeconds: null,
    maxAttempts: 1,
    shuffleQuestions: true,
    shuffleChoices: true,
    allowBack: false,
    resultsAfterDue: false,
  };
}

/** Overdue first, then open by due time (no due date last), then not yet open by open time, then closed. */
export function sortWaiting<T extends { window: QuizWindow; dueAt: string | null; opensAt?: string | null }>(
  rows: T[],
): T[] {
  const rank = (row: T) => (row.window === "late" ? 0 : row.window === "open" ? 1 : row.window === "not_open" ? 2 : 3);
  const time = (value: string | null | undefined) => (value ? new Date(value).getTime() : Number.POSITIVE_INFINITY);
  return [...rows].sort((left, right) => {
    const byRank = rank(left) - rank(right);
    if (byRank !== 0) return byRank;
    const byTime =
      left.window === "not_open" ? time(left.opensAt) - time(right.opensAt) : time(left.dueAt) - time(right.dueAt);
    return Number.isNaN(byTime) ? 0 : byTime;
  });
}

/** "3 days", "5 hours", "12 minutes", or "less than a minute". Rounds down. */
export function spanLabel(ms: number): string {
  const minutes = Math.floor(Math.abs(ms) / 60_000);
  if (minutes < 1) return "less than a minute";
  if (minutes < 60) return minutes === 1 ? "1 minute" : `${minutes} minutes`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return hours === 1 ? "1 hour" : `${hours} hours`;
  const days = Math.floor(hours / 24);
  return `${days} days`;
}

/** A student's countdown for one quiz, using the window the server decided. */
export function quizCountdown(
  quiz: { dueAt: string | null; opensAt?: string | null },
  window: QuizWindow,
  now = new Date(),
): string {
  const at = (value: string | null | undefined) => (value ? new Date(value).getTime() : NaN);
  if (window === "not_open") {
    const opens = at(quiz.opensAt);
    return Number.isFinite(opens) && opens > now.getTime() ? `Opens in ${spanLabel(opens - now.getTime())}` : "Opens soon";
  }
  const due = at(quiz.dueAt);
  if (window === "late") {
    return Number.isFinite(due) ? `Overdue by ${spanLabel(now.getTime() - due)} · Late work accepted` : "Late work accepted";
  }
  if (window === "closed") return "Closed";
  if (!Number.isFinite(due)) return "Open until your teacher closes it";
  return due > now.getTime() ? `Due in ${spanLabel(due - now.getTime())}` : "Due now";
}

/** A datetime-local value read as Manila time. Empty means open now. */
export function opensAtInstant(value: string, now = new Date()): string | null | undefined {
  const clean = value.trim();
  if (!clean) return null;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(clean)) return undefined;
  const when = new Date(`${clean}:00+08:00`);
  if (Number.isNaN(when.getTime())) return undefined;
  if (when.getTime() > now.getTime() + 366 * 86_400_000) return undefined;
  return when.getTime() <= now.getTime() ? null : when.toISOString();
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
