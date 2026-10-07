import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

// Shared label / hint / error layout used by Input and Textarea.
// Pass the same `id` to the control; hint and error ids are derived from it.

export type FieldProps = {
  id: string;
  label: string;
  hint?: ReactNode;
  error?: string;
};

export const hintId = (id: string) => `${id}-hint`;
export const errorId = (id: string) => `${id}-error`;

export function describedBy({ id, hint, error }: Pick<FieldProps, "id" | "hint" | "error">) {
  return [hint ? hintId(id) : null, error ? errorId(id) : null].filter(Boolean).join(" ") || undefined;
}

export function controlClasses(hasError: boolean) {
  return cn(
    "block w-full rounded-md border bg-surface px-3 py-2.5 text-base text-ink placeholder:text-ink-muted",
    "disabled:cursor-not-allowed disabled:bg-background disabled:opacity-70",
    hasError ? "border-error" : "border-border-strong",
  );
}

export function Field({
  id,
  label,
  hint,
  error,
  children,
}: FieldProps & { children: ReactNode }) {
  return (
    <div className="space-y-2">
      <label htmlFor={id} className="type-label block">
        {label}
      </label>
      {children}
      {error && (
        <p id={errorId(id)} className="text-sm font-medium text-error">
          {error}
        </p>
      )}
      {hint && (
        <p id={hintId(id)} className="type-helper">
          {hint}
        </p>
      )}
    </div>
  );
}
