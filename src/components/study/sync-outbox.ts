"use client";

import { signedInAccount } from "@/app/actions/auth";
import { markCard } from "@/app/actions/decks";
import { dropQueuedAnswer, listQueuedAnswers, RETRY_LATER_ERRORS } from "@/lib/offline/study-store";

const flushing = new Map<string, Promise<void>>();

/** Send this account's unsent answers. Stops at the first answer that still cannot reach the server. */
export function syncStudyOutbox(accountId: string): Promise<void> {
  const current = flushing.get(accountId);
  if (current) return current;
  const run = flushOutbox(accountId).finally(() => flushing.delete(accountId));
  flushing.set(accountId, run);
  return run;
}

async function flushOutbox(accountId: string): Promise<void> {
  const signedIn = await signedInAccount();
  if (!signedIn || signedIn.id !== accountId) return;
  const pending = await listQueuedAnswers(accountId);
  for (const answer of pending) {
    try {
      const result = await markCard(answer.cardId, answer.outcome, answer.mode);
      if (!result.ok && RETRY_LATER_ERRORS.has(result.error)) return;
      await dropQueuedAnswer(accountId, answer.cardId);
    } catch {
      return;
    }
  }
}
