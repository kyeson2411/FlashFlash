import type { ReactNode } from "react";

export function FocusCenter({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh items-center justify-center px-4 py-8">
      <div className="w-full max-w-xl">{children}</div>
    </div>
  );
}
