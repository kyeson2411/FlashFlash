"use client";

import Link from "next/link";
import { useState } from "react";
import { Button, ButtonLink } from "@/components/ui/Button";
import type { DeckSummary } from "@/lib/deck";
import { DeckProgressCompact } from "./DeckProgress";
import { DuePrompt } from "./DuePrompt";

export function DeckSummaryCard({
  deck,
  heading: Heading = "h3",
  note,
}: {
  deck: DeckSummary;
  heading?: "h2" | "h3";
  note?: string;
}) {
  const [chooseOpen, setChooseOpen] = useState(false);
  const hasCards = deck.stats.total > 0;
  const toReview = deck.stats.learning + deck.stats.unreviewed;
  const showChoice = hasCards && toReview > 0 && toReview < deck.stats.total;
  const studyHref =
    toReview > 0
      ? `/decks/${deck.id}/study?review=1`
      : deck.readyCount > 0
        ? `/decks/${deck.id}/study?due=1`
        : `/decks/${deck.id}/study?all=1`;

  return (
    <article className="af-deck-tile space-y-4">
      <div className="space-y-1">
        <Heading className="break-words">
          <Link href={`/decks/${deck.id}`} className="rounded-sm text-ink underline-offset-2 hover:underline">
            {deck.title}
          </Link>
        </Heading>
        <p className="type-helper">
          {hasCards
            ? `${deck.stats.total} ${deck.stats.total === 1 ? "card" : "cards"}`
            : "No cards yet"}
        </p>
      </div>
      {hasCards && <DeckProgressCompact stats={deck.stats} />}
      {note && <p className="type-helper">{note}</p>}
      <div className="flex flex-wrap gap-2">
        {showChoice ? (
          <Button className="w-full sm:w-auto" onClick={() => setChooseOpen(true)}>
            Study now
          </Button>
        ) : hasCards ? (
          <ButtonLink href={studyHref} className="w-full sm:w-auto">
            Study now
          </ButtonLink>
        ) : (
          <ButtonLink href={`/decks/${deck.id}`} className="w-full sm:w-auto">
            Add cards
          </ButtonLink>
        )}
        {hasCards && (
          <ButtonLink href={`/decks/${deck.id}`} variant="secondary" className="w-full sm:w-auto">
            Add or edit cards
          </ButtonLink>
        )}
      </div>
      {showChoice && (
        <DuePrompt
          deckId={deck.id}
          unmemorizedCount={toReview}
          totalCount={deck.stats.total}
          open={chooseOpen}
          onClose={() => setChooseOpen(false)}
        />
      )}
    </article>
  );
}
