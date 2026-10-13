"use client";

import { useEffect, useReducer, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { markCard, undoCardReview } from "@/app/actions/decks";
import { Alert } from "@/components/ui/Alert";
import { Button, ButtonLink } from "@/components/ui/Button";
import { buildChoices } from "@/lib/choices";
import type { Deck } from "@/lib/deck";
import { dropQueuedAnswer, enqueueAnswer, RETRY_LATER_ERRORS, SAVED_ON_PHONE, saveStudyDeck, warmOfflinePage } from "@/lib/offline/study-store";
import { syncStudyOutbox } from "./sync-outbox";
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

type StudyAccount = { id: string; name: string };

export function StudyView({
  deck,
  queueIds,
  account,
  homeHref,
  homeLabel,
  onHome,
}: {
  deck: Deck;
  queueIds: string[];
  account?: StudyAccount;
  homeHref?: string;
  homeLabel?: string;
  onHome?: () => void;
}) {
  const router = useRouter();
  const backHref = homeHref ?? (deck.classId ? `/classes/${deck.classId}` : "/decks");
  const backLabel = homeLabel ?? (deck.classId ? "Back to class" : "Back to decks");

  useEffect(() => {
    if (!account) return;
    void saveStudyDeck({
      accountId: account.id,
      accountName: account.name,
      deckId: deck.id,
      title: deck.title,
      classId: deck.classId ?? null,
      cards: deck.cards.map((card) => ({
        id: card.id,
        question: card.question,
        answer: card.answer,
        state: card.state,
      })),
      queueIds,
      savedAt: Date.now(),
    });
    const stopWarm = warmOfflinePage(() => router.prefetch("/study-offline"));
    void syncStudyOutbox(account.id);
    const sync = () => {
      void syncStudyOutbox(account.id);
    };
    window.addEventListener("online", sync);
    return () => {
      stopWarm?.();
      window.removeEventListener("online", sync);
    };
  }, [account, deck, queueIds, router]);

  if (deck.cards.length > 0 && queueIds.length === 0) {
    return (
      <div className="max-w-xl space-y-4">
        <Alert title="Nothing is ready right now">
          New cards and cards you are still learning show up here. Cards you know come back when they are due.
        </Alert>
        <HomeControl href={backHref} onHome={onHome} variant="secondary">
          {backLabel}
        </HomeControl>
      </div>
    );
  }

  if (deck.cards.length === 0) {
    return (
      <div className="max-w-xl space-y-4">
        <Alert title="No cards to study">
          {onHome
            ? "This deck has no cards yet."
            : deck.classId
              ? "This class deck has no cards yet."
              : "This deck has no cards yet. Go back to the deck, or generate new cards."}
        </Alert>
        <div className="flex flex-wrap gap-3">
          <HomeControl href={backHref} onHome={onHome} variant="secondary">
            {backLabel}
          </HomeControl>
          {!deck.classId && !onHome && <ButtonLink href="/generate">Generate flashcards</ButtonLink>}
        </div>
      </div>
    );
  }

  return (
    <StudySession
      deck={deck}
      queueIds={queueIds}
      account={account}
      homeHref={backHref}
      homeLabel={backLabel}
      onHome={onHome}
    />
  );
}

function HomeControl({
  href,
  onHome,
  variant = "secondary",
  className,
  children,
}: {
  href: string;
  onHome?: () => void;
  variant?: "secondary" | "ghost";
  className?: string;
  children: ReactNode;
}) {
  if (onHome) {
    return (
      <Button type="button" variant={variant} className={className} onClick={onHome}>
        {children}
      </Button>
    );
  }
  return (
    <ButtonLink href={href} variant={variant} className={className}>
      {children}
    </ButtonLink>
  );
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
      className="h-1 w-full overflow-hidden rounded-full bg-raised"
    >
      <div className="h-full rounded-full bg-primary-strong transition-[width] duration-300" style={{ width: `${(done / total) * 100}%` }} />
    </div>
  );
}

