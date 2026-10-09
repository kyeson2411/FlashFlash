// Pure progress math. public.student_progress_snapshot() in SQL must count the same way.

export const PROGRESS_TIME_ZONE = "Asia/Manila";

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

export type ReviewRow = { outcome: "known" | "learning"; reviewed_at: string };
export type DueRow = { due_at: string; state: string };

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

/** Turns the SQL aggregate into the snapshot the dashboard renders. */
export function snapshotFromAggregate(raw: unknown, now: Date): ProgressSnapshot | null {
  if (typeof raw !== "object" || raw === null) return null;
  const value = raw as Record<string, unknown>;
  if (typeof value.streak !== "number" || !Number.isFinite(value.streak)) return null;
  if (!Array.isArray(value.days)) return null;
  if (typeof value.ready_today !== "number" || typeof value.ready_soon !== "number" || typeof value.ready_later !== "number") {
    return null;
  }
  if (typeof value.has_reviews !== "boolean" || typeof value.has_cards !== "boolean") return null;

  const today = manilaDateKey(now);
  const days: ProgressDay[] = [];
  for (const day of value.days) {
    if (typeof day !== "object" || day === null) return null;
    const row = day as Record<string, unknown>;
    if (typeof row.key !== "string" || typeof row.count !== "number") return null;
    days.push({
      key: row.key,
      count: row.count,
      label: row.key === today ? "Today" : weekdayLabel(row.key),
    });
  }

  return {
    streak: value.streak,
    days,
    readyToday: value.ready_today,
    readySoon: value.ready_soon,
    readyLater: value.ready_later,
    hasReviews: value.has_reviews,
    hasCards: value.has_cards,
  };
}

function weekdayLabel(key: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: PROGRESS_TIME_ZONE,
    weekday: "short",
  }).format(new Date(`${key}T12:00:00+08:00`));
}

export function manilaDateKey(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: PROGRESS_TIME_ZONE,
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
