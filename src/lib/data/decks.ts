import "server-only";
import { createDeck, getDeckStats, type CardState, type Deck, type DeckSummary, type Flashcard } from "@/lib/deck";
import type { StudyMode } from "@/lib/study-mode";
import type { GeneratedCard, GeneratedDeck } from "@/lib/flashcards";
import { withoutExistingCards } from "@/lib/quality";
import { isTypeableAnswer } from "@/lib/typeable";
import { needStudent } from "@/lib/auth/session";
import { DAILY_GENERATION_LIMIT } from "@/lib/limits";
import { createClient } from "@/lib/supabase/server";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type DeckRow = { id: string; title: string; created_at: string };
type CardRow = {
  id: string;
  deck_id: string;
  position: number;
  question: string;
  answer: string;
  state: CardState;
  due_at?: string;
};

export class QuotaError extends Error {
  constructor() {
    super(
      `You have reached the daily limit of ${DAILY_GENERATION_LIMIT} generated decks. Please try again tomorrow.`,
    );
    this.name = "QuotaError";
  }
}

export async function remainingGenerations(): Promise<{ used: number; limit: number; remaining: number }> {
  const student = await needStudent();
  const supabase = await createClient();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count, error } = await supabase
    .from("generation_log")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", student.id)
    .gte("created_at", since);

  if (error) {
    console.error("[decks] quota:", error.message);
    throw new Error("Could not check your generation limit.");
  }

  const used = count ?? 0;
  return { used, limit: DAILY_GENERATION_LIMIT, remaining: Math.max(0, DAILY_GENERATION_LIMIT - used) };
}

export async function assertGenerationQuota() {
  const quota = await remainingGenerations();
  if (quota.remaining <= 0) throw new QuotaError();
}

export async function recordGeneration() {
  const student = await needStudent();
  const supabase = await createClient();
  const { error } = await supabase.from("generation_log").insert({ owner_id: student.id });
  if (error) console.error("[decks] generation_log:", error.message);
}

export async function createEmptyDeck(title: string): Promise<string> {
  await needStudent();
  const clean = title.trim();
  if (clean.length < 1 || clean.length > 200) {
    throw new Error("Enter a deck name between 1 and 200 characters.");
  }

  const supabase = await createClient();
  const { data, error } = await supabase.from("decks").insert({ title: clean }).select("id").single();

  if (error || !data?.id) {
    console.error("[decks] create empty:", error?.message ?? "no id");
    throw new Error("Your deck could not be created. Please try again.");
  }
  return String(data.id);
}

export const CARDS_ALREADY_IN_DECK = "These cards are already in this deck. Nothing new was added.";

export type PersistedGeneration = {
  deck: Deck;
  cards: GeneratedCard[];
  added: number;
  skipped: number;
};

export async function persistGeneratedDeck(
  generated: GeneratedDeck,
  sourceTopic: string,
  existingDeckId: string | null = null,
): Promise<PersistedGeneration> {
  await needStudent();
  const supabase = await createClient();

  if (existingDeckId) {
    const current = await getDeckById(existingDeckId);
    if (!current) throw new Error("That deck is no longer available.");

    const fresh = withoutExistingCards(
      generated.cards,
      current.cards.map((card) => card.question),
    );
    const skipped = generated.cards.length - fresh.length;
    if (fresh.length === 0) throw new Error(CARDS_ALREADY_IN_DECK);

    const { data: deckId, error } = await supabase.rpc("add_cards_to_deck", {
      p_deck_id: existingDeckId,
      p_cards: fresh,
    });

    if (error || !deckId) {
      console.error("[decks] append:", error?.message ?? "no id");
      if (error?.code === "P0002") throw new Error("That deck is no longer available.");
      if (error?.message?.includes("200 cards")) throw new Error("A deck can hold 200 cards.");
      throw new Error("Your flashcards were generated but could not be saved. Please try again.");
    }

    const deck = await getDeckById(existingDeckId);
    if (!deck) throw new Error("That deck is no longer available.");
    return { deck, cards: fresh, added: fresh.length, skipped };
  }

  const { data: deckId, error } = await supabase.rpc("create_deck_with_cards", {
    p_title: generated.title,
    p_source_topic: sourceTopic,
    p_cards: generated.cards,
  });

  if (error || !deckId) {
    console.error("[decks] create:", error?.message ?? "no id");
    throw new Error("Your flashcards were generated but could not be saved. Please try again.");
  }

  const deck = await getDeckById(String(deckId));
  const saved = deck ?? { ...createDeck(generated), id: String(deckId) };
  return { deck: saved, cards: generated.cards, added: generated.cards.length, skipped: 0 };
}

