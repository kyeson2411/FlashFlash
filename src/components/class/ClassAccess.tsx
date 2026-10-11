"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  regenerateClassCodeAction,
  revokeClassCodeAction,
  setClassApprovalAction,
} from "@/app/actions/classes";
import { ClassCode } from "@/components/class/ClassCode";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";

export function ClassAccess({
  classId,
  code,
  revoked,
  requireApproval,
}: {
  classId: string;
  code: string;
  revoked: boolean;
  requireApproval: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const [pending, startTransition] = useTransition();

  function run(action: () => Promise<{ ok: true } | { ok: false; error: string }>) {
    setError(null);
    setConfirmRevoke(false);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <section aria-labelledby="join-code-heading" className="space-y-3 rounded-lg border border-border bg-surface px-4 py-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id="join-code-heading" className="type-section">
              Join code
            </h2>
            {revoked ? <Badge tone="warning">Off</Badge> : null}
          </div>
          <ClassCode code={code} />
          <p className="max-w-xl text-[13px] leading-relaxed text-ink-muted">
            {revoked
              ? "This code no longer works. Students already in the class stay. Make a new code when you want someone new to join."
              : requireApproval
                ? "New students wait for approval. Students already in the class stay."
                : "New students join immediately. Anyone still waiting needs approval."}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            disabled={pending}
            onClick={() => run(() => regenerateClassCodeAction(classId))}
          >
            New code
          </Button>
          {revoked ? null : confirmRevoke ? (
            <Button type="button" variant="danger" disabled={pending} onClick={() => run(() => revokeClassCodeAction(classId))}>
              Confirm turn off
            </Button>
          ) : (
            <Button type="button" variant="ghost" disabled={pending} onClick={() => setConfirmRevoke(true)}>
              Turn off code
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            disabled={pending}
            onClick={() => run(() => setClassApprovalAction(classId, !requireApproval))}
          >
            {requireApproval ? "Allow immediate joins" : "Require approval"}
          </Button>
        </div>
      </div>
      {error ? <p className="text-sm font-medium text-error">{error}</p> : null}
    </section>
  );
}
