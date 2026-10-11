"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { startQuizAction } from "@/app/actions/quizzes";
import { useOnline } from "@/components/quiz/useOnline";
import { Button } from "@/components/ui/Button";

const NETWORK_ERROR = "Could not reach AutoFlash. Check your connection, then try again.";

/** warning: shown for a confirm step before starting, used for timed quizzes. */
export function QuizStart({ quizId, label, warning }: { quizId: string; label: string; warning?: string }) {
  const router = useRouter();
  const online = useOnline();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function start() {
    setError(null);
    startTransition(async () => {
      try {
        const result = await startQuizAction(quizId);
        if (!result.ok) {
          setError(result.error);
          return;
        }
      } catch {
        setError(NETWORK_ERROR);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="space-y-2">
      {!online ? (
        <p className="text-sm font-medium text-warning">You are offline. Connect to the internet before you start.</p>
      ) : null}
      {confirming && warning ? (
        <div className="max-w-xl space-y-3 rounded-md border border-warning/30 bg-warning-soft p-4">
          <p className="text-sm font-medium text-ink">{warning}</p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" loading={pending} loadingText="Starting…" disabled={!online} onClick={start}>
              Start now
            </Button>
            <Button type="button" variant="ghost" disabled={pending} onClick={() => setConfirming(false)}>
              Not yet
            </Button>
          </div>
        </div>
      ) : (
        <Button
          type="button"
          loading={pending}
          loadingText="Starting…"
          disabled={!online}
          onClick={() => (warning ? setConfirming(true) : start())}
        >
          {label}
        </Button>
      )}
      {error && <p className="text-sm font-medium text-error">{error}</p>}
    </div>
  );
}
