import { Button } from "@/components/ui/Button";

type TypingCardProps = {
  question: string;
  answer: string;
  value: string;
  checked: boolean;
  matched: boolean;
  onChange: (value: string) => void;
  onCheck: () => void;
};

export function normalizeTypedAnswer(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export function TypingCard({
  question,
  answer,
  value,
  checked,
  matched,
  onChange,
  onCheck,
}: TypingCardProps) {
  return (
    <div className="card-enter space-y-5 rounded-lg border border-border-strong bg-surface p-5 sm:p-8">
      <p className="type-meta">Question</p>
      <p className="text-2xl font-semibold leading-snug tracking-tight text-balance text-ink [overflow-wrap:anywhere]">{question}</p>
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (!checked) onCheck();
        }}
      >
        <label htmlFor="typed-answer" className="type-label block">
          Your answer
        </label>
        <input
          id="typed-answer"
          value={value}
          disabled={checked}
          autoComplete="off"
          onChange={(event) => onChange(event.target.value)}
          className="block h-11 w-full rounded-md border border-border-strong bg-background px-3 text-base text-ink transition-colors hover:border-zinc-600 focus:border-primary-strong focus:outline-none focus:ring-2 focus:ring-primary-strong/40 disabled:opacity-70"
        />
        {!checked && (
          <Button type="submit" className="w-full sm:w-auto">
            Check
          </Button>
        )}
      </form>
      {checked && (
        <div className="space-y-2">
          <p className="type-body">{matched ? "That matches the saved answer." : "Not yet. Here is the saved answer."}</p>
          <p className="rounded-md border border-primary/20 bg-primary-soft px-4 py-3 text-base font-medium text-ink [overflow-wrap:anywhere]">
            {answer}
          </p>
        </div>
      )}
    </div>
  );
}
