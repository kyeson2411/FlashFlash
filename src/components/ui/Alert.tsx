import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

type Tone = "error" | "warning" | "success";

const styles: Record<Tone, { box: string; icon: ReactNode }> = {
  error: {
    box: "border-error/40 bg-error-soft text-error",
    // circle with exclamation
    icon: <path d="M12 8v5m0 3.5h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />,
  },
  warning: {
    box: "border-warning/40 bg-warning-soft text-warning",
    // triangle with exclamation
    icon: <path d="M12 9v4m0 3.5h.01M10.3 4.2 2.9 17a2 2 0 0 0 1.7 3h14.8a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0Z" />,
  },
  success: {
    box: "border-success/40 bg-success-soft text-success",
    // circle with check
    icon: <path d="m8.5 12.5 2.5 2.5 4.5-5M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />,
  },
};

type AlertProps = {
  tone?: Tone;
  title: string;
  children?: ReactNode;
  /** Optional recovery action, e.g. a "Try again" button. */
  action?: ReactNode;
};

// The icon and the title make the meaning clear without relying on color alone.
export function Alert({ tone = "error", title, children, action }: AlertProps) {
  const { box, icon } = styles[tone];

  return (
    <div role={tone === "error" ? "alert" : "status"} className={cn("rounded-md border p-4", box)}>
      <div className="flex gap-3">
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="mt-0.5 size-5 shrink-0"
        >
          {icon}
        </svg>
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-base font-semibold">{title}</p>
          {children && <div className="text-sm leading-normal text-ink">{children}</div>}
          {action && <div className="pt-2">{action}</div>}
        </div>
      </div>
    </div>
  );
}
