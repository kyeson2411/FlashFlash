"use client";

import { useEffect, useState } from "react";
import { signedInAccount } from "@/app/actions/auth";
import { Button } from "@/components/ui/Button";
import { List, ListRow } from "@/components/ui/List";
import { LoadingState } from "@/components/ui/LoadingState";
import type { Deck } from "@/lib/deck";
import { listStudyDecks, type SavedDeck } from "@/lib/offline/study-store";
import { StudyView } from "./StudyView";
import { syncStudyOutbox } from "./sync-outbox";

export function OfflineStudy() {
  const [decks, setDecks] = useState<SavedDeck[] | null>(null);
  const [openKey, setOpenKey] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void listStudyDecks().then((saved) => {
      if (!cancelled) setDecks(saved);
    });
    const sync = () => {
      void signedInAccount()
        .then(async (account) => {
          if (!account) return;
          await syncStudyOutbox(account.id);
        })
        .catch(() => {
          // The phone is still offline. Answers stay in the outbox.
        });
    };
    sync();
    window.addEventListener("online", sync);
    return () => {
      cancelled = true;
      window.removeEventListener("online", sync);
    };
  }, []);

  if (!decks) return <LoadingState title="Loading saved decks…" />;

  const open = decks.find((deck) => deckKey(deck) === openKey);
  if (open) {
    const deck: Deck = {
      id: open.deckId,
      title: open.title,
      createdAt: open.savedAt,
      classId: open.classId,
      cards: open.cards,
    };
    return (
      <StudyView
        deck={deck}
        queueIds={open.queueIds}
        account={{ id: open.accountId, name: open.accountName }}
        homeLabel="Saved decks"
        onHome={() => setOpenKey(null)}
      />
    );
  }

  const groups = groupByAccount(decks);

  return (
    <div className="mx-auto max-w-xl space-y-6 pt-4 sm:pt-8">
      <div className="space-y-2">
        <h1 className="type-page">Saved decks</h1>
        <p className="type-body">
          These decks can be studied with no connection. Quizzes and new cards still need a connection.
        </p>
      </div>
      {groups.length === 0 ? (
        <p className="type-body">Sign in while you are online. Your decks stay on this phone after that.</p>
      ) : (
        groups.map((group) => (
          <section key={group.accountId} className="space-y-3">
            <h2 className="type-section">Saved for {group.accountName}</h2>
            <List aria-label={`Decks saved for ${group.accountName}`}>
              {group.decks.map((deck) => (
                <ListRow
                  key={deck.deckId}
                  primary={deck.title}
                  secondary={`${deck.cards.length} ${deck.cards.length === 1 ? "card" : "cards"}`}
                  aside={
                    <Button type="button" variant="secondary" onClick={() => setOpenKey(deckKey(deck))}>
                      Study
                    </Button>
                  }
                />
              ))}
            </List>
          </section>
        ))
      )}
    </div>
  );
}

function deckKey(deck: SavedDeck) {
  return `${deck.accountId}:${deck.deckId}`;
}

function groupByAccount(decks: SavedDeck[]) {
  const groups: { accountId: string; accountName: string; decks: SavedDeck[] }[] = [];
  for (const deck of decks) {
    let group = groups.find((item) => item.accountId === deck.accountId);
    if (!group) {
      group = { accountId: deck.accountId, accountName: deck.accountName, decks: [] };
      groups.push(group);
    }
    group.decks.push(deck);
  }
  return groups;
}
