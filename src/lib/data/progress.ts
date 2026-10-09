import "server-only";
import { needStudent } from "@/lib/auth/session";
import type { DeckSummary } from "@/lib/deck";
import { snapshotFromAggregate, summarizeProgress, type DueRow, type ReviewRow } from "@/lib/progress-summary";
import { createClient } from "@/lib/supabase/server";

export type { ProgressDay, ProgressSnapshot } from "@/lib/progress-summary";
export { summarizeProgress } from "@/lib/progress-summary";

const QUIET_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

function safeJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function missingRpc(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return error.code === "PGRST202" || error.code === "42883" || /function|schema cache/i.test(error.message ?? "");
}

/** Personal study activity for the signed-in student. Never reads another account. */
export async function getProgress() {
  const student = await needStudent();
  const supabase = await createClient();
  const now = new Date();

  const { data, error } = await supabase.rpc("student_progress_snapshot");
  if (!error) {
    const payload = typeof data === "string" ? safeJson(data) : data;
    const snapshot = snapshotFromAggregate(payload, now);
    if (snapshot) return snapshot;
    console.error("[progress] snapshot shape");
  } else if (!missingRpc(error)) {
    console.error("[progress] snapshot:", error.message);
    throw new Error("Could not load your progress.");
  } else {
    console.error("[progress] snapshot missing, counting reviews in the app. Run the latest SQL migration.");
  }

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
  const grouped = await supabase.rpc("deck_last_reviewed");

  let latest = new Map<string, number>();
  if (!grouped.error) {
    for (const row of (grouped.data ?? []) as { deck_id: string | null; reviewed_at: string }[]) {
      if (!row.deck_id) continue;
      const at = Date.parse(row.reviewed_at);
      if (!Number.isNaN(at)) latest.set(row.deck_id, at);
    }
  } else if (!missingRpc(grouped.error)) {
    console.error("[progress] quiet deck:", grouped.error.message);
    throw new Error("Could not load your progress.");
  } else {
    console.error("[progress] deck_last_reviewed missing. Run the latest SQL migration.");
    const { data, error } = await supabase
      .from("review_events")
      .select("deck_id, reviewed_at")
      .eq("owner_id", student.id);

    if (error) {
      console.error("[progress] quiet deck:", error.message);
      throw new Error("Could not load your progress.");
    }

    latest = new Map();
    for (const row of (data ?? []) as { deck_id: string | null; reviewed_at: string }[]) {
      if (!row.deck_id) continue;
      const at = Date.parse(row.reviewed_at);
      if (Number.isNaN(at)) continue;
      const previous = latest.get(row.deck_id);
      if (previous === undefined || at > previous) latest.set(row.deck_id, at);
    }
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