export async function listDeckSummaries(): Promise<DeckSummary[]> {
  await needStudent();
  const supabase = await createClient();

  const { data: decks, error } = await supabase
    .from("decks")
    .select("id, title, created_at")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[decks] list:", error.message);
    throw new Error("Could not load your decks.");
  }
  if (!decks || decks.length === 0) return [];

  const ids = decks.map((d: DeckRow) => d.id);
  const { data: cards, error: cardError } = await supabase
    .from("flashcards")
    .select("id, deck_id, position, question, answer, state, due_at")
    .in("deck_id", ids)
    .order("position");

  if (cardError) {
    console.error("[decks] list cards:", cardError.message);
    throw new Error("Could not load your decks.");
  }

  const byDeck = groupCards(cards ?? []);
  return decks.map((row: DeckRow) => {
    const mapped = mapDeck(row, byDeck.get(row.id) ?? []);
    const deckCards = byDeck.get(row.id) ?? [];
    return {
      id: mapped.id,
      title: mapped.title,
      createdAt: mapped.createdAt,
      stats: getDeckStats(mapped),
      readyCount: countReady(deckCards),
      dueAgainCount: countDueAgain(deckCards),
    };
  });
}

export async function getDeckById(deckId: string): Promise<Deck | null> {
  await needStudent();
  if (!UUID_RE.test(deckId)) return null;

  const supabase = await createClient();
  const { data: row, error } = await supabase
    .from("decks")
    .select("id, title, created_at")
    .eq("id", deckId)
    .maybeSingle();

  if (error) {
    console.error("[decks] get:", error.message);
    return null;
  }
  if (!row) return null;

  const { data: cards, error: cardError } = await supabase
    .from("flashcards")
    .select("id, deck_id, position, question, answer, state")
    .eq("deck_id", deckId)
    .order("position");

  if (cardError) {
    console.error("[decks] get cards:", cardError.message);
    return null;
  }

  return mapDeck(row, cards ?? []);
}

export async function setCardState(cardId: string, state: CardState, mode: StudyMode = "flip"): Promise<boolean> {
  await needStudent();
  if (!UUID_RE.test(cardId)) return false;

  const supabase = await createClient();
  const { error } =
    state === "unreviewed"
      ? await supabase.rpc("reset_card_progress", { p_card_id: cardId })
      : await supabase.rpc("review_flashcard", {
          p_card_id: cardId,
          p_outcome: state,
          p_mode: mode,
        });

  if (error) {
    console.error("[decks] setCardState:", error.message);
    if (error.code === "P0002") return false;
    throw new Error("Could not save this card.");
  }
  return true;
}

/** Card ids that are ready to study now. Scheduling columns stay on the server. */
export async function getDueCardIds(deckId: string): Promise<string[]> {
  await needStudent();
  if (!UUID_RE.test(deckId)) return [];

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("flashcards")
    .select("id")
    .eq("deck_id", deckId)
    .lte("due_at", new Date().toISOString())
    .order("due_at")
    .order("position");

  if (error) {
    console.error("[decks] due cards:", error.message);
    throw new Error("Could not load cards that are ready to study.");
  }

  return (data ?? []).map((row: { id: string }) => row.id);
}

export class CardTextError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CardTextError";
  }
}

const DECK_CARD_LIMIT = 200;

/** One new card, unreviewed. Scheduling columns keep their database defaults. */
export async function insertCard(deckId: string, question: string, answer: string): Promise<Flashcard> {
  await needStudent();
  if (!UUID_RE.test(deckId)) throw new CardTextError("That deck is no longer available.");
  const text = cleanCardText(question, answer);

  const deck = await getDeckById(deckId);
  if (!deck) throw new CardTextError("That deck is no longer available.");
  if (deck.cards.length >= DECK_CARD_LIMIT) throw new CardTextError("A deck can hold 200 cards.");
  if (withoutExistingCards([text], deck.cards.map((card) => card.question)).length === 0) {
    throw new CardTextError("That question is already in this deck.");
  }

  const supabase = await createClient();
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const position = await nextFreePosition(deckId);
    if (position === null) throw new CardTextError("A deck can hold 200 cards.");

    const { data, error } = await supabase
      .from("flashcards")
      .insert({ deck_id: deckId, position, question: text.question, answer: text.answer })
      .select("id")
      .maybeSingle();

    if (!error && data?.id) {
      return { id: String(data.id), question: text.question, answer: text.answer, state: "unreviewed" };
    }
    if (error?.code === "23505" && attempt === 0) continue;
    console.error("[decks] insertCard:", error?.message ?? "no id");
    throw new CardTextError("This card could not be saved. Please try again.");
  }

  throw new CardTextError("This card could not be saved. Please try again.");
}

