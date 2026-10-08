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
      className="flex flex-col gap-5"
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
      <div className="flex flex-col gap-2">
        <label htmlFor={FIELD_ID} className="type-label">
          Deck name
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
          className={cn(controlClasses(!!error), "h-10 min-w-0")}
        />
        {error ? (
          <p id={errorId(FIELD_ID)} className="text-sm font-medium text-error">
            {error}
          </p>
        ) : (
          <p id={hintId(FIELD_ID)} className="type-helper">
            {HINT}
          </p>
        )}
      </div>
      <Button type="submit" loading={pending} loadingText="Creating…" className="w-full">
        Create deck
      </Button>
    </form>
  );
}
