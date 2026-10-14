import "server-only";
import {
  createDeck,
  getDeckStats,
  type CardState,
  type Deck,
  type DeckSummary,
  type DeckVersionSummary,
  type DeckWorkflowStatus,
  type Flashcard,
} from "@/lib/deck";
import type { StudyMode } from "@/lib/study-mode";
import type { GeneratedCard, GeneratedDeck } from "@/lib/flashcards";
import { withoutExistingCards } from "@/lib/quality";
import { isTypeableAnswer } from "@/lib/typeable";
import { orderTodayQueue } from "@/lib/today-queue";
import { needStudent } from "@/lib/auth/session";
import { DAILY_GENERATION_LIMIT } from "@/lib/limits";
import { createClient } from "@/lib/supabase/server";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type DeckRow = {
  id: string;
  title: string;
  created_at: string;
  class_id?: string | null;
  owner_id?: string;
  workflow_status?: string | null;
};
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
    await assertCanWriteDeck(existingDeckId);
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

const UNTOUCHED_DUE = "9999-01-01T00:00:00.000Z";

type ProgressRow = { card_id: string; state: CardState; due_at: string };

async function loadClassNames(ids: string[]): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  if (ids.length === 0) return names;
  const supabase = await createClient();
  const { data, error } = await supabase.from("classes").select("id, name").in("id", ids);
  if (error) {
    console.error("[decks] class names:", error.message);
    return names;
  }
  for (const row of data ?? []) names.set(String(row.id), String(row.name));
  return names;
}

async function loadOwnProgress(cardIds: string[]): Promise<Map<string, ProgressRow>> {
  const progress = new Map<string, ProgressRow>();
  if (cardIds.length === 0) return progress;
  const student = await needStudent();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("student_card_progress")
    .select("card_id, state, due_at")
    .eq("student_id", student.id)
    .in("card_id", cardIds);

  if (error) {
    console.error("[decks] progress:", error.message);
    throw new Error("Could not load your decks.");
  }

  for (const row of data ?? []) {
    progress.set(String(row.card_id), {
      card_id: String(row.card_id),
      state: row.state,
      due_at: String(row.due_at),
    });
  }
  return progress;
}

function withMemberProgress(cards: CardRow[], progress: Map<string, ProgressRow>): CardRow[] {
  return cards.map((card) => {
    const row = progress.get(card.id);
    if (!row) return { ...card, state: "unreviewed", due_at: UNTOUCHED_DUE };
    return { ...card, state: row.state, due_at: row.due_at };
  });
}

export async function assertCanWriteDeck(deckId: string): Promise<void> {
  const student = await needStudent();
  const deck = await getDeckById(deckId);
  if (!deck) throw new Error("That deck is no longer available.");
  if (student.role === "teacher") {
    if (!deck.classId || deck.ownerId !== student.id) {
      throw new Error("Choose a deck from one of your classes.");
    }
    return;
  }
  if (deck.classId || deck.ownerId !== student.id) {
    throw new Error("Only the teacher can add cards to this class.");
  }
}

const DECK_WORKFLOW_ERRORS = [
  "Mark this deck reviewed before publishing.",
  "This deck has no cards.",
  "This deck is already published.",
  "This deck is already reviewed.",
  "That deck is no longer available.",
];

