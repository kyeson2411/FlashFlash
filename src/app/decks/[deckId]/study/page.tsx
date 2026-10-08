import { Suspense } from "react";
import { redirect } from "next/navigation";
import { PageContainer } from "@/components/layout/PageContainer";
import { DeckMissing } from "@/components/deck/DeckMissing";
import { StudyView } from "@/components/study/StudyView";
import { LoadingState } from "@/components/ui/LoadingState";
import { getDeckById, getDueCardIds } from "@/lib/data/decks";
import { requireStudent } from "@/lib/auth/session";

export const metadata = { title: "Study | AutoFlash" };

export default function StudyPage({
  params,
  searchParams,
}: {
  params: Promise<{ deckId: string }>;
  searchParams: Promise<{ all?: string; due?: string; review?: string; again?: string }>;
}) {
  return (
    <PageContainer compact>
      <Suspense fallback={<LoadingState title="Loading your deck…" />}>
        <StudyLoader params={params} searchParams={searchParams} />
      </Suspense>
    </PageContainer>
  );
}

async function StudyLoader({
  params,
  searchParams,
}: {
  params: Promise<{ deckId: string }>;
  searchParams: Promise<{ all?: string; due?: string; review?: string; again?: string }>;
}) {
  const student = await requireStudent();
  const { deckId } = await params;
  const query = await searchParams;
  const deck = await getDeckById(deckId);
  if (!deck) return <DeckMissing />;
  if (deck.classId && deck.ownerId === student.id) redirect(`/decks/${deckId}`);
  if (deck.cards.length === 0) return <StudyView deck={deck} queueIds={[]} scope="due" />;

  const dueIds = await getDueCardIds(deckId);
  const everyCardDue = dueIds.length === deck.cards.length;
  const studyAll = query.all === "1";
  const studyDue = query.due === "1" || everyCardDue;
  const studyReview = query.review === "1";
  const studyAgain = query.again === "1";
  const reviewIds = deck.cards.filter((card) => card.state !== "known").map((card) => card.id);
  const knownIds = new Set(deck.cards.filter((card) => card.state === "known").map((card) => card.id));
  const againIds = dueIds.filter((id) => knownIds.has(id));

  if (studyAgain) {
    if (againIds.length === 0) redirect(`/decks/${deckId}`);
    return <StudyView deck={deck} queueIds={againIds} scope="again" />;
  }

  if (studyReview && reviewIds.length > 0) {
    return <StudyView deck={deck} queueIds={reviewIds} scope="review" />;
  }

  if (!studyAll && !studyReview && dueIds.length > 0 && !studyDue) {
    redirect(`/decks/${deckId}?choose=1`);
  }

  if (studyAll || dueIds.length === 0) {
    return <StudyView deck={deck} queueIds={deck.cards.map((card) => card.id)} scope="all" />;
  }

  return <StudyView deck={deck} queueIds={dueIds} scope="due" />;
}
