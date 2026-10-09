import { describe, expect, it } from "vitest";
import { createSession, sessionReducer, summarize } from "./session";

describe("sessionReducer", () => {
  it("ignores an answer before the card is revealed", () => {
    const start = createSession(["a"]);
    const next = sessionReducer(start, { type: "answer", cardId: "a", outcome: "known", at: 1_000 });
    expect(next).toBe(start);
  });

  it("ignores an answer in the lock window after reveal", () => {
    let state = createSession(["a"]);
    state = sessionReducer(state, { type: "reveal", at: 1_000 });
    const next = sessionReducer(state, { type: "answer", cardId: "a", outcome: "known", at: 1_100 });
    expect(next).toBe(state);
  });

  it("ignores a reveal in the lock window after an answer", () => {
    let state = createSession(["a", "b"]);
    state = sessionReducer(state, { type: "reveal", at: 1_000 });
    state = sessionReducer(state, { type: "answer", cardId: "a", outcome: "known", at: 2_000 });
    const next = sessionReducer(state, { type: "reveal", at: 2_100 });
    expect(next).toBe(state);
    expect(next.flipped).toBe(false);
  });

  it("records one answer and moves to the next question", () => {
    let state = createSession(["a", "b"]);
    state = sessionReducer(state, { type: "reveal", at: 1_000 });
    state = sessionReducer(state, { type: "answer", cardId: "a", outcome: "learning", at: 2_000 });
    const again = sessionReducer(state, { type: "answer", cardId: "a", outcome: "known", at: 3_000 });
    expect(again).toBe(state);
    expect(summarize(state)).toMatchObject({ known: 0, learning: 1, remaining: 1, finished: false });
  });

  it("ignores an answer for a card that is not showing", () => {
    let state = createSession(["a", "b"]);
    state = sessionReducer(state, { type: "reveal", at: 1_000 });
    const next = sessionReducer(state, { type: "answer", cardId: "b", outcome: "known", at: 2_000 });
    expect(next).toBe(state);
  });

  it("undoes the last answer and returns to that card", () => {
    let state = createSession(["a", "b"]);
    state = sessionReducer(state, { type: "reveal", at: 1_000 });
    state = sessionReducer(state, { type: "answer", cardId: "a", outcome: "known", at: 2_000 });
    state = sessionReducer(state, { type: "undo", at: 3_000 });
    expect(state.index).toBe(0);
    expect(state.flipped).toBe(false);
    expect(state.results).toEqual({});
    expect(summarize(state).finished).toBe(false);
  });

  it("does not undo before any answer", () => {
    const start = createSession(["a"]);
    expect(sessionReducer(start, { type: "undo", at: 1_000 })).toBe(start);
  });
});
