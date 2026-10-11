import type { GeneratedDeck } from "./flashcards";

// Student-facing deck model.
// Cards only have three simple states. Scheduling stays on the server and is never shown.

export const CARD_STATES = ["unreviewed", "learning", "known"] as const;
export type CardState = (typeof CARD_STATES)[number];

export const CARD_STATE_LABELS: Record<CardState, string> = {
  unreviewed: "Unreviewed",
  learning: "Still learning",
  known: "Known",
};

export type Flashcard = {
  id: string;
  question: string;
  answer: string;
  state: CardState;
};

export const DECK_WORKFLOW_STATUSES = ["draft", "teacher_reviewed", "published"] as const;
export type DeckWorkflowStatus = (typeof DECK_WORKFLOW_STATUSES)[number];

export const DECK_WORKFLOW_LABELS: Record<DeckWorkflowStatus, string> = {
  draft: "Draft",
  teacher_reviewed: "Reviewed",
  published: "Published",
};

export type DeckWorkflowStep = {
  /** Position of the current status in DECK_WORKFLOW_STATUSES. */
  index: number;
  next: Exclude<DeckWorkflowStatus, "draft"> | null;
  /** What the teacher does next, for the class deck list. */
  nextLine: string;
};

export function deckWorkflowStep(status: DeckWorkflowStatus): DeckWorkflowStep {
  if (status === "draft") return { index: 0, next: "teacher_reviewed", nextLine: "Next: mark reviewed" };
  if (status === "teacher_reviewed") return { index: 1, next: "published", nextLine: "Next: publish" };
  return { index: 2, next: null, nextLine: "Ready to give as a quiz" };
}

export const MAX_REVIEW_CARDS = 100;

/** More than half of the students who studied the card still mark it as learning. */
export function isHardCard(learning: number, studied: number): boolean {
  return studied > 0 && learning > 0 && learning * 2 > studied;
}

export type DeckVersionSummary = {
  number: number;
  createdAt: string;
  cardCount: number;
};

export type Deck = {
  id: string;
  title: string;
  createdAt: number; // ms since epoch
  cards: Flashcard[];
  classId?: string | null;
  className?: string | null;
  ownerId?: string;
  /** Null on a personal deck. Class decks are draft until a teacher publishes them. */
  workflowStatus?: DeckWorkflowStatus | null;
  /** Earlier published snapshots. Only the teacher who owns the deck receives these. */
  versions?: DeckVersionSummary[];
};

export type DeckStats = {
  total: number;
  known: number;
  learning: number;
  unreviewed: number;
  reviewed: number; // known + learning
  percentReviewed: number; // 0-100
};

export type DeckSummary = {
  id: string;
  title: string;
  createdAt: number;
  stats: DeckStats;
  /** Cards whose review time has arrived. Scheduling details stay on the server. */
  readyCount: number;
  /** Known cards whose review time has arrived. New and learning cards are not included. */
  dueAgainCount: number;
  classId?: string | null;
  className?: string | null;
  workflowStatus?: DeckWorkflowStatus | null;
};

export type UpNext = { kind: "quiz"; id: string } | { kind: "deck"; id: string } | null;

/** The most urgent thing for a student: an overdue quiz, then an open quiz, then the deck with most to learn. */
export function pickUpNext(
  quizzes: { id: string; window: string; finished: boolean }[],
  decks: Pick<DeckSummary, "id" | "stats" | "readyCount">[],
): UpNext {
  const waiting = quizzes.filter((quiz) => !quiz.finished);
  const quiz = waiting.find((item) => item.window === "late") ?? waiting.find((item) => item.window === "open");
  if (quiz) return { kind: "quiz", id: quiz.id };
  const deck = mostToStudy(decks);
  return deck ? { kind: "deck", id: deck.id } : null;
}

/** The deck with the most cards still to learn, then the most cards ready again. Null when nothing is due. */
export function mostToStudy<T extends Pick<DeckSummary, "id" | "stats" | "readyCount">>(decks: T[]): T | null {
  let best: T | null = null;
  for (const deck of decks) {
    const due = unmemorizedCount(deck.stats) + deck.readyCount;
    if (due === 0) continue;
    if (
      !best ||
      unmemorizedCount(deck.stats) > unmemorizedCount(best.stats) ||
      (unmemorizedCount(deck.stats) === unmemorizedCount(best.stats) && deck.readyCount > best.readyCount)
    ) {
      best = deck;
    }
  }
  return best;
}

/** "10 cards to learn", or the cards ready again when everything is known. */
export function toLearnLine(deck: Pick<DeckSummary, "stats" | "readyCount">): string {
  const toLearn = unmemorizedCount(deck.stats);
  if (toLearn > 0) return `${toLearn} ${toLearn === 1 ? "card" : "cards"} to learn`;
  return `${deck.readyCount} ${deck.readyCount === 1 ? "card" : "cards"} ready to review`;
}

// Where the student is with a deck.
export type DeckLearningState = "empty" | "not-started" | "in-progress" | "all-reviewed";

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `deck-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Turns the validated API response into a deck with ids and every card "unreviewed". */
export function createDeck(generated: GeneratedDeck): Deck {
  const id = newId();
  return {
    id,
    title: generated.title,
    createdAt: Date.now(),
    cards: generated.cards.map((card, index) => ({
      id: `${id}-card-${index + 1}`,
      question: card.question,
      answer: card.answer,
      state: "unreviewed" as const,
    })),
  };
}

// Counts are always calculated from the cards, so they can never drift out of sync.
export function getDeckStats(deck: Deck): DeckStats {
  const total = deck.cards.length;
  const known = deck.cards.filter((c) => c.state === "known").length;
  const learning = deck.cards.filter((c) => c.state === "learning").length;
  const reviewed = known + learning;

  return {
    total,
    known,
    learning,
    unreviewed: total - reviewed,
    reviewed,
    percentReviewed: total === 0 ? 0 : Math.round((reviewed / total) * 100),
  };
}

/** Still learning and unreviewed. Known cards are treated as memorized. */
export function unmemorizedCount(stats: DeckStats): number {
  return stats.learning + stats.unreviewed;
}

export function getDeckLearningState(stats: DeckStats): DeckLearningState {
  if (stats.total === 0) return "empty";
  if (stats.reviewed === 0) return "not-started";
  if (stats.reviewed === stats.total) return "all-reviewed";
  return "in-progress";
}

function isCardState(value: unknown): value is CardState {
  return typeof value === "string" && (CARD_STATES as readonly string[]).includes(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/** Checks data read from storage. Returns null if anything is malformed. */
export function parseDeck(value: unknown): Deck | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;

  if (!isNonEmptyString(v.id) || !isNonEmptyString(v.title) || typeof v.createdAt !== "number") return null;
  if (!Array.isArray(v.cards)) return null;

  const seen = new Set<string>();
  const cards: Flashcard[] = [];

  for (const raw of v.cards as unknown[]) {
    if (typeof raw !== "object" || raw === null) return null;
    const c = raw as Record<string, unknown>;

    if (!isNonEmptyString(c.id) || seen.has(c.id)) return null;
    if (!isNonEmptyString(c.question) || !isNonEmptyString(c.answer) || !isCardState(c.state)) return null;

    seen.add(c.id);
    cards.push({ id: c.id, question: c.question, answer: c.answer, state: c.state });
  }

  return { id: v.id, title: v.title, createdAt: v.createdAt, cards };
}
