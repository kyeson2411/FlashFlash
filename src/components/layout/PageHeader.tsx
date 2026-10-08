import Link from "next/link";
import type { ReactNode } from "react";

export function PageHeader({
  title,
  description,
  eyebrow,
  back,
  titleAside,
  actions,
}: {
  title: ReactNode;
  description?: ReactNode;
  eyebrow?: string;
  back?: { href: string; label: string };
  titleAside?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-4 border-b border-border pb-4 pt-6 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0 space-y-1">
        {back && (
          <Link
            href={back.href}
            className="mb-2 inline-flex items-center gap-1.5 text-[13px] text-ink-muted transition-colors hover:text-ink"
          >
            <span aria-hidden="true">←</span>
            {back.label}
          </Link>
        )}
        {eyebrow && (
          <p className="font-mono text-[11px] font-medium uppercase tracking-wider text-ink-muted">{eyebrow}</p>
        )}
        <div className="flex flex-wrap items-center gap-2.5">
          <h1 className="text-2xl font-semibold leading-tight tracking-tight text-balance break-words text-ink">
            {title}
          </h1>
          {titleAside}
        </div>
        {description && <div className="max-w-xl text-sm leading-relaxed text-ink-secondary">{description}</div>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function SectionHeader({
  id,
  title,
  count,
  action,
}: {
  id?: string;
  title: string;
  count?: number;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 pb-2">
      <h2 id={id} className="font-mono text-[11px] font-medium uppercase tracking-wider text-ink-muted">
        {title}
        {count !== undefined && <span className="ml-2 tabular-nums text-ink-secondary">{count}</span>}
      </h2>
      {action}
    </div>
  );
}

export function SectionLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="text-[13px] text-ink-muted transition-colors hover:text-ink">
      {children}
    </Link>
  );
}
