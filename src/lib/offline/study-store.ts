import type { CardState } from "@/lib/deck";
import type { StudyMode } from "@/lib/study-mode";
import type { Outcome } from "@/components/study/session";

// Decks and unsent answers stored on this phone. The server stays the record
// of progress. A signed-in visit while online stores the decks that can be studied.

export type SavedCard = {
  id: string;
  question: string;
  answer: string;
  state: CardState;
};

export type SavedDeck = {
  accountId: string;
  accountName: string;
  deckId: string;
  title: string;
  classId: string | null;
  cards: SavedCard[];
  queueIds: string[];
  savedAt: number;
};

export type OutboxAnswer = {
  accountId: string;
  cardId: string;
  outcome: Outcome;
  mode: StudyMode;
};

const DB_NAME = "autoflash-study";
const DB_VERSION = 1;

export const SAVED_ON_PHONE = "Saved on this phone. It will sync when you are back online.";

/** These replies mean the answer never reached the server, so it stays on the phone. */
export const RETRY_LATER_ERRORS = new Set([
  "Your progress could not be saved. Check your connection and try again.",
  "Your session ended. Sign in again to save your progress.",
]);

function withoutKey<T extends { key: string }>(row: T): Omit<T, "key"> {
  const value = { ...row };
  delete value.key;
  return value;
}

function deckKey(accountId: string, deckId: string) {
  return `${accountId}:${deckId}`;
}

function answerKey(accountId: string, cardId: string) {
  return `${accountId}:${cardId}`;
}

export function queueAnswer(items: OutboxAnswer[], next: OutboxAnswer): OutboxAnswer[] {
  return [...items.filter((item) => answerKey(item.accountId, item.cardId) !== answerKey(next.accountId, next.cardId)), next];
}

export function dropAnswer(items: OutboxAnswer[], accountId: string, cardId: string): OutboxAnswer[] {
  const key = answerKey(accountId, cardId);
  return items.filter((item) => answerKey(item.accountId, item.cardId) !== key);
}

export function answersForAccount(items: OutboxAnswer[], accountId: string): OutboxAnswer[] {
  return items.filter((item) => item.accountId === accountId);
}

function canUseDb() {
  return typeof indexedDB !== "undefined";
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("decks")) db.createObjectStore("decks", { keyPath: "key" });
      if (!db.objectStoreNames.contains("outbox")) db.createObjectStore("outbox", { keyPath: "key" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

type DeckRow = SavedDeck & { key: string };
type OutboxRow = OutboxAnswer & { key: string };

export async function keepStudyDecks(accountId: string, deckIds: string[]): Promise<void> {
  if (!canUseDb()) return;
  const db = await openDb();
  const rows = await requestToPromise(db.transaction("decks").objectStore("decks").getAll() as IDBRequest<DeckRow[]>);
  const keep = new Set(deckIds);
  const tx = db.transaction("decks", "readwrite");
  const store = tx.objectStore("decks");
  await Promise.all(
    rows
      .filter((row) => row.accountId === accountId && !keep.has(row.deckId))
      .map((row) => requestToPromise(store.delete(row.key))),
  );
  db.close();
}

export async function saveStudyDeck(deck: SavedDeck): Promise<void> {
  if (!canUseDb()) return;
  const db = await openDb();
  const row: DeckRow = { ...deck, key: deckKey(deck.accountId, deck.deckId) };
  await requestToPromise(db.transaction("decks", "readwrite").objectStore("decks").put(row));
  db.close();
}

export async function listStudyDecks(): Promise<SavedDeck[]> {
  if (!canUseDb()) return [];
  const db = await openDb();
  const rows = await requestToPromise(db.transaction("decks").objectStore("decks").getAll() as IDBRequest<DeckRow[]>);
  db.close();
  return rows.map(withoutKey).sort((a, b) => b.savedAt - a.savedAt);
}

export async function enqueueAnswer(answer: OutboxAnswer): Promise<void> {
  if (!canUseDb()) return;
  const db = await openDb();
  const row: OutboxRow = { ...answer, key: answerKey(answer.accountId, answer.cardId) };
  await requestToPromise(db.transaction("outbox", "readwrite").objectStore("outbox").put(row));
  db.close();
}

export async function dropQueuedAnswer(accountId: string, cardId: string): Promise<void> {
  if (!canUseDb()) return;
  const db = await openDb();
  await requestToPromise(
    db.transaction("outbox", "readwrite").objectStore("outbox").delete(answerKey(accountId, cardId)),
  );
  db.close();
}

export async function listQueuedAnswers(accountId: string): Promise<OutboxAnswer[]> {
  if (!canUseDb()) return [];
  const db = await openDb();
  const rows = await requestToPromise(db.transaction("outbox").objectStore("outbox").getAll() as IDBRequest<OutboxRow[]>);
  db.close();
  return answersForAccount(rows.map(withoutKey), accountId);
}

/** Ask the browser to load the saved-decks page so it can be opened with no connection. */
export function warmOfflinePage(prefetch?: () => void) {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  const warm = () => {
    prefetch?.();
    void fetch("/study-offline", { credentials: "same-origin", headers: { Accept: "text/html" } }).catch(() => {
      // The page is cached the next time this screen is opened online.
    });
  };
  void navigator.serviceWorker.ready.then(warm).catch(() => {});
  navigator.serviceWorker.addEventListener("controllerchange", warm);
  return () => navigator.serviceWorker.removeEventListener("controllerchange", warm);
}
