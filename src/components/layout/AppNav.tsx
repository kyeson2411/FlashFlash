"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

const ICONS: Record<string, ReactNode> = {
  overview: <path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z" />,
  decks: <path d="M7 3h10a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2ZM9 21h8" />,
  classes: (
    <path d="M16 20v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 18.5V20M10 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM20 20v-1.5a3.5 3.5 0 0 0-2.5-3.35M15.5 4.15a3.5 3.5 0 0 1 0 6.7" />
  ),
  history: <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />,
  generate: <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6" />,
};

const STUDENT_LINKS = [
  { href: "/dashboard", label: "Overview", icon: "overview", match: (path: string) => path === "/dashboard" },
  { href: "/decks", label: "My decks", icon: "decks", match: (path: string) => path.startsWith("/decks") },
  { href: "/classes", label: "My classes", icon: "classes", match: (path: string) => path.startsWith("/classes") },
  { href: "/dashboard#week", label: "Study history", icon: "history", match: () => false },
  { href: "/generate", label: "Make flashcards", icon: "generate", match: (path: string) => path.startsWith("/generate") },
];

const TEACHER_LINKS = [
  { href: "/classes", label: "Classes", icon: "classes", match: (path: string) => path.startsWith("/classes") },
  { href: "/generate", label: "Make flashcards", icon: "generate", match: (path: string) => path.startsWith("/generate") },
];

export function AppNav({ variant, role = "student" }: { variant: "side" | "mobile"; role?: "student" | "teacher" }) {
  const pathname = usePathname();
  const links = role === "teacher" ? TEACHER_LINKS : STUDENT_LINKS;

  return (
    <nav className={variant === "side" ? "af-nav" : "af-mobile-nav"} aria-label="Study space">
      {links.map((link) => (
        <Link key={link.href} href={link.href} className={link.match(pathname) ? "selected" : undefined} aria-current={link.match(pathname) ? "page" : undefined}>
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            {ICONS[link.icon]}
          </svg>
          {link.label}
        </Link>
      ))}
    </nav>
  );
}

export function AppBreadcrumb({ role = "student" }: { role?: "student" | "teacher" }) {
  const pathname = usePathname();
  const current = pathname.startsWith("/generate")
    ? "Make flashcards"
    : pathname.includes("/study")
      ? "Study"
      : pathname.startsWith("/classes")
        ? role === "teacher"
          ? "Classes"
          : "My classes"
        : pathname.startsWith("/decks")
          ? "My decks"
          : "Overview";

  return (
    <p className="af-breadcrumb">
      Study space <span aria-hidden="true" className="text-zinc-700">/</span> <strong>{current}</strong>
    </p>
  );
}
