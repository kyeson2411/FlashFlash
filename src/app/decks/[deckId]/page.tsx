import { Suspense } from "react";
import { PageContainer } from "@/components/layout/PageContainer";
import { DeckMissing } from "@/components/deck/DeckMissing";
import { DeckView } from "@/components/deck/DeckView";
import { LoadingState } from "@/components/ui/LoadingState";
import { getDeckById, getDueCardIds } from "@/lib/data/decks";
import { requireStudent } from "@/lib/auth/session";

export const metadata = { title: "Deck | AutoFlash" };

export default function DeckPage({
  params,
  searchParams,
}: {
  params: Promise<{ deckId: string }>;
  searchParams: Promise<{ choose?: string; added?: string; skipped?: string }>;
}) {
  return (
    <PageContainer>
      <Suspense fallback={<LoadingState title="Loading your deck…" />}>
        <DeckLoader params={params} searchParams={searchParams} />
      </Suspense>
    </PageContainer>
  );
}

async function DeckLoader({
  params,
  searchParams,
}: {
  params: Promise<{ deckId: string }>;
  searchParams: Promise<{ choose?: string; added?: string; skipped?: string }>;
}) {
  const student = await requireStudent();
  const { deckId } = await params;
  const query = await searchParams;
  const deck = await getDeckById(deckId);
  if (!deck) return <DeckMissing />;
  const mode = !deck.classId
    ? "personal"
    : deck.ownerId === student.id
      ? "class-teacher"
      : "class-student";
  const dueIds = deck.cards.length === 0 || mode === "class-teacher" ? [] : await getDueCardIds(deckId);
  const unmemorized = deck.cards.filter((card) => card.state !== "known").length;
  const canChoose = mode === "personal" && unmemorized > 0 && unmemorized < deck.cards.length;
  return (
    <DeckView
      deck={deck}
      readyCount={dueIds.length}
      promptOpen={canChoose && query.choose === "1"}
      savedNotice={savedNotice(query.added, query.skipped)}
      justAdded={countFromQuery(query.added)}
      mode={mode}
    />
  );
}

function savedNotice(added: string | undefined, skipped: string | undefined): string | null {
  const addedCount = countFromQuery(added);
  if (addedCount === null) return null;
  const addedText =
    addedCount === 1 ? "1 new flashcard added." : `${addedCount} new flashcards added.`;
  const skippedCount = countFromQuery(skipped);
  if (skippedCount === null) return `${addedText} They're saved in this deck.`;
  const skippedText =
    skippedCount === 1 ? "1 similar card was skipped." : `${skippedCount} similar cards were skipped.`;
  return `${addedText} ${skippedText}`;
}

function countFromQuery(value: string | undefined): number | null {
  if (!value || !/^\d+$/.test(value)) return null;
  const count = Number(value);
  if (count < 1 || count > 20) return null;
  return count;
}
