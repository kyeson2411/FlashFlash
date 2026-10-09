import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Flashcard } from "./deck";
import { answersMatch, dueCloseInstant, dueDayLabel, quizIsOpen, quizMode, quizStatusLabel } from "./quiz";

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
