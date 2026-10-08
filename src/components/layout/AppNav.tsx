"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/dashboard", label: "Overview", match: (path: string) => path === "/dashboard" },
  { href: "/decks", label: "My decks", match: (path: string) => path.startsWith("/decks") },
  { href: "/dashboard#week", label: "Study history", match: () => false },
  { href: "/generate", label: "Make flashcards", match: (path: string) => path.startsWith("/generate") },
];

export function AppNav({ variant }: { variant: "side" | "mobile" }) {
  const pathname = usePathname();

  return (
    <nav className={variant === "side" ? "af-nav" : "af-mobile-nav"} aria-label="Study space">
      {LINKS.map((link) => (
        <Link key={link.href} href={link.href} className={link.match(pathname) ? "selected" : undefined} aria-current={link.match(pathname) ? "page" : undefined}>
          {link.label}
        </Link>
      ))}
    </nav>
  );
}

export function AppBreadcrumb() {
  const pathname = usePathname();
  const current = pathname.startsWith("/generate")
    ? "Make flashcards"
    : pathname.includes("/study")
      ? "Study"
      : pathname.startsWith("/decks")
        ? "My decks"
        : "Overview";

  return (
    <p className="af-breadcrumb">
      Study space <span aria-hidden="true">/</span> <strong>{current}</strong>
    </p>
  );
}
