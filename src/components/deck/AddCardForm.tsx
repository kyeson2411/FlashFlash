"use client";

import { useState } from "react";
import type { MutationResult } from "@/app/actions/decks";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

export function AddCardForm({ onAdd }: { onAdd: (question: string, answer: string) => Promise<MutationResult> }) {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  return (
    <form
      className="space-y-4 rounded-lg border border-border bg-surface p-5 sm:p-6"
      onSubmit={async (event) => {
        event.preventDefault();
        if (pending) return;
        setPending(true);
        setError(null);
        const result = await onAdd(question, answer);
        setPending(false);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setQuestion("");
        setAnswer("");
      }}
    >
      <h2 className="type-section">Add a card</h2>
      <Input
        id="new-card-question"
        name="question"
        label="Question"
        value={question}
        onChange={(event) => setQuestion(event.target.value)}
        disabled={pending}
        required
      />
      <Input
        id="new-card-answer"
        name="answer"
        label="Answer"
        hint="1 to 3 words, up to 40 characters."
        value={answer}
        onChange={(event) => setAnswer(event.target.value)}
        disabled={pending}
        required
      />
      {error && <p className="text-sm font-medium text-error">{error}</p>}
      <Button type="submit" loading={pending} loadingText="Adding card…">
        Add card
      </Button>
    </form>
  );
}
