import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

type Tone = "neutral" | "primary" | "success" | "warning";

const tones: Record<Tone, string> = {
  warning: "bg-warning-soft text-warning border-warning/20",
  neutral: "bg-raised text-ink-secondary border-border-strong",
  primary: "bg-primary-soft text-primary border-primary/20",
  success: "bg-success-soft text-success border-success/20",
};

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center gap-1.5 rounded-md border px-1.5 text-[11px] font-medium tracking-wide",
        tones[tone],
      )}
    >
      <span aria-hidden="true" className="size-1.5 rounded-full bg-current opacity-80" />
      {children}
    </span>
  );
}
