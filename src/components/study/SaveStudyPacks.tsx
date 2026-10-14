"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { downloadStudyPacks } from "@/app/actions/decks";
import {
  hasNativeStudyStore,
  importNativeOutbox,
  keepStudyDecks,
  PACKS_SAVED_EVENT,
  PACKS_SAVED_KEY,
  saveNativePacks,
  saveStudyDeck,
  warmOfflinePage,
  type SavedDeck,
} from "@/lib/offline/study-store";
import { syncStudyOutbox } from "./sync-outbox";

const saving = new Map<string, Promise<void>>();

function markSaved() {
  try {
    sessionStorage.setItem(PACKS_SAVED_KEY, "1");
  } catch {
    // The line still appears for this visit.
  }
  window.dispatchEvent(new Event(PACKS_SAVED_EVENT));
}

async function storePacks(accountId: string, accountName: string) {
  try {
    await importNativeOutbox();
    await syncStudyOutbox(accountId);
  } catch {
    // A stuck answer must not stop the decks from being stored.
  }
  const packs = await downloadStudyPacks();
  if (!packs) return;
  const savedAt = Date.now();
  const decks: SavedDeck[] = packs.map((pack) => ({
    accountId,
    accountName,
    deckId: pack.deckId,
    title: pack.title,
    classId: pack.classId,
    cards: pack.cards,
    queueIds: pack.queueIds,
    savedAt,
  }));
  for (const deck of decks) await saveStudyDeck(deck);
  await keepStudyDecks(
    accountId,
    decks.map((deck) => deck.deckId),
  );
  const wroteNative = saveNativePacks(decks);
  if (wroteNative || !hasNativeStudyStore()) markSaved();
}

function rememberStudyPacks(accountId: string, accountName: string) {
  const current = saving.get(accountId);
  if (current) return current;
  const run = storePacks(accountId, accountName).finally(() => saving.delete(accountId));
  saving.set(accountId, run);
  return run;
}

export function SaveStudyPacks({ accountId, accountName }: { accountId: string; accountName: string }) {
  const router = useRouter();

  useEffect(() => {
    const run = () => {
      if (!navigator.onLine) return;
      void rememberStudyPacks(accountId, accountName).catch(() => {
        // The next signed-in visit tries again.
      });
    };
    run();
    window.addEventListener("online", run);
    const stopWarm = warmOfflinePage(() => router.prefetch("/study-offline"));
    return () => {
      window.removeEventListener("online", run);
      stopWarm?.();
    };
  }, [accountId, accountName, router]);

  return null;
}
