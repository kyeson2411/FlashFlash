"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  closeClassQuiz,
  giveClassQuiz,
  giveQuickQuiz,
  type GiveQuizForm as GiveQuizValues,
} from "@/app/actions/quizzes";
import { Button, ButtonLink } from "@/components/ui/Button";
import { controlClasses } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import {
  MAX_QUESTION_SECONDS,
  MAX_QUIZ_ATTEMPTS,
  MAX_QUIZ_MINUTES,
  MIN_QUESTION_SECONDS,
  QUIZ_UNREADY,
  type DeckQuizOffer,
} from "@/lib/quiz";

export function DeckQuizPanel({
  deckId,
  classId,
  offer,
}: {
  deckId: string;
  classId: string;
  offer: DeckQuizOffer;
}) {
  if (!offer.available) {
    return (
      <section aria-labelledby="deck-quiz-heading" className="space-y-2">
        <h2 id="deck-quiz-heading" className="type-section">
          Quiz
        </h2>
        <p className="type-helper">Giving a quiz needs a database update. Run the latest SQL migration, then reload.</p>
      </section>
    );
  }

  return (
    <section aria-labelledby="deck-quiz-heading" className="space-y-3">
      <h2 id="deck-quiz-heading" className="type-section">
        Quiz
      </h2>
      {offer.openQuiz ? (
        <OpenQuiz deckId={deckId} classId={classId} quizId={offer.openQuiz.id} status={offer.openQuiz.status} />
      ) : offer.ready ? (
        <div className="space-y-5">
          <QuickQuiz deckId={deckId} />
          <div className="space-y-3">
            <p className="type-label">Or choose the settings</p>
            <GiveQuizForm deckId={deckId} minDate={offer.minDate} maxDate={offer.maxDate} choice={offer.choice} />
          </div>
        </div>
      ) : (
        <p className="type-helper">{QUIZ_UNREADY}</p>
      )}
    </section>
  );
}

function OpenQuiz({
  deckId,
  classId,
  quizId,
  status,
}: {
  deckId: string;
  classId: string;
  quizId: string;
  status: string;
}) {
  return (
    <div className="space-y-3">
      <p className="type-body">{status}. Students can take it until it closes.</p>
      <div className="flex flex-wrap gap-3">
        <ButtonLink href={`/quizzes/${quizId}`}>See who has finished</ButtonLink>
        <CloseQuizButton quizId={quizId} classId={classId} deckId={deckId} />
      </div>
    </div>
  );
}

function QuickQuiz({ deckId }: { deckId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="max-w-xl space-y-2">
      <p className="type-body">
        A quiz from every card in this deck, open now until you close it. Questions and choices are shuffled for each
        student, with one attempt and no timer.
      </p>
      <Button
        type="button"
        loading={pending}
        loadingText="Making the quiz…"
        onClick={() => {
          setError(null);
          startTransition(async () => {
            try {
              const result = await giveQuickQuiz(deckId);
              if (!result.ok) {
                setError(result.error);
                return;
              }
              router.push(`/quizzes/${result.quizId}`);
            } catch {
              setError("Could not reach AutoFlash. Check your connection, then try again.");
            }
          });
        }}
      >
        Quick quiz
      </Button>
      {error && <p className="text-sm font-medium text-error">{error}</p>}
    </div>
  );
}

const EMPTY_FORM: GiveQuizValues = {
  dueDate: "",
  opensAt: "",
  latePolicy: "block",
  timerMode: "none",
  timeLimitMinutes: "",
  questionSeconds: "30",
  maxAttempts: "1",
  shuffleQuestions: false,
  shuffleChoices: false,
  allowBack: false,
  resultsAfterDue: false,
};

