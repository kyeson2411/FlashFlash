import { cn } from "@/lib/cn";

export const LEARNING_STEPS = [
  { label: "Input", description: "Type a topic or paste your notes." },
  { label: "Generate", description: "AutoFlash writes the number of cards you choose." },
  { label: "Review", description: "Read the cards and check that they match what you need." },
  { label: "Study", description: "Flip each card and mark it Know it or Still learning." },
];

// The learning flow: Input → Generate → Review → Study.
// `current` (0-based) highlights where the student is; steps before it show as done.
// Without `current` it is a plain "how it works" list with descriptions.
export function Steps({ current, showDescriptions = false }: { current?: number; showDescriptions?: boolean }) {
  return (
    <ol className={cn("grid gap-4", showDescriptions ? "sm:grid-cols-2" : "grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4")}>
      {LEARNING_STEPS.map((step, index) => {
        const isCurrent = current === index;
        const isDone = current !== undefined && index < current;

        return (
          <li
            key={step.label}
            aria-current={isCurrent ? "step" : undefined}
            className={cn(
              "flex gap-3",
              showDescriptions ? "items-start" : "flex-col items-start sm:flex-row sm:items-center",
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                "flex size-6 shrink-0 items-center justify-center rounded-md border font-mono text-[11px] font-medium",
                isCurrent && "border-primary-strong bg-primary-strong text-white",
                isDone && "border-primary/20 bg-primary-soft text-primary",
                !isCurrent && !isDone && "border-border-strong bg-raised text-ink-muted",
              )}
            >
              {isDone ? "✓" : index + 1}
            </span>
            <span className="min-w-0">
              <span className={cn("block text-sm", isCurrent ? "font-semibold text-ink" : "font-medium text-ink-secondary")}>
                {step.label}
                {isCurrent && <span className="sr-only"> (current step)</span>}
                {isDone && <span className="sr-only"> (done)</span>}
              </span>
              {showDescriptions && <span className="type-helper mt-0.5 block">{step.description}</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
