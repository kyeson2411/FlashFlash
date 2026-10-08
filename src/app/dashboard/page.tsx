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
  const toLearn = topDecks(decks, (deck) => unmemorizedCount(deck.stats));
  const reviewAgain = topDecks(decks, (deck) => deck.dueAgainCount);
  const toLearnTotal = decks.reduce((sum, deck) => sum + unmemorizedCount(deck.stats), 0);
  const dueAgainTotal = decks.reduce((sum, deck) => sum + deck.dueAgainCount, 0);
  const knownCards = decks.reduce((sum, deck) => sum + deck.stats.known, 0);
  const hasWork = toLearnTotal > 0 || dueAgainTotal > 0;
  const hasDecks = decks.length > 0;
  const earliestDueId = dueAgainTotal > 0 ? await getEarliestReadyDeckId() : null;
  const reviewDeckId = earliestDueId ?? reviewAgain[0]?.deck.id ?? null;
  const primary = reviewDeckId
    ? { href: `/decks/${reviewDeckId}/study?again=1`, label: "Review again" }
    : toLearn[0]
      ? { href: `/decks/${toLearn[0].deck.id}/study?review=1`, label: "Review cards" }
      : null;
  const quietDeck = hasWork || !hasDecks ? null : await getQuietDeck(decks);
  const showProgress = progress.hasReviews || progress.hasCards;

  const next = quietDeck
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
      {hasWork && primary ? (
        <section aria-labelledby="today-heading" className="space-y-6">
          <div className="space-y-4">
            <div className="max-w-xl space-y-2">
              <h2 id="today-heading" className="type-section">
                Today
              </h2>
              <p className="type-body">{todaySummary(toLearnTotal, dueAgainTotal)}</p>
            </div>
            <ButtonLink href={primary.href} className="w-full sm:w-auto">
              {primary.label}
            </ButtonLink>
          </div>

          {reviewAgain.length > 0 ? (
            <Queue
              id="review-again-heading"
              title="Review again"
              items={reviewAgain}
              hrefFor={(deck) => `/decks/${deck.id}/study?again=1`}
              labelFor={(count) =>
                count === 1 ? "1 card ready to review again" : `${count} cards ready to review again`
              }
              action="Review again"
            />
          ) : null}

          {toLearn.length > 0 ? (
            <Queue
              id="still-learning-heading"
              title="Still to learn"
              items={toLearn}
              hrefFor={(deck) => `/decks/${deck.id}/study?review=1`}
              labelFor={(count) => (count === 1 ? "1 card still to learn" : `${count} cards still to learn`)}
              action="Review cards"
            />
          ) : null}
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
          <ProgressBoard progress={progress} cards={{ known: knownCards, toLearn: toLearnTotal }} />
        </section>
      )}

      {!hasDecks ? (
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

function topDecks(decks: DeckSummary[], countOf: (deck: DeckSummary) => number) {
  return decks
    .map((deck) => ({ deck, count: countOf(deck) }))
    .filter((item) => item.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 3);
}

function todaySummary(toLearn: number, dueAgain: number): string {
  const learn = toLearn === 1 ? "1 card still to learn" : `${toLearn} cards still to learn`;
  const again =
    dueAgain === 1 ? "1 card is ready to review again" : `${dueAgain} cards are ready to review again`;
  return `${learn}. ${again}.`;
}

function Queue({
  id,
  title,
  items,
  hrefFor,
  labelFor,
  action,
}: {
  id: string;
  title: string;
  items: { deck: DeckSummary; count: number }[];
  hrefFor: (deck: DeckSummary) => string;
  labelFor: (count: number) => string;
  action: string;
}) {
  return (
    <div className="space-y-3">
      <h3 id={id} className="text-base font-semibold text-ink">
        {title}
      </h3>
      <ul aria-labelledby={id} className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface">
        {items.map(({ deck, count }) => (
          <li key={deck.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 space-y-1">
              <h4 className="text-base font-semibold break-words text-ink">
                <Link href={`/decks/${deck.id}`} className="rounded-sm underline-offset-2 hover:underline">
                  {deck.title}
                </Link>
              </h4>
              <p className="type-helper">{labelFor(count)}</p>
            </div>
            <ButtonLink href={hrefFor(deck)} variant="secondary" className="w-full shrink-0 sm:w-auto">
              {action}
            </ButtonLink>
          </li>
        ))}
      </ul>
    </div>
  );
}
