"use client";

import { useEffect, useReducer, useRef, useState } from "react";
import { markCard } from "@/app/actions/decks";
import { Alert } from "@/components/ui/Alert";
import { Button, ButtonLink } from "@/components/ui/Button";
import { buildChoices } from "@/lib/choices";
import type { Deck } from "@/lib/deck";
import type { StudyMode } from "@/lib/study-mode";
import { isTypeableAnswer } from "@/lib/typeable";
import { ChoiceCard } from "./ChoiceCard";
import { FlipCard } from "./FlipCard";
import { StudyComplete } from "./StudyComplete";
import { TypingCard, normalizeTypedAnswer } from "./TypingCard";
import { createSession, currentCardId, sessionReducer, summarize, type Outcome } from "./session";

const MODE_LABELS: Record<StudyMode, string> = {
  flip: "Flip",
  choice: "Multiple choice",
  typing: "Type the answer",
};

export function StudyView({
  deck,
  queueIds,
  scope = "due",
}: {
  deck: Deck;
  queueIds: string[];
  scope?: "due" | "all" | "review";
}) {
  if (deck.cards.length === 0) {
    return (
      <div className="max-w-xl space-y-4">
        <Alert title="No cards to study">This deck has no cards left. Go back to the deck or generate a new one.</Alert>
        <div className="flex flex-wrap gap-3">
          <ButtonLink href={`/decks/${deck.id}`} variant="secondary">
            Back to deck
          </ButtonLink>
          <ButtonLink href="/generate">Generate flashcards</ButtonLink>
        </div>
      </div>
    );
  }

  return <StudySession deck={deck} queueIds={queueIds} scope={scope} />;
}

function ProgressBar({ done, total }: { done: number; total: number }) {
  return (
    <div
      role="progressbar"
      aria-label="Study progress"
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={done}
      aria-valuetext={`${done} of ${total} cards done`}
      className="h-2 w-full overflow-hidden rounded-full bg-border"
    >
      <div className="h-full bg-primary transition-[width] duration-300" style={{ width: `${(done / total) * 100}%` }} />
    </div>
  );
}

