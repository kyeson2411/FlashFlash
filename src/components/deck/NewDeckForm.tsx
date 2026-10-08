"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createDeck } from "@/app/actions/decks";
import { Button } from "@/components/ui/Button";
import { controlClasses, describedBy, errorId, hintId } from "@/components/ui/Field";
import { cn } from "@/lib/cn";

const FIELD_ID = "new-deck-title";
const HINT = "A name is enough. You can write a card or generate some.";

export function NewDeckForm() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [pending, setPending] = useState(false);

  return (
    <form
      className="grid grid-cols-1 items-start gap-2 border-b border-border pb-8 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-x-3"
      action={async (formData) => {
        setPending(true);
        setError(undefined);
        const result = await createDeck(String(formData.get("title") ?? ""));
        if (!result.ok) {
          setError(result.error);
          setPending(false);
          return;
        }
        setTitle("");
        setPending(false);
        router.refresh();
      }}
    >
      <label htmlFor={FIELD_ID} className="type-label sm:col-span-2 sm:col-start-1 sm:row-start-1">
        New deck
      </label>
      <input
        id={FIELD_ID}
        name="title"
        placeholder="e.g. Biology midterm"
        maxLength={200}
        value={title}
        disabled={pending}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy({ id: FIELD_ID, hint: error ? undefined : HINT, error })}
        onChange={(event) => {
          setTitle(event.target.value);
          if (error) setError(undefined);
        }}
        className={cn(controlClasses(!!error), "h-11 min-w-0 sm:col-start-1 sm:row-start-2")}
      />
      {error ? (
        <p id={errorId(FIELD_ID)} className="text-sm font-medium text-error sm:col-start-1 sm:row-start-3">
          {error}
        </p>
      ) : (
        <p id={hintId(FIELD_ID)} className="type-helper sm:col-start-1 sm:row-start-3">
          {HINT}
        </p>
      )}
      <Button
        type="submit"
        loading={pending}
        loadingText="Creating…"
        className="h-11 w-full sm:col-start-2 sm:row-start-2 sm:w-auto"
      >
        Create deck
      </Button>
    </form>
  );
}
