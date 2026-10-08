import { Suspense } from "react";
import { DeckSummaryCard } from "@/components/deck/DeckSummaryCard";
import { NewDeckForm } from "@/components/deck/NewDeckForm";
import { EmptyState } from "@/components/ui/EmptyState";
import { LoadingState } from "@/components/ui/LoadingState";
import { listDeckSummaries } from "@/lib/data/decks";
import { requireStudent } from "@/lib/auth/session";

export const metadata = { title: "My Decks | AutoFlash" };

export default function DecksPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  return (
    <Suspense fallback={<LoadingState title="Loading your decks…" placeholders={3} />}>
      <DeckList searchParams={searchParams} />
    </Suspense>
  );
}

async function DeckList({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await requireStudent();
  const query = (await searchParams).q?.trim() ?? "";
  const decks = await listDeckSummaries();
  const shown = query ? decks.filter((deck) => deck.title.toLowerCase().includes(query.toLowerCase())) : decks;

  return (
    <>
      <div className="af-view-heading">
        <p className="af-eyebrow">Your study space</p>
        <h1>Your decks</h1>
        <p>All the subjects you are learning, together in one place.</p>
      </div>
      <NewDeckForm />
      {decks.length === 0 ? (
        <EmptyState title="No decks yet" description="Name a deck above. Then generate cards into it." />
      ) : shown.length === 0 ? (
        <EmptyState title="No decks found" description="Try a different search." />
      ) : (
        <div className="af-deck-grid">
          {shown.map((deck) => (
            <DeckSummaryCard key={deck.id} deck={deck} />
          ))}
        </div>
      )}
    </>
  );
}
