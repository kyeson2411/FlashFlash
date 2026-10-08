import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export function List({
  children,
  ordered = false,
  className,
  "aria-label": ariaLabel,
}: {
  children: ReactNode;
  ordered?: boolean;
  className?: string;
  "aria-label"?: string;
}) {
  const Tag = ordered ? "ol" : "ul";
  return (
    <Tag
      aria-label={ariaLabel}
      className={cn("divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface", className)}
    >
      {children}
    </Tag>
  );
}

// When `href` is set the primary text becomes a stretched link, so the whole row is
// clickable while buttons in `aside` stay independently clickable above it.
export function ListRow({
  primary,
  secondary,
  leading,
  aside,
  href,
  children,
}: {
  primary: ReactNode;
  secondary?: ReactNode;
  leading?: ReactNode;
  aside?: ReactNode;
  href?: string;
  children?: ReactNode;
}) {
  return (
    <li
      className={cn(
        "relative flex items-center gap-3 px-4 py-3 transition-colors",
        href && "cursor-pointer hover:bg-white/5",
      )}
    >
      {leading}
      <div className="min-w-0 flex-1">
        {href ? (
          <Link
            href={href}
            className="block truncate text-sm font-semibold text-ink after:absolute after:inset-0 after:content-['']"
          >
            {primary}
          </Link>
        ) : (
          <p className="truncate text-sm font-semibold text-ink">{primary}</p>
        )}
        {secondary && <p className="mt-0.5 truncate text-[13px] text-ink-muted">{secondary}</p>}
        {children}
      </div>
      {aside && <div className="relative z-10 flex shrink-0 items-center gap-2">{aside}</div>}
    </li>
  );
}

export function Chevron() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="size-4 text-ink-muted"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

export function Avatar({ name }: { name: string }) {
  return (
    <span
      aria-hidden="true"
      className="grid size-7 shrink-0 place-items-center rounded-full border border-border-strong bg-raised text-xs font-semibold text-ink-secondary"
    >
      {name.trim()[0]?.toUpperCase() ?? "?"}
    </span>
  );
}
