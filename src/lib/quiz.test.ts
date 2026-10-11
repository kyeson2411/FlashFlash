import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Flashcard } from "./deck";
import {
  answersMatch,
  dueCloseInstant,
  dueDayLabel,
  opensAtInstant,
  quizIsOpen,
  quizCountdown,
  quizMode,
  quizStatusLabel,
  quizWindow,
  sortWaiting,
  spanLabel,
} from "./quiz";

describe("quiz countdowns", () => {
  const now = new Date("2026-10-11T08:00:00.000Z");
  const at = (minutes: number) => new Date(now.getTime() + minutes * 60_000).toISOString();

  it("rounds spans down to minutes, hours, or days", () => {
    expect(spanLabel(30_000)).toBe("less than a minute");
    expect(spanLabel(60_000)).toBe("1 minute");
    expect(spanLabel(59 * 60_000)).toBe("59 minutes");
    expect(spanLabel(119 * 60_000)).toBe("1 hour");
    expect(spanLabel(47 * 3_600_000)).toBe("47 hours");
    expect(spanLabel(50 * 3_600_000)).toBe("2 days");
  });

  it("describes each window from the server", () => {
    expect(quizCountdown({ dueAt: at(300), opensAt: null }, "open", now)).toBe("Due in 5 hours");
    expect(quizCountdown({ dueAt: null, opensAt: null }, "open", now)).toBe("Open until your teacher closes it");
    expect(quizCountdown({ dueAt: at(-5), opensAt: null }, "open", now)).toBe("Due now");
    expect(quizCountdown({ dueAt: at(600), opensAt: at(90) }, "not_open", now)).toBe("Opens in 1 hour");
    expect(quizCountdown({ dueAt: at(-3 * 1440), opensAt: null }, "late", now)).toBe(
      "Overdue by 3 days · Late work accepted",
    );
    expect(quizCountdown({ dueAt: at(-10), opensAt: null }, "closed", now)).toBe("Closed");
  });

  it("puts overdue quizzes first, then the soonest due, then ones not open yet", () => {
    const rows = [
      { id: "later", window: "not_open" as const, dueAt: null, opensAt: at(600) },
      { id: "no-due", window: "open" as const, dueAt: null },
      { id: "soon", window: "open" as const, dueAt: at(60) },
      { id: "closed", window: "closed" as const, dueAt: at(-60) },
      { id: "overdue", window: "late" as const, dueAt: at(-60) },
      { id: "sooner-open", window: "not_open" as const, dueAt: null, opensAt: at(30) },
      { id: "week", window: "open" as const, dueAt: at(7 * 1440) },
    ];
    expect(sortWaiting(rows).map((row) => row.id)).toEqual([
      "overdue",
      "soon",
      "week",
      "no-due",
      "sooner-open",
      "later",
      "closed",
    ]);
  });
});

function card(id: string, answer: string): Flashcard {
  return { id, question: `Question ${id}`, answer, state: "unreviewed" };
}

describe("answersMatch", () => {
  it("ignores case and extra spaces", () => {
    expect(answersMatch("  Oxygen ", "oxygen")).toBe(true);
    expect(answersMatch("New  York", "new york")).toBe(true);
    expect(answersMatch("leaf", "leaves")).toBe(false);
  });
});

