// Today's study pass: new cards, cards still being learned, then known cards that are due.
// Known cards that are still waiting stay out of the queue.

export type TodayCard = {
  id: string;
  state: string;
  dueAt?: string | null;
  position: number;
};

const RANK: Record<string, number> = {
  unreviewed: 0,
  learning: 1,
  known: 2,
};

export function orderTodayQueue(cards: TodayCard[], now = Date.now()): string[] {
  return cards
    .filter((card) => included(card, now))
    .sort((a, b) => (RANK[a.state] ?? 9) - (RANK[b.state] ?? 9) || a.position - b.position)
    .map((card) => card.id);
}

function included(card: TodayCard, now: number): boolean {
  if (card.state === "unreviewed" || card.state === "learning") return true;
  if (card.state !== "known") return false;
  const due = Date.parse(card.dueAt ?? "");
  return Number.isFinite(due) && due <= now;
}
