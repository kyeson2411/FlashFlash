import { Card } from "@/components/ui/Card";
import type { ProgressSnapshot } from "@/lib/data/progress";

export function ProgressBoard({ progress }: { progress: ProgressSnapshot }) {
  const streakLabel = progress.streak === 1 ? "1 day" : `${progress.streak} days`;

  return (
    <div className="grid gap-4 md:grid-cols-3">
      <Card className="space-y-1">
        <h3 className="type-helper">Streak</h3>
        <p className="text-3xl font-semibold text-ink">{streakLabel}</p>
        <p className="type-helper">A day counts when you study at least one card.</p>
      </Card>

      <Card className="space-y-3">
        <h3 className="type-helper">Last 7 days</h3>
        <dl className="grid grid-cols-2 gap-4">
          <div>
            <dd className="text-3xl font-semibold text-ink">{progress.known}</dd>
            <dt className="type-helper mt-1">Know it</dt>
          </div>
          <div>
            <dd className="text-3xl font-semibold text-ink">{progress.learning}</dd>
            <dt className="type-helper mt-1">Still learning</dt>
          </div>
        </dl>
      </Card>

      <Card className="space-y-3">
        <h3 className="type-helper">Ready to review</h3>
        <dl className="space-y-2">
          <Count label="Ready today" value={progress.readyToday} />
          <Count label="Next 7 days" value={progress.readySoon} />
          <Count label="Later" value={progress.readyLater} />
        </dl>
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