export async function setDeckWorkflow(deckId: string, status: "teacher_reviewed" | "published"): Promise<void> {
  const student = await needStudent();
  if (student.role !== "teacher" || !UUID_RE.test(deckId)) {
    throw new Error("That deck is no longer available.");
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_deck_workflow", { p_deck_id: deckId, p_status: status });
  if (!error) return;

  const message = error.message ?? "";
  if (/schema cache|does not exist|could not find the function/i.test(message)) {
    throw new Error("Deck review needs a database update. Run the latest SQL migration, then try again.");
  }
  throw new Error(
    DECK_WORKFLOW_ERRORS.find((item) => message.includes(item)) ?? "This deck could not be updated. Please try again.",
  );
}

export async function listDeckSummaries(): Promise<DeckSummary[]> {
  const student = await needStudent();
  const supabase = await createClient();

  const loaded = await loadDeckRows(supabase);

  if (loaded.error) {
    console.error("[decks] list:", loaded.error.message);
    throw new Error("Could not load your decks.");
  }
  const decks = loaded.rows;
  if (decks.length === 0) return [];

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
  const classNames = await loadClassNames(
    [...new Set(decks.map((row: DeckRow) => row.class_id).filter((id: string | null | undefined): id is string => !!id))],
  );
  const memberCardIds = decks.flatMap((row: DeckRow) =>
    row.class_id && row.owner_id !== student.id ? (byDeck.get(row.id) ?? []).map((card) => card.id) : [],
  );
  const progress = await loadOwnProgress(memberCardIds);

  return decks.map((row: DeckRow) => {
    const memberDeck = !!row.class_id && row.owner_id !== student.id;
    const deckCards = memberDeck
      ? withMemberProgress(byDeck.get(row.id) ?? [], progress)
      : (byDeck.get(row.id) ?? []);
    const mapped = mapDeck(row, deckCards, classNames.get(row.class_id ?? "") ?? null);
    return {
      id: mapped.id,
      title: mapped.title,
      createdAt: mapped.createdAt,
      stats: getDeckStats(mapped),
      readyCount: countReady(deckCards),
      dueAgainCount: countDueAgain(deckCards),
      classId: row.class_id ?? null,
      className: row.class_id ? classNames.get(row.class_id) ?? null : null,
      workflowStatus: workflowStatusOf(row, loaded.workflowKnown),
    };
  });
}

export type StudyPack = {
  deckId: string;
  title: string;
  classId: string | null;
  cards: { id: string; question: string; answer: string; state: CardState }[];
  queueIds: string[];
};

/** Decks this account can study, with the queue that is ready today. */
export async function listStudyPacks(): Promise<StudyPack[]> {
  const student = await needStudent();
  const supabase = await createClient();
  const loaded = await loadDeckRows(supabase);
  if (loaded.error) {
    console.error("[decks] study packs:", loaded.error.message);
    throw new Error("Could not load your decks.");
  }
  if (loaded.rows.length === 0) return [];

  const studyRows = loaded.rows.filter((row: DeckRow) => {
    if (row.class_id && row.owner_id === student.id) return false;
    if (row.class_id && workflowStatusOf(row, loaded.workflowKnown) !== "published") return false;
    return true;
  });
  if (studyRows.length === 0) return [];

  const ids = studyRows.map((row: DeckRow) => row.id);
  const { data: cards, error: cardError } = await supabase
    .from("flashcards")
    .select("id, deck_id, position, question, answer, state, due_at")
    .in("deck_id", ids)
    .order("position");
  if (cardError) {
    console.error("[decks] study packs cards:", cardError.message);
    throw new Error("Could not load your decks.");
  }

  const byDeck = groupCards(cards ?? []);
  const memberCardIds = studyRows.flatMap((row: DeckRow) =>
    row.class_id && row.owner_id !== student.id ? (byDeck.get(row.id) ?? []).map((card) => card.id) : [],
  );
  const progress = await loadOwnProgress(memberCardIds);

  return studyRows.map((row: DeckRow) => {
    const memberDeck = !!row.class_id && row.owner_id !== student.id;
    const deckCards = memberDeck
      ? withMemberProgress(byDeck.get(row.id) ?? [], progress)
      : (byDeck.get(row.id) ?? []);
    const ordered = [...deckCards].sort((a, b) => a.position - b.position);
    return {
      deckId: row.id,
      title: row.title,
      classId: row.class_id ?? null,
      cards: ordered.map((card) => ({
        id: card.id,
        question: card.question,
        answer: card.answer,
        state: card.state,
      })),
      queueIds: orderTodayQueue(
        ordered.map((card) => ({
          id: card.id,
          state: card.state,
          dueAt: card.due_at ?? null,
          position: card.position,
        })),
      ),
    };
  });
}

export async function getDeckById(deckId: string): Promise<Deck | null> {
  const student = await needStudent();
  if (!UUID_RE.test(deckId)) return null;

  const supabase = await createClient();
  const loaded = await loadDeckRows(supabase, deckId);
  const row = loaded.rows[0] ?? null;
  const error = loaded.error;

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

  const memberDeck = !!row.class_id && row.owner_id !== student.id;
  const classNames = row.class_id ? await loadClassNames([row.class_id]) : new Map<string, string>();
  let deckCards = cards ?? [];
  if (memberDeck) {
    deckCards = withMemberProgress(
      deckCards,
      await loadOwnProgress(deckCards.map((card: CardRow) => card.id)),
    );
  }

  const deck = mapDeck(row, deckCards, row.class_id ? classNames.get(row.class_id) ?? null : null);
  deck.workflowStatus = workflowStatusOf(row, loaded.workflowKnown);
  if (row.class_id && row.owner_id === student.id) {
    deck.versions = await loadDeckVersions(deckId);
  }
  return deck;
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

/** Today's queue: new cards, cards still being learned, then known cards that are due. */
export async function getDueCardIds(deckId: string): Promise<string[]> {
  const student = await needStudent();
  if (!UUID_RE.test(deckId)) return [];

  const supabase = await createClient();
  const { data: deck, error: deckError } = await supabase
    .from("decks")
    .select("owner_id, class_id")
    .eq("id", deckId)
    .maybeSingle();

  if (deckError && !missingClassColumn(deckError)) return [];
  if (!deckError && (!deck || (deck.class_id && deck.owner_id !== student.id))) {
    if (!deck) return [];
    const { data: cards, error: cardError } = await supabase
      .from("flashcards")
      .select("id, position")
      .eq("deck_id", deckId)
      .order("position");
    if (cardError) {
      console.error("[decks] due cards:", cardError.message);
      throw new Error("Could not load cards that are ready to study.");
    }
    const rows = (cards ?? []) as { id: string; position: number }[];
    if (rows.length === 0) return [];
    const { data: progress, error } = await supabase
      .from("student_card_progress")
      .select("card_id, state, due_at")
      .eq("student_id", student.id)
      .in(
        "card_id",
        rows.map((row) => row.id),
      );
    if (error) {
      console.error("[decks] due cards:", error.message);
      throw new Error("Could not load cards that are ready to study.");
    }
    const byCard = new Map((progress ?? []).map((row: ProgressRow) => [row.card_id, row]));
    return orderTodayQueue(
      rows.map((row) => {
        const saved = byCard.get(row.id);
        return {
          id: row.id,
          position: row.position,
          state: saved?.state ?? "unreviewed",
          dueAt: saved?.due_at ?? null,
        };
      }),
    );
  }

  const { data, error } = await supabase
    .from("flashcards")
    .select("id, state, due_at, position")
    .eq("deck_id", deckId);

  if (error) {
    console.error("[decks] due cards:", error.message);
    throw new Error("Could not load cards that are ready to study.");
  }

  return orderTodayQueue(
    ((data ?? []) as { id: string; state: string; due_at: string; position: number }[]).map((row) => ({
      id: row.id,
      state: row.state,
      dueAt: row.due_at,
      position: row.position,
    })),
  );
}

export async function undoLastReview(cardId: string): Promise<void> {
  await needStudent();
  if (!UUID_RE.test(cardId)) throw new Error("That card is no longer in this deck.");

  const supabase = await createClient();
  const { error } = await supabase.rpc("undo_last_review", { p_card_id: cardId });
  if (!error) return;

  console.error("[decks] undo:", error.message);
  if (error.code === "P0002") throw new Error("That card is no longer in this deck.");
  if (error.code === "PGRST202" || error.code === "42883" || /undo_last_review|schema cache/i.test(error.message)) {
    throw new Error("Undo needs a database update. Run the latest SQL migration, then try again.");
  }
  if (/no longer be undone/i.test(error.message)) {
    throw new Error("That answer can no longer be undone.");
  }
  throw new Error("That answer could not be undone. Please try again.");
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
  try {
    await assertCanWriteDeck(deckId);
  } catch (error) {
    throw new CardTextError(error instanceof Error ? error.message : "This card could not be saved. Please try again.");
  }
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
  try {
    await assertCanWriteDeck(deck.id);
  } catch (error) {
    throw new CardTextError(error instanceof Error ? error.message : "This card could not be saved. Please try again.");
  }
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
      throw new CardTextError("Editing cards requires a database update. Run the latest SQL migration, then try again.");
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

function missingClassColumn(error: { message: string } | null): boolean {
  return !!error && /class_id|owner_id|schema cache|column/i.test(error.message);
}

function missingWorkflowColumn(error: { message: string } | null): boolean {
  return !!error && /workflow_status/i.test(error.message);
}

type DeckLoad = {
  rows: DeckRow[];
  workflowKnown: boolean;
  error: { message: string } | null;
};

async function loadDeckRows(
  supabase: Awaited<ReturnType<typeof createClient>>,
  deckId?: string,
): Promise<DeckLoad> {
  const withWorkflow = deckId
    ? await supabase
        .from("decks")
        .select("id, title, created_at, class_id, owner_id, workflow_status")
        .eq("id", deckId)
        .maybeSingle()
    : await supabase
        .from("decks")
        .select("id, title, created_at, class_id, owner_id, workflow_status")
        .order("created_at", { ascending: false });

  if (!missingWorkflowColumn(withWorkflow.error)) {
    return {
      rows: asDeckRows(withWorkflow.data),
      workflowKnown: true,
      error: withWorkflow.error,
    };
  }

  const withClass = deckId
    ? await supabase
        .from("decks")
        .select("id, title, created_at, class_id, owner_id")
        .eq("id", deckId)
        .maybeSingle()
    : await supabase.from("decks").select("id, title, created_at, class_id, owner_id").order("created_at", { ascending: false });
  const legacy = missingClassColumn(withClass.error)
    ? deckId
      ? await supabase.from("decks").select("id, title, created_at").eq("id", deckId).maybeSingle()
      : await supabase.from("decks").select("id, title, created_at").order("created_at", { ascending: false })
    : null;
  const chosen = legacy ?? withClass;
  return { rows: asDeckRows(chosen.data), workflowKnown: false, error: chosen.error };
}

function asDeckRows(data: unknown): DeckRow[] {
  if (Array.isArray(data)) return data as DeckRow[];
  if (data && typeof data === "object") return [data as DeckRow];
  return [];
}

function workflowStatusOf(row: DeckRow, workflowKnown: boolean): DeckWorkflowStatus | null {
  if (!row.class_id) return null;
  if (!workflowKnown) return "published";
  if (
    row.workflow_status === "draft" ||
    row.workflow_status === "teacher_reviewed" ||
    row.workflow_status === "published"
  ) {
    return row.workflow_status;
  }
  return "published";
}

async function loadDeckVersions(deckId: string): Promise<DeckVersionSummary[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("deck_versions")
    .select("version_number, created_at, cards")
    .eq("deck_id", deckId)
    .order("version_number", { ascending: false });
  if (error || !data) return [];
  return data.map((row) => ({
    number: Number(row.version_number),
    createdAt: String(row.created_at),
    cardCount: Array.isArray(row.cards) ? row.cards.length : 0,
  }));
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

function mapDeck(row: DeckRow, cards: CardRow[], className: string | null = null): Deck {
  return {
    id: row.id,
    title: row.title,
    createdAt: Date.parse(row.created_at) || Date.now(),
    classId: row.class_id ?? null,
    className,
    ownerId: row.owner_id,
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
