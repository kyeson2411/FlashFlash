"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setDeckWorkflowAction } from "@/app/actions/decks";
import { Button } from "@/components/ui/Button";
import {
  DECK_WORKFLOW_LABELS,
  DECK_WORKFLOW_STATUSES,
  deckWorkflowStep,
  type DeckVersionSummary,
  type DeckWorkflowStatus,
} from "@/lib/deck";

const STEP_NOTE: Record<DeckWorkflowStatus, string> = {
  draft: "Read through the cards, then mark the deck reviewed.",
  teacher_reviewed: "The cards are reviewed. Publish them so students can start studying.",
  published: "Students can study this deck. You can give it as a quiz below.",
};

const ACTION_LABEL = { teacher_reviewed: "Mark reviewed", published: "Publish to students" } as const;

export function DeckWorkflow({
  deckId,
  status,
  versions,
}: {
  deckId: string;
  status: DeckWorkflowStatus;
  versions: DeckVersionSummary[];
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [working, startTransition] = useTransition();
  const step = deckWorkflowStep(status);

  function run(next: "teacher_reviewed" | "published") {
    setError(null);
    startTransition(async () => {
      const result = await setDeckWorkflowAction(deckId, next);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <section aria-labelledby="deck-publish-heading" className="space-y-4 rounded-lg border border-border bg-surface p-4 sm:p-5">
        <h2 id="deck-publish-heading" className="sr-only">
          Publishing
        </h2>
        <ol className="flex flex-wrap items-center gap-x-3 gap-y-2">
          {DECK_WORKFLOW_STATUSES.map((item, index) => {
            const done = index < step.index;
            const current = index === step.index;
            return (
              <li
                key={item}
                aria-current={current ? "step" : undefined}
                className="flex items-center gap-3 text-[13px] font-medium"
              >
                {index > 0 ? (
                  <span aria-hidden="true" className={`h-px w-6 sm:w-10 ${done || current ? "bg-success" : "bg-border-strong"}`} />
                ) : null}
                <span
                  className={`flex items-center gap-2 ${
                    done ? "text-success" : current ? (status === "published" ? "text-success" : "text-primary") : "text-ink-muted"
                  }`}
                >
                  <StepMark state={done || (current && status === "published") ? "done" : current ? "current" : "upcoming"} />
                  {DECK_WORKFLOW_LABELS[item]}
                  {done ? <span className="sr-only">, done</span> : null}
                </span>
              </li>
            );
          })}
        </ol>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="type-body">{STEP_NOTE[status]}</p>
          {step.next ? (
            <Button
              type="button"
              variant={step.next === "published" ? "primary" : "secondary"}
              loading={working}
              loadingText="Saving…"
              onClick={() => step.next && run(step.next)}
              className="shrink-0"
            >
              {ACTION_LABEL[step.next]}
            </Button>
          ) : null}
        </div>
        {error ? <p className="text-[13px] font-medium text-error">{error}</p> : null}
      </section>
      {versions.length > 0 ? (
        <section className="space-y-2" aria-labelledby="deck-versions-heading">
          <h2 id="deck-versions-heading" className="type-section">
            Versions
          </h2>
          <p className="type-helper">Students see the current cards. Earlier versions stay here for you.</p>
          <ol className="space-y-1">
            {versions.map((version) => (
              <li key={version.number} className="type-helper">
                Version {version.number} · {version.cardCount} {version.cardCount === 1 ? "card" : "cards"} ·{" "}
                {versionWhen(version.createdAt)}
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </div>
  );
}

function StepMark({ state }: { state: "done" | "current" | "upcoming" }) {
  if (state === "done") {
    return (
      <svg aria-hidden="true" viewBox="0 0 16 16" className="size-4">
        <circle cx="8" cy="8" r="7.5" fill="currentColor" opacity="0.18" />
        <path d="M5 8.2 7 10.2 11 6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  return (
    <span
      aria-hidden="true"
      className={`size-2.5 rounded-full ${state === "current" ? "bg-primary ring-4 ring-primary/20" : "border border-border-strong"}`}
    />
  );
}

function versionWhen(iso: string): string {
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return "Unknown time";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Asia/Manila",
  }).format(when);
}
