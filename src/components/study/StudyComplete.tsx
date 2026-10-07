"use client";

import { useEffect, useRef } from "react";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";

type StudyCompleteProps = {
  deckTitle: string;
  deckHref: string;
  known: number;
  learning: number;
  onStudyAgain: () => void;
  onPracticeLearning: () => void;
};

// Shown after the last card. Plain facts and clear next steps, no celebration.
export function StudyComplete({
  deckTitle,
  deckHref,
  known,
  learning,
  onStudyAgain,
  onPracticeLearning,
}: StudyCompleteProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const total = known + learning;

  // Move focus here so keyboard and screen reader users land on the result.
  useEffect(() => headingRef.current?.focus(), []);

  const message =
    learning === 0
      ? `You marked all ${total} ${total === 1 ? "card" : "cards"} as known.`
      : `You know ${known} of ${total} cards. ${learning} still ${learning === 1 ? "needs" : "need"} more practice.`;

  return (
    <div className="card-enter mx-auto max-w-xl space-y-6">
      <div className="space-y-2">
        <p className="type-helper break-words">{deckTitle}</p>
        <h1 ref={headingRef} tabIndex={-1} className="type-page outline-offset-4">
          Session complete
        </h1>
        <p className="type-body">{message}</p>
      </div>

      <div className="flex flex-col gap-3">
        {learning > 0 ? (
          <>
            <Button onClick={onPracticeLearning}>
              Practice the {learning} still learning
            </Button>
            <Button variant="secondary" onClick={onStudyAgain}>
              Study again
            </Button>
          </>
        ) : (
          <Button onClick={onStudyAgain}>Study again</Button>
        )}
        <ButtonLink href={deckHref} variant={learning > 0 ? "ghost" : "secondary"}>
          Back to deck
        </ButtonLink>
      </div>
    </div>
  );
}
