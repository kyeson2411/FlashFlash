"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { submitQuizAnswer } from "@/app/actions/quizzes";
import { Button, ButtonLink } from "@/components/ui/Button";
import { answersMatch, type QuizAnswerMode, type QuizCardView } from "@/lib/quiz";

export function QuizTake({
  quizId,
  classId,
  title,
  mode,
  cards,
  answeredCount,
  total,
}: {
  quizId: string;
  classId: string;
  title: string;
  mode: QuizAnswerMode;
  cards: QuizCardView[];
  answeredCount: number;
  total: number;
}) {
  const router = useRouter();
  const [index, setIndex] = useState(0);
  const [typed, setTyped] = useState("");
  const [feedback, setFeedback] = useState<{ given: string; correct: boolean; expected: string } | null>(null);
  const [summary, setSummary] = useState<{ correct: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const card = cards[index];

  function submit(given: string) {
    if (!card || feedback || pending) return;
    setError(null);
    startTransition(async () => {
      const result = await submitQuizAnswer(quizId, card.id, given);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setFeedback({ given, correct: result.correct, expected: result.expected });
      if (result.finished && result.correctCount !== null && result.total !== null) {
        setSummary({ correct: result.correctCount, total: result.total });
        router.refresh();
      }
    });
  }

  if (summary) {
    return (
      <div className="space-y-4">
        <h1 className="type-page">{title}</h1>
        <p className="text-2xl font-semibold text-ink">
          {summary.correct} of {summary.total}
        </p>
        <p className="type-body">Your answers are saved. This quiz does not change what you still need to study.</p>
        <ButtonLink href={`/classes/${classId}`} variant="secondary">
          Back to class
        </ButtonLink>
      </div>
    );
  }

  if (!card) {
    return (
      <div className="space-y-3">
        <h1 className="type-page">{title}</h1>
        <p className="type-body">Every card in this quiz has an answer.</p>
        <ButtonLink href={`/classes/${classId}`} variant="secondary">
          Back to class
        </ButtonLink>
      </div>
    );
  }

  const choice = mode === "choice" && card.options;
  const last = index === cards.length - 1;

  return (
    <div className="space-y-5">
      <ButtonLink href={`/classes/${classId}`} variant="ghost" className="-ml-3 h-11 px-3 text-sm">
        <span aria-hidden="true">←</span> Back to class
      </ButtonLink>
      <div className="space-y-1">
        <p className="type-meta">
          Card {answeredCount + index + 1} of {total}
        </p>
        <h1 className="type-page">{title}</h1>
      </div>

      <div className="space-y-5 rounded-lg border border-border-strong bg-surface p-5 sm:p-8">
        <p className="type-meta">Question</p>
        <p className="text-2xl font-semibold leading-snug tracking-tight text-balance text-ink [overflow-wrap:anywhere]">
          {card.question}
        </p>
        {choice ? (
          <div className="grid gap-2" role="group" aria-label="Answer choices">
            {card.options!.map((option) => {
              const showCorrect = !!feedback && answersMatch(option, feedback.expected);
              const showWrong = !!feedback && option === feedback.given && !feedback.correct;
              return (
                <button
                  key={option}
                  type="button"
                  disabled={!!feedback || pending}
                  onClick={() => submit(option)}
                  className={
                    "rounded-md border px-4 py-3 text-left text-[15px] text-ink transition-colors disabled:cursor-default " +
                    (showCorrect
                      ? "border-success/50 bg-success-soft text-success"
                      : showWrong
                        ? "border-warning/50 bg-warning-soft text-warning"
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
              submit(typed);
            }}
          >
            <label htmlFor="quiz-answer" className="type-label block">
              Your answer
            </label>
            <input
              id="quiz-answer"
              value={typed}
              disabled={!!feedback || pending}
              autoComplete="off"
              onChange={(event) => setTyped(event.target.value)}
              className="block h-11 w-full rounded-md border border-border-strong bg-background px-3 text-base text-ink transition-colors hover:border-zinc-600 focus:border-primary-strong focus:outline-none focus:ring-2 focus:ring-primary-strong/40 disabled:opacity-70"
            />
            {!feedback && (
              <Button type="submit" loading={pending} loadingText="Checking…" className="w-full sm:w-auto">
                Check
              </Button>
            )}
          </form>
        )}
        {feedback && (
          <p className="type-body">
            {feedback.correct ? "That matches the saved answer." : `The saved answer is ${feedback.expected}.`}
          </p>
        )}
      </div>

      {error && <p className="text-sm font-medium text-error">{error}</p>}

      {feedback && !last && (
        <Button
          type="button"
          onClick={() => {
            setIndex((current) => current + 1);
            setTyped("");
            setFeedback(null);
          }}
        >
          Next card
        </Button>
      )}
    </div>
  );
}
