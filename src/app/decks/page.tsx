import { Suspense } from "react";
import { redirect } from "next/navigation";
import { DeckTile, DeckTileGrid } from "@/components/deck/DeckTile";
import { NewDeckForm } from "@/components/deck/NewDeckForm";
import { UpNext } from "@/components/deck/UpNext";
import { PageHeader, SectionHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { LoadingState } from "@/components/ui/LoadingState";
import { Modal } from "@/components/ui/Modal";
import { listDeckSummaries } from "@/lib/data/decks";
import { mostToStudy, toLearnLine, unmemorizedCount } from "@/lib/deck";
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
  const next = query ? null : mostToStudy(decks);
  const totalToLearn = decks.reduce((sum, deck) => sum + unmemorizedCount(deck.stats), 0);
  const decksToLearn = decks.filter((deck) => unmemorizedCount(deck.stats) > 0).length;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Your decks"
        description="All the subjects you are learning, together in one place."
        actions={
          <Modal
            triggerLabel="New deck"
            variant="secondary"
            title="New deck"
            description="Name a deck, then write cards or generate them from your notes."
          >
            <NewDeckForm />
          </Modal>
        }
      />
      {next ? (
        <UpNext
          heading={
            totalToLearn > 0
              ? `${totalToLearn} ${totalToLearn === 1 ? "card" : "cards"} to learn across ${decksToLearn} ${decksToLearn === 1 ? "deck" : "decks"}`
              : toLearnLine(next)
          }
          detail={`Start with ${next.title}: ${toLearnLine(next)}.`}
          href={`/decks/${next.id}/study`}
          action={`Study ${next.title}`}
        />
      ) : null}
      {decks.length === 0 ? (
        <EmptyState title="No decks yet" description="Use New deck to name your first one. Then generate cards for it." />
      ) : shown.length === 0 ? (
        <EmptyState title="No decks found" description={`Nothing matches “${query}”. Try a different search.`} />
      ) : (
        <section aria-labelledby="deck-list-heading">
          <SectionHeader
            id="deck-list-heading"
            title={query ? `Results for “${query}”` : "All decks"}
            count={shown.length}
          />
          <DeckTileGrid>
            {shown.map((deck) => (
              <DeckTile key={deck.id} deck={deck} />
            ))}
          </DeckTileGrid>
        </section>
      )}
    </div>
  );
}
