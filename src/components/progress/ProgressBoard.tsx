import type { ProgressSnapshot } from "@/lib/data/progress";

export function ProgressBoard({
  progress,
  cards,
}: {
  progress: ProgressSnapshot;
  cards: { known: number; toLearn: number };
}) {
  const peak = Math.max(...progress.days.map((day) => day.count), 1);
  const weekTotal = progress.days.reduce((sum, day) => sum + day.count, 0);

  return (
    <section className="af-section" id="week" aria-labelledby="week-heading">
      <div className="af-section-head">
        <div>
          <h3 id="week-heading">Your week, in moments</h3>
          <p>Every review is a win. This is not a grade.</p>
        </div>
      </div>
      <div className="af-week-amount">
        {weekTotal}
        <small>reviews saved</small>
      </div>
      <div className="af-week-chart" aria-label="Reviews saved each day">
        {progress.days.map((day, index) => (
          <div
            className={index === progress.days.length - 1 ? "af-day current" : "af-day"}
            key={day.key}
            aria-label={`${day.label}, ${day.count} ${day.count === 1 ? "review" : "reviews"}`}
          >
            <div className="af-bar" style={{ height: `${Math.max(5, (day.count / peak) * 66)}px` }} />
            <span>{day.label === "Today" ? "Today" : day.label.slice(0, 1)}</span>
          </div>
        ))}
      </div>
      <p className="af-week-foot">
        {cards.known} known · {cards.toLearn} still to learn · {progress.readyToday} known cards ready today,{" "}
        {progress.readySoon} in the next 7 days, {progress.readyLater} later.
      </p>
    </section>
  );
}
