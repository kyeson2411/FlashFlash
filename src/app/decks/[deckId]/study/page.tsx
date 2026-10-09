import { Suspense } from "react";
import { redirect } from "next/navigation";
import { PageContainer } from "@/components/layout/PageContainer";
import { DeckMissing } from "@/components/deck/DeckMissing";
import { StudyView } from "@/components/study/StudyView";
import { LoadingState } from "@/components/ui/LoadingState";
import { getDeckById, getDueCardIds } from "@/lib/data/decks";
import { requireStudent } from "@/lib/auth/session";

export const metadata = { title: "Study | AutoFlash" };

export default function StudyPage({ params }: { params: Promise<{ deckId: string }> }) {
  return (
    <PageContainer compact>
      <Suspense fallback={<LoadingState title="Loading your deck…" />}>
        <StudyLoader params={params} />
      </Suspense>
    </PageContainer>
  );
}

async function StudyLoader({ params }: { params: Promise<{ deckId: string }> }) {
  const student = await requireStudent();
  const { deckId } = await params;
  const deck = await getDeckById(deckId);
  if (!deck) return <DeckMissing />;
  if (deck.classId && deck.ownerId === student.id) redirect(`/decks/${deckId}`);
  if (deck.cards.length === 0) return <StudyView deck={deck} queueIds={[]} />;

  const queueIds = await getDueCardIds(deckId);
  return <StudyView deck={deck} queueIds={queueIds} />;
}
