import "server-only";
import { STUDY_MATERIAL_MARKER, type GeneratedCard, type GeneratedDeck } from "@/lib/flashcards";
import { isTypeableAnswer } from "@/lib/typeable";

/** Fewest cards we will save after dropping weak or unsupported ones. */
export const MIN_CARDS_TO_SAVE = 3;

const STOP_WORDS = new Set([
  "a", "an", "the", "of", "and", "or", "to", "in", "on", "for", "with", "from",
  "is", "are", "was", "were", "be", "as", "by", "at", "that", "this", "it", "its",
  "what", "which", "who", "how", "why", "when", "where", "does", "do", "did",
]);

export type FilterResult = {
  cards: GeneratedCard[];
  reasons: string[];
};

/**
 * Drops cards that are duplicates, that repeat their question as the answer,
 * whose answer is longer than 1 to 3 words, or (when real notes were supplied)
 * whose answer is not supported by those notes.
 * Reasons are for server logs only.
 */
export function filterGeneratedDeck(deck: GeneratedDeck, source: string): FilterResult {
  const notes = notesFromSource(source);
  const noteTokens = new Set(contentTokens(notes));
  const checkSupport = noteTokens.size >= 8;

  const cards: GeneratedCard[] = [];
  const reasons: string[] = [];
  const keptTokens: Set<string>[] = [];

  deck.cards.forEach((card, index) => {
    const label = `card ${index + 1}`;
    const question = normalize(card.question);
    const answer = normalize(card.answer);

    if (!question || !answer || question === answer) {
      reasons.push(`${label}: question repeats the answer`);
      return;
    }

    if (!isTypeableAnswer(card.answer)) {
      reasons.push(`${label}: answer is longer than 1 to 3 words`);
      return;
    }

    const tokens = new Set(contentTokens(card.question));
    const duplicate = cards.some((kept, keptIndex) => {
      if (normalize(kept.question) === question) return true;
      return isNearCopy(tokens, keptTokens[keptIndex]);
    });
    if (duplicate) {
      reasons.push(`${label}: duplicate question`);
      return;
    }

    if (checkSupport && !answerIsSupported(card.answer, noteTokens)) {
      reasons.push(`${label}: answer not supported by the notes`);
      return;
    }

    cards.push(card);
    keptTokens.push(tokens);
  });

  return { cards, reasons };
}

function notesFromSource(source: string): string {
  const index = source.indexOf(STUDY_MATERIAL_MARKER);
  if (index === -1) return "";
  return source.slice(index + STUDY_MATERIAL_MARKER.length).trim();
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function contentTokens(value: string): string[] {
  return normalize(value)
    .split(" ")
    .filter((token) => token.length >= 2 && !STOP_WORDS.has(token));
}

function isNearCopy(left: Set<string>, right: Set<string> | undefined): boolean {
  if (!right || left.size < 3 || right.size < 3) return false;
  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  const union = left.size + right.size - shared;
  return union > 0 && shared / union >= 0.75;
}

function answerIsSupported(answer: string, noteTokens: Set<string>): boolean {
  const tokens = contentTokens(answer);
  if (tokens.length === 0) return false;
  const shared = tokens.filter((token) => noteTokens.has(token)).length;
  const needed = Math.max(1, Math.ceil(tokens.length * 0.5));
  return shared >= needed;
}
