import { cn } from "@/lib/cn";
import type { ChoiceOption } from "@/lib/choices";

type ChoiceCardProps = {
  question: string;
  options: ChoiceOption[];
  picked: number | null;
  onPick: (index: number) => void;
};

export function ChoiceCard({ question, options, picked, onPick }: ChoiceCardProps) {
  const locked = picked !== null;

  return (
    <div className="card-enter space-y-4 rounded-lg border border-border bg-surface p-5">
      <p className="text-sm font-semibold text-ink-muted">Question</p>
      <p className="text-xl font-semibold leading-snug text-ink [overflow-wrap:anywhere]">{question}</p>
      <div className="grid gap-2" role="group" aria-label="Answer choices">
        {options.map((option, index) => {
          const selected = picked === index;
          const showCorrect = locked && option.correct;
          const showWrong = locked && selected && !option.correct;
          return (
            <button
              key={option.text}
              type="button"
              disabled={locked}
              onClick={() => onPick(index)}
              className={cn(
                "rounded-md border px-4 py-3 text-left text-base text-ink",
                "disabled:cursor-default",
                showCorrect && "border-success bg-success-soft",
                showWrong && "border-warning bg-warning-soft",
                !showCorrect && !showWrong && "border-border bg-background hover:border-primary",
              )}
            >
              {option.text}
            </button>
          );
        })}
      </div>
      {locked && (
        <p className="type-body">
          {options[picked]?.correct
            ? "That matches the saved answer."
            : "Not this one. The saved answer is highlighted."}
        </p>
      )}
    </div>
  );
}
