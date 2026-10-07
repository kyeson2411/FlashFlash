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

export type Deck = {
  id: string;
  title: string;
  createdAt: number; // ms since epoch
  cards: Flashcard[];
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
};

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