describe("due dates", () => {
  const now = new Date("2026-10-09T02:00:00.000Z");

  it("closes at the end of the Manila day", () => {
    expect(dueCloseInstant("2026-10-16", now)).toBe(new Date("2026-10-17T00:00:00+08:00").toISOString());
    expect(dueDayLabel("2026-10-17T00:00:00+08:00")).toBe("Fri, Oct 16");
  });

  it("rejects a past day, a bad day, and a day more than a year ahead", () => {
    expect(dueCloseInstant("2026-10-08", now)).toBeNull();
    expect(dueCloseInstant("2026-02-31", now)).toBeNull();
    expect(dueCloseInstant("2028-10-09", now)).toBeNull();
  });

  it("treats a past due instant or a close stamp as closed", () => {
    expect(quizIsOpen({ dueAt: null, closedAt: null }, now)).toBe(true);
    expect(quizIsOpen({ dueAt: "2026-10-09T00:00:00.000Z", closedAt: null }, now)).toBe(false);
    expect(quizIsOpen({ dueAt: null, closedAt: "2026-10-09T01:00:00.000Z" }, now)).toBe(false);
    expect(quizStatusLabel({ dueAt: "2026-10-17T00:00:00+08:00", closedAt: null }, now)).toBe("Due Fri, Oct 16");
    expect(
      quizStatusLabel({ dueAt: "2026-10-17T00:00:00+08:00", closedAt: "2026-10-09T01:00:00.000Z" }, now),
    ).toBe("Closed · Due Fri, Oct 16");
  });
});

describe("quiz windows", () => {
  const now = new Date("2026-10-09T02:00:00.000Z");
  const past = "2026-10-09T00:00:00.000Z";
  const future = "2026-10-10T00:00:00.000Z";

  it("waits for the open time, then takes late work only when allowed", () => {
    expect(quizWindow({ dueAt: future, closedAt: null, opensAt: future }, now)).toBe("not_open");
    expect(quizWindow({ dueAt: future, closedAt: null, opensAt: past }, now)).toBe("open");
    expect(quizWindow({ dueAt: past, closedAt: null, latePolicy: "block" }, now)).toBe("closed");
    expect(quizWindow({ dueAt: past, closedAt: null, latePolicy: "accept" }, now)).toBe("late");
    expect(quizWindow({ dueAt: past, closedAt: past, latePolicy: "accept" }, now)).toBe("closed");
    expect(quizIsOpen({ dueAt: past, closedAt: null, latePolicy: "accept" }, now)).toBe(true);
    expect(quizStatusLabel({ dueAt: "2026-10-09T16:00:00.000Z", closedAt: null, latePolicy: "accept" }, new Date("2026-10-10T00:00:00.000Z"))).toBe(
      "Late work accepted · Was due Fri, Oct 9",
    );
  });

  it("reads the open time as Manila time and treats a past time as open now", () => {
    expect(opensAtInstant("", now)).toBeNull();
    expect(opensAtInstant("2026-10-09T08:00", now)).toBeNull();
    expect(opensAtInstant("2026-10-12T08:00", now)).toBe("2026-10-12T00:00:00.000Z");
    expect(opensAtInstant("next tuesday", now)).toBeUndefined();
    expect(opensAtInstant("2028-10-12T08:00", now)).toBeUndefined();
  });
});

describe("quizMode", () => {
  it("uses choices when four different answers exist, otherwise typing", () => {
    const choices = ["Leaf", "Root", "Stem", "Seed"].map((answer, index) => card(String(index), answer));
    expect(quizMode(choices)).toBe("choice");
    expect(quizMode([card("1", "Leaf"), card("2", "Root")])).toBe("typing");
    expect(quizMode([card("1", "A long explanation of how leaves capture light")])).toBeNull();
  });
});

describe("quiz sql", () => {
  const sql = readFileSync("supabase/migrations/20261009020000_class_quizzes.sql", "utf8");

  it("scores typed answers the same way and leaves study progress alone", () => {
    expect(sql).toMatch(/function public\.quiz_answer_matches/);
    expect(sql).toMatch(/lower\(regexp_replace\(btrim/);
    expect(sql).not.toMatch(/student_card_progress/);
    expect(sql).not.toMatch(/review_flashcard/);
    expect(sql).toMatch(/quizzes_one_open_deck_idx/);
    expect(sql).toMatch(/function public\.quiz_play_cards/);
    expect(sql).not.toMatch(/grant select on public\.quizzes to authenticated/);
  });
});
