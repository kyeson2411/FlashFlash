"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const STUDENT_LINKS = [
  { href: "/dashboard", label: "Overview", match: (path: string) => path === "/dashboard" },
  { href: "/decks", label: "My decks", match: (path: string) => path.startsWith("/decks") },
  { href: "/classes", label: "My classes", match: (path: string) => path.startsWith("/classes") },
  { href: "/dashboard#week", label: "Study history", match: () => false },
  { href: "/generate", label: "Make flashcards", match: (path: string) => path.startsWith("/generate") },
];

const TEACHER_LINKS = [
  { href: "/classes", label: "Classes", match: (path: string) => path.startsWith("/classes") },
  { href: "/generate", label: "Make flashcards", match: (path: string) => path.startsWith("/generate") },
];

export function AppNav({ variant, role = "student" }: { variant: "side" | "mobile"; role?: "student" | "teacher" }) {
  const pathname = usePathname();
  const links = role === "teacher" ? TEACHER_LINKS : STUDENT_LINKS;

  return (
    <nav className={variant === "side" ? "af-nav" : "af-mobile-nav"} aria-label="Study space">
      {links.map((link) => (
        <Link key={link.href} href={link.href} className={link.match(pathname) ? "selected" : undefined} aria-current={link.match(pathname) ? "page" : undefined}>
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
      Study space <span aria-hidden="true">/</span> <strong>{current}</strong>
    </p>
  );
}
