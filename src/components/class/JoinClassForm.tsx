"use client";

import { useActionState } from "react";
import { joinClassAction, type ClassActionState } from "@/app/actions/classes";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

export function JoinClassForm() {
  const [state, action, pending] = useActionState(joinClassAction, undefined as ClassActionState | undefined);

  return (
    <form action={action} className="max-w-md space-y-4">
      <Input
        id="class-code"
        name="code"
        label="Class code"
        autoCapitalize="characters"
        spellCheck={false}
        required
        maxLength={6}
        disabled={pending}
        hint="Ask your teacher for the 6-character code."
      />
      {state?.error && <p className="text-sm font-medium text-error">{state.error}</p>}
      {state?.classId && !state.error && <p className="type-body">You joined the class.</p>}
      <Button type="submit" loading={pending} loadingText="Joining…">
        Join class
      </Button>
    </form>
  );
}
