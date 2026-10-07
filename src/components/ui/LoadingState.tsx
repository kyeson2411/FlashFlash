import { Spinner } from "./Spinner";

// Announced to screen readers via role="status". The pulsing placeholders
// hint at the shape of the result without being distracting.
export function LoadingState({
  title,
  description,
  placeholders = 0,
}: {
  title: string;
  description?: string;
  placeholders?: number;
}) {
  return (
    <div role="status" className="space-y-4">
      <div className="flex items-center gap-3">
        <Spinner className="size-5 text-primary" />
        <div>
          <p className="type-section">{title}</p>
          {description && <p className="type-helper">{description}</p>}
        </div>
      </div>
      {placeholders > 0 && (
        <div aria-hidden="true" className="space-y-3">
          {Array.from({ length: placeholders }, (_, i) => (
            <div
              key={i}
              className="h-24 animate-pulse rounded-lg border border-border bg-surface motion-reduce:animate-none"
            />
          ))}
        </div>
      )}
    </div>
  );
}