function GiveQuizForm({
  deckId,
  minDate,
  maxDate,
  choice,
}: {
  deckId: string;
  minDate: string;
  maxDate: string;
  choice: boolean;
}) {
  const router = useRouter();
  const [form, setForm] = useState<GiveQuizValues>(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const set = <K extends keyof GiveQuizValues>(key: K, value: GiveQuizValues[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  return (
    <form
      className="max-w-xl space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        startTransition(async () => {
          try {
            const result = await giveClassQuiz(deckId, form);
            if (!result.ok) {
              setError(result.error);
              return;
            }
            router.push(`/quizzes/${result.quizId}`);
          } catch {
            setError("Could not reach AutoFlash. Check your connection, then try again.");
          }
        });
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Input
          id={`quiz-opens-${deckId}`}
          label="Opens"
          type="datetime-local"
          value={form.opensAt}
          onChange={(event) => set("opensAt", event.target.value)}
          hint="Optional. Manila time. Leave empty to open now."
        />
        <Input
          id={`quiz-due-${deckId}`}
          label="Due date"
          type="date"
          min={minDate}
          max={maxDate}
          value={form.dueDate}
          onChange={(event) => set("dueDate", event.target.value)}
          hint="Optional. Students can take it through the end of this day."
        />
        <div className="space-y-1.5">
          <label htmlFor={`quiz-late-${deckId}`} className="type-label block">
            After the due date
          </label>
          <select
            id={`quiz-late-${deckId}`}
            value={form.latePolicy}
            onChange={(event) => set("latePolicy", event.target.value)}
            className={controlClasses(false) + " h-10"}
          >
            <option value="block">Stop taking answers</option>
            <option value="accept">Accept answers and mark them late</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <label htmlFor={`quiz-timer-${deckId}`} className="type-label block">
            Timer
          </label>
          <select
            id={`quiz-timer-${deckId}`}
            value={form.timerMode}
            onChange={(event) => set("timerMode", event.target.value)}
            className={controlClasses(false) + " h-10"}
          >
            <option value="none">No timer</option>
            <option value="quiz">One timer for the whole quiz</option>
            <option value="question">A timer on each question</option>
          </select>
        </div>
        {form.timerMode === "quiz" ? (
          <Input
            id={`quiz-minutes-${deckId}`}
            label="Time limit (minutes)"
            type="number"
            inputMode="numeric"
            min={1}
            max={MAX_QUIZ_MINUTES}
            value={form.timeLimitMinutes}
            onChange={(event) => set("timeLimitMinutes", event.target.value)}
            hint="From 1 to 240. Starts when the student starts the quiz."
          />
        ) : form.timerMode === "question" ? (
          <Input
            id={`quiz-seconds-${deckId}`}
            label="Seconds for each question"
            type="number"
            inputMode="numeric"
            min={MIN_QUESTION_SECONDS}
            max={MAX_QUESTION_SECONDS}
            value={form.questionSeconds}
            onChange={(event) => set("questionSeconds", event.target.value)}
            hint="From 10 to 600. When time runs out, the quiz moves on."
          />
        ) : null}
        <Input
          id={`quiz-attempts-${deckId}`}
          label="Attempts allowed"
          type="number"
          inputMode="numeric"
          min={1}
          max={MAX_QUIZ_ATTEMPTS}
          value={form.maxAttempts}
          onChange={(event) => set("maxAttempts", event.target.value)}
          hint="Students see their latest score."
        />
        <div className="space-y-1.5">
          <label htmlFor={`quiz-results-${deckId}`} className="type-label block">
            Show scores
          </label>
          <select
            id={`quiz-results-${deckId}`}
            value={form.resultsAfterDue ? "after" : "now"}
            onChange={(event) => set("resultsAfterDue", event.target.value === "after")}
            className={controlClasses(false) + " h-10"}
          >
            <option value="now">{form.allowBack && form.timerMode !== "question" ? "When they hand it in" : "Right after each answer"}</option>
            <option value="after">After the due date</option>
          </select>
        </div>
      </div>

      <div className="space-y-2">
        <Checkbox
          id={`quiz-shuffle-q-${deckId}`}
          checked={form.shuffleQuestions}
          onChange={(checked) => set("shuffleQuestions", checked)}
          label="Shuffle the question order for each student"
        />
        {choice ? (
          <Checkbox
            id={`quiz-shuffle-c-${deckId}`}
            checked={form.shuffleChoices}
            onChange={(checked) => set("shuffleChoices", checked)}
            label="Shuffle the answer choices for each student"
          />
        ) : null}
        {form.timerMode !== "question" ? (
          <Checkbox
            id={`quiz-back-${deckId}`}
            checked={form.allowBack}
            onChange={(checked) => set("allowBack", checked)}
            label="Let students go back and change answers before they hand it in"
          />
        ) : null}
      </div>

      {form.resultsAfterDue ? (
        <p className="type-helper">
          {form.latePolicy === "accept"
            ? "Scores appear when you close the quiz, because late answers are still coming in."
            : form.dueDate
              ? "Scores and correct answers appear after the due date has passed for every student."
              : "Scores and correct answers appear when you close the quiz."}
        </p>
      ) : null}

      <Button type="submit" loading={pending} loadingText="Giving quiz…">
        Give this as a quiz
      </Button>
      {error && <p className="text-sm font-medium text-error">{error}</p>}
    </form>
  );
}

function Checkbox({
  id,
  checked,
  onChange,
  label,
}: {
  id: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}) {
  return (
    <label htmlFor={id} className="flex cursor-pointer items-start gap-3">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5 size-5 shrink-0 rounded border-border-strong"
      />
      <span className="text-sm text-ink">{label}</span>
    </label>
  );
}

export function CloseQuizButton({ quizId, classId, deckId }: { quizId: string; classId: string; deckId: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="space-y-2">
      <Button
        type="button"
        variant="secondary"
        loading={pending}
        loadingText="Closing…"
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const result = await closeClassQuiz(quizId, classId, deckId);
            if (!result.ok) setError(result.error);
          });
        }}
      >
        Close quiz
      </Button>
      {error && <p className="text-sm font-medium text-error">{error}</p>}
    </div>
  );
}
