"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { downloadStudyPacks } from "@/app/actions/decks";
import { keepStudyDecks, saveStudyDeck, warmOfflinePage } from "@/lib/offline/study-store";
import { syncStudyOutbox } from "./sync-outbox";

export function SaveStudyPacks({ accountId, accountName }: { accountId: string; accountName: string }) {
  const router = useRouter();

  useEffect(() => {
    if (!navigator.onLine) return;
    let cancelled = false;
    const stopWarm = warmOfflinePage(() => router.prefetch("/study-offline"));
    void syncStudyOutbox(accountId);
    void downloadStudyPacks()
      .then(async (packs) => {
        if (cancelled || !packs) return;
        const savedAt = Date.now();
        for (const pack of packs) {
          await saveStudyDeck({
            accountId,
            accountName,
            deckId: pack.deckId,
            title: pack.title,
            classId: pack.classId,
            cards: pack.cards,
            queueIds: pack.queueIds,
            savedAt,
          });
        }
        await keepStudyDecks(
          accountId,
          packs.map((pack) => pack.deckId),
        );
      })
      .catch(() => {
        // The next signed-in visit tries again.
      });
    return () => {
      cancelled = true;
      stopWarm?.();
    };
  }, [accountId, accountName, router]);

  return null;
}
