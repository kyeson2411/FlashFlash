// Pure state logic for one study session. No React, no storage, no algorithm:
// it only records the student's simple outcome for each card (known / still learning).
//
// Every guard here exists to keep the flow reliable:
//   - an answer only counts if the card has been revealed first
//   - an answer only counts for the card that is currently showing
//   - a card can only be answered once per pass
//   - an answer right after a reveal is ignored (the answer must be on screen first)
//   - a reveal right after an answer is ignored, so a fast double-click can't
//     reveal the next card by accident

export type Outcome = "known" | "learning";

export type SessionState = {
  queue: string[]; // card ids, in the order they are studied
  index: number; // position of the current card; === queue.length when finished
  flipped: boolean; // is the answer showing?
  results: Record<string, Outcome>;
  lastAnswerAt: number; // timestamp (ms) of the last accepted answer
  revealedAt: number; // timestamp (ms) of the last accepted reveal
  runId: number; // changes on every restart so cards remount cleanly
};

export type SessionAction =
  | { type: "reveal"; at: number }
  | { type: "answer"; cardId: string; outcome: Outcome; at: number }
  | { type: "undo"; at: number }
  | { type: "restart"; queue: string[] };

/** Ignore a reveal this soon after an answer (guards against double-clicks). */
export const REVEAL_LOCK_MS = 350;

/** Ignore an answer this soon after the reveal, so the answer is on screen before it can be rated. */
export const ANSWER_LOCK_MS = 250;

export function createSession(queue: string[], runId = 0): SessionState {
  return { queue, index: 0, flipped: false, results: {}, lastAnswerAt: 0, revealedAt: 0, runId };
}

export function isFinished(state: SessionState): boolean {
  return state.index >= state.queue.length;
}

export function currentCardId(state: SessionState): string | null {
  return isFinished(state) ? null : state.queue[state.index];
}

export function sessionReducer(state: SessionState, action: SessionAction): SessionState {
  switch (action.type) {
    case "reveal": {
      if (isFinished(state) || state.flipped) return state;
      if (action.at - state.lastAnswerAt < REVEAL_LOCK_MS) return state;
      return { ...state, flipped: true, revealedAt: action.at };
    }

    case "answer": {
      if (isFinished(state) || !state.flipped) return state;
      if (state.queue[state.index] !== action.cardId) return state;
      if (action.cardId in state.results) return state;
      if (action.at - state.revealedAt < ANSWER_LOCK_MS) return state;

      return {
        ...state,
        results: { ...state.results, [action.cardId]: action.outcome },
        index: state.index + 1,
        flipped: false, // the next card always starts on its question
        lastAnswerAt: action.at,
      };
    }

    case "undo": {
      if (state.index === 0) return state;
      const cardId = state.queue[state.index - 1];
      if (!cardId || !(cardId in state.results)) return state;
      const results = { ...state.results };
      delete results[cardId];
      return {
        ...state,
        results,
        index: state.index - 1,
        flipped: false,
        lastAnswerAt: action.at,
        revealedAt: 0,
      };
    }

    case "restart":
      return createSession(action.queue, state.runId + 1);
  }
}

export type SessionSummary = {
  total: number;
  answered: number;
  remaining: number;
  known: number;
  learning: number;
  finished: boolean;
};

export function summarize(state: SessionState): SessionSummary {
  let known = 0;
  let learning = 0;
  for (const id of state.queue) {
    if (state.results[id] === "known") known++;
    else if (state.results[id] === "learning") learning++;
  }

  const answered = known + learning;
  return {
    total: state.queue.length,
    answered,
    remaining: state.queue.length - answered,
    known,
    learning,
    finished: isFinished(state),
  };
}
