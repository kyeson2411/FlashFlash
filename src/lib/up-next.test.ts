import { describe, expect, it } from "vitest";
import { mostToStudy, pickUpNext, type DeckStats } from "@/lib/deck";

function stats(total: number, known: number, learning: number): DeckStats {
  const reviewed = known + learning;
  return {
    total,
    known,
    learning,
    unreviewed: total - reviewed,
    reviewed,
    percentReviewed: total === 0 ? 0 : Math.round((reviewed / total) * 100),
  };
}

const allKnown = { id: "known", stats: stats(10, 10, 0), readyCount: 0 };
const few = { id: "few", stats: stats(10, 7, 1), readyCount: 0 };
const many = { id: "many", stats: stats(20, 2, 3), readyCount: 0 };

describe("pickUpNext", () => {
  it("puts an overdue quiz before an open one", () => {
    const quizzes = [
      { id: "open", window: "open", finished: false },
      { id: "late", window: "late", finished: false },
    ];
    expect(pickUpNext(quizzes, [many])).toEqual({ kind: "quiz", id: "late" });
  });

  it("puts an open quiz before any deck", () => {
    expect(pickUpNext([{ id: "open", window: "open", finished: false }], [many])).toEqual({ kind: "quiz", id: "open" });
  });

  it("skips finished, closed, and not yet open quizzes", () => {
    const quizzes = [
      { id: "done", window: "open", finished: true },
      { id: "closed", window: "closed", finished: false },
      { id: "soon", window: "not_open", finished: false },
    ];
    expect(pickUpNext(quizzes, [few, many])).toEqual({ kind: "deck", id: "many" });
  });

  it("returns null when nothing is due", () => {
    expect(pickUpNext([], [allKnown])).toBeNull();
    expect(pickUpNext([], [])).toBeNull();
  });
});

describe("mostToStudy", () => {
  it("picks the deck with the most cards to learn", () => {
    expect(mostToStudy([few, many, allKnown])?.id).toBe("many");
  });

  it("uses cards ready to review when nothing is left to learn", () => {
    const ready = { id: "ready", stats: stats(10, 10, 0), readyCount: 4 };
    expect(mostToStudy([allKnown, ready])?.id).toBe("ready");
  });
});
