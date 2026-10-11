"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { makeReviewDeck } from "@/app/actions/classes";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { MAX_REVIEW_CARDS } from "@/lib/deck";

export type ReviewCardChoice = { cardId: string; question: string; answer: string; deckTitle: string };

const NETWORK_ERROR = "Could not reach AutoFlash. Check your connection and try again.";

export function ReviewDeckForm({
  classId,
  cards,
  defaultTitle,
}: {
  classId: string;
  cards: ReviewCardChoice[];
  defaultTitle: string;
}) {
  const router = useRouter();
  const choices = uniqueByQuestion(cards);
  const [title, setTitle] = useState(defaultTitle);
  const [picked, setPicked] = useState(() => new Set(choices.slice(0, MAX_REVIEW_CARDS).map((card) => card.cardId)));
  const [error, setError] = useState<string | null>(null);
  const [working, startTransition] = useTransition();
  const tooMany = picked.size > MAX_REVIEW_CARDS;

  function toggle(cardId: string, on: boolean) {
    setPicked((current) => {
      const next = new Set(current);
      if (on) next.add(cardId);
      else next.delete(cardId);
      return next;
    });
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const ids = choices.filter((card) => picked.has(card.cardId)).map((card) => card.cardId);
    startTransition(async () => {
      try {
        const result = await makeReviewDeck(classId, title, ids);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        router.push(`/decks/${result.deckId}`);
      } catch {
        setError(NETWORK_ERROR);
      }
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-5 text-left">
      <Input
        id="review-deck-title"
        label="Deck name"
        required
        maxLength={200}
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        disabled={working}
      />
      <fieldset className="space-y-2">
        <legend className="type-label">
          Cards to copy · {picked.size} of {choices.length}
        </legend>
        <p className="type-helper">
          The new deck starts as a draft with copies of these cards. The original decks and student progress stay as they
          are.
        </p>
        <ul className="max-h-80 divide-y divide-border overflow-y-auto rounded-lg border border-border">
          {choices.map((card) => (
            <li key={card.cardId}>
              <label htmlFor={`review-${card.cardId}`} className="flex cursor-pointer items-start gap-3 px-3 py-3 hover:bg-white/[0.03]">
                <input
                  id={`review-${card.cardId}`}
                  type="checkbox"
                  checked={picked.has(card.cardId)}
                  onChange={(event) => toggle(card.cardId, event.target.checked)}
                  disabled={working}
                  className="mt-0.5 size-5 shrink-0 rounded border-border-strong"
                />
                <span className="min-w-0 space-y-0.5">
                  <span className="block text-sm font-medium text-ink">{card.question}</span>
                  <span className="block text-[13px] text-ink-muted">
                    {card.answer} · {card.deckTitle}
                  </span>
                </span>
              </label>
            </li>
          ))}
        </ul>
        {tooMany ? <p className="text-[13px] font-medium text-error">Choose up to {MAX_REVIEW_CARDS} cards.</p> : null}
      </fieldset>
      {error ? <p className="text-sm font-medium text-error">{error}</p> : null}
      <Button
        type="submit"
        loading={working}
        loadingText="Making…"
        disabled={picked.size === 0 || tooMany || title.trim().length === 0}
        className="w-full"
      >
        Make review deck
      </Button>
    </form>
  );
}

function uniqueByQuestion(cards: ReviewCardChoice[]): ReviewCardChoice[] {
  const seen = new Set<string>();
  return cards.filter((card) => {
    const key = card.question.trim().toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
