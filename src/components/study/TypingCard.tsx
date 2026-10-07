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
    <div className="card-enter space-y-4 rounded-lg border border-border bg-surface p-5">
      <p className="text-sm font-semibold text-ink-muted">Question</p>
      <p className="text-xl font-semibold leading-snug text-ink [overflow-wrap:anywhere]">{question}</p>
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
          className="block w-full rounded-md border border-border-strong bg-background px-3 py-2.5 text-base text-ink disabled:opacity-70"
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
          <p className="rounded-md border border-primary/30 bg-primary-soft px-4 py-3 text-base text-ink [overflow-wrap:anywhere]">
            {answer}
          </p>
        </div>
      )}
    </div>
  );
}
