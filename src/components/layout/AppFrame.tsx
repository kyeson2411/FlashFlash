import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { logout } from "@/app/actions/auth";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { firstName, getStudent, type Student } from "@/lib/auth/session";
import { getProgress } from "@/lib/data/progress";
import { AppBreadcrumb, AppNav } from "./AppNav";

function initials(fullName: string) {
  const parts = fullName.trim().split(/\s+/).filter(Boolean).slice(0, 2);
  const letters = parts.map((part) => part[0]?.toUpperCase() ?? "").join("");
  return letters || "A";
}

export function AppFrame({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<GuestFrame>{children}</GuestFrame>}>
      <SessionFrame>{children}</SessionFrame>
    </Suspense>
  );
}

function GuestFrame({ children }: { children: ReactNode }) {
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
              Account data is processed under the Philippine Data Privacy Act of 2012. Study progress is for
              your own learning. It is not a grade or a teacher record.
            </p>
          </div>
        </div>
      </footer>
    </>
  );
}

async function SessionFrame({ children }: { children: ReactNode }) {
  const student = await getStudent();
  if (!student) return <GuestFrame>{children}</GuestFrame>;

  let streak = 0;
  try {
    streak = (await getProgress()).streak;
  } catch {
    streak = 0;
  }

  return (
    <StudyFrame student={student} streak={streak}>
      {children}
    </StudyFrame>
  );
}

function StudyFrame({
  student,
  streak,
  children,
}: {
  student: Student;
  streak: number;
  children: ReactNode;
}) {
  return (
    <div className="af-app">
      <div className="af-shell">
        <aside className="af-sidebar">
          <Link href={student.role === "teacher" ? "/classes" : "/dashboard"} className="af-brand">
            <span className="af-brand-mark" aria-hidden="true">
              A
            </span>
            AutoFlash
          </Link>
          <p className="af-nav-label">Study space</p>
          <AppNav variant="side" role={student.role} />
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
            <AppBreadcrumb role={student.role} />
            {student.role === "student" ? (
              <form className="af-search" action="/decks" method="get">
                <svg aria-hidden="true" viewBox="0 0 24 24" className="size-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="m21 21-4.3-4.3M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Z" />
                </svg>
                <input name="q" type="search" placeholder="Search decks" aria-label="Search decks" />
              </form>
            ) : (
              <span />
            )}
          </header>
          <AppNav variant="mobile" role={student.role} />
          <div className="af-content">
            <main id="main">{children}</main>
          </div>
        </section>
      </div>
    </div>
  );
}
