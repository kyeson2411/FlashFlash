import type { Ref } from "react";
import { cn } from "@/lib/cn";

type FlipCardProps = {
  question: string;
  answer: string;
  flipped: boolean;
  /** Called when the student clicks/taps the card while it still shows the question. */
  onReveal?: () => void;
  ref?: Ref<HTMLDivElement>;
};

// The large central flashcard. The parent should give it a `key` per card, so every
// card mounts fresh on its question side (no old answer can show while it changes).
export function FlipCard({ question, answer, flipped, onReveal, ref }: FlipCardProps) {
  const face =
    "flex min-h-[clamp(12rem,36svh,24rem)] flex-col rounded-lg border border-border bg-surface p-5 short:min-h-36 short:p-4 roomy:p-8";

  return (
    <div
      ref={ref}
      tabIndex={-1}
      role="group"
      aria-label="Flashcard"
      onClick={!flipped ? onReveal : undefined}
      className={cn("flip-scene card-enter rounded-lg", !flipped && "cursor-pointer")}
    >
      <div className="flip-inner" data-flipped={flipped}>
        {/* Front: question */}
        <div aria-hidden={flipped} className={cn("flip-face flip-face-front", face)}>
          <p className="text-sm font-medium text-ink-muted">Question</p>
          <p className="my-auto py-4 text-center text-xl font-semibold leading-snug text-ink [overflow-wrap:anywhere] short:text-lg short:py-2">
            {question}
          </p>
        </div>

        <div aria-hidden={!flipped} className={cn("flip-face flip-face-back", face)}>
          <p className="text-sm font-medium text-ink-muted">Answer</p>
          <p className="my-auto py-4 text-center text-lg font-medium leading-relaxed text-ink [overflow-wrap:anywhere] short:text-base short:py-2">
            {answer}
          </p>
        </div>
      </div>
    </div>
  );
}
