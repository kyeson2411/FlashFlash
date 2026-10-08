"use client";

import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button, ButtonLink } from "@/components/ui/Button";
import type { DeckSummary } from "@/lib/deck";
import { DuePrompt } from "./DuePrompt";

const ROW_BUTTON = "h-8 px-3 text-[13px]";

// Renders as a list row; place inside <List>.
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
  const pct = (n: number) => (deck.stats.total === 0 ? 0 : (n / deck.stats.total) * 100);

  return (
    <li className="relative flex flex-col gap-3 px-4 py-3 transition-colors hover:bg-white/5 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <Heading className="truncate text-sm font-semibold">
          <Link
            href={`/decks/${deck.id}`}
            className="text-ink after:absolute after:inset-0 after:content-['']"
          >
            {deck.title}
          </Link>
        </Heading>
        <p className="mt-0.5 truncate text-[13px] text-ink-muted">
          {deck.className ? `${deck.className} · ` : ""}
          {hasCards
            ? `${deck.stats.total} ${deck.stats.total === 1 ? "card" : "cards"} · ${deck.stats.known} known · ${deck.stats.learning} still learning`
            : "No cards yet"}
        </p>
        {note && <p className="mt-0.5 text-[13px] text-ink-muted">{note}</p>}
        {hasCards && (
          <div
            role="progressbar"
            aria-label="Cards reviewed"
            aria-valuemin={0}
            aria-valuemax={deck.stats.total}
            aria-valuenow={deck.stats.reviewed}
            className="mt-2 flex h-1 max-w-56 gap-px overflow-hidden rounded-full bg-raised"
          >
            <div className="bg-success-fill" style={{ width: `${pct(deck.stats.known)}%` }} />
            <div className="bg-warning-fill" style={{ width: `${pct(deck.stats.learning)}%` }} />
          </div>
        )}
      </div>

      <div className="relative z-10 flex shrink-0 flex-wrap items-center gap-2">
        {!hasCards ? (
          <Badge>Empty</Badge>
        ) : toReview > 0 ? (
          <Badge tone="warning">{toReview} to learn</Badge>
        ) : deck.readyCount > 0 ? (
          <Badge tone="primary">{deck.readyCount} ready</Badge>
        ) : (
          <Badge tone="success">All known</Badge>
        )}
        {hasCards && !deck.classId && (
          <ButtonLink href={`/decks/${deck.id}`} variant="ghost" className={ROW_BUTTON}>
            Edit
          </ButtonLink>
        )}
        {showChoice ? (
          <Button variant="secondary" className={ROW_BUTTON} onClick={() => setChooseOpen(true)}>
            Study
          </Button>
        ) : hasCards ? (
          <ButtonLink href={studyHref} variant="secondary" className={ROW_BUTTON}>
            Study
          </ButtonLink>
        ) : (
          <ButtonLink href={`/decks/${deck.id}`} variant="secondary" className={ROW_BUTTON}>
            {deck.classId ? "View deck" : "Add cards"}
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
    </li>
  );
}
