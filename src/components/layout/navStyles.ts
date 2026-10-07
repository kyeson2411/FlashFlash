import { cn } from "@/lib/cn";

// The active page is shown with a filled background and bolder text, and also
// gets aria-current (so it does not rely on color alone).
export function navLinkClasses(active: boolean) {
  return cn(
    "inline-flex h-11 items-center whitespace-nowrap border-b-2 px-3 text-sm transition-colors",
    active
      ? "border-primary font-semibold text-ink"
      : "border-transparent font-medium text-ink-secondary hover:text-ink",
  );
}
