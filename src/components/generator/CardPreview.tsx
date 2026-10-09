"use client";

import { Button } from "@/components/ui/Button";
import { controlClasses } from "@/components/ui/Field";
import { isTypeableAnswer } from "@/lib/typeable";

export type DraftCard = {
  key: string;
  question: string;
  answer: string;
};

function draftError(card: DraftCard): string | null {
  if (!card.question.trim()) return "Enter a question.";
  if (card.question.trim().length > 2000) return "Keep the question under 2000 characters.";
  if (!isTypeableAnswer(card.answer)) return "Use an answer of 1 to 3 words, up to 40 characters.";
  return null;
}

export function CardPreview({
  cards,
  heading,
  remaining,
  saving,
  onChange,
  onRemove,
  onSave,
  onDiscard,
}: {
  cards: DraftCard[];
  /** Topic the student typed, or the model title when they only pasted notes. */
  heading?: string;
  remaining: number | null;
  saving: boolean;
  onChange: (key: string, patch: Partial<Pick<DraftCard, "question" | "answer">>) => void;
  onRemove: (key: string) => void;
  onSave: () => void;
  onDiscard: () => void;
}) {
  const problems = cards.map(draftError);
  const blocked = cards.length === 0 || problems.some(Boolean);

  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <h2 className="type-section">Check these cards</h2>
        {heading ? (
          <p>
            <span className="type-label">Topic</span>
            <span className="mt-1 block text-lg font-semibold text-ink">{heading}</span>
          </p>
        ) : null}
        <p className="type-helper">
          Edit or remove any card before it is saved.
          {remaining === null
            ? " Saving uses one of today's flashcard creations."
            : ` Saving uses one of today's ${remaining} remaining ${remaining === 1 ? "creation" : "creations"}. Discarding does not.`}
        </p>
      </div>

      {cards.length === 0 ? (
        <p className="type-body">Every card was removed. Discard these and create another set, or go back and keep one.</p>
      ) : (
        <ol className="space-y-4">
          {cards.map((card, index) => {
            const error = problems[index];
            return (
              <li key={card.key} className="space-y-3 rounded-lg border border-border bg-surface p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="font-mono text-xs text-ink-muted">Card {index + 1}</p>
                  <button
                    type="button"
                    className="text-sm font-medium text-ink-secondary underline-offset-2 hover:text-ink hover:underline"
                    onClick={() => onRemove(card.key)}
                    disabled={saving}
                  >
                    Remove
                  </button>
                </div>
                <div className="space-y-1.5">
                  <label htmlFor={`preview-q-${card.key}`} className="type-label block">
                    Question
                  </label>
                  <textarea
                    id={`preview-q-${card.key}`}
                    value={card.question}
                    rows={2}
                    disabled={saving}
                    onChange={(event) => onChange(card.key, { question: event.target.value })}
                    className={controlClasses(!!error && !card.question.trim()) + " resize-y"}
                  />
                </div>
                <div className="space-y-1.5">
                  <label htmlFor={`preview-a-${card.key}`} className="type-label block">
                    Answer
                  </label>
                  <input
                    id={`preview-a-${card.key}`}
                    value={card.answer}
                    disabled={saving}
                    onChange={(event) => onChange(card.key, { answer: event.target.value })}
                    className={controlClasses(!!error && card.question.trim().length > 0) + " h-10"}
                  />
                </div>
                {error && <p className="text-sm font-medium text-error">{error}</p>}
              </li>
            );
          })}
        </ol>
      )}

      <div className="flex flex-wrap gap-3">
        <Button type="button" onClick={onSave} disabled={blocked} loading={saving} loadingText="Saving cards…">
          Save {cards.length} {cards.length === 1 ? "card" : "cards"}
        </Button>
        <Button type="button" variant="secondary" onClick={onDiscard} disabled={saving}>
          Discard
        </Button>
      </div>
    </div>
  );
}
