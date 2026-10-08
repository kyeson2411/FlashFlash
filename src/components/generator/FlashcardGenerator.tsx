"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button, ButtonLink } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/Input";
import { LoadingState } from "@/components/ui/LoadingState";
import { Steps } from "@/components/ui/Steps";
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
  return material ? `Topic: ${topic}${STUDY_MATERIAL_MARKER}${material}` : topic;
}

export function FlashcardGenerator({
  decks,
  initialDeckId = "",
}: {
  decks: { id: string; title: string }[];
  initialDeckId?: string;
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
  const currentStep = opening ? 2 : loading ? 1 : 0;

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
    if (cleanTopic.length === 0) {
      setTopicError("Enter a topic, for example “Photosynthesis”.");
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
        setRequestError(json?.error ?? "Something went wrong on our side. Please try again.");
        return;
      }

      const nextDeckId = json.data?.deckId as string | undefined;
      if (!nextDeckId) {
        setRequestError("Your flashcards were generated but could not be saved. Please try again.");
        return;
      }

      navigatingAway.current = true;
      rememberSavedDeck(nextDeckId);
      setOpening(true);
      const added = json.data?.added;
      const skipped = json.data?.skipped;
      const params = new URLSearchParams();
      if (typeof added === "number" && added > 0 && typeof skipped === "number" && skipped > 0) {
        params.set("added", String(added));
        params.set("skipped", String(skipped));
      }
      const search = params.toString();
      router.push(search ? `/decks/${nextDeckId}?${search}` : `/decks/${nextDeckId}`);
    } catch {
      setRequestError("We couldn't reach the server. Check your internet connection and try again.");
    } finally {
      inFlight.current = false;
      setLoading(false);
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
        title="Create a deck first"
        description="Name a deck on My Decks. Then come back here and choose that deck for your cards."
      >
        <ButtonLink href="/decks">Go to My Decks</ButtonLink>
      </EmptyState>
    );
  }

  return (
    <div className="w-full space-y-6">
      <div aria-label="Progress" role="group">
        <Steps current={currentStep} />
      </div>

      <form
        className="space-y-5"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          generate();
        }}
      >
          <div className="space-y-2">
            <label htmlFor="destination" className="type-label block">
              Save to
            </label>
            <select
              ref={deckRef}
              id="destination"
              value={deckId}
              required
              disabled={busy}
              aria-invalid={deckError ? true : undefined}
              onChange={(event) => {
                setDeckId(event.target.value);
                if (deckError) setDeckError(undefined);
              }}
              className={controlClasses(!!deckError) + " h-11"}
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
            ) : (
              <p className="type-helper">Cards are added to this deck. Its name stays the same.</p>
            )}
          </div>

          <Input
            ref={topicRef}
            id="topic"
            label="Topic"
            placeholder="e.g. Photosynthesis"
            maxLength={MAX_TOPIC_LENGTH}
            autoComplete="off"
            required
            value={topic}
            onChange={(e) => {
              setTopic(e.target.value);
              if (topicError) setTopicError(undefined);
            }}
            disabled={busy}
            error={topicError}
            hint="What are you studying?"
          />

          <div className="space-y-2">
            <p id="card-count-label" className="type-label">
              How many cards
            </p>
            <div role="radiogroup" aria-labelledby="card-count-label" className="grid grid-cols-4 gap-2">
              {CARD_COUNT_OPTIONS.map((option) => (
                <button
                  key={option}
                  type="button"
                  role="radio"
                  aria-checked={count === option}
                  disabled={busy}
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

          <Textarea
                ref={materialRef}
                id="material"
                label="Notes or study material (optional)"
                rows={12}
                placeholder="Paste a paragraph from your textbook or class notes. AutoFlash will build the cards from it."
                value={material}
                onChange={(e) => {
                  setMaterial(e.target.value);
                  if (materialError) setMaterialError(undefined);
                }}
                disabled={busy}
                error={materialError}
                hint={
                  <span className={tooLong ? "font-medium text-error" : undefined}>
                    {totalLength.toLocaleString()} / {MAX_INPUT_LENGTH.toLocaleString()}
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
                  disabled={busy}
                  onChange={(event) => loadNotesFile(event.target.files?.[0])}
                  className="block w-full text-sm text-ink file:mr-3 file:h-11 file:rounded-md file:border-0 file:bg-background file:px-3 file:text-sm file:font-semibold file:text-ink"
                />
                <p className="type-helper">
                  {loadedFile
                    ? `Loaded ${loadedFile} into your notes.`
                    : "Plain text (.txt) or Markdown (.md). The text is placed in the notes box."}
                </p>
              </div>

          <div className="space-y-3">
            <Button
              type="submit"
              className="w-full"
              loading={busy}
              loadingText={opening ? "Opening your deck…" : "Generating flashcards…"}
            >
              Generate {count} flashcards
            </Button>
            <p className="type-helper">
              Cards are saved into the deck you chose. On that deck you can read them, remove any that do not fit, then study.
            </p>

            <div className="flex flex-wrap items-center gap-x-3">
              <span className="type-helper">Try an example:</span>
              {EXAMPLES.map((example) => (
                <button
                  key={example}
                  type="button"
                  disabled={busy}
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
        <LoadingState
          title={opening ? "Opening your deck…" : "Generating your flashcards…"}
          description={opening ? undefined : "This usually takes a few seconds."}
          placeholders={Math.min(count, 5)}
        />
      )}

      {savedDeckId && !busy && (
        <Alert
          tone="success"
          title="Cards saved"
          action={<ButtonLink href={`/decks/${savedDeckId}`}>Open deck</ButtonLink>}
        >
          Those cards are in your deck. Enter a new topic to generate another set.
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
