"use client";

import { useActionState } from "react";
import { createClassAction, type ClassActionState } from "@/app/actions/classes";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { ClassCode } from "./ClassCode";

export function CreateClassForm() {
  const [state, action, pending] = useActionState(createClassAction, undefined as ClassActionState | undefined);

  return (
    <form action={action} className="space-y-4">
      <Input id="class-name" name="name" label="Class name" required maxLength={80} disabled={pending} />
      {state?.error && <p className="text-sm font-medium text-error">{state.error}</p>}
      {state?.code && (
        <div className="space-y-2">
          <p className="type-body">Share this code with your students.</p>
          <ClassCode code={state.code} />
        </div>
      )}
      <Button type="submit" loading={pending} loadingText="Creating…">
        Create class
      </Button>
    </form>
  );
}
