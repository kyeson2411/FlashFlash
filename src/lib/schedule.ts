// Same steps as public.review_flashcard. Ease is rounded to the numeric(4,2) column.
// Interval uses the ease from before this review. Still learning is due immediately.

export type ScheduleState = {
  repetitions: number;
  intervalDays: number;
  easeFactor: number;
};

export type ScheduleResult = ScheduleState & {
  state: "known" | "learning";
  /** 0 means the card is due now. */
  dueInDays: number;
};

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function applyReview(current: ScheduleState, outcome: "known" | "learning"): ScheduleResult {
  let repetitions = current.repetitions;
  let intervalDays = current.intervalDays;
  let easeFactor = current.easeFactor;
  const quality = outcome === "known" ? 5 : 2;

  if (quality >= 3) {
    if (repetitions === 0) intervalDays = 1;
    else if (repetitions === 1) intervalDays = 6;
    else intervalDays = Math.max(1, Math.round(intervalDays * easeFactor));
    repetitions += 1;
  } else {
    repetitions = 0;
    intervalDays = 0;
  }

  const gap = 5 - quality;
  easeFactor = round2(easeFactor + (0.1 - gap * (0.08 + gap * 0.02)));
  if (easeFactor < 1.3) easeFactor = 1.3;

  return {
    repetitions,
    intervalDays,
    easeFactor,
    state: quality >= 3 ? "known" : "learning",
    dueInDays: outcome === "learning" ? 0 : intervalDays,
  };
}
