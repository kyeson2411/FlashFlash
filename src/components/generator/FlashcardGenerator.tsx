"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button, ButtonLink } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/Input";
import { LoadingState } from "@/components/ui/LoadingState";
import { Textarea } from "@/components/ui/Textarea";
import { controlClasses } from "@/components/ui/Field";
import { CARD_COUNT_OPTIONS, MAX_INPUT_LENGTH, STUDY_MATERIAL_MARKER, type CardCount } from "@/lib/flashcards";

const EXAMPLES = ["Photosynthesis", "Causes of World War I", "Basic SQL joins"];
const MAX_TOPIC_LENGTH = 150;
const SAVED_DECK_KEY = "autoflash-generate-saved";

function readSavedDeck(): string | null {
  try {
    return sessionStorage.getItem(SAVED_DECK_KEY);
  } catch {
    return null;
  }
}

function rememberSavedDeck(id: string) {
  try {
    sessionStorage.setItem(SAVED_DECK_KEY, id);
  } catch {
    // The page can still reset from memory if storage is blocked.
  }
}

function forgetSavedDeck() {
  try {
    sessionStorage.removeItem(SAVED_DECK_KEY);
  } catch {
    // ignore
  }
}

// The API accepts a single text field, so the topic and the optional notes are
// combined into one message. The server and prompt are unchanged.
function buildInput(topic: string, material: string) {
  if (topic && material) return `Topic: ${topic}${STUDY_MATERIAL_MARKER}${material}`;
  return topic || material;
}

function studentError(message: string | undefined, status: number): string {
  if (status === 429) {
    return message ?? "You've used today's flashcard creations. Please try again tomorrow.";
  }
  if (!message || /stack trace|api key|postgres|pgrst|jwt/i.test(message)) {
    return "Something went wrong while creating your flashcards. Please try again.";
  }
  return message;
}

