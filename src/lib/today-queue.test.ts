import { describe, expect, it } from "vitest";
import { orderTodayQueue } from "./today-queue";

const now = Date.parse("2026-10-09T04:00:00+08:00");

describe("orderTodayQueue", () => {
  it("studies new cards, then still learning, then known cards that are due", () => {
    const ids = orderTodayQueue(
      [
        { id: "known-later", state: "known", dueAt: "2026-10-12T00:00:00+08:00", position: 1 },
        { id: "known-due", state: "known", dueAt: "2026-10-09T01:00:00+08:00", position: 2 },
        { id: "learning", state: "learning", dueAt: "2026-10-20T00:00:00+08:00", position: 3 },
        { id: "new", state: "unreviewed", dueAt: null, position: 4 },
      ],
      now,
    );

    expect(ids).toEqual(["new", "learning", "known-due"]);
  });
});
