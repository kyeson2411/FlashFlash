import { SectionHeader } from "@/components/layout/PageHeader";
import { cn } from "@/lib/cn";
import type { ProgressSnapshot } from "@/lib/data/progress";

const LEVELS = [
  "border-border bg-raised",
  "border-primary-strong/30 bg-primary-strong/25",
  "border-primary-strong/50 bg-primary-strong/50",
  "border-primary-strong/70 bg-primary-strong/75",
  "border-primary-strong bg-primary-strong",
];

function readyLine(today: number, soon: number, later: number) {
  const verb = (count: number) => (count === 1 ? "is" : "are");
  const known = today === 1 ? "1 known card is" : `${today} known cards are`;
  return `${known} ready today, ${soon} ${verb(soon)} ready in the next 7 days, and ${later} ${verb(later)} ready later.`;
}

function levelFor(count: number, peak: number) {
  if (count === 0) return 0;
  return Math.min(4, Math.max(1, Math.ceil((count / peak) * 4)));
}

export function ProgressBoard({ progress, empty = false }: { progress: ProgressSnapshot; empty?: boolean }) {
  const peak = Math.max(...progress.days.map((day) => day.count), 1);
  const weekTotal = progress.days.reduce((sum, day) => sum + day.count, 0);

  return (
    <section id="week" aria-labelledby="week-heading" className="scroll-mt-16">
      <SectionHeader id="week-heading" title="Activity this week" />
      <div className="space-y-4 rounded-lg border border-border bg-surface p-4">
        <div className="flex items-baseline justify-between gap-3">
          <p className="flex items-baseline gap-2">
            <strong className="text-2xl font-semibold tabular-nums tracking-tight text-ink">{weekTotal}</strong>
            <span className="text-[13px] text-ink-muted">{weekTotal === 1 ? "review saved" : "reviews saved"}</span>
          </p>
          <p className="font-mono text-[11px] text-ink-muted">{progress.streak}-day streak</p>
        </div>

        <ol className="grid grid-cols-7 gap-1.5" aria-label="Reviews saved each day">
          {progress.days.map((day, index) => {
            const isToday = index === progress.days.length - 1;
            return (
              <li key={day.key} className="flex flex-col items-center gap-1.5">
                <span
                  aria-hidden="true"
                  title={`${day.label}: ${day.count}`}
                  className={cn(
                    "aspect-square w-full rounded-[4px] border transition-colors",
                    LEVELS[levelFor(day.count, peak)],
                    isToday && "ring-1 ring-ink/40 ring-offset-2 ring-offset-surface",
                  )}
                />
                <span className={cn("font-mono text-[10px]", isToday ? "text-ink" : "text-ink-muted")}>
                  {day.label === "Today" ? "Tod" : day.label.slice(0, 3)}
                </span>
                <span className="sr-only">
                  {day.label}: {day.count} {day.count === 1 ? "review" : "reviews"}
                </span>
              </li>
            );
          })}
        </ol>

        <div className="flex items-center justify-end gap-1.5 font-mono text-[10px] text-ink-muted" aria-hidden="true">
          Less
          {LEVELS.map((level) => (
            <span key={level} className={cn("size-2.5 rounded-[2px] border", level)} />
          ))}
          More
        </div>

        <p className="border-t border-border pt-3 text-[13px] leading-relaxed text-ink-muted">
          {empty
            ? "Reviews you save will light up here. A day with no reviews stays dark. This is not a grade."
            : readyLine(progress.readyToday, progress.readySoon, progress.readyLater)}
        </p>
      </div>
    </section>
  );
}
