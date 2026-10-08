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
    "flex min-h-[clamp(14rem,42svh,26rem)] flex-col rounded-lg border border-border-strong bg-surface p-5 transition-colors short:min-h-36 short:p-4 roomy:p-10";

  return (
    <div
      ref={ref}
      tabIndex={-1}
      role="group"
      aria-label="Flashcard"
      onClick={!flipped ? onReveal : undefined}
      className={cn("flip-scene card-enter group rounded-lg", !flipped && "cursor-pointer")}
    >
      <div className="flip-inner" data-flipped={flipped}>
        {/* Front: question */}
        <div aria-hidden={flipped} className={cn("flip-face flip-face-front group-hover:border-zinc-600", face)}>
          <p className="type-meta">Question</p>
          <p className="mx-auto my-auto max-w-xl py-6 text-center text-2xl font-semibold leading-snug tracking-tight text-balance text-ink [overflow-wrap:anywhere] sm:text-3xl short:text-lg short:py-2">
            {question}
          </p>
          <p className="type-meta text-center opacity-70 short:hidden">Click to reveal</p>
        </div>

        <div aria-hidden={!flipped} className={cn("flip-face flip-face-back", face)}>
          <p className="type-meta text-primary">Answer</p>
          <p className="mx-auto my-auto max-w-xl py-6 text-center text-xl font-medium leading-relaxed text-balance text-ink [overflow-wrap:anywhere] sm:text-2xl short:text-base short:py-2">
            {answer}
          </p>
        </div>
      </div>
    </div>
  );
}
