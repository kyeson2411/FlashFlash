import "server-only";
import { createDeck, getDeckStats, type CardState, type Deck, type DeckSummary } from "@/lib/deck";
import type { StudyMode } from "@/lib/study-mode";
import type { GeneratedDeck } from "@/lib/flashcards";
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

export async function persistGeneratedDeck(
  generated: GeneratedDeck,
  sourceTopic: string,
  existingDeckId: string | null = null,
): Promise<Deck> {
  await needStudent();
  const supabase = await createClient();

  if (existingDeckId) {
    const { data: deckId, error } = await supabase.rpc("add_cards_to_deck", {
      p_deck_id: existingDeckId,
      p_cards: generated.cards,
    });

    if (error || !deckId) {
      console.error("[decks] append:", error?.message ?? "no id");
      if (error?.code === "P0002") throw new Error("That deck is no longer available.");
      if (error?.message?.includes("200 cards")) throw new Error("A deck can hold 200 cards.");
      throw new Error("Your flashcards were generated but could not be saved. Please try again.");
    }

    const deck = await getDeckById(existingDeckId);
    if (!deck) throw new Error("That deck is no longer available.");
    return deck;
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
  if (!deck) {
    const local = createDeck(generated);
    return { ...local, id: String(deckId) };
  }
  return deck;
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

function countReady(cards: CardRow[]): number {
  const now = Date.now();
  return cards.filter((card) => {
    if (!card.due_at) return false;
    const due = Date.parse(card.due_at);
    return Number.isFinite(due) && due <= now;
  }).length;
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
