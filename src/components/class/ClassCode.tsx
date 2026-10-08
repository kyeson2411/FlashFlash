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
    <div className="flex flex-wrap items-center gap-3">
      <p className="font-mono text-2xl font-semibold tracking-widest text-ink">{code}</p>
      <Button type="button" variant="secondary" onClick={copy}>
        {copied ? "Copied" : "Copy code"}
      </Button>
    </div>
  );
}
