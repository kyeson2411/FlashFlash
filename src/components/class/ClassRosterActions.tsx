"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { approveStudentAction, removeStudentAction } from "@/app/actions/classes";
import { Button } from "@/components/ui/Button";

export function ClassRosterActions({
  classId,
  studentId,
  pending,
}: {
  classId: string;
  studentId: string;
  pending: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [working, startTransition] = useTransition();

  function run(action: () => Promise<{ ok: true } | { ok: false; error: string }>) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setConfirmRemove(false);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-1">
        {pending ? (
          <Button
            type="button"
            variant="secondary"
            className="h-8 px-2.5 text-[13px]"
            disabled={working}
            onClick={() => run(() => approveStudentAction(classId, studentId))}
          >
            Approve
          </Button>
        ) : null}
        {confirmRemove ? (
          <Button
            type="button"
            variant="danger"
            className="h-8 px-2.5 text-[13px]"
            disabled={working}
            onClick={() => run(() => removeStudentAction(classId, studentId))}
          >
            Remove
          </Button>
        ) : (
          <Button
            type="button"
            variant="ghost"
            className="h-8 px-2.5 text-[13px]"
            disabled={working}
            onClick={() => setConfirmRemove(true)}
          >
            Remove
          </Button>
        )}
      </div>
      {error ? <p className="max-w-40 text-right text-[12px] font-medium text-error">{error}</p> : null}
    </div>
  );
}
