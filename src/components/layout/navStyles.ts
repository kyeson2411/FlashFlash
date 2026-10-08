import { cn } from "@/lib/cn";

// The active page is shown with a filled background and bolder text, and also
// gets aria-current (so it does not rely on color alone).
export function navLinkClasses(active: boolean) {
  return cn(
    "inline-flex h-8 items-center whitespace-nowrap rounded-md px-3 text-[13px] font-medium transition-colors",
    active ? "bg-white/[0.06] text-ink" : "text-ink-secondary hover:bg-white/[0.04] hover:text-ink",
  );
}
