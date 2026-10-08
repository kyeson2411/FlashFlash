"use client";

import { useState } from "react";
import type { MutationResult } from "@/app/actions/decks";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { cn } from "@/lib/cn";
import { CARD_STATE_LABELS, type Flashcard } from "@/lib/deck";

const BADGE_TONE = { unreviewed: "neutral", learning: "warning", known: "success" } as const;

const actionBase =
  "inline-flex h-8 items-center justify-center rounded-md border px-3 text-[13px] font-medium transition-colors";

type CardRowProps = {
  card: Flashcard;
  index: number;
  onRemove: (cardId: string) => void;
  onSave: (cardId: string, question: string, answer: string) => Promise<MutationResult>;
  /** Show the answer immediately, for cards the student still needs to check. */
  answerVisible?: boolean;
  readOnly?: boolean;
  hideState?: boolean;
};

export function CardRow({ card, index, onRemove, onSave, answerVisible = false, readOnly = false, hideState = false }: CardRowProps) {
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [editing, setEditing] = useState(false);
  const [question, setQuestion] = useState(card.question);
  const [answer, setAnswer] = useState(card.answer);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function startEdit() {
    setQuestion(card.question);
    setAnswer(card.answer);
    setError(null);
    setConfirmingRemove(false);
    setEditing(true);
  }

  return (
    <li>
      <article
        className="-mx-3 space-y-2.5 rounded-md border-b border-border px-3 py-4 transition-colors hover:bg-white/[0.02]"
        data-card-id={card.id}
        data-state={card.state}
      >
        <div className="flex items-center justify-between gap-3">
          <p className="font-mono text-[11px] tabular-nums text-ink-muted">#{String(index + 1).padStart(2, "0")}</p>
          {!hideState && <Badge tone={BADGE_TONE[card.state]}>{CARD_STATE_LABELS[card.state]}</Badge>}
        </div>

        {editing ? (
          <form
            className="space-y-4"
            onSubmit={async (event) => {
              event.preventDefault();
              if (pending) return;
              setPending(true);
              setError(null);
              const result = await onSave(card.id, question, answer);
              setPending(false);
              if (!result.ok) {
                setError(result.error);
                return;
              }
              setEditing(false);
            }}
          >
            <Input
              id={`${card.id}-question`}
              label="Question"
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              disabled={pending}
              required
            />
            <Input
              id={`${card.id}-answer`}
              label="Answer"
              hint="1 to 3 words, up to 40 characters."
              value={answer}
              onChange={(event) => setAnswer(event.target.value)}
              disabled={pending}
              required
            />
            {error && <p className="text-sm font-medium text-error">{error}</p>}
            <div className="flex flex-wrap gap-2">
              <Button type="submit" loading={pending} loadingText="Saving…">
                Save
              </Button>
              <Button type="button" variant="secondary" onClick={() => setEditing(false)} disabled={pending}>
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <div className="space-y-3">
            <p className="text-[15px] font-medium leading-snug text-ink [overflow-wrap:anywhere]">{card.question}</p>
            {answerVisible ? (
              <p className="type-body border-l-2 border-border pl-4 [overflow-wrap:anywhere]">{card.answer}</p>
            ) : (
              <details className="group">
                <summary className="inline-flex min-h-8 cursor-pointer items-center rounded text-[13px] font-medium text-ink-secondary transition-colors hover:text-ink">
                  <span className="group-open:hidden">Show answer</span>
                  <span className="hidden group-open:inline">Hide answer</span>
                </summary>
                <p className="type-body mt-1 border-l-2 border-border pl-4 [overflow-wrap:anywhere]">{card.answer}</p>
              </details>
            )}
          </div>
        )}

        {!editing && !readOnly && (
        <div className="flex flex-wrap items-center justify-end gap-2">
          {confirmingRemove ? (
            <>
              <span className="text-sm text-ink-secondary">Remove this card?</span>
              <button
                type="button"
                onClick={() => onRemove(card.id)}
                className={cn(actionBase, "border-error/40 bg-error-soft text-error hover:border-error/70")}
              >
                Yes, remove
              </button>
              <button
                type="button"
                onClick={() => setConfirmingRemove(false)}
                className={cn(actionBase, "border-transparent text-ink-secondary hover:bg-white/5 hover:text-ink")}
              >
                Cancel
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={startEdit}
                className={cn(actionBase, "border-transparent text-ink-secondary hover:bg-white/5 hover:text-ink")}
              >
                Edit
              </button>
              <button
                type="button"
                onClick={() => setConfirmingRemove(true)}
                className={cn(actionBase, "border-transparent text-ink-secondary hover:bg-error-soft hover:text-error")}
              >
                Remove
              </button>
            </>
          )}
        </div>
        )}
      </article>
    </li>
  );
}
