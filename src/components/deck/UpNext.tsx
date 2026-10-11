import type { ReactNode } from "react";
import { ButtonLink } from "@/components/ui/Button";

// The one thing to do next on this page, with the page's main button.
export function UpNext({
  heading,
  detail,
  href,
  action,
}: {
  heading: string;
  detail: ReactNode;
  href: string;
  action: string;
}) {
  return (
    <section
      aria-labelledby="up-next-heading"
      className="flex flex-col gap-4 rounded-lg border border-primary/25 bg-primary-soft p-5 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="min-w-0">
        <p className="text-[13px] font-medium text-primary">Up next</p>
        <h2 id="up-next-heading" className="mt-1 text-xl font-semibold tracking-tight text-ink [overflow-wrap:anywhere]">
          {heading}
        </h2>
        <p className="mt-1 text-sm text-ink-secondary">{detail}</p>
      </div>
      <ButtonLink href={href} className="h-11 shrink-0 px-5">
        {action}
      </ButtonLink>
    </section>
  );
}
