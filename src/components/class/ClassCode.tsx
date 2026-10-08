"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";

export function ClassCode({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="inline-flex h-10 items-center gap-2 rounded-md border border-border-strong bg-raised pl-3 pr-1">
      <span className="sr-only">Class code</span>
      <p className="font-mono text-sm font-semibold tracking-widest text-ink">{code}</p>
      <Button type="button" variant="ghost" className="h-8 px-2.5 text-[13px]" onClick={copy}>
        {copied ? "Copied" : "Copy code"}
      </Button>
    </div>
  );
}
