"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setDeckWorkflowAction } from "@/app/actions/decks";
import { Button } from "@/components/ui/Button";
import type { DeckVersionSummary, DeckWorkflowStatus } from "@/lib/deck";

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
      {status === "draft" ? (
        <div className="space-y-2">
          <p className="type-helper">Students cannot see this deck until you publish it.</p>
          <Button type="button" variant="secondary" disabled={working} onClick={() => run("teacher_reviewed")}>
            Mark reviewed
          </Button>
        </div>
      ) : null}
      {status === "teacher_reviewed" ? (
        <div className="space-y-2">
          <p className="type-helper">Students still cannot see this deck. Publish it when the cards look right.</p>
          <Button type="button" disabled={working} onClick={() => run("published")}>
            Publish
          </Button>
        </div>
      ) : null}
      {error ? <p className="text-[13px] font-medium text-error">{error}</p> : null}
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
