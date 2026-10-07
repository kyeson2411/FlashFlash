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
  searchParams: Promise<{ choose?: string }>;
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
  searchParams: Promise<{ choose?: string }>;
}) {
  await requireStudent();
  const { deckId } = await params;
  const query = await searchParams;
  const deck = await getDeckById(deckId);
  if (!deck) return <DeckMissing />;
  const dueIds = deck.cards.length === 0 ? [] : await getDueCardIds(deckId);
  const unmemorized = deck.cards.filter((card) => card.state !== "known").length;
  const canChoose = unmemorized > 0 && unmemorized < deck.cards.length;
  return <DeckView deck={deck} readyCount={dueIds.length} promptOpen={canChoose && query.choose === "1"} />;
}