function StudySession({
  deck,
  queueIds,
  scope,
}: {
  deck: Deck;
  queueIds: string[];
  scope: "due" | "all" | "review";
}) {
  const deckHref = `/decks/${deck.id}`;
  const [session, dispatch] = useReducer(sessionReducer, queueIds, (queue) => createSession(queue));
  const cardRef = useRef<HTMLDivElement>(null);
  const mounted = useRef(false);
  const saved = useRef(new Set<string>());
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const [mode, setMode] = useState<StudyMode>("flip");
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const [picked, setPicked] = useState<number | null>(null);
  const [typed, setTyped] = useState("");
  const [typedChecked, setTypedChecked] = useState(false);
  const [typeNotice, setTypeNotice] = useState<string | null>(null);
  const choiceReady = deck.cards.length >= 4;

  const summary = summarize(session);
  const cardId = currentCardId(session);
  const card = cardId ? deck.cards.find((c) => c.id === cardId) : undefined;
  const attemptKey = `${session.runId}:${card?.id ?? ""}`;
  const [attemptFor, setAttemptFor] = useState(attemptKey);
  if (attemptFor !== attemptKey) {
    setAttemptFor(attemptKey);
    setPicked(null);
    setTyped("");
    setTypedChecked(false);
    setTypeNotice(null);
  }

  // Record each result on the server right away (idempotent per card in this session).
  useEffect(() => {
    for (const [id, outcome] of Object.entries(session.results)) {
      if (saved.current.has(id)) continue;
      saved.current.add(id);
      void markCard(id, outcome, modeRef.current).then((result) => {
        if (!result.ok) {
          saved.current.delete(id);
          setSaveNotice(result.error);
        }
      });
    }
  }, [session.results]);

  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    cardRef.current?.focus({ preventScroll: true });
  }, [session.index, session.flipped, session.runId]);

  const reveal = () => dispatch({ type: "reveal", at: Date.now() });
  const answer = (outcome: Outcome) => {
    if (cardId) dispatch({ type: "answer", cardId, outcome, at: Date.now() });
  };

  const choices = mode === "choice" && card ? buildChoices(card, deck.cards) : null;
  const typedMatched = !!card && typedChecked && normalizeTypedAnswer(typed) === normalizeTypedAnswer(card.answer);
  // A sentence is a poor thing to retype, so that card flips and the student rates it.
  const longTyped = mode === "typing" && !!card && !isTypeableAnswer(card.answer);
  const selfRated = mode === "flip" || longTyped;

  function goNext() {
    if (!card) return;
    if (mode === "choice" && choices && picked !== null) {
      answer(choices[picked]?.correct ? "known" : "learning");
    } else if (mode === "typing" && !longTyped && typedChecked) {
      answer(typedMatched ? "known" : "learning");
    }
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.defaultPrevented || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;

      const el = e.target as HTMLElement | null;
      const inField = !!el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));
      const checkedTypingField = el?.id === "typed-answer" && typedChecked;
      if (inField && !checkedTypingField) return;
      const onControl = !!el && ["BUTTON", "A", "SUMMARY"].includes(el.tagName);

      if (!session.flipped) {
        if (selfRated && (e.key === " " || e.key === "Enter") && !onControl) {
          e.preventDefault();
          reveal();
        }
      } else if (selfRated && e.key === "ArrowLeft") {
        e.preventDefault();
        answer("learning");
      } else if (selfRated && e.key === "ArrowRight") {
        e.preventDefault();
        answer("known");
      } else if (!selfRated && e.key === "Enter" && !onControl) {
        e.preventDefault();
        goNext();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  const restartAll = () => {
    saved.current = new Set();
    dispatch({ type: "restart", queue: queueIds });
  };
  const restartLearning = () => {
    saved.current = new Set(
      session.queue.filter((id) => session.results[id] === "known"),
    );
    dispatch({ type: "restart", queue: session.queue.filter((id) => session.results[id] === "learning") });
  };

  if (summary.finished) {
    return (
      <StudyComplete
        deckTitle={deck.title}
        deckHref={deckHref}
        known={summary.known}
        learning={summary.learning}
        onStudyAgain={restartAll}
        onPracticeLearning={restartLearning}
      />
    );
  }

  if (!card) {
    return (
      <div className="max-w-xl space-y-4">
        <Alert title="This card is no longer available">
          It was removed from the deck. Go back to the deck to continue.
        </Alert>
        <ButtonLink href={deckHref}>Back to deck</ButtonLink>
      </div>
    );
  }

  const position = session.index + 1;

  function chooseMode(next: StudyMode) {
    if (session.flipped || next === mode) return;
    if (next === "choice" && !choiceReady) return;
    setMode(next);
  }

  function pickChoice(index: number) {
    if (!choices || picked !== null) return;
    setPicked(index);
    reveal();
  }

  function checkTyped() {
    if (typedChecked) return;
    if (!typed.trim()) {
      setTypeNotice("Type an answer first.");
      return;
    }
    setTypeNotice(null);
    setTypedChecked(true);
    reveal();
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4 sm:space-y-6">
      <header className="space-y-3 short:grid short:grid-cols-[auto_1fr_auto] short:items-center short:gap-x-3 short:gap-y-1 short:space-y-0">
        <div className="flex items-center justify-between gap-3 short:contents">
          <ButtonLink href={deckHref} variant="ghost" className="-ml-3 h-11 px-3 text-sm short:order-1">
            <span aria-hidden="true">←</span> Back to deck
          </ButtonLink>
          <p className="text-lg font-semibold text-ink short:order-3">
            {position} of {summary.total}
          </p>
        </div>
        <h1 className="type-section truncate short:order-2">{deck.title}</h1>
        <div className="short:order-4 short:col-span-3">
          <ProgressBar done={summary.answered} total={summary.total} />
        </div>
        <p className="type-helper short:hidden">
          {scope === "all"
            ? "Studying every card in this deck. "
            : scope === "review"
              ? "Reviewing cards you have not memorized yet. "
              : "These cards are ready now. "}
          Known {summary.known} · Still learning {summary.learning} · {summary.remaining} remaining
        </p>
      </header>

      <div className="flex flex-wrap gap-2" role="group" aria-label="Study mode">
        {(Object.keys(MODE_LABELS) as StudyMode[]).map((option) => {
          const unavailable = option === "choice" && !choiceReady;
          return (
            <button
              key={option}
              type="button"
              aria-pressed={mode === option}
              disabled={session.flipped || unavailable}
              onClick={() => chooseMode(option)}
              className={
                mode === option
                  ? "inline-flex h-11 items-center border-b-2 border-primary px-3 text-sm font-semibold text-ink"
                  : "inline-flex h-11 items-center border-b-2 border-transparent px-3 text-sm font-medium text-ink-secondary disabled:opacity-50"
              }
            >
              {MODE_LABELS[option]}
            </button>
          );
        })}
      </div>
      {!choiceReady && (
        <p className="type-helper">Multiple choice needs at least four cards so the other answers can be the choices.</p>
      )}

      {saveNotice && (
        <Alert tone="warning" title="Progress may not be saved">
          {saveNotice}
        </Alert>
      )}

      {mode === "choice" && !choiceReady ? (
        <Alert tone="warning" title="Multiple choice needs a larger deck">
          This mode uses other answers from the same deck as the choices. It needs at least four cards with different
          answers. Use Flip instead.
          <div className="mt-3">
            <Button variant="secondary" onClick={() => setMode("flip")}>
              Use Flip
            </Button>
          </div>
        </Alert>
      ) : mode === "flip" ? (
        <FlipCard
          key={`${session.runId}-${card.id}`}
          ref={cardRef}
          question={card.question}
          answer={card.answer}
          flipped={session.flipped}
          onReveal={reveal}
        />
      ) : mode === "choice" && choices ? (
        <ChoiceCard question={card.question} options={choices} picked={picked} onPick={pickChoice} />
      ) : mode === "choice" ? (
        <Alert tone="warning" title="Multiple choice needs a larger deck">
          The other cards in this deck do not have enough different answers for this question. Use Flip instead.
          <div className="mt-3">
            <Button variant="secondary" onClick={() => setMode("flip")}>
              Use Flip
            </Button>
          </div>
        </Alert>
      ) : longTyped ? (
        <div className="space-y-3">
          <p className="type-helper">
            This answer is an explanation, not a short phrase, so this card flips instead of asking you to type it.
          </p>
          <FlipCard
            key={`${session.runId}-${card.id}`}
            ref={cardRef}
            question={card.question}
            answer={card.answer}
            flipped={session.flipped}
            onReveal={reveal}
          />
        </div>
      ) : (
        <div className="space-y-2">
          <TypingCard
            question={card.question}
            answer={card.answer}
            value={typed}
            checked={typedChecked}
            matched={typedMatched}
            onChange={(value) => {
              setTyped(value);
              if (typeNotice) setTypeNotice(null);
            }}
            onCheck={checkTyped}
          />
          {typeNotice && <p className="text-sm font-medium text-error">{typeNotice}</p>}
        </div>
      )}

      <div className="sticky bottom-0 -mx-4 border-t border-border bg-background px-4 py-3 roomy:static roomy:mx-0 roomy:border-0 roomy:bg-transparent roomy:p-0">
        {session.flipped && selfRated ? (
          <div className="grid grid-cols-2 gap-3">
            <Button variant="warning" className="h-14!" onClick={() => answer("learning")}>
              Still learning
            </Button>
            <Button variant="success" className="h-14!" onClick={() => answer("known")}>
              Know it
            </Button>
          </div>
        ) : session.flipped ? (
          <div className="flex justify-center">
            <Button className="h-14! w-full sm:w-72" onClick={goNext}>
              Next
            </Button>
          </div>
        ) : selfRated ? (
          <div className="flex justify-center">
            <Button className="h-14! w-full sm:w-72" onClick={reveal}>
              Show answer
            </Button>
          </div>
        ) : mode === "choice" && choices ? (
          <p className="type-helper text-center">Pick one choice.</p>
        ) : mode === "typing" && !longTyped ? (
          <p className="type-helper text-center">Type your answer, then check it.</p>
        ) : null}
      </div>

      <div className="space-y-1 short:hidden">
        <p className="type-helper text-center">
          {session.flipped && selfRated
            ? "How well did you know this one?"
            : session.flipped && mode === "choice"
              ? "Next saves Know it if the choice was right, or Still learning if it was wrong."
              : session.flipped
                ? "Next saves Know it if it matched, or Still learning if it did not."
                : selfRated
                  ? "Think of the answer first, then reveal it."
                  : mode === "choice" && choices
                    ? "The choice itself decides Know it or Still learning."
                    : mode === "typing" && !longTyped
                      ? "A match is Know it. Anything else is Still learning."
                      : ""}
        </p>
        <p className="type-helper hidden text-center [@media(hover:hover)]:block">
          {session.flipped && selfRated
            ? "Keyboard: ← Still learning · → Know it"
            : session.flipped
              ? "Keyboard: Enter goes to the next card"
              : selfRated
                ? "Keyboard: Space or Enter shows the answer"
                : ""}
        </p>
      </div>

      <p role="status" className="sr-only">
        {session.flipped
          ? `Answer: ${card.answer}`
          : `Card ${position} of ${summary.total}. Question: ${card.question}`}
      </p>
    </div>
  );
}
