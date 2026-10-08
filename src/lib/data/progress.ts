import "server-only";
import { needStudent } from "@/lib/auth/session";
import type { DeckSummary } from "@/lib/deck";
import { createClient } from "@/lib/supabase/server";

const QUIET_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

const TIME_ZONE = "Asia/Manila";

export type ProgressDay = {
  key: string;
  label: string;
  count: number;
};

export type ProgressSnapshot = {
  streak: number;
  days: ProgressDay[];
  readyToday: number;
  readySoon: number;
  readyLater: number;
  hasReviews: boolean;
  hasCards: boolean;
};

type ReviewRow = { outcome: "known" | "learning"; reviewed_at: string };
type DueRow = { due_at: string; state: string };

/** Personal study activity for the signed-in student. Never reads another account. */
export async function getProgress(): Promise<ProgressSnapshot> {
  const student = await needStudent();
  const supabase = await createClient();
  const now = new Date();

  const { data: events, error: eventError } = await supabase
    .from("review_events")
    .select("outcome, reviewed_at")
    .eq("owner_id", student.id);

  if (eventError) {
    console.error("[progress] reviews:", eventError.message);
    throw new Error("Could not load your progress.");
  }

  const { data: cards, error: cardError } = await supabase.from("flashcards").select("due_at, state");

  if (cardError) {
    console.error("[progress] cards:", cardError.message);
    throw new Error("Could not load your progress.");
  }

  return summarizeProgress((events ?? []) as ReviewRow[], (cards ?? []) as DueRow[], now);
}

/** Deck that holds the known card whose review time arrived soonest. */
export async function getEarliestReadyDeckId(): Promise<string | null> {
  await needStudent();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("flashcards")
    .select("deck_id")
    .eq("state", "known")
    .lte("due_at", new Date().toISOString())
    .order("due_at")
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("[progress] ready deck:", error.message);
    throw new Error("Could not load your progress.");
  }

  return data?.deck_id ?? null;
}

/** Deck with cards that has not been studied for 7 days. A new deck is left alone. */
export async function getQuietDeck(decks: DeckSummary[]): Promise<{ id: string; title: string } | null> {
  const candidates = decks.filter((deck) => deck.stats.total > 0);
  if (candidates.length === 0) return null;

  const student = await needStudent();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("review_events")
    .select("deck_id, reviewed_at")
    .eq("owner_id", student.id);

  if (error) {
    console.error("[progress] quiet deck:", error.message);
    throw new Error("Could not load your progress.");
  }

  const latest = new Map<string, number>();
  for (const row of (data ?? []) as { deck_id: string | null; reviewed_at: string }[]) {
    if (!row.deck_id) continue;
    const at = Date.parse(row.reviewed_at);
    if (Number.isNaN(at)) continue;
    const previous = latest.get(row.deck_id);
    if (previous === undefined || at > previous) latest.set(row.deck_id, at);
  }

  const cutoff = Date.now() - QUIET_AFTER_MS;
  let chosen: { id: string; title: string; since: number } | null = null;

  for (const deck of candidates) {
    const last = latest.get(deck.id);
    if (last === undefined && deck.createdAt > cutoff) continue;
    const since = last ?? deck.createdAt;
    if (since > cutoff) continue;
    if (!chosen || since < chosen.since) chosen = { id: deck.id, title: deck.title, since };
  }

  return chosen ? { id: chosen.id, title: chosen.title } : null;
}

export function summarizeProgress(events: ReviewRow[], cards: DueRow[], now: Date): ProgressSnapshot {
  const today = manilaDateKey(now);
  const studied = new Set(events.map((event) => manilaDateKey(new Date(event.reviewed_at))));

  let streak = 0;
  let cursor = studied.has(today) ? today : addDays(today, -1);
  if (studied.has(cursor)) {
    while (studied.has(cursor)) {
      streak += 1;
      cursor = addDays(cursor, -1);
    }
  }

  const dayCounts = new Map<string, number>();
  for (let offset = 6; offset >= 0; offset -= 1) dayCounts.set(addDays(today, -offset), 0);
  for (const event of events) {
    const key = manilaDateKey(new Date(event.reviewed_at));
    if (!dayCounts.has(key)) continue;
    dayCounts.set(key, (dayCounts.get(key) ?? 0) + 1);
  }
  const days = [...dayCounts.entries()].map(([key, count]) => ({
    key,
    label: key === today ? "Today" : weekdayLabel(key),
    count,
  }));

  const tomorrow = manilaStart(addDays(today, 1));
  const soonEnd = manilaStart(addDays(today, 8));
  let readyToday = 0;
  let readySoon = 0;
  let readyLater = 0;

  for (const card of cards) {
    if (card.state !== "known") continue;
    const due = Date.parse(card.due_at);
    if (Number.isNaN(due) || due < tomorrow) readyToday += 1;
    else if (due < soonEnd) readySoon += 1;
    else readyLater += 1;
  }

  return {
    streak,
    days,
    readyToday,
    readySoon,
    readyLater,
    hasReviews: events.length > 0,
    hasCards: cards.length > 0,
  };
}

function weekdayLabel(key: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    weekday: "short",
  }).format(new Date(`${key}T12:00:00+08:00`));
}

function manilaDateKey(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function addDays(key: string, days: number): string {
  const [year, month, day] = key.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function manilaStart(key: string): number {
  return Date.parse(`${key}T00:00:00+08:00`);
}
