"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { cn } from "@/lib/cn";
import { CARD_STATE_LABELS, type Flashcard } from "@/lib/deck";

const BADGE_TONE = { unreviewed: "neutral", learning: "warning", known: "success" } as const;

const actionBase =
  "inline-flex h-11 items-center justify-center rounded-md border px-4 text-sm font-semibold transition-colors";

type CardRowProps = {
  card: Flashcard;
  index: number;
  onRemove: (cardId: string) => void;
};

export function CardRow({ card, index, onRemove }: CardRowProps) {
  const [confirmingRemove, setConfirmingRemove] = useState(false);

  return (
    <li>
      <article className="space-y-3 border-b border-border py-5" data-card-id={card.id} data-state={card.state}>
        <div className="flex items-center justify-between gap-3">
          <p className="type-helper">Card {index + 1}</p>
          <Badge tone={BADGE_TONE[card.state]}>{CARD_STATE_LABELS[card.state]}</Badge>
        </div>

        <div className="space-y-3">
          <p className="text-base font-semibold leading-snug text-ink [overflow-wrap:anywhere]">{card.question}</p>
          <details className="group">
            <summary className="inline-flex min-h-11 cursor-pointer items-center rounded text-sm font-medium text-primary hover:text-primary-hover">
              <span className="group-open:hidden">Show answer</span>
              <span className="hidden group-open:inline">Hide answer</span>
            </summary>
            <p className="type-body mt-1 border-l-2 border-border pl-4 [overflow-wrap:anywhere]">{card.answer}</p>
          </details>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2">
          {confirmingRemove ? (
            <>
              <span className="text-sm text-ink-secondary">Remove this card?</span>
              <button
                type="button"
                onClick={() => onRemove(card.id)}
                className={cn(actionBase, "border-error bg-error-soft text-error hover:bg-error-soft")}
              >
                Yes, remove
              </button>
              <button
                type="button"
                onClick={() => setConfirmingRemove(false)}
                className={cn(actionBase, "border-transparent text-ink-secondary hover:bg-background")}
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmingRemove(true)}
              className={cn(actionBase, "border-transparent text-ink-secondary hover:bg-background hover:text-error")}
            >
              Remove
            </button>
          )}
        </div>
      </article>
    </li>
  );
}
