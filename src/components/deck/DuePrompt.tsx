"use client";

import { useEffect, useRef } from "react";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";

export function DuePrompt({
  deckId,
  unmemorizedCount,
  totalCount,
  open,
  onClose,
}: {
  deckId: string;
  unmemorizedCount: number;
  totalCount: number;
  open: boolean;
  onClose: () => void;
}) {
  const firstActionRef = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    if (!open) return;
    firstActionRef.current?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  const hasReview = unmemorizedCount > 0 && unmemorizedCount < totalCount;
  const reviewLine =
    unmemorizedCount === 1
      ? `1 of ${totalCount} cards is not memorized yet. Review that card, or study every card in this deck.`
      : `${unmemorizedCount} of ${totalCount} cards are not memorized yet. Review those cards, or study every card in this deck.`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button type="button" className="absolute inset-0 bg-ink/40" aria-label="Close" onClick={onClose} />
      <Card
        role="dialog"
        aria-modal="true"
        aria-labelledby="due-prompt-title"
        className="relative z-10 w-full max-w-lg space-y-4"
      >
        <h2 id="due-prompt-title" className="type-section">
          Cards for review
        </h2>
        <p className="type-body">{reviewLine}</p>
        <div className="flex flex-col gap-3">
          {hasReview && (
            <ButtonLink ref={firstActionRef} href={`/decks/${deckId}/study?review=1`} className="w-full">
              Review cards you haven&apos;t memorized
            </ButtonLink>
          )}
          <ButtonLink
            ref={hasReview ? undefined : firstActionRef}
            href={`/decks/${deckId}/study?all=1`}
            variant={hasReview ? "secondary" : "primary"}
            className="w-full"
          >
            Study every card
          </ButtonLink>
          <Button variant="ghost" onClick={onClose} className="w-full">
            Close
          </Button>
        </div>
      </Card>
    </div>
  );
}
