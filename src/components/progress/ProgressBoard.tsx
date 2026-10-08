import { Card } from "@/components/ui/Card";
import type { ProgressSnapshot } from "@/lib/data/progress";

export function ProgressBoard({
  progress,
  cards,
}: {
  progress: ProgressSnapshot;
  cards: { known: number; toLearn: number };
}) {
  const streakLabel = progress.streak === 1 ? "1 day" : `${progress.streak} days`;

  return (
    <div className="grid gap-4 md:grid-cols-3">
      <Card className="space-y-1">
        <h3 className="type-helper">Streak</h3>
        <p className="text-3xl font-semibold text-ink">{streakLabel}</p>
        <p className="type-helper">A day counts when you study at least one card.</p>
      </Card>

      <Card className="space-y-3">
        <h3 className="type-helper">Your cards</h3>
        <dl className="grid grid-cols-2 gap-4">
          <div>
            <dd className="text-3xl font-semibold text-ink">{cards.known}</dd>
            <dt className="type-helper mt-1">Known</dt>
          </div>
          <div>
            <dd className="text-3xl font-semibold text-ink">{cards.toLearn}</dd>
            <dt className="type-helper mt-1">Still to learn</dt>
          </div>
        </dl>
        <p className="type-helper">Each card is counted once.</p>
      </Card>

      <Card className="space-y-3">
        <h3 className="type-helper">Ready to review</h3>
        <dl className="space-y-2">
          <Count label="Ready today" value={progress.readyToday} />
          <Count label="Next 7 days" value={progress.readySoon} />
          <Count label="Later" value={progress.readyLater} />
        </dl>
        <p className="type-helper">Cards you already marked as known.</p>
      </Card>

      <Card className="space-y-3 md:col-span-3">
        <h3 className="type-helper">Last 7 days</h3>
        <ol className="grid grid-cols-7 gap-1">
          {progress.days.map((day) => (
            <li
              key={day.key}
              className="min-w-0 text-center"
              aria-label={`${day.label}, ${day.count} ${day.count === 1 ? "review" : "reviews"}`}
            >
              <p className="text-lg font-semibold text-ink">{day.count}</p>
              <p className="type-helper">{day.label}</p>
            </li>
          ))}
        </ol>
        <p className="type-helper">Reviews you saved each day. A quiet day shows 0.</p>
      </Card>
    </div>
  );
}

function Count({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-sm font-medium text-ink">{label}</dt>
      <dd className="text-lg font-semibold text-ink">{value}</dd>
    </div>
  );
}
