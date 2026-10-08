"use client";

import { useActionState } from "react";
import Link from "next/link";
import { createClassDeckAction, type ClassActionState } from "@/app/actions/classes";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

export function ClassDeckForm({ classId }: { classId: string }) {
  const [state, action, pending] = useActionState(createClassDeckAction, undefined as ClassActionState | undefined);

  return (
    <form action={action} className="flex flex-col gap-5 text-left">
      <input type="hidden" name="classId" value={classId} />
      <Input id="deck-title" name="title" label="Deck name" required maxLength={200} disabled={pending} />
      {state?.error && <p className="text-sm font-medium text-error">{state.error}</p>}
      {state?.classId && !state.error && (
        <p className="type-body">
          Deck created.{" "}
          <Link href={`/generate?deck=${state.classId}&class=${classId}`} className="font-semibold text-primary underline-offset-2 hover:underline">
            Make flashcards for it.
          </Link>
        </p>
      )}
      <Button type="submit" loading={pending} loadingText="Creating…" className="w-full">
        Create deck
      </Button>
    </form>
  );
}
