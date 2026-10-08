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
    <div className="card-enter space-y-5 rounded-lg border border-border-strong bg-surface p-5 sm:p-8">
      <p className="type-meta">Question</p>
      <p className="text-2xl font-semibold leading-snug tracking-tight text-balance text-ink [overflow-wrap:anywhere]">{question}</p>
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
                "rounded-md border px-4 py-3 text-left text-[15px] text-ink transition-colors",
                "disabled:cursor-default",
                showCorrect && "border-success/50 bg-success-soft text-success",
                showWrong && "border-warning/50 bg-warning-soft text-warning",
                !showCorrect && !showWrong && "border-border-strong bg-background hover:border-zinc-500 hover:bg-raised",
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
