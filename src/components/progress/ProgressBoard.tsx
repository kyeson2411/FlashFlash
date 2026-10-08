import type { ProgressSnapshot } from "@/lib/data/progress";

export function ProgressBoard({ progress }: { progress: ProgressSnapshot }) {
  const peak = Math.max(...progress.days.map((day) => day.count), 1);
  const weekTotal = progress.days.reduce((sum, day) => sum + day.count, 0);

  return (
    <section className="dash-panel" id="week" aria-labelledby="week-heading">
      <div className="dash-panel-head">
        <div>
          <h2 id="week-heading">This week</h2>
          <p>Reviews you saved. This is not a grade.</p>
        </div>
      </div>
      <p className="dash-week-total">
        <strong>{weekTotal}</strong>
        <span>{weekTotal === 1 ? "review saved" : "reviews saved"}</span>
      </p>
      <div className="dash-week" aria-label="Reviews saved each day">
        {progress.days.map((day, index) => (
          <div className={index === progress.days.length - 1 ? "dash-day is-today" : "dash-day"} key={day.key}>
            <div className="dash-bar-track" aria-hidden="true">
              <div className="dash-bar" style={{ height: `${Math.max(8, (day.count / peak) * 100)}%` }} />
            </div>
            <span className="dash-day-count">{day.count}</span>
            <span className="dash-day-label">{day.label}</span>
          </div>
        ))}
      </div>
      <p className="dash-week-note">
        {progress.readyToday} known {progress.readyToday === 1 ? "card is" : "cards are"} ready today,{" "}
        {progress.readySoon} in the next 7 days, and {progress.readyLater} later. A quiet day shows 0.
      </p>
    </section>
  );
}
