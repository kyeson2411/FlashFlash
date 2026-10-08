import Link from "next/link";
import { Suspense } from "react";
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
    <Suspense fallback={<LoadingState title="Loading your dashboard…" />}>
      <DashboardHome />
    </Suspense>
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

  const today = new Intl.DateTimeFormat("en", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "Asia/Manila",
  }).format(new Date());
  const resumeDeck = reviewAgain[0]?.deck ?? toLearn[0]?.deck ?? decks[0];
  const resumeLabel = primary?.label ?? "Open deck";
  const shelf = decks.slice(0, 3);

  return (
    <>
      <div className="af-welcome">
        <div>
          <p className="af-eyebrow">{today}</p>
          <h1>A little progress adds up.</h1>
          <p>
            {hasWork
              ? todaySummary(toLearnTotal, dueAgainTotal)
              : "Your notes are ready when you are. Pick up where you left off."}
          </p>
        </div>
        <div className="af-date">Your own pace · No grades</div>
      </div>

      <section className="af-hero" aria-labelledby="today-heading">
        <div className="af-hero-copy">
          <span className="af-hero-tag">Made from your notes</span>
          <h2 id="today-heading">Turn today&apos;s class notes into tomorrow&apos;s recall.</h2>
          <p>Paste what you are learning. Your cards stay in your account.</p>
          <Link className="af-primary" href="/generate">
            Generate cards from notes
          </Link>
        </div>
        <div className="af-resume">
          <div className="af-resume-heading">Ready when you are</div>
          {resumeDeck ? (
            <>
              <div>
                <b>{resumeDeck.title}</b>
                <small>{hasWork ? todaySummary(toLearnTotal, dueAgainTotal) : next.body}</small>
              </div>
              <Link className="af-primary" href={hasWork && primary ? primary.href : next.href}>
                {hasWork && primary ? resumeLabel : next.label}
              </Link>
            </>
          ) : (
            <div>
              <b>{next.title}</b>
              <small>{next.body}</small>
              <Link className="af-primary" href={next.href} style={{ marginTop: 12 }}>
                {next.label}
              </Link>
            </div>
          )}
        </div>
      </section>

      <div className="af-metrics">
        <div className="af-metric">
          <small>Your current streak</small>
          <strong>{progress.streak === 1 ? "1 day" : `${progress.streak} days`}</strong>
        </div>
        <div className="af-metric">
          <small>Cards you know</small>
          <strong>{knownCards}</strong>
          <em>one at a time</em>
        </div>
        <div className="af-metric">
          <small>Still to learn</small>
          <strong>{toLearnTotal}</strong>
          <em>
            {dueAgainTotal === 1 ? "1 ready again" : `${dueAgainTotal} ready again`}
          </em>
        </div>
      </div>

      <div className="af-lower">
        <section className="af-section" aria-labelledby="decks-heading">
          <div className="af-section-head">
            <div>
              <h3 id="decks-heading">Your decks</h3>
              <p>A small shelf of things you are learning.</p>
            </div>
            <Link className="af-text-link" href="/decks">
              See all
            </Link>
          </div>
          {shelf.length > 0 ? (
            <div className="af-deck-list">
              {shelf.map((deck) => {
                const learn = unmemorizedCount(deck.stats);
                const again = deck.dueAgainCount;
                const clear = learn === 0 && again === 0;
                const href =
                  again > 0
                    ? `/decks/${deck.id}/study?again=1`
                    : learn > 0
                      ? `/decks/${deck.id}/study?review=1`
                      : `/decks/${deck.id}/study?all=1`;
                const pill = again > 0 ? `${again} to review again` : learn > 0 ? `${learn} to learn` : "All caught up";
                return (
                  <div className="af-deck" key={deck.id}>
                    <div>
                      <Link className="af-deck-name" href={`/decks/${deck.id}`}>
                        {deck.title}
                      </Link>
                      <span className="af-deck-meta">
                        {deck.stats.total} {deck.stats.total === 1 ? "card" : "cards"}
                      </span>
                    </div>
                    <span className={clear ? "af-due-pill clear" : "af-due-pill"}>{pill}</span>
                    <Link className="af-text-link" href={href}>
                      Study
                    </Link>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="type-helper">Name a deck, then generate cards into it when you are ready.</p>
          )}
          <Link className="af-generate-inline" href="/generate">
            <span>
              <strong>Have fresh class notes?</strong>
              <small>Start a deck with the material you already have.</small>
            </span>
            <span className="af-text-link">Generate</span>
          </Link>
        </section>

        {showProgress ? (
          <ProgressBoard progress={progress} cards={{ known: knownCards, toLearn: toLearnTotal }} />
        ) : (
          <section className="af-section" id="week">
            <h3>Your week, in moments</h3>
            <p className="type-helper">Reviews you save will show up here. A quiet day shows 0.</p>
          </section>
        )}
      </div>

      <p className="af-privacy">Your saved decks and review history stay in your account. No grades, no leaderboard.</p>

      {!hasDecks ? (
        <section aria-labelledby="how-heading" className="af-section" style={{ marginTop: 16 }}>
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
