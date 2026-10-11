import Link from "next/link";
import type { ReactNode } from "react";
import { ButtonLink } from "@/components/ui/Button";
import { unmemorizedCount, type DeckSummary } from "@/lib/deck";

// One deck in a grid. The page's main Study button lives in UpNext, so tiles use the secondary style.
export function DeckTile({ deck }: { deck: DeckSummary }) {
  const { total, known, learning } = deck.stats;
  const toLearn = unmemorizedCount(deck.stats);
  const ready = toLearn > 0 || deck.readyCount > 0 || deck.dueAgainCount > 0;
  const pct = (n: number) => (total === 0 ? 0 : (n / total) * 100);

  return (
    <li className="relative flex flex-col gap-5 rounded-lg border border-border bg-surface p-5 transition-colors hover:border-border-strong">
      <div className="min-w-0">
        <h3 className="text-base font-semibold text-ink [overflow-wrap:anywhere]">
          <Link href={`/decks/${deck.id}`} className="after:absolute after:inset-0 after:content-['']">
            {deck.title}
          </Link>
        </h3>
        <p className="mt-0.5 text-sm text-ink-secondary">
          {total === 0 ? "No cards yet" : `${total} ${total === 1 ? "card" : "cards"}`}
        </p>
      </div>

      {total > 0 ? (
        <div className="mt-auto space-y-3">
          <div className="flex items-end justify-between gap-3">
            {toLearn > 0 ? (
              <p className="flex items-baseline gap-2">
                <span className="text-3xl font-semibold tabular-nums leading-none text-ink">{toLearn}</span>
                <span className="text-sm text-ink-secondary">to learn</span>
              </p>
            ) : deck.readyCount > 0 ? (
              <p className="flex items-baseline gap-2">
                <span className="text-3xl font-semibold tabular-nums leading-none text-ink">{deck.readyCount}</span>
                <span className="text-sm text-ink-secondary">ready to review</span>
              </p>
            ) : (
              <p className="text-sm font-semibold text-success">All known</p>
            )}
            <div className="relative z-10 flex shrink-0 items-center gap-1">
              {!deck.classId ? (
                <ButtonLink href={`/decks/${deck.id}`} variant="ghost" className="h-9 px-3">
                  Edit
                </ButtonLink>
              ) : null}
              {ready ? (
                <ButtonLink href={`/decks/${deck.id}/study`} variant="secondary" className="h-9 px-4">
                  Study
                </ButtonLink>
              ) : null}
            </div>
          </div>
          <div
            role="progressbar"
            aria-label="Cards reviewed"
            aria-valuemin={0}
            aria-valuemax={total}
            aria-valuenow={known + learning}
            aria-valuetext={`${known} known, ${learning} still learning, of ${total}`}
            className="flex h-1.5 gap-px overflow-hidden rounded-full bg-raised"
          >
            <div className="bg-success-fill" style={{ width: `${pct(known)}%` }} />
            <div className="bg-warning-fill" style={{ width: `${pct(learning)}%` }} />
          </div>
          <p className="flex gap-4 text-[13px] text-ink-secondary">
            <span className="flex items-center gap-1.5">
              <span aria-hidden="true" className="size-2 rounded-full bg-success-fill" />
              {known} known
            </span>
            <span className="flex items-center gap-1.5">
              <span aria-hidden="true" className="size-2 rounded-full bg-warning-fill" />
              {learning} still learning
            </span>
          </p>
        </div>
      ) : (
        <div className="relative z-10 mt-auto">
          <ButtonLink href={`/decks/${deck.id}`} variant="secondary" className="h-9 px-4">
            {deck.classId ? "View deck" : "Add cards"}
          </ButtonLink>
        </div>
      )}
    </li>
  );
}

export function DeckTileGrid({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <ul aria-label={label} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {children}
    </ul>
  );
}
