import type { DeckStats } from "@/lib/deck";

// Segmented bar: known (green), still learning (amber), unreviewed (empty).
// The numbers and labels beside it carry the meaning, so color is only a helper.
function ProgressBar({ stats }: { stats: DeckStats }) {
  const pct = (n: number) => (stats.total === 0 ? 0 : (n / stats.total) * 100);

  return (
    <div
      role="progressbar"
      aria-label="Cards reviewed"
      aria-valuemin={0}
      aria-valuemax={stats.total}
      aria-valuenow={stats.reviewed}
      aria-valuetext={`${stats.reviewed} of ${stats.total} cards reviewed`}
      className="flex h-2.5 w-full overflow-hidden rounded-full bg-border"
    >
      <div className="bg-success-fill transition-[width]" style={{ width: `${pct(stats.known)}%` }} />
      <div className="bg-warning-fill transition-[width]" style={{ width: `${pct(stats.learning)}%` }} />
    </div>
  );
}

export function reviewedText(stats: DeckStats) {
  return `${stats.reviewed} of ${stats.total} ${stats.total === 1 ? "card" : "cards"} reviewed`;
}

// Full progress block used on the deck page.
export function DeckProgress({ stats }: { stats: DeckStats }) {
  const items = [
    { label: "Known", value: stats.known },
    { label: "Still learning", value: stats.learning },
    { label: "Unreviewed", value: stats.unreviewed },
  ];

  return (
    <div className="space-y-4">
      <p className="type-section">{reviewedText(stats)}</p>
      <ProgressBar stats={stats} />
      <dl className="grid grid-cols-3 gap-3">
        {items.map((item) => (
          <div key={item.label}>
            <dd className="text-2xl font-semibold leading-none text-ink">{item.value}</dd>
            <dt className="type-helper mt-1">{item.label}</dt>
          </div>
        ))}
      </dl>
    </div>
  );
}

// Smaller version used on summary cards.
export function DeckProgressCompact({ stats }: { stats: DeckStats }) {
  return (
    <div className="space-y-2">
      <ProgressBar stats={stats} />
      <p className="type-helper">
        {reviewedText(stats)} · {stats.known} known · {stats.learning} still learning
      </p>
    </div>
  );
}
