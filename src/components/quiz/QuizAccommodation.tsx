"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setQuizAccommodationAction } from "@/app/actions/quizzes";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { MAX_QUESTION_SECONDS, MAX_QUIZ_MINUTES } from "@/lib/quiz";

/** current.extra is minutes for a whole-quiz timer and seconds for a per-question timer. */
export function QuizAccommodation({
  quizId,
  studentId,
  name,
  timer,
  hasDueDate,
  minDate,
  maxDate,
  current,
}: {
  quizId: string;
  studentId: string;
  name: string;
  timer: "quiz" | "question" | null;
  hasDueDate: boolean;
  minDate: string;
  maxDate: string;
  current: { dueDate: string; extra: number } | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [dueDate, setDueDate] = useState(current?.dueDate ?? "");
  const [extra, setExtra] = useState(current?.extra ? String(current.extra) : "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const perQuestion = timer === "question";

  if (!timer && !hasDueDate) return null;

  function save(nextDue: string, nextExtra: string) {
    setError(null);
    startTransition(async () => {
      const result = await setQuizAccommodationAction(
        quizId,
        studentId,
        nextDue,
        nextExtra,
        perQuestion ? "seconds" : "minutes",
      );
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  if (!open) {
    return (
      <Button type="button" variant="ghost" className="h-8 px-2.5 text-[13px]" onClick={() => setOpen(true)}>
        {current ? "Change extension" : "Give more time"}
      </Button>
    );
  }

  return (
    <form
      className="mt-3 max-w-md space-y-3 rounded-md border border-border bg-background p-3"
      aria-label={`More time for ${name}`}
      onSubmit={(event) => {
        event.preventDefault();
        save(dueDate, extra);
      }}
    >
      {hasDueDate ? (
        <Input
          id={`ext-due-${studentId}`}
          label="Later due date"
          type="date"
          min={minDate}
          max={maxDate}
          value={dueDate}
          onChange={(event) => setDueDate(event.target.value)}
          hint="Only this student. Must be after the quiz due date."
        />
      ) : null}
      {timer ? (
        <Input
          id={`ext-extra-${studentId}`}
          label={perQuestion ? "Extra seconds for each question" : "Extra minutes"}
          type="number"
          inputMode="numeric"
          min={0}
          max={perQuestion ? MAX_QUESTION_SECONDS : MAX_QUIZ_MINUTES}
          value={extra}
          onChange={(event) => setExtra(event.target.value)}
          hint={perQuestion ? "Added to every question for this student." : "Added to the time limit for this student."}
        />
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" loading={pending} loadingText="Saving…" className="h-9 px-3 text-[13px]">
          Save
        </Button>
        {current ? (
          <Button
            type="button"
            variant="secondary"
            disabled={pending}
            className="h-9 px-3 text-[13px]"
            onClick={() => save("", "")}
          >
            Remove extension
          </Button>
        ) : null}
        <Button type="button" variant="ghost" disabled={pending} className="h-9 px-3 text-[13px]" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
      {error && <p className="text-sm font-medium text-error">{error}</p>}
    </form>
  );
}
