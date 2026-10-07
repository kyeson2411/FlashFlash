"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { deleteCard, resetProgress } from "@/app/actions/decks";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Button, ButtonLink } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { getDeckLearningState, getDeckStats, type Deck } from "@/lib/deck";
import { CardRow } from "./CardRow";
import { DeckProgress, reviewedText } from "./DeckProgress";
import { DuePrompt } from "./DuePrompt";

function readinessMessage(deck: Deck) {
  const stats = getDeckStats(deck);
  switch (getDeckLearningState(stats)) {
    case "empty":
      return "This deck has no cards, so there is nothing to study.";
    case "not-started":
      return "You haven't reviewed any cards yet. Study now when you are ready.";
    case "in-progress":
      return `${stats.unreviewed} ${stats.unreviewed === 1 ? "card" : "cards"} left to review. Study now when you are ready.`;
    case "all-reviewed":
      return stats.learning > 0
        ? `You've reviewed every card. ${stats.learning} still ${stats.learning === 1 ? "needs" : "need"} more practice.`
        : "You know every card in this deck.";
  }
}

export function DeckView({
  deck: initial,
  readyCount: initialReady,
  promptOpen = false,
}: {
  deck: Deck;
  readyCount: number;
  promptOpen?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [deck, setDeck] = useState(initial);
  const stats = getDeckStats(deck);
  const hasCards = stats.total > 0;
  const toReview = stats.learning + stats.unreviewed;
  const [readyCount, setReadyCount] = useState(initialReady);
  const [chooseOpen, setChooseOpen] = useState(promptOpen);
  const [announcement, setAnnouncement] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const closePrompt = useCallback(() => {
    setChooseOpen(false);
    if (promptOpen) router.replace(pathname);
  }, [pathname, promptOpen, router]);

  async function handleRemove(cardId: string) {
    const previous = deck;
    setDeck({ ...deck, cards: deck.cards.filter((c) => c.id !== cardId) });
    setNotice(null);
    setBusyId(cardId);
    const result = await deleteCard(cardId);
    setBusyId(null);
    if (!result.ok) {
      setDeck(previous);
      setNotice(result.error);
      return;
    }
    setAnnouncement("Card removed from this deck.");
  }

  async function handleReset() {
    const previous = deck;
    setDeck({ ...deck, cards: deck.cards.map((c) => ({ ...c, state: "unreviewed" as const })) });
    const result = await resetProgress(deck.id);
    if (!result.ok) {
      setDeck(previous);
      setNotice(result.error);
      return;
    }
    setReadyCount(previous.cards.length);
    setAnnouncement("Progress reset. All cards are unreviewed.");
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="type-page break-words">{deck.title}</h1>
            <Badge tone="primary">
              {stats.total} {stats.total === 1 ? "card" : "cards"}
            </Badge>
          </div>
          <p className="type-body max-w-xl">{readinessMessage(deck)}</p>
        </div>

        <div className="shrink-0 sm:text-right">
          {hasCards ? (
            <ButtonLink
              href={
                toReview > 0
                  ? `/decks/${deck.id}/study?review=1`
                  : readyCount > 0
                    ? `/decks/${deck.id}/study?due=1`
                    : `/decks/${deck.id}/study?all=1`
              }
              className="w-full sm:w-auto"
            >
              Study now
            </ButtonLink>
          ) : (
            <ButtonLink href={`/generate?deck=${deck.id}`} className="w-full sm:w-auto">
              Add cards
            </ButtonLink>
          )}
        </div>
      </div>

      {notice && (
        <Alert tone="warning" title="Nothing changed">
          {notice}
        </Alert>
      )}

      <section aria-label="Deck progress" className="space-y-4 border-y border-border py-6">
        <h2 className="sr-only">Progress</h2>
        {hasCards ? <DeckProgress stats={stats} /> : <p className="type-body">No cards to track yet.</p>}
      </section>

      <section aria-labelledby="cards-heading" className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="cards-heading" className="type-section">
            Cards
          </h2>
          {stats.reviewed > 0 && (
            <Button variant="ghost" onClick={handleReset} disabled={busyId !== null}>
              Reset progress
            </Button>
          )}
        </div>

        {hasCards ? (
          <ol className="border-t border-border">
            {deck.cards.map((card, index) => (
              <CardRow key={card.id} card={card} index={index} onRemove={handleRemove} />
            ))}
          </ol>
        ) : (
          <EmptyState
            headingLevel={3}
            title="No cards yet"
            description="Use Add cards above when you are ready to generate into this deck."
          />
        )}
      </section>

      <p className="type-helper">Your progress is saved to your account.</p>

      <p role="status" className="sr-only">
        {announcement} {hasCards ? reviewedText(stats) : "No cards left."}
      </p>

      <DuePrompt
        deckId={deck.id}
        unmemorizedCount={toReview}
        totalCount={stats.total}
        open={chooseOpen && hasCards}
        onClose={closePrompt}
      />
    </div>
  );
}