/** Changes the question and answer only. Study state and the review schedule stay. */
export async function updateCardText(cardId: string, question: string, answer: string): Promise<boolean> {
  await needStudent();
  if (!UUID_RE.test(cardId)) return false;
  const text = cleanCardText(question, answer);

  const supabase = await createClient();
  const { data: row, error: readError } = await supabase
    .from("flashcards")
    .select("id, deck_id")
    .eq("id", cardId)
    .maybeSingle();

  if (readError) {
    console.error("[decks] updateCardText read:", readError.message);
    throw new CardTextError("This card could not be saved. Please try again.");
  }
  if (!row?.deck_id) return false;

  const deck = await getDeckById(String(row.deck_id));
  if (!deck) return false;
  const others = deck.cards.filter((card) => card.id !== cardId).map((card) => card.question);
  if (withoutExistingCards([text], others).length === 0) {
    throw new CardTextError("That question is already in this deck.");
  }

  const { data, error } = await supabase
    .from("flashcards")
    .update({ question: text.question, answer: text.answer })
    .eq("id", cardId)
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("[decks] updateCardText:", error.message);
    if (error.code === "42501") {
      throw new CardTextError("Editing cards needs a database update. Run the latest SQL migration, then try again.");
    }
    throw new CardTextError("This card could not be saved. Please try again.");
  }
  return !!data;
}

function cleanCardText(question: string, answer: string): { question: string; answer: string } {
  const cleanQuestion = question.trim();
  const cleanAnswer = answer.trim();
  if (!cleanQuestion) throw new CardTextError("Enter a question.");
  if (cleanQuestion.length > 2000) throw new CardTextError("Keep the question under 2000 characters.");
  if (!cleanAnswer) throw new CardTextError("Enter an answer.");
  if (!isTypeableAnswer(cleanAnswer)) {
    throw new CardTextError("Use an answer of 1 to 3 words, up to 40 characters.");
  }
  return { question: cleanQuestion, answer: cleanAnswer };
}

async function nextFreePosition(deckId: string): Promise<number | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("flashcards").select("position").eq("deck_id", deckId);
  if (error) {
    console.error("[decks] positions:", error.message);
    throw new CardTextError("This card could not be saved. Please try again.");
  }
  const used = new Set((data ?? []).map((row: { position: number }) => row.position));
  for (let position = 1; position <= DECK_CARD_LIMIT; position += 1) {
    if (!used.has(position)) return position;
  }
  return null;
}

export async function removeCard(cardId: string): Promise<boolean> {
  await needStudent();
  if (!UUID_RE.test(cardId)) return false;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("flashcards")
    .delete()
    .eq("id", cardId)
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("[decks] removeCard:", error.message);
    return false;
  }
  return !!data;
}

export async function resetDeckProgress(deckId: string): Promise<boolean> {
  await needStudent();
  if (!UUID_RE.test(deckId)) return false;

  const supabase = await createClient();
  const { error } = await supabase.rpc("reset_deck_progress", { p_deck_id: deckId });

  if (error) {
    console.error("[decks] resetProgress:", error.message);
    throw new Error("Could not reset this deck.");
  }
  return true;
}

export async function deleteDeck(deckId: string): Promise<boolean> {
  await needStudent();
  if (!UUID_RE.test(deckId)) return false;

  const supabase = await createClient();
  const { data, error } = await supabase.from("decks").delete().eq("id", deckId).select("id").maybeSingle();
  if (error) {
    console.error("[decks] deleteDeck:", error.message);
    return false;
  }
  return !!data;
}

function isDueNow(card: CardRow, now = Date.now()): boolean {
  if (!card.due_at) return false;
  const due = Date.parse(card.due_at);
  return Number.isFinite(due) && due <= now;
}

function countReady(cards: CardRow[]): number {
  return cards.filter((card) => isDueNow(card)).length;
}

function countDueAgain(cards: CardRow[]): number {
  return cards.filter((card) => card.state === "known" && isDueNow(card)).length;
}

function groupCards(cards: CardRow[]): Map<string, CardRow[]> {
  const map = new Map<string, CardRow[]>();
  for (const card of cards) {
    const list = map.get(card.deck_id) ?? [];
    list.push(card);
    map.set(card.deck_id, list);
  }
  return map;
}

function mapDeck(row: DeckRow, cards: CardRow[]): Deck {
  return {
    id: row.id,
    title: row.title,
    createdAt: Date.parse(row.created_at) || Date.now(),
    cards: [...cards]
      .sort((a, b) => a.position - b.position)
      .map((card) => ({
        id: card.id,
        question: card.question,
        answer: card.answer,
        state: card.state,
      })),
  };
}
