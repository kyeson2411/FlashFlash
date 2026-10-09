"use client";

import { useState, useTransition } from "react";
import { closeClassQuiz, giveClassQuiz } from "@/app/actions/quizzes";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { QUIZ_UNREADY, type DeckQuizOffer } from "@/lib/quiz";

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
        <OpenQuiz deckId={deckId} classId={classId} quizId={offer.openQuiz.id} dueLabel={offer.openQuiz.dueLabel} />
      ) : offer.ready ? (
        <GiveQuizForm deckId={deckId} minDate={offer.minDate} maxDate={offer.maxDate} />
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
  dueLabel,
}: {
  deckId: string;
  classId: string;
  quizId: string;
  dueLabel: string | null;
}) {
  return (
    <div className="space-y-3">
      <p className="type-body">{dueLabel ? `Students can take this until the end of ${dueLabel}.` : "Students can take this until you close it."}</p>
      <div className="flex flex-wrap gap-3">
        <ButtonLink href={`/quizzes/${quizId}`}>See who has finished</ButtonLink>
        <CloseQuizButton quizId={quizId} classId={classId} deckId={deckId} />
      </div>
    </div>
  );
}

function GiveQuizForm({ deckId, minDate, maxDate }: { deckId: string; minDate: string; maxDate: string }) {
  const [due, setDue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <form
      className="max-w-sm space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        startTransition(async () => {
          const result = await giveClassQuiz(deckId, due);
          if (!result.ok) setError(result.error);
        });
      }}
    >
      <Input
        id={`quiz-due-${deckId}`}
        label="Due date"
        type="date"
        min={minDate}
        max={maxDate}
        value={due}
        onChange={(event) => setDue(event.target.value)}
        hint="Optional. Students can take it through the end of this day."
      />
      <Button type="submit" loading={pending} loadingText="Giving quiz…">
        Give this as a quiz
      </Button>
      {error && <p className="text-sm font-medium text-error">{error}</p>}
    </form>
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
