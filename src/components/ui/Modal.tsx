"use client";

import { useId, useRef, type ReactNode } from "react";
import { Button } from "./Button";

type Variant = "primary" | "secondary" | "ghost";

export function Modal({
  triggerLabel,
  title,
  description,
  variant = "primary",
  triggerClassName,
  children,
}: {
  triggerLabel: string;
  title: string;
  description?: string;
  variant?: Variant;
  triggerClassName?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  return (
    <>
      <Button variant={variant} className={triggerClassName} onClick={() => ref.current?.showModal()}>
        {triggerLabel}
      </Button>
      <dialog
        ref={ref}
        aria-labelledby={titleId}
        onClick={(event) => {
          if (event.target === ref.current) ref.current?.close();
        }}
        className="m-auto w-[calc(100%-2rem)] max-w-md rounded-lg border border-border-strong bg-surface p-0 text-ink shadow-2xl backdrop:bg-black/50 backdrop:backdrop-blur-sm"
      >
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div className="space-y-1">
            <h2 id={titleId} className="text-base font-semibold text-ink">
              {title}
            </h2>
            {description && <p className="text-[13px] leading-relaxed text-ink-muted">{description}</p>}
          </div>
          <button
            type="button"
            onClick={() => ref.current?.close()}
            className="-mr-1 grid size-8 shrink-0 place-items-center rounded-md text-ink-muted transition-colors hover:bg-white/5 hover:text-ink"
          >
            <span className="sr-only">Close</span>
            <svg aria-hidden="true" viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="px-5 py-5">{children}</div>
      </dialog>
    </>
  );
}
