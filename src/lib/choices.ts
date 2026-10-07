import type { Flashcard } from "@/lib/deck";

export type ChoiceOption = {
  text: string;
  correct: boolean;
};

/** Other answers already in this deck. Returns null when there are not three unique distractors. */
export function buildChoices(card: Flashcard, cards: Flashcard[]): ChoiceOption[] | null {
  const correct = card.answer.trim();
  const correctKey = normalize(correct);
  const seen = new Set<string>([correctKey]);
  const distractors: ChoiceOption[] = [];

  for (const other of cards) {
    if (other.id === card.id) continue;
    const text = other.answer.trim();
    const key = normalize(text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    distractors.push({ text, correct: false });
    if (distractors.length === 3) break;
  }

  if (distractors.length < 3) return null;

  return stableOrder([{ text: correct, correct: true }, ...distractors], card.id);
}

export function deckSupportsChoices(cards: Flashcard[]): boolean {
  if (cards.length < 4) return false;
  return cards.every((card) => buildChoices(card, cards) !== null);
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function stableOrder(options: ChoiceOption[], seed: string): ChoiceOption[] {
  return [...options].sort((left, right) => {
    const delta = mix(seed, left.text) - mix(seed, right.text);
    return delta !== 0 ? delta : left.text.localeCompare(right.text);
  });
}

function mix(seed: string, text: string): number {
  const value = `${seed}\n${text}`;
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
