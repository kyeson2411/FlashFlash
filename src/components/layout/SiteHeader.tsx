import Link from "next/link";
import { Suspense } from "react";
import { getStudent, type Student } from "@/lib/auth/session";
import { AccountMenu } from "./AccountMenu";
import { NavLinks } from "./NavItem";
import { navLinkClasses } from "./navStyles";

const MARKETING_LINKS = [
  { href: "/#how", label: "How it works" },
  { href: "/#features", label: "Features" },
];

// Small screens: brand and account on the first row, links on a second row that
// scrolls sideways. Larger screens: one row.
export function SiteHeader() {
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-background/80 backdrop-blur-md">
      <Suspense fallback={<HeaderBar student={null} pending />}>
        <HeaderAuth />
      </Suspense>
    </header>
  );
}

async function HeaderAuth() {
  const student = await getStudent();
  return <HeaderBar student={student} />;
}

function HeaderBar({ student, pending = false }: { student: Student | null; pending?: boolean }) {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col px-4 sm:h-16 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:px-6 lg:px-8">
      <div className="flex h-14 items-center justify-between gap-3 sm:h-auto">
        <Link
          href={student ? "/dashboard" : "/"}
          className="flex items-center gap-2 rounded-md text-[15px] font-semibold tracking-tight text-ink"
        >
          <LogoMark />
          AutoFlash
        </Link>
        <div className="sm:hidden">{pending ? <AccountSkeleton /> : <AccountMenu student={student} />}</div>
      </div>

      <nav aria-label="Main" className="-mx-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:overflow-visible sm:p-0">
        <ul className="flex items-center gap-1">
          {pending ? (
            <li className="h-11 w-28" aria-hidden="true" />
          ) : student ? (
            <NavLinks />
          ) : (
            MARKETING_LINKS.map((link) => (
              <li key={link.href}>
                <Link href={link.href} className={navLinkClasses(false)}>
                  {link.label}
                </Link>
              </li>
            ))
          )}
        </ul>
      </nav>

      <div className="hidden sm:block">{pending ? <AccountSkeleton /> : <AccountMenu student={student} />}</div>
    </div>
  );
}

function AccountSkeleton() {
  return <div aria-hidden="true" className="h-8 w-24 rounded-md bg-raised" />;
}

function LogoMark() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-6" fill="none">
      <rect x="6" y="2" width="16" height="16" rx="3" className="fill-raised stroke-border-strong" strokeWidth="1.5" />
      <rect x="2" y="6" width="16" height="16" rx="3" className="fill-ink" />
      <path d="M10.5 10.5 8 18h2l.5-1.6h3L14 18h2l-2.5-7.5h-3Zm.5 4.4.9-3 .9 3h-1.8Z" className="fill-background" />
    </svg>
  );
}
