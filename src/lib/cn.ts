// Tiny helper to join class names, ignoring falsy values.
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
