import { Suspense } from "react";
import { PageContainer, PageHeader } from "@/components/layout/PageContainer";
import { DeckSummaryCard } from "@/components/deck/DeckSummaryCard";
import { NewDeckForm } from "@/components/deck/NewDeckForm";
import { EmptyState } from "@/components/ui/EmptyState";
import { LoadingState } from "@/components/ui/LoadingState";
import { listDeckSummaries } from "@/lib/data/decks";
import { requireStudent } from "@/lib/auth/session";

export const metadata = { title: "My Decks | AutoFlash" };

export default function DecksPage() {
  return (
    <PageContainer className="space-y-8">
      <PageHeader title="My Decks" description="Name a deck, then generate cards into it." />
      <NewDeckForm />
      <Suspense fallback={<LoadingState title="Loading your decks…" placeholders={3} />}>
        <DeckList />
      </Suspense>
    </PageContainer>
  );
}

async function DeckList() {
  await requireStudent();
  const decks = await listDeckSummaries();

  if (decks.length === 0) {
    return <EmptyState title="No decks yet" description="Name a deck above. Then generate cards into it." />;
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {decks.map((deck) => (
        <DeckSummaryCard key={deck.id} deck={deck} />
      ))}
    </div>
  );
}
