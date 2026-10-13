import { describe, expect, it } from "vitest";
import { answersForAccount, dropAnswer, queueAnswer, type OutboxAnswer } from "./study-store";

const known: OutboxAnswer = { accountId: "student-a", cardId: "card-1", outcome: "known", mode: "flip" };
const learning: OutboxAnswer = { accountId: "student-a", cardId: "card-1", outcome: "learning", mode: "choice" };
const other: OutboxAnswer = { accountId: "student-b", cardId: "card-1", outcome: "known", mode: "flip" };

describe("study outbox", () => {
  it("keeps one answer per card and account", () => {
    const next = queueAnswer(queueAnswer([], known), learning);
    expect(next).toEqual([learning]);
  });

  it("does not mix two accounts that studied the same card", () => {
    const next = queueAnswer(queueAnswer([], known), other);
    expect(answersForAccount(next, "student-a")).toEqual([known]);
    expect(answersForAccount(next, "student-b")).toEqual([other]);
  });

  it("drops an answer only for that account", () => {
    const next = dropAnswer([known, other], "student-a", "card-1");
    expect(next).toEqual([other]);
  });
});
