import Link from "next/link";
import type { ReactNode } from "react";
import { logout } from "@/app/actions/auth";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { firstName, getStudent } from "@/lib/auth/session";
import { getProgress } from "@/lib/data/progress";
import { AppBreadcrumb, AppNav } from "./AppNav";

function initials(fullName: string) {
  const parts = fullName.trim().split(/\s+/).filter(Boolean).slice(0, 2);
  const letters = parts.map((part) => part[0]?.toUpperCase() ?? "").join("");
  return letters || "A";
}

export async function AppFrame({ children }: { children: ReactNode }) {
  const student = await getStudent();

  if (!student) {
    return (
      <>
        <SiteHeader />
        <main id="main" className="flex-1">
          {children}
        </main>
        <footer className="border-t border-border bg-surface">
          <div className="mx-auto grid w-full max-w-6xl gap-8 px-4 py-10 sm:grid-cols-2 sm:px-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,0.8fr)_minmax(0,0.8fr)] lg:px-8">
            <div className="space-y-2">
              <p className="text-base font-semibold text-ink">AutoFlash</p>
              <p className="type-helper max-w-sm">
                Flashcards made from your own notes, saved to your account, and ready when you are.
              </p>
            </div>
            <div className="space-y-2">
              <p className="text-sm font-semibold text-ink">Product</p>
              <ul className="space-y-1">
                <li>
                  <Link href="/#how" className="type-helper hover:text-ink">
                    How it works
                  </Link>
                </li>
                <li>
                  <Link href="/#features" className="type-helper hover:text-ink">
                    Features
                  </Link>
                </li>
                <li>
                  <Link href="/dashboard" className="type-helper hover:text-ink">
                    Dashboard
                  </Link>
                </li>
              </ul>
            </div>
            <div className="space-y-2">
              <p className="text-sm font-semibold text-ink">Account</p>
              <ul className="space-y-1">
                <li>
                  <Link href="/login" className="type-helper hover:text-ink">
                    Sign in
                  </Link>
                </li>
                <li>
                  <Link href="/register" className="type-helper hover:text-ink">
                    Create account
                  </Link>
                </li>
              </ul>
            </div>
          </div>
          <div className="border-t border-border">
            <div className="page-shell py-4">
              <p className="type-helper">
                Account data is processed under the Philippine Data Privacy Act of 2012. Study progress is
                for your own learning. It is not a grade or a teacher record.
              </p>
            </div>
          </div>
        </footer>
      </>
    );
  }

  let streak = 0;
  try {
    streak = (await getProgress()).streak;
  } catch {
    streak = 0;
  }

  return (
    <div className="af-app">
      <div className="af-shell">
        <aside className="af-sidebar">
          <Link href="/dashboard" className="af-brand">
            <span className="af-brand-mark" aria-hidden="true">
              A
            </span>
            AutoFlash
          </Link>
          <p className="af-nav-label">Study space</p>
          <AppNav variant="side" />
          <div className="af-side-bottom">
            <div className="af-streak-mini">
              <div className="af-streak-top">
                <span>Current streak</span>
              </div>
              <strong>{streak === 1 ? "1 day" : `${streak} days`}</strong>
              <p>A day counts when you study at least one card.</p>
            </div>
            <div className="af-profile">
              <span className="af-avatar" aria-hidden="true">
                {initials(student.fullName)}
              </span>
              <div>
                <b>{firstName(student.fullName)}</b>
                <form action={logout}>
                  <button type="submit" className="af-logout">
                    Log out
                  </button>
                </form>
              </div>
            </div>
          </div>
        </aside>
        <section className="af-main">
          <header className="af-topbar">
            <AppBreadcrumb />
            <form className="af-search" action="/decks" method="get">
              <input name="q" type="search" placeholder="Search decks" aria-label="Search decks" />
            </form>
          </header>
          <AppNav variant="mobile" />
          <div className="af-content">
            <main id="main">{children}</main>
          </div>
        </section>
      </div>
    </div>
  );
}
