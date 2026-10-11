"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { handInQuizAction, logQuizFocusAction, submitQuizAnswer } from "@/app/actions/quizzes";
import { useOnline } from "@/components/quiz/useOnline";
import { Button, ButtonLink } from "@/components/ui/Button";
import { answersMatch, type QuizQuestion } from "@/lib/quiz";

type Feedback = { given: string; correct: boolean | null; expected: string | null; timedOut: boolean };
type Summary = { correct: number | null; total: number | null; timedOut: boolean };

const NETWORK_ERROR = "Could not reach AutoFlash, so this was not saved. Check your connection, then try again.";
/** Server answers that mean this screen is out of date. Reloading shows the current state. */
const STALE_RE = /closed|already finished|no longer open|start the quiz first|not open yet/i;

/** The page keys this by card, so each question the server issues starts fresh. */
export function QuizTake({
  quizId,
  classId,
  title,
  question,
  serverNow,
}: {
  quizId: string;
  classId: string;
  title: string;
  question: QuizQuestion;
  serverNow: string;
}) {
  const router = useRouter();
  const [typed, setTyped] = useState(question.given ?? "");
  const [saved, setSaved] = useState<string | null>(question.given);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState<(() => void) | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  const remaining = useRemainingSeconds(question.deadline, serverNow);
  const expired = useRef(false);
  const online = useOnline();
  useFocusNotes(quizId, !summary);

  function fail(message: string, again: (() => void) | null = null) {
    setError(message);
    setRetry(() => (STALE_RE.test(message) ? null : again));
  }

  function run(task: () => Promise<unknown>) {
    setError(null);
    setRetry(null);
    startTransition(async () => {
      await task();
    });
  }

  const choice = !!question.options;
  const back = question.allowBack;
  const answeredCount = question.answeredCount + (back && question.given === null && saved !== null ? 1 : 0);
  const unanswered = question.total - answeredCount;
  const dirty = back && !choice && typed.trim() !== "" && typed !== saved;

  async function save(given: string, timeout = false): Promise<boolean> {
    let result: Awaited<ReturnType<typeof submitQuizAnswer>>;
    try {
      result = await submitQuizAnswer(quizId, question.cardId, given, timeout);
    } catch {
      fail(NETWORK_ERROR, () => run(() => save(given, timeout)));
      return false;
    }
    if (!result.ok) {
      fail(result.error);
      return false;
    }
    if (result.timedOut) {
      setSummary({ correct: result.correctCount, total: result.total, timedOut: true });
      router.refresh();
      return false;
    }
    if (back) {
      setSaved(given);
      return true;
    }
    setFeedback({ given, correct: result.correct, expected: result.expected, timedOut: result.questionTimedOut });
    if (result.finished) {
      setSummary({ correct: result.correctCount, total: result.total, timedOut: false });
      router.refresh();
    }
    return true;
  }

  function answer(given: string) {
    if (pending || feedback || summary) return;
    run(() => save(given));
  }

  function go(position: number) {
    run(async () => {
      if (dirty && !(await save(typed))) return;
      router.push(`/quizzes/${quizId}?q=${position}`);
    });
  }

  function handIn() {
    run(async () => {
      if (dirty && !(await save(typed))) return;
      let result: Awaited<ReturnType<typeof handInQuizAction>>;
      try {
        result = await handInQuizAction(quizId);
      } catch {
        fail(NETWORK_ERROR, handIn);
        return;
      }
      if (!result.ok) {
        fail(result.error);
        return;
      }
      setSummary({ correct: result.correctCount, total: result.total, timedOut: result.timedOut });
      router.refresh();
    });
  }

  useEffect(() => {
    if (remaining !== 0 || expired.current || summary) return;
    expired.current = true;
    startTransition(async () => {
      if (question.questionTimer) {
        if (feedback) return;
        if (await save(choice ? "" : typed, true)) return;
        await new Promise((resolve) => window.setTimeout(resolve, 6000));
        router.refresh();
        return;
      }
      if (!feedback && !choice && typed.trim() !== "" && typed !== saved) await save(typed, true);
      router.refresh();
    });
    // Runs once when the displayed clock reaches zero.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remaining]);

  if (summary) {
    return (
      <div className="space-y-4">
        <h1 className="type-page">{title}</h1>
        {summary.timedOut ? <p className="type-body">Time is up. The answers you gave before the time ran out are saved.</p> : null}
        {summary.correct !== null && summary.total !== null ? (
          <p className="text-2xl font-semibold text-ink">
            {summary.correct} of {summary.total}
          </p>
        ) : (
          <p className="type-body">Your answers are saved. Your score appears after the due date.</p>
        )}
        <p className="type-body">This quiz does not change what you still need to study.</p>
        <ButtonLink href={`/classes/${classId}`} variant="secondary">
          Back to class
        </ButtonLink>
      </div>
    );
  }

  const reveal = !!feedback && feedback.correct !== null && feedback.expected !== null;
  const locked = !!feedback || pending || (question.questionTimer && remaining === 0);
  const last = question.position >= question.total;

  return (
    <div className="space-y-5">
      <ButtonLink href={`/classes/${classId}`} variant="ghost" className="-ml-3 h-11 px-3 text-sm">
        <span aria-hidden="true">←</span> Back to class
      </ButtonLink>
      <div className="space-y-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="type-meta">
            Question {question.position} of {question.total}
            {back ? ` · ${answeredCount} answered` : ""}
          </p>
          {remaining !== null ? (
            <p
              className={
                "font-mono text-[13px] tabular-nums " +
                (remaining <= (question.questionTimer ? 5 : 60) ? "font-semibold text-warning" : "text-ink-secondary")
              }
              aria-live="off"
            >
              {question.questionTimer ? "This question" : "Time left"} {clock(remaining)}
            </p>
          ) : null}
          <p className="sr-only" aria-live="polite">
            {remaining === 60 && !question.questionTimer
              ? "One minute left."
              : remaining === 10
                ? "Ten seconds left."
                : ""}
          </p>
        </div>
        <h1 className="type-page">{title}</h1>
        {!online ? (
          <p className="text-sm font-medium text-warning">
            You are offline. The timer keeps running, and answers cannot be saved until you reconnect.
          </p>
        ) : null}
        {remaining === 0 && !feedback ? (
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm font-medium text-warning">
              {question.questionTimer ? "Time is up for this question." : "Time is up."}{" "}
              {pending ? "Saving…" : null}
            </p>
            {!pending && !error ? (
              <Button
                type="button"
                variant="secondary"
                className="h-9 px-3 text-[13px]"
                onClick={() => startTransition(() => router.refresh())}
              >
                Check again
              </Button>
            ) : null}
          </div>
        ) : null}
        {question.late ? <p className="type-helper">The due date has passed. Answers you give now are marked late.</p> : null}
        <p className="type-helper">Leaving this page is noted for your teacher. It does not change your score.</p>
      </div>

      <div className="space-y-5 rounded-lg border border-border-strong bg-surface p-5 sm:p-8">
        <p className="type-meta">Question</p>
        <p className="text-2xl font-semibold leading-snug tracking-tight text-balance text-ink [overflow-wrap:anywhere]">
          {question.question}
        </p>
        {choice ? (
          <div className="grid gap-2" role="group" aria-label="Answer choices">
            {question.options!.map((option) => {
              const showCorrect = reveal && answersMatch(option, feedback!.expected!);
              const showWrong = reveal && option === feedback!.given && !feedback!.correct;
              const showPicked = back ? option === saved : !!feedback && !reveal && option === feedback.given;
              return (
                <button
                  key={option}
                  type="button"
                  aria-pressed={back ? option === saved : undefined}
                  disabled={back ? pending : locked}
                  onClick={() => {
                    if (!back) return answer(option);
                    if (option === saved || pending) return;
                    run(() => save(option));
                  }}
                  className={
                    "rounded-md border px-4 py-3 text-left text-[15px] text-ink transition-colors disabled:cursor-default " +
                    (showCorrect
                      ? "border-success/50 bg-success-soft text-success"
                      : showWrong
                        ? "border-warning/50 bg-warning-soft text-warning"
                        : showPicked
                          ? "border-primary/50 bg-primary-soft text-primary"
                          : "border-border-strong bg-background hover:border-zinc-500 hover:bg-raised")
                  }
                >
                  {option}
                </button>
              );
            })}
          </div>
        ) : (
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              if (!back) return answer(typed);
              if (!dirty || pending) return;
              run(() => save(typed));
            }}
          >
            <label htmlFor="quiz-answer" className="type-label block">
              Your answer
            </label>
            <input
              id="quiz-answer"
              value={typed}
              disabled={back ? pending : locked}
              autoComplete="off"
              onChange={(event) => setTyped(event.target.value)}
              className="block h-11 w-full rounded-md border border-border-strong bg-background px-3 text-base text-ink transition-colors hover:border-zinc-600 focus:border-primary-strong focus:outline-none focus:ring-2 focus:ring-primary-strong/40 disabled:opacity-70"
            />
            {back ? (
              <Button type="submit" variant="secondary" disabled={!dirty} loading={pending} loadingText="Saving…" className="w-full sm:w-auto">
                Save answer
              </Button>
            ) : !feedback ? (
              <Button
                type="submit"
                disabled={locked}
                loading={pending}
                loadingText={question.feedback ? "Checking…" : "Saving…"}
                className="w-full sm:w-auto"
              >
                {question.feedback ? "Check" : "Save answer"}
              </Button>
            ) : null}
          </form>
        )}
        {feedback ? (
          <p className="type-body">
            {feedback.timedOut ? "Time ran out on this question. " : ""}
            {!reveal
              ? feedback.timedOut
                ? ""
                : "Answer saved."
              : feedback.correct
                ? "That matches the saved answer."
                : `The saved answer is ${feedback.expected}.`}
          </p>
        ) : null}
        {back && saved !== null && !dirty ? (
          <p className="type-helper">Answer saved. You can change it until you hand in the quiz.</p>
        ) : null}
      </div>

      {error ? (
        <div className="space-y-2" role="alert">
          <p className="text-sm font-medium text-error">{error}</p>
          {retry ? (
            <Button type="button" variant="secondary" disabled={pending} onClick={retry}>
              Try again
            </Button>
          ) : STALE_RE.test(error) ? (
            <Button
              type="button"
              variant="secondary"
              loading={pending}
              loadingText="Loading…"
              onClick={() => startTransition(() => router.refresh())}
            >
              Reload quiz
            </Button>
          ) : null}
        </div>
      ) : null}

      {!back && feedback && !last ? (
        <Button
          type="button"
          loading={pending}
          loadingText="Loading…"
          onClick={() => startTransition(() => router.refresh())}
        >
          Next question
        </Button>
      ) : null}

      {back ? (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-3">
            {question.position > 1 ? (
              <Button type="button" variant="secondary" disabled={pending} onClick={() => go(question.position - 1)}>
                Previous
              </Button>
            ) : null}
            {!last ? (
              <Button type="button" variant="secondary" disabled={pending} onClick={() => go(question.position + 1)}>
                Next
              </Button>
            ) : null}
            {!confirming ? (
              <Button
                type="button"
                disabled={pending}
                onClick={() => (unanswered > 0 ? setConfirming(true) : handIn())}
              >
                Hand in quiz
              </Button>
            ) : null}
          </div>
          {confirming ? (
            <div className="space-y-3 rounded-md border border-border bg-background p-3">
              <p className="type-body">
                {unanswered === 1 ? "1 question has" : `${unanswered} questions have`} no answer. They count as missed.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button type="button" loading={pending} loadingText="Handing in…" onClick={handIn}>
                  Hand in anyway
                </Button>
                <Button type="button" variant="ghost" disabled={pending} onClick={() => setConfirming(false)}>
                  Keep working
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** Tells the server when the student leaves or comes back. The server stamps the time. */
function useFocusNotes(quizId: string, active: boolean) {
  useEffect(() => {
    if (!active) return;
    let away = false;
    if (document.visibilityState === "visible" && document.hasFocus()) void logQuizFocusAction(quizId, false);
    const update = () => {
      const now = document.visibilityState === "hidden" || !document.hasFocus();
      if (now === away) return;
      away = now;
      void logQuizFocusAction(quizId, now);
    };
    document.addEventListener("visibilitychange", update);
    window.addEventListener("blur", update);
    window.addEventListener("focus", update);
    return () => {
      document.removeEventListener("visibilitychange", update);
      window.removeEventListener("blur", update);
      window.removeEventListener("focus", update);
    };
  }, [quizId, active]);
}

/** Display only. The server decides when time is up. */
function useRemainingSeconds(deadline: string | null, serverNow: string): number | null {
  const [offset] = useState(() => {
    const server = Date.parse(serverNow);
    return Number.isFinite(server) ? server - Date.now() : 0;
  });
  const end = deadline ? Date.parse(deadline) : NaN;
  const [now, setNow] = useState(() => Date.now() + offset);

  useEffect(() => {
    if (!Number.isFinite(end)) return;
    const timer = window.setInterval(() => setNow(Date.now() + offset), 1000);
    return () => window.clearInterval(timer);
  }, [end, offset]);

  if (!Number.isFinite(end)) return null;
  return Math.max(0, Math.ceil((end - now) / 1000));
}

function clock(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  const pad = (value: number) => String(value).padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(rest)}` : `${minutes}:${pad(rest)}`;
}
