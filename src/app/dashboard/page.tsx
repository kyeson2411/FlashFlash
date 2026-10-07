import Link from "next/link";
import { Suspense } from "react";
import { PageContainer } from "@/components/layout/PageContainer";
import { ButtonLink } from "@/components/ui/Button";
import { LoadingState } from "@/components/ui/LoadingState";
import { ProgressBoard } from "@/components/progress/ProgressBoard";
import { Steps } from "@/components/ui/Steps";
import { listDeckSummaries } from "@/lib/data/decks";
import { unmemorizedCount, type DeckSummary } from "@/lib/deck";
import { getEarliestReadyDeckId, getProgress, getQuietDeck } from "@/lib/data/progress";
import { requireStudent } from "@/lib/auth/session";

export const metadata = { title: "Dashboard | AutoFlash" };

export default function DashboardPage() {
  return (
    <PageContainer className="space-y-8">
      <Suspense fallback={<LoadingState title="Loading your dashboard…" />}>
        <DashboardHome />
      </Suspense>
    </PageContainer>
  );
}

async function DashboardHome() {
  await requireStudent();
  const [decks, progress] = await Promise.all([listDeckSummaries(), getProgress()]);
  const studyNext = decks
    .map((deck) => ({ deck, count: unmemorizedCount(deck.stats) }))
    .filter((item) => item.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 3);
  const reviewDeck = studyNext[0]?.deck ?? null;
  const reviewTotal = decks.reduce((sum, deck) => sum + unmemorizedCount(deck.stats), 0);
  const readyDeckId = !reviewDeck && progress.readyToday > 0 ? await getEarliestReadyDeckId() : null;
  const hasDecks = decks.length > 0;
  const quietDeck = reviewDeck || readyDeckId || !hasDecks ? null : await getQuietDeck(decks);
  const showProgress = progress.hasReviews || progress.hasCards;

  const next = reviewDeck
    ? {
        title: "Cards for review",
        body:
          reviewTotal === 1
            ? "1 card is not memorized yet."
            : `${reviewTotal} cards are not memorized yet.`,
        href: `/decks/${reviewDeck.id}/study?review=1`,
        label: "Review cards",
      }
    : readyDeckId
      ? {
          title: "Cards for review",
          body:
            progress.readyToday === 1
              ? "1 card you already know is ready to review again."
              : `${progress.readyToday} cards you already know are ready to review again.`,
          href: `/decks/${readyDeckId}/study?due=1`,
          label: "Review cards",
        }
      : quietDeck
        ? {
            title: "It's been a while",
            body: `You have not studied ${quietDeck.title} in a while. Those cards are still here when you want them.`,
            href: `/decks/${quietDeck.id}/study`,
            label: "Study this deck",
          }
        : hasDecks
          ? {
              title: "Add to a deck",
              body: "Nothing is waiting right now. Generate more cards into a deck you already have, or start a new one.",
              href: "/generate",
              label: "Generate more cards",
            }
          : {
              title: "Start with a deck",
              body: "Name a deck, then generate cards into it when you are ready.",
              href: "/decks",
              label: "Create your first deck",
            };

  return (
    <>
      {studyNext.length > 0 ? (
        <section aria-labelledby="study-next-heading" className="space-y-4">
          <div className="space-y-1">
            <h2 id="study-next-heading" className="type-section">
              Study next
            </h2>
            <p className="type-body">
              {reviewTotal === 1
                ? "1 card is not memorized yet."
                : `${reviewTotal} cards are not memorized yet.`}
            </p>
          </div>
          <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface">
            {studyNext.map(({ deck, count }, index) => (
              <StudyNextRow key={deck.id} deck={deck} count={count} featured={index === 0} />
            ))}
          </ul>
        </section>
      ) : (
        <section className="space-y-4 rounded-lg border border-border bg-surface p-5 sm:p-6">
          <div className="max-w-xl space-y-2">
            <h2 className="type-section">{next.title}</h2>
            <p className="type-body break-words">{next.body}</p>
          </div>
          <ButtonLink href={next.href} className="w-full sm:w-auto">
            {next.label}
          </ButtonLink>
        </section>
      )}

      {showProgress && (
        <section aria-labelledby="progress-heading" className="space-y-4">
          <div className="space-y-1">
            <h2 id="progress-heading" className="type-section">
              Your progress
            </h2>
            <p className="type-helper">Only for you. This is not a grade.</p>
          </div>
          <ProgressBoard progress={progress} />
        </section>
      )}

      {studyNext.length === 0 && !hasDecks ? (
        <section aria-labelledby="how-heading" className="space-y-4">
          <h2 id="how-heading" className="type-section">
            How it works
          </h2>
          <Steps showDescriptions />
        </section>
      ) : null}
    </>
  );
}

function StudyNextRow({
  deck,
  count,
  featured,
}: {
  deck: DeckSummary;
  count: number;
  featured: boolean;
}) {
  const label = count === 1 ? "1 card still to learn" : `${count} cards still to learn`;

  return (
    <li className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 space-y-1">
        <h3 className="text-base font-semibold break-words text-ink">
          <Link href={`/decks/${deck.id}`} className="rounded-sm underline-offset-2 hover:underline">
            {deck.title}
          </Link>
        </h3>
        <p className="type-helper">{label}</p>
      </div>
      <ButtonLink
        href={`/decks/${deck.id}/study?review=1`}
        variant={featured ? "primary" : "secondary"}
        className="w-full shrink-0 sm:w-auto"
      >
        Review cards
      </ButtonLink>
    </li>
  );
}
