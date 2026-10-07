import type { ReactNode } from "react";

// Dashed placeholder shown when there is nothing to display yet.
// Use headingLevel={3} when it sits under a section heading.
export function EmptyState({
  title,
  description,
  headingLevel = 2,
  children,
}: {
  title: string;
  description: string;
  headingLevel?: 2 | 3;
  children?: ReactNode;
}) {
  const Heading = headingLevel === 2 ? "h2" : "h3";

  return (
    <div className="rounded-lg border border-dashed border-border px-5 py-8 text-center">
      <Heading className="type-section">{title}</Heading>
      <p className="type-helper mx-auto mt-2 max-w-sm">{description}</p>
      {children && <div className="mt-5">{children}</div>}
    </div>
  );
}
