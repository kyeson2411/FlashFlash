import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { manilaDateKey, snapshotFromAggregate, summarizeProgress } from "./progress-summary";

const now = new Date("2026-10-09T02:00:00+08:00");

describe("summarizeProgress", () => {
  it("counts a streak through today and stops at a gap", () => {
    const snapshot = summarizeProgress(
      [
        { outcome: "known", reviewed_at: "2026-10-09T01:00:00+08:00" },
        { outcome: "learning", reviewed_at: "2026-10-08T23:00:00+08:00" },
        { outcome: "known", reviewed_at: "2026-10-06T12:00:00+08:00" },
      ],
      [
        { state: "known", due_at: "2026-10-09T01:00:00+08:00" },
        { state: "known", due_at: "2026-10-12T00:00:00+08:00" },
        { state: "known", due_at: "2026-11-01T00:00:00+08:00" },
        { state: "learning", due_at: "2026-10-09T01:00:00+08:00" },
      ],
      now,
    );

    expect(snapshot.streak).toBe(2);
    expect(snapshot.days.find((day) => day.label === "Today")?.count).toBe(1);
    expect(snapshot.readyToday).toBe(1);
    expect(snapshot.readySoon).toBe(1);
    expect(snapshot.readyLater).toBe(1);
    expect(snapshot.hasReviews).toBe(true);
    expect(snapshot.hasCards).toBe(true);
  });

  it("keeps yesterday's streak when today has no review yet", () => {
    const snapshot = summarizeProgress(
      [{ outcome: "known", reviewed_at: "2026-10-08T12:00:00+08:00" }],
      [],
      now,
    );
    expect(snapshot.streak).toBe(1);
    expect(snapshot.hasCards).toBe(false);
  });
});

describe("snapshotFromAggregate", () => {
  it("labels the SQL day keys in Manila", () => {
    const today = manilaDateKey(now);
    const snapshot = snapshotFromAggregate(
      {
        streak: 2,
        days: [{ key: today, count: 4 }],
        ready_today: 1,
        ready_soon: 0,
        ready_later: 3,
        has_reviews: true,
        has_cards: true,
      },
      now,
    );

    expect(snapshot).toMatchObject({
      streak: 2,
      readyToday: 1,
      readySoon: 0,
      readyLater: 3,
      days: [{ key: today, label: "Today", count: 4 }],
    });
  });
});

describe("student_progress_snapshot SQL", () => {
  const sql = readFileSync("supabase/migrations/20261009000000_undo_and_progress.sql", "utf8");

  it("aggregates the streak and the Manila week in the database", () => {
    expect(sql).toContain("student_progress_snapshot");
    expect(sql).toContain("Asia/Manila");
    expect(sql).toContain("deck_last_reviewed");
    expect(sql).toContain("v_today - 6");
    expect(sql).toContain("v_today + 8");
  });
});