function StudySession({
  deck,
  queueIds,
  account,
  homeHref,
  homeLabel,
  onHome,
}: {
  deck: Deck;
  queueIds: string[];
  account?: StudyAccount;
  homeHref: string;
  homeLabel: string;
  onHome?: () => void;
}) {
  const [session, dispatch] = useReducer(sessionReducer, queueIds, (queue) => createSession(queue));
  const cardRef = useRef<HTMLDivElement>(null);
  const mounted = useRef(false);
  const saved = useRef(new Set<string>());
  const queued = useRef(new Set<string>());
  const saves = useRef(new Map<string, Promise<void>>());
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const [undoCardId, setUndoCardId] = useState<string | null>(null);
  const [undoing, setUndoing] = useState(false);
  const [mode, setMode] = useState<StudyMode>("flip");
  const modeRef = useRef(mode);
  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);
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

  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    cardRef.current?.focus({ preventScroll: true });
  }, [session.index, session.flipped, session.runId]);

  const reveal = () => dispatch({ type: "reveal", at: Date.now() });
  const answer = (outcome: Outcome) => {
    if (!cardId) return;
    const id = cardId;
    const action = { type: "answer" as const, cardId: id, outcome, at: Date.now() };
    if (sessionReducer(session, action) === session) return;
    dispatch(action);
    if (saved.current.has(id)) return;
    saved.current.add(id);
    const mode = modeRef.current;
    const keepOnPhone = async () => {
      if (!account) {
        saved.current.delete(id);
        setSaveNotice("Your progress could not be saved. Check your connection and try again.");
        setUndoCardId((current) => (current === id ? null : current));
        return;
      }
      await enqueueAnswer({ accountId: account.id, cardId: id, outcome, mode });
      queued.current.add(id);
      setSaveNotice(SAVED_ON_PHONE);
    };
    const job = (navigator.onLine ? markCard(id, outcome, mode) : Promise.reject(new Error("offline")))
      .then(async (result) => {
        if (result.ok) return;
        if (RETRY_LATER_ERRORS.has(result.error)) {
          await keepOnPhone();
          return;
        }
        saved.current.delete(id);
        setSaveNotice(result.error);
        setUndoCardId((current) => (current === id ? null : current));
      })
      .catch(() => keepOnPhone());
    saves.current.set(id, job);
    setUndoCardId(id);
  };

  async function undoLast() {
    if (undoing || !undoCardId) return;
    const id = undoCardId;
    setUndoing(true);
    setSaveNotice(null);
    await saves.current.get(id);
    if (queued.current.has(id) && account) {
      await dropQueuedAnswer(account.id, id);
      queued.current.delete(id);
      saved.current.delete(id);
      dispatch({ type: "undo", at: Date.now() });
      setUndoCardId(null);
      setUndoing(false);
      return;
    }
    if (!saved.current.has(id)) {
      dispatch({ type: "undo", at: Date.now() });
      setUndoCardId(null);
      setUndoing(false);
      return;
    }
    let result: Awaited<ReturnType<typeof undoCardReview>>;
    try {
      result = await undoCardReview(id);
    } catch {
      setUndoing(false);
      setSaveNotice("Your progress could not be saved. Check your connection and try again.");
      return;
    }
    setUndoing(false);
    if (!result.ok) {
      setSaveNotice(result.error);
      return;
    }
    saved.current.delete(id);
    dispatch({ type: "undo", at: Date.now() });
    setUndoCardId(null);
  }

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
    setUndoCardId(null);
    dispatch({ type: "restart", queue: queueIds });
  };
  const restartLearning = () => {
    saved.current = new Set(
      session.queue.filter((id) => session.results[id] === "known"),
    );
    setUndoCardId(null);
    dispatch({ type: "restart", queue: session.queue.filter((id) => session.results[id] === "learning") });
  };

  if (summary.finished) {
    return (
      <StudyComplete
        deckTitle={deck.title}
        decksHref={homeHref}
        homeLabel={homeLabel}
        onHome={onHome}
        known={summary.known}
        learning={summary.learning}
        onStudyAgain={restartAll}
        onPracticeLearning={restartLearning}
        onUndo={undoCardId ? undoLast : undefined}
        undoing={undoing}
      />
    );
  }

  if (!card) {
    return (
      <div className="max-w-xl space-y-4">
        <Alert title="This card is no longer available">
          It was removed from the deck. Go back to the deck to continue.
        </Alert>
        <HomeControl href={homeHref} onHome={onHome}>
          {homeLabel}
        </HomeControl>
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
    <div className="mx-auto max-w-2xl space-y-5 pt-4 sm:space-y-6 sm:pt-8">
      <header className="space-y-3 short:grid short:grid-cols-[auto_1fr_auto] short:items-center short:gap-x-3 short:gap-y-1 short:space-y-0">
        <div className="flex items-center justify-between gap-3 short:contents">
          <HomeControl href={homeHref} onHome={onHome} variant="ghost" className="-ml-2 h-8 px-2 text-[13px] short:order-1">
            <span aria-hidden="true">←</span> {homeLabel}
          </HomeControl>
          <p className="font-mono text-xs tabular-nums text-ink-secondary short:order-3">
            <span className="text-ink">{position}</span> / {summary.total}
          </p>
        </div>
        <h1 className="type-section truncate short:order-2">{deck.title}</h1>
        <div className="short:order-4 short:col-span-3">
          <ProgressBar done={summary.answered} total={summary.total} />
        </div>
        <p className="font-mono text-[11px] text-ink-muted short:hidden">
          New cards, cards you are still learning, and cards that are ready for another review. Known {summary.known} ·
          Still learning {summary.learning} · {summary.remaining} remaining
        </p>
      </header>

      <div
        className="inline-flex flex-wrap gap-0.5 rounded-md border border-border bg-surface p-0.5"
        role="group"
        aria-label="Study mode"
      >
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
                  ? "inline-flex h-8 items-center rounded-[5px] bg-raised px-3 text-[13px] font-medium text-ink shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)]"
                  : "inline-flex h-8 items-center rounded-[5px] px-3 text-[13px] font-medium text-ink-muted transition-colors hover:text-ink disabled:opacity-40 disabled:hover:text-ink-muted"
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
        <Alert
          tone="warning"
          title={saveNotice === SAVED_ON_PHONE ? "Saved on this phone" : "Progress may not be saved"}
        >
          {saveNotice === SAVED_ON_PHONE ? "It will sync when you are back online." : saveNotice}
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
        {!session.flipped && undoCardId && (
          <div className="mb-3 flex justify-center">
            <Button variant="ghost" onClick={undoLast} disabled={undoing} loading={undoing} loadingText="Undoing…">
              Undo last answer
            </Button>
          </div>
        )}
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
              ? "Next saves Know it if your choice was right, or Still learning if it was wrong."
              : session.flipped
                ? "Next saves Know it if your answer matched, or Still learning if it did not."
                : selfRated
                  ? "Think of the answer first, then reveal it."
                  : mode === "choice" && choices
                    ? "Your choice is marked Know it or Still learning."
                    : mode === "typing" && !longTyped
                      ? "A matching answer is marked Know it. Anything else is marked Still learning."
                      : ""}
        </p>
        <p className="hidden text-center font-mono text-[11px] text-zinc-600 [@media(hover:hover)]:block">
          {session.flipped && selfRated
            ? "Keyboard: press ← for Still learning, or → for Know it."
            : session.flipped
              ? "Keyboard: press Enter for the next card."
              : selfRated
                ? "Keyboard: press Space or Enter to show the answer."
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
