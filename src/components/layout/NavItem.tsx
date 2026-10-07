"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ENABLED_NAV_LINKS } from "@/config/nav";
import { navLinkClasses } from "./navStyles";

// Navigation links that mark the current page. Reading the pathname is runtime
// data, so SiteHeader wraps this in <Suspense> with a plain-links fallback.
export function NavLinks() {
  const pathname = usePathname();

  return (
    <>
      {ENABLED_NAV_LINKS.map((link) => {
        const active = link.href === "/" ? pathname === "/" : pathname.startsWith(link.href);

        return (
          <li key={link.href}>
            <Link href={link.href} aria-current={active ? "page" : undefined} className={navLinkClasses(active)}>
              {link.label}
            </Link>
          </li>
        );
      })}
    </>
  );
}
