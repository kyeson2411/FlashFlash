import Link from "next/link";
import type { ButtonHTMLAttributes, ComponentProps } from "react";
import { cn } from "@/lib/cn";
import { Spinner } from "./Spinner";

type Variant = "primary" | "secondary" | "ghost" | "success" | "warning" | "danger";

const variants: Record<Variant, string> = {
  // The two study choices: clearly different in color AND in their text labels.
  success: "border border-success/30 bg-success-strong text-white hover:brightness-110",
  warning: "border border-warning/30 bg-warning-soft text-warning hover:border-warning/50 hover:bg-warning/10",
  primary:
    "border border-white/10 bg-primary-strong text-white hover:bg-primary-strong-hover",
  secondary: "border border-border-strong bg-raised text-ink hover:border-zinc-600 hover:bg-zinc-800",
  ghost: "text-ink-secondary hover:bg-white/5 hover:text-ink",
  danger: "border border-error/40 bg-error-soft text-error hover:border-error/70",
};

function buttonClasses(variant: Variant, className?: string) {
  return cn(
    "inline-flex h-10 items-center justify-center gap-2 rounded-md px-4 text-sm font-medium transition-[background-color,border-color,color,filter,transform] duration-150 active:scale-[0.98]",
    "disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100",
    variants[variant],
    className,
  );
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  /** Shows a spinner and disables the button. Pass a `loadingText` to replace the label. */
  loading?: boolean;
  loadingText?: string;
};

export function Button({
  variant = "primary",
  loading = false,
  loadingText,
  className,
  children,
  disabled,
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={buttonClasses(variant, className)}
      {...props}
    >
      {loading && <Spinner />}
      {loading && loadingText ? loadingText : children}
    </button>
  );
}

// A link that looks like a button (for navigation, e.g. "Generate flashcards").
export function ButtonLink({
  variant = "primary",
  className,
  ...props
}: ComponentProps<typeof Link> & { variant?: Variant }) {
  return <Link className={buttonClasses(variant, className)} {...props} />;
}
