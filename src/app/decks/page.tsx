import { Suspense } from "react";
import { redirect } from "next/navigation";
import { DeckSummaryCard } from "@/components/deck/DeckSummaryCard";
import { NewDeckForm } from "@/components/deck/NewDeckForm";
import { PageHeader, SectionHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { List } from "@/components/ui/List";
import { LoadingState } from "@/components/ui/LoadingState";
import { Modal } from "@/components/ui/Modal";
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
  const student = await requireStudent();
  if (student.role === "teacher") redirect("/classes");
  const query = (await searchParams).q?.trim() ?? "";
  const decks = (await listDeckSummaries()).filter((deck) => !deck.classId);
  const shown = query ? decks.filter((deck) => deck.title.toLowerCase().includes(query.toLowerCase())) : decks;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Your decks"
        description="All the subjects you are learning, together in one place."
        actions={
          <Modal
            triggerLabel="New deck"
            title="New deck"
            description="Name a deck, then write cards or generate them from your notes."
          >
            <NewDeckForm />
          </Modal>
        }
      />
      {decks.length === 0 ? (
        <EmptyState title="No decks yet" description="Use New deck to name your first one. Then generate cards into it." />
      ) : shown.length === 0 ? (
        <EmptyState title="No decks found" description={`Nothing matches “${query}”. Try a different search.`} />
      ) : (
        <section aria-labelledby="deck-list-heading">
          <SectionHeader
            id="deck-list-heading"
            title={query ? `Results for “${query}”` : "All decks"}
            count={shown.length}
          />
          <List>
            {shown.map((deck) => (
              <DeckSummaryCard key={deck.id} deck={deck} />
            ))}
          </List>
        </section>
      )}
    </div>
  );
}
