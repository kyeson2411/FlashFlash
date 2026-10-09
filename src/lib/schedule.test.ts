import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { applyReview } from "./schedule";

const fresh = { repetitions: 0, intervalDays: 0, easeFactor: 2.5 };

describe("applyReview", () => {
  it("schedules the first Know it for one day", () => {
    expect(applyReview(fresh, "known")).toMatchObject({
      repetitions: 1,
      intervalDays: 1,
      easeFactor: 2.6,
      state: "known",
      dueInDays: 1,
    });
  });

  it("schedules the second Know it for six days", () => {
    const once = applyReview(fresh, "known");
    expect(applyReview(once, "known")).toMatchObject({
      repetitions: 2,
      intervalDays: 6,
      easeFactor: 2.7,
      state: "known",
      dueInDays: 6,
    });
  });

  it("grows the interval from the ease before this review", () => {
    const twice = applyReview(applyReview(fresh, "known"), "known");
    expect(applyReview(twice, "known")).toMatchObject({
      repetitions: 3,
      intervalDays: 16,
      easeFactor: 2.8,
      dueInDays: 16,
    });
  });

  it("makes Still learning due now and resets the interval", () => {
    const known = applyReview(fresh, "known");
    expect(applyReview(known, "learning")).toMatchObject({
      repetitions: 0,
      intervalDays: 0,
      easeFactor: 2.28,
      state: "learning",
      dueInDays: 0,
    });
  });

  it("does not let ease fall below 1.3", () => {
    let state = applyReview(fresh, "learning");
    for (let i = 0; i < 11; i += 1) state = applyReview(state, "learning");
    expect(state.easeFactor).toBe(1.3);
    expect(state.dueInDays).toBe(0);
  });
});

describe("review_flashcard SQL", () => {
  const sql = readFileSync("supabase/migrations/20261009000000_undo_and_progress.sql", "utf8");

  it("uses the same intervals and ease formula as applyReview", () => {
    expect(sql).toContain("v_i := 1");
    expect(sql).toContain("v_i := 6");
    expect(sql).toContain("greatest(1, round(v_i * v_ef)::int)");
    expect(sql).toContain("v_ef + (0.1 - (5 - v_q) * (0.08 + (5 - v_q) * 0.02))");
    expect(sql).toContain("when p_outcome = 'learning' then now()");
  });

  it("can undo only the latest saved answer", () => {
    expect(sql).toContain("undo_last_review");
    expect(sql).toContain("That answer can no longer be undone.");
  });
});
