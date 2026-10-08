"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

const FOCUS_ROUTE = /^\/decks\/[^/]+\/study\/?$/;

// Study sessions render in focus mode: no sidebar, top bar, or mobile nav.
export function AppShell({
  sidebar,
  topbar,
  mobileNav,
  children,
}: {
  sidebar: ReactNode;
  topbar: ReactNode;
  mobileNav: ReactNode;
  children: ReactNode;
}) {
  const pathname = usePathname();

  if (FOCUS_ROUTE.test(pathname)) {
    return (
      <div className="af-app">
        <main id="main" className="min-h-dvh">
          {children}
        </main>
      </div>
    );
  }

  return (
    <div className="af-app">
      <div className="af-shell">
        {sidebar}
        <section className="af-main">
          {topbar}
          {mobileNav}
          <div className="af-content">
            <main id="main">{children}</main>
          </div>
        </section>
      </div>
    </div>
  );
}