export function FlashcardGenerator({
  decks,
  initialDeckId = "",
  remaining,
  dailyLimit,
  forTeacher = false,
}: {
  decks: { id: string; title: string }[];
  initialDeckId?: string;
  remaining: number | null;
  dailyLimit: number | null;
  forTeacher?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const navigatingAway = useRef(false);
  const [topic, setTopic] = useState("");
  const [material, setMaterial] = useState("");
  const [count, setCount] = useState<CardCount>(5);
  const [deckId, setDeckId] = useState(decks.some((deck) => deck.id === initialDeckId) ? initialDeckId : "");
  const [deckError, setDeckError] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const [opening, setOpening] = useState(false); // deck is ready, navigating to it
  const [topicError, setTopicError] = useState<string | undefined>();
  const [materialError, setMaterialError] = useState<string | undefined>();
  const [requestError, setRequestError] = useState<string | null>(null);
  const [savedDeckId, setSavedDeckId] = useState<string | null>(null);

  const inFlight = useRef(false); // blocks double submits before React re-renders
  const topicRef = useRef<HTMLInputElement>(null);
  const deckRef = useRef<HTMLSelectElement>(null);
  const materialRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [loadedFile, setLoadedFile] = useState<string | null>(null);

  const cleanTopic = topic.trim();
  const cleanMaterial = material.trim();
  const totalLength = buildInput(cleanTopic, cleanMaterial).length;
  const tooLong = totalLength > MAX_INPUT_LENGTH;

  const busy = loading || opening;
  const chosenDeck = decks.find((deck) => deck.id === deckId);
  const outOfCreations = remaining !== null && remaining <= 0;

  function releaseSavedForm(deckToOpen: string | null) {
    forgetSavedDeck();
    inFlight.current = false;
    setOpening(false);
    setLoading(false);
    setTopic("");
    setMaterial("");
    setLoadedFile(null);
    setTopicError(undefined);
    setMaterialError(undefined);
    setRequestError(null);
    if (deckToOpen) setSavedDeckId(deckToOpen);
  }

  // After a save, this page used to come back still on "Opening your deck…" with the
  // old topic filled in, so the next generate could not start.
  useEffect(() => {
    if (pathname !== "/generate") {
      navigatingAway.current = false;
      return;
    }

    const recover = () => {
      if (inFlight.current) return;
      if (window.location.pathname !== "/generate") return;
      navigatingAway.current = false;
      releaseSavedForm(readSavedDeck());
    };

    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) recover();
    };
    window.addEventListener("pageshow", onPageShow);

    const shouldReset = opening || readSavedDeck() !== null;
    if (!shouldReset) {
      return () => window.removeEventListener("pageshow", onPageShow);
    }

    if (navigatingAway.current) {
      const timer = window.setTimeout(recover, 800);
      return () => {
        window.clearTimeout(timer);
        window.removeEventListener("pageshow", onPageShow);
      };
    }

    recover();
    return () => window.removeEventListener("pageshow", onPageShow);
  }, [pathname, opening]);

  async function generate() {
    if (inFlight.current) return;

    // Check the input here first so obvious mistakes don't wait on the server.
    if (outOfCreations && dailyLimit !== null) {
      setRequestError(`You've used today's ${dailyLimit} flashcard creations. You can make more tomorrow.`);
      return;
    }
    if (cleanTopic.length === 0 && cleanMaterial.length === 0) {
      setTopicError("Enter a topic, paste your notes, or provide both.");
      topicRef.current?.focus();
      return;
    }
    if (tooLong) {
      setMaterialError(`Please shorten your notes. The limit is ${MAX_INPUT_LENGTH.toLocaleString()} characters in total.`);
      materialRef.current?.focus();
      return;
    }
    if (!deckId) {
      setDeckError("Choose a deck to save these cards in.");
      deckRef.current?.focus();
      return;
    }

    inFlight.current = true;
    setTopicError(undefined);
    setMaterialError(undefined);
    setDeckError(undefined);
    setRequestError(null);
    setLoading(true);

    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic: buildInput(cleanTopic, cleanMaterial),
          count,
          deckId,
        }),
      });

      const json = await response.json().catch(() => null);

      if (response.status === 401) {
        router.push("/login?next=/generate");
        return;
      }

      if (!response.ok || !json?.success) {
        setRequestError(studentError(typeof json?.error === "string" ? json.error : undefined, response.status));
        return;
      }

      const nextDeckId = json.data?.deckId as string | undefined;
      if (!nextDeckId) {
        setRequestError("Your flashcards were generated but could not be saved. Please try again.");
        return;
      }

      navigatingAway.current = true;
      rememberSavedDeck(nextDeckId);
      const added = json.data?.added;
      const skipped = json.data?.skipped;
      const params = new URLSearchParams();
      if (typeof added === "number" && added > 0) params.set("added", String(added));
      if (typeof skipped === "number" && skipped > 0) params.set("skipped", String(skipped));
      const search = params.toString();
      // A full page load lands on the new cards. A client transition was leaving
      // students on this form before the deck finished opening.
      window.location.assign(search ? `/decks/${nextDeckId}?${search}` : `/decks/${nextDeckId}`);
      return;
    } catch {
      setRequestError("We couldn't reach the server. Check your internet connection and try again.");
    } finally {
      if (!navigatingAway.current) {
        inFlight.current = false;
        setLoading(false);
      }
    }
  }

  function loadNotesFile(file: File | undefined) {
    if (!file) return;
    const name = file.name.toLowerCase();
    if (!name.endsWith(".txt") && !name.endsWith(".md")) {
      setMaterialError("Please choose a .txt or .md file.");
      if (fileRef.current) fileRef.current.value = "";
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const text = typeof reader.result === "string" ? reader.result.replace(/^\uFEFF/, "") : "";
      if (!text.trim()) {
        setMaterialError("That file is empty.");
        setLoadedFile(null);
        return;
      }
      setMaterial(text);
      setMaterialError(undefined);
      setLoadedFile(file.name);
    };
    reader.onerror = () => {
      setMaterialError("That file could not be read. Paste the notes instead.");
      setLoadedFile(null);
    };
    reader.readAsText(file);
    if (fileRef.current) fileRef.current.value = "";
  }

  function applyExample(example: string) {
    setTopic(example);
    setTopicError(undefined);
    topicRef.current?.focus();
  }

  if (decks.length === 0) {
    return (
      <EmptyState
        title={forTeacher ? "Name a class deck first" : "Name a deck first"}
        description={
          forTeacher
            ? "Class flashcards are saved into a deck for that class. Name one on the class page, then come back."
            : "Flashcards are saved into a deck. Create one, then come back and turn your notes into cards."
        }
      >
        <ButtonLink href={forTeacher ? "/classes" : "/decks"}>
          {forTeacher ? "Go to your classes" : "Create a deck"}
        </ButtonLink>
      </EmptyState>
    );
  }

  return (
    <div className="w-full max-w-2xl space-y-6">
      {outOfCreations && (
        <Alert tone="warning" title="That's enough for today">
          You&apos;ve used today&apos;s {dailyLimit} flashcard creations. You can make more tomorrow.
        </Alert>
      )}

      <form
        className="space-y-5"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          generate();
        }}
      >
        <Input
          ref={topicRef}
          id="topic"
          label="Topic"
          placeholder="e.g. Photosynthesis"
          maxLength={MAX_TOPIC_LENGTH}
          autoComplete="off"
          value={topic}
          onChange={(e) => {
            setTopic(e.target.value);
            if (topicError) setTopicError(undefined);
          }}
          disabled={busy || outOfCreations}
          error={topicError}
          hint="Optional if you paste notes below."
        />

        <Textarea
          ref={materialRef}
          id="material"
          label="Class notes"
          rows={8}
          placeholder="Paste a section from class. Definitions, key ideas, or a short reading all work."
          value={material}
          onChange={(e) => {
            setMaterial(e.target.value);
            if (materialError) setMaterialError(undefined);
          }}
          disabled={busy || outOfCreations}
          error={materialError}
          hint={
            <span className={tooLong ? "font-medium text-error" : undefined}>
              Optional if you entered a topic. {totalLength.toLocaleString()} / {MAX_INPUT_LENGTH.toLocaleString()}{" "}
              characters.
            </span>
          }
        />

        <div className="space-y-2">
          <label htmlFor="notes-file" className="type-label block">
            Or load a notes file
          </label>
          <input
            ref={fileRef}
            id="notes-file"
            type="file"
            accept=".txt,.md,text/plain,text/markdown"
            disabled={busy || outOfCreations}
            onChange={(event) => loadNotesFile(event.target.files?.[0])}
            className="block w-full max-w-full text-sm text-ink file:mr-3 file:h-11 file:rounded-md file:border-0 file:bg-background file:px-3 file:text-sm file:font-semibold file:text-ink"
          />
          <p className="type-helper">
            {loadedFile
              ? `Loaded ${loadedFile} into your notes.`
              : "A .txt or .md file. The text is placed in the notes box."}
          </p>
        </div>

        <div className="space-y-2">
          <p id="card-count-label" className="type-label">
            How many cards
          </p>
          <div role="radiogroup" aria-labelledby="card-count-label" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {CARD_COUNT_OPTIONS.map((option) => (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={count === option}
                disabled={busy || outOfCreations}
                onClick={() => setCount(option)}
                className={
                  count === option
                    ? "h-11 rounded-md border-2 border-primary bg-surface text-sm font-semibold text-ink"
                    : "h-11 rounded-md border border-border bg-surface text-sm font-medium text-ink-secondary disabled:opacity-60"
                }
              >
                {option}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <label htmlFor="destination" className="type-label block">
            Save cards to
          </label>
          <select
            ref={deckRef}
            id="destination"
            value={deckId}
            required
            disabled={busy || outOfCreations}
            aria-invalid={deckError ? true : undefined}
            onChange={(event) => {
              setDeckId(event.target.value);
              if (deckError) setDeckError(undefined);
            }}
            className={controlClasses(!!deckError) + " h-11 w-full max-w-full"}
          >
            <option value="">Choose a deck</option>
            {decks.map((deck) => (
              <option key={deck.id} value={deck.id}>
                {deck.title}
              </option>
            ))}
          </select>
          {deckError ? (
            <p className="text-sm font-medium text-error">{deckError}</p>
          ) : chosenDeck ? (
            <p className="type-helper">These cards will be added to {chosenDeck.title}.</p>
          ) : (
            <p className="type-helper">
              Choose the deck that should hold these cards.{" "}
              <Link
                href={forTeacher ? "/classes" : "/decks"}
                className="font-semibold text-primary underline-offset-2 hover:underline"
              >
                {forTeacher ? "Need a new class deck? Name one in your class." : "Need a new deck? Name one on My Decks."}
              </Link>
            </p>
          )}
        </div>

        <div className="space-y-3">
          <Button
            type="submit"
            className="w-full sm:w-auto"
            loading={busy}
            loadingText="Creating flashcards…"
            disabled={outOfCreations}
          >
            Create {count} flashcards
          </Button>
          <p className="type-helper">
            {outOfCreations
              ? "Creating flashcards is paused until tomorrow."
              : remaining === null
                ? "Afterward you can check the cards, edit or remove any, then study."
                : `You can do this ${remaining} more ${remaining === 1 ? "time" : "times"} today. Afterward you can check the cards, edit or remove any, then study.`}
          </p>

          <div className="flex flex-wrap items-center gap-x-3">
            <span className="type-helper">Try an example:</span>
            {EXAMPLES.map((example) => (
              <button
                key={example}
                type="button"
                disabled={busy || outOfCreations}
                onClick={() => applyExample(example)}
                className="inline-flex min-h-11 items-center rounded text-sm font-medium text-primary underline-offset-2 hover:text-primary-hover hover:underline disabled:opacity-60"
              >
                {example}
              </button>
            ))}
          </div>
        </div>
      </form>

      {busy && (
        <LoadingState title="Creating flashcards…" description="This usually takes a few seconds. Keep this page open." />
      )}

      {savedDeckId && !busy && (
        <Alert
          tone="success"
          title="Flashcards saved"
          action={
            <div className="flex flex-wrap gap-2">
              <ButtonLink href={`/decks/${savedDeckId}/study?review=1`}>Study now</ButtonLink>
              <ButtonLink href={`/decks/${savedDeckId}`} variant="secondary">
                View deck
              </ButtonLink>
            </div>
          }
        >
          Your new cards are in the deck you chose. Study them, or open the deck to edit or remove any.
        </Alert>
      )}

      {requestError && (
        <Alert
          title="We couldn't create your flashcards"
          action={
            <Button variant="secondary" onClick={generate} disabled={busy}>
              Try again
            </Button>
          }
        >
          {requestError}
        </Alert>
      )}
    </div>
  );
}
