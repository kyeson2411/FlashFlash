import { Suspense } from "react";
import { PageContainer, PageHeader } from "@/components/layout/PageContainer";
import { FlashcardGenerator } from "@/components/generator/FlashcardGenerator";
import { LoadingState } from "@/components/ui/LoadingState";
import { listDeckSummaries } from "@/lib/data/decks";
import { requireStudent } from "@/lib/auth/session";

export const metadata = { title: "Generate flashcards | AutoFlash" };

export default function GeneratePage({ searchParams }: { searchParams: Promise<{ deck?: string }> }) {
  return (
    <PageContainer className="space-y-8 px-0">
      <div className="af-view-heading">
        <p className="af-eyebrow">A gentle start</p>
        <PageHeader
          title="Make flashcards"
          description="Begin with the material you already have. Choose a deck, then add cards to it."
        />
      </div>
      <Suspense fallback={<LoadingState title="Loading…" />}>
        <GenerateBody searchParams={searchParams} />
      </Suspense>
    </PageContainer>
  );
}

async function GenerateBody({ searchParams }: { searchParams: Promise<{ deck?: string }> }) {
  await requireStudent();
  const query = await searchParams;
  const decks = await listDeckSummaries();
  return (
    <FlashcardGenerator
      decks={decks.map((deck) => ({ id: deck.id, title: deck.title }))}
      initialDeckId={query.deck}
    />
  );
}
