"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { InstallHint } from "@/components/pwa/InstallHint";

const FOCUS_ROUTE = /^\/decks\/[^/]+\/study\/?$/;

// Study sessions render in focus mode: no sidebar, top bar, or mobile nav.
export function AppShell({
  sidebar,
  topbar,
  mobileNav,
  role = "student",
  children,
}: {
  sidebar: ReactNode;
  topbar: ReactNode;
  mobileNav: ReactNode;
  role?: "student" | "teacher";
  children: ReactNode;
}) {
  const pathname = usePathname();

  if (FOCUS_ROUTE.test(pathname)) {
    return (
      <div className="af-app">
        <main id="main" className="min-h-dvh pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
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
            <InstallHint role={role} />
            <main id="main">{children}</main>
          </div>
        </section>
      </div>
    </div>
  );
}
