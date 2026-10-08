import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { LoadingState } from "@/components/ui/LoadingState";
import { ProgressBoard } from "@/components/progress/ProgressBoard";
import { ButtonLink } from "@/components/ui/Button";
import { listDeckSummaries } from "@/lib/data/decks";
import { unmemorizedCount, type DeckSummary } from "@/lib/deck";
import { getEarliestReadyDeckId, getProgress, getQuietDeck } from "@/lib/data/progress";
import { requireStudent } from "@/lib/auth/session";

export const metadata = { title: "Dashboard | AutoFlash" };

export default function DashboardPage() {
  return (
    <Suspense fallback={<LoadingState title="Loading your dashboard…" />}>
      <DashboardHome />
    </Suspense>
  );
}

async function DashboardHome() {
  const student = await requireStudent();
  if (student.role === "teacher") redirect("/classes");
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
          body: "Nothing is waiting right now. Generate more cards for a deck you already have, or start a new one.",
          href: "/generate",
          label: "Generate more cards",
        }
      : {
          title: "Start with a deck",
          body: "Name a deck, then generate cards for it when you are ready.",
          href: "/decks",
          label: "Create your first deck",
        };

  const today = new Intl.DateTimeFormat("en", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "Asia/Manila",
  }).format(new Date());
  const focus =
    dueAgainTotal > 0
      ? decks.find((deck) => deck.id === reviewDeckId) ?? reviewAgain[0]?.deck
      : toLearn[0]?.deck;

  if (!hasDecks) {
    return (
      <section className="dash-next" aria-labelledby="today-heading">
        <p className="dash-kicker">{today}</p>
        <h1 id="today-heading">Start your first study deck</h1>
        <p>Turn your notes into flashcards and start learning.</p>
        <ButtonLink href="/generate" className="dash-action">
          Make flashcards
        </ButtonLink>
      </section>
    );
  }

  const heading = dueAgainTotal > 0 ? "Ready to review" : toLearnTotal > 0 ? "Keep learning" : "All caught up";
  const detail =
    dueAgainTotal > 0
      ? "Some cards are ready for another review."
      : toLearnTotal > 0
        ? "You still have cards to learn."
        : "You're up to date for now.";

  return (
    <>
      <section className="dash-next" aria-labelledby="today-heading">
        <p className="dash-kicker">{today}</p>
        <h1 id="today-heading">{heading}</h1>
        <p>{detail}</p>
        {focus ? <p className="dash-focus">{focus.title}</p> : null}
        {hasWork && primary ? (
          <ButtonLink href={primary.href} className="dash-action">
            {primary.label}
          </ButtonLink>
        ) : quietDeck ? (
          <p className="dash-note">
            You have not studied {quietDeck.title} in a while. Those cards are still here when you want them.{" "}
            <Link href={next.href}>{next.label}</Link>
          </p>
        ) : (
          <p className="dash-note">
            <Link href={next.href}>Make more flashcards</Link> when you have new notes.
          </p>
        )}
      </section>

      <dl className="dash-metrics">
        <div>
          <dt>Current streak</dt>
          <dd>{progress.streak === 1 ? "1 day" : `${progress.streak} days`}</dd>
        </div>
        <div>
          <dt>Cards you know</dt>
          <dd>{knownCards}</dd>
        </div>
        <div>
          <dt>Cards left to learn</dt>
          <dd>{toLearnTotal}</dd>
        </div>
        <div>
          <dt>Ready for review</dt>
          <dd>{dueAgainTotal}</dd>
        </div>
      </dl>

      <div className="dash-lower">
        <section className="dash-panel" aria-labelledby="decks-heading">
          <div className="dash-panel-head">
            <div>
              <h2 id="decks-heading">Your decks</h2>
              <p>What is left to learn, and what is ready for another review.</p>
            </div>
            <Link href="/decks">All decks</Link>
          </div>
          <ul className="dash-decks">
            {decks.map((deck) => {
              const learn = unmemorizedCount(deck.stats);
              const again = deck.dueAgainCount;
              const href =
                again > 0
                  ? `/decks/${deck.id}/study?again=1`
                  : learn > 0
                    ? `/decks/${deck.id}/study?review=1`
                    : `/decks/${deck.id}/study?all=1`;
              const action = again > 0 ? "Review again" : learn > 0 ? "Review cards" : "Study";
              return (
                <li key={deck.id}>
                  <div className="min-w-0">
                    <Link href={`/decks/${deck.id}`} className="dash-deck-name">
                      {deck.title}
                    </Link>
                    <p>
                      {deck.stats.total} {deck.stats.total === 1 ? "card" : "cards"}
                      {" · "}
                      {learn} {learn === 1 ? "card" : "cards"} left to learn
                      {" · "}
                      {again} {again === 1 ? "card" : "cards"} ready for review
                    </p>
                  </div>
                  <ButtonLink href={href} variant="secondary" className="dash-study">
                    {action}
                  </ButtonLink>
                </li>
              );
            })}
          </ul>
        </section>

        {showProgress ? (
          <ProgressBoard progress={progress} />
        ) : (
          <section className="dash-panel" id="week" aria-labelledby="week-heading">
            <h2 id="week-heading">This week</h2>
            <p>Reviews you save will show up here. A day with no reviews shows 0. This is not a grade.</p>
          </section>
        )}
      </div>
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

