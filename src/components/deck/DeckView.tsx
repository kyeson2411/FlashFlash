"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { addCard, deleteCard, resetProgress, updateCard, type MutationResult } from "@/app/actions/decks";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Button, ButtonLink } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { getDeckLearningState, getDeckStats, type Deck } from "@/lib/deck";
import { AddCardForm } from "./AddCardForm";
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
        ? `You have reviewed every card. ${stats.learning} ${stats.learning === 1 ? "card still needs" : "cards still need"} more practice.`
        : "You know every card in this deck.";
  }
}

export function DeckView({
  deck: initial,
  readyCount: initialReady,
  promptOpen = false,
  savedNotice = null,
  justAdded = null,
  mode = "personal",
}: {
  deck: Deck;
  readyCount: number;
  promptOpen?: boolean;
  savedNotice?: string | null;
  /** How many cards were just appended. They are the last cards in the deck. */
  justAdded?: number | null;
  mode?: "personal" | "class-teacher" | "class-student";
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [deck, setDeck] = useState(initial);
  const stats = getDeckStats(deck);
  const hasCards = stats.total > 0;
  const toReview = stats.learning + stats.unreviewed;
  const canEdit = mode !== "class-student";
  const canStudy = mode !== "class-teacher";
  const backHref =
    mode !== "personal" && deck.classId ? `/classes/${deck.classId}` : "/decks";
  const [readyCount, setReadyCount] = useState(initialReady);
  const [chooseOpen, setChooseOpen] = useState(promptOpen);
  const [announcement, setAnnouncement] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const scrolledToNew = useRef(false);

  const freshIds = new Set(
    justAdded && justAdded > 0 ? initial.cards.slice(-justAdded).map((card) => card.id) : [],
  );
  const freshCards = deck.cards.filter((card) => freshIds.has(card.id));
  const olderCards = deck.cards.filter((card) => !freshIds.has(card.id));
  const studyHref =
    toReview > 0
      ? `/decks/${deck.id}/study?review=1`
      : readyCount > 0
        ? `/decks/${deck.id}/study?due=1`
        : `/decks/${deck.id}/study?all=1`;

  useEffect(() => {
    if (scrolledToNew.current || freshCards.length === 0) return;
    scrolledToNew.current = true;
    document.getElementById("new-cards")?.scrollIntoView({ block: "start" });
  }, [freshCards.length]);

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

  async function handleAdd(question: string, answer: string): Promise<MutationResult> {
    const result = await addCard(deck.id, question, answer);
    if (!result.ok) return result;
    setDeck((current) => ({ ...current, cards: [...current.cards, result.card] }));
    setAnnouncement("Card added.");
    return { ok: true };
  }

  async function handleEdit(cardId: string, question: string, answer: string): Promise<MutationResult> {
    const result = await updateCard(cardId, question, answer);
    if (!result.ok) return result;
    setDeck((current) => ({
      ...current,
      cards: current.cards.map((card) =>
        card.id === cardId ? { ...card, question: question.trim(), answer: answer.trim() } : card,
      ),
    }));
    setAnnouncement("Card updated.");
    return result;
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
      <ButtonLink href={backHref} variant="ghost" className="-ml-3 h-11 px-3 text-sm">
        <span aria-hidden="true">←</span> {mode === "personal" ? "Back to decks" : "Back to class"}
      </ButtonLink>
      <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="type-page break-words">{deck.title}</h1>
            <Badge tone="primary">
              {stats.total} {stats.total === 1 ? "card" : "cards"}
            </Badge>
          </div>
          {deck.className && <p className="type-helper">{deck.className}</p>}
          <p className="type-body max-w-xl">
            {mode === "class-teacher"
              ? "Students study these cards. Their progress stays on their own accounts."
              : mode === "class-student"
                ? "These cards are from your class. Your progress is saved only for you."
                : readinessMessage(deck)}
          </p>
        </div>

        <div className="shrink-0 sm:text-right">
          {canStudy && hasCards ? (
            <ButtonLink href={studyHref} className="w-full sm:w-auto">
              Study now
            </ButtonLink>
          ) : canEdit ? (
            <ButtonLink href={`/generate?deck=${deck.id}`} className="w-full sm:w-auto">
              Make flashcards
            </ButtonLink>
          ) : null}
        </div>
      </div>

      {savedNotice && (
        <Alert
          tone="success"
          title="Flashcards saved"
          action={
            hasCards && canStudy ? (
              <div className="flex flex-wrap gap-2">
                <ButtonLink href={studyHref}>Study now</ButtonLink>
                <ButtonLink href={`/decks/${deck.id}`} variant="secondary">
                  View deck
                </ButtonLink>
              </div>
            ) : null
          }
        >
          {savedNotice}
        </Alert>
      )}

      {notice && (
        <Alert tone="warning" title="Nothing changed">
          {notice}
        </Alert>
      )}

      {freshCards.length > 0 && (
        <section id="new-cards" aria-labelledby="new-cards-heading" className="scroll-mt-6 space-y-4">
          <div className="space-y-1">
            <h2 id="new-cards-heading" className="type-section">
              New flashcards
            </h2>
            <p className="type-helper">
              These are the flashcards AutoFlash created from your material. Check each question and answer, then edit
              or remove any that don&apos;t look right.
            </p>
          </div>
          <ol className="border-t border-border">
            {freshCards.map((card) => (
              <CardRow
                key={card.id}
                card={card}
                index={deck.cards.findIndex((item) => item.id === card.id)}
                onRemove={handleRemove}
                onSave={handleEdit}
                answerVisible
                readOnly={!canEdit}
                hideState={mode === "class-teacher"}
              />
            ))}
          </ol>
        </section>
      )}

      {mode !== "class-teacher" && (
      <section aria-label="Deck progress" className="space-y-4 border-y border-border py-6">
        <h2 className="sr-only">Progress</h2>
        {hasCards ? <DeckProgress stats={stats} /> : <p className="type-body">No cards to track yet.</p>}
      </section>
      )}

      {canEdit && <AddCardForm onAdd={handleAdd} />}

      {(olderCards.length > 0 || freshCards.length === 0) && (
      <section aria-labelledby="cards-heading" className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="cards-heading" className="type-section">
            {freshCards.length > 0 && olderCards.length > 0 ? "Other cards" : "Cards"}
          </h2>
          {canEdit && mode !== "class-teacher" && stats.reviewed > 0 && (
            <Button variant="ghost" onClick={handleReset} disabled={busyId !== null}>
              Reset progress
            </Button>
          )}
        </div>

        {olderCards.length > 0 ? (
          <ol className="border-t border-border">
            {olderCards.map((card) => (
              <CardRow
                key={card.id}
                card={card}
                index={deck.cards.findIndex((item) => item.id === card.id)}
                onRemove={handleRemove}
                onSave={handleEdit}
                readOnly={!canEdit}
                hideState={mode === "class-teacher"}
              />
            ))}
          </ol>
        ) : freshCards.length > 0 ? null : (
          <EmptyState
            headingLevel={3}
            title="No cards yet"
            description={
              canEdit
                ? "Write a card in the form above, or generate some from your notes."
                : "Your teacher has not added cards to this deck yet."
            }
          />
        )}
      </section>
      )}

      <p className="type-helper">
        {mode === "class-teacher"
          ? "Deleting a card also removes each student's progress on that card."
          : "Your progress is saved to your account."}
      </p>

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
