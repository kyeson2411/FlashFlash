import Link from "next/link";
import type { ButtonHTMLAttributes, ComponentProps } from "react";
import { cn } from "@/lib/cn";
import { Spinner } from "./Spinner";

type Variant = "primary" | "secondary" | "ghost" | "success" | "warning" | "danger";

const variants: Record<Variant, string> = {
  // The two study choices: clearly different in color AND in their text labels.
  success: "bg-success-strong text-white hover:brightness-110",
  warning: "border-2 border-warning bg-warning-soft text-warning hover:brightness-95",
  primary: "bg-primary-strong text-white hover:bg-primary-strong-hover",
  secondary: "border border-border-strong bg-surface text-ink hover:bg-background",
  ghost: "text-ink-secondary hover:bg-background hover:text-ink",
  danger: "border border-error bg-surface text-error hover:bg-error-soft",
};

function buttonClasses(variant: Variant, className?: string) {
  return cn(
    "inline-flex h-11 items-center justify-center gap-2 rounded-md px-5 text-base font-semibold transition-colors",
    "disabled:cursor-not-allowed disabled:opacity-60",
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
