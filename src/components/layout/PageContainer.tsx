import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

// Standard page width and padding. Use size="narrow" for text-heavy or form-only pages.
export function PageContainer({
  size = "wide",
  compact = false,
  className,
  children,
}: {
  size?: "wide" | "narrow";
  /** Less vertical padding, for focused screens such as studying. */
  compact?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "mx-auto w-full px-4 sm:px-6 lg:px-8",
        compact ? "py-4 sm:py-8" : "py-8 sm:py-12",
        size === "wide" ? "max-w-6xl" : "max-w-2xl",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function PageHeader({ title, description }: { title: string; description?: string }) {
  return (
    <div className="max-w-2xl space-y-2">
      <h1 className="type-page">{title}</h1>
      {description && <p className="type-body">{description}</p>}
    </div>
  );
}
