import Link from "next/link";
import { logout } from "@/app/actions/auth";
import { firstName, type Student } from "@/lib/auth/session";

const accountLink =
  "inline-flex h-11 items-center justify-center whitespace-nowrap rounded-md px-3 text-sm font-semibold";

export function AccountMenu({ student }: { student: Student | null }) {
  if (!student) {
    return (
      <div className="flex items-center gap-1">
        <Link href="/login" className={`${accountLink} text-ink-secondary hover:bg-background hover:text-ink`}>
          Sign in
        </Link>
        <Link href="/register" className={`${accountLink} bg-primary-strong text-white hover:bg-primary-strong-hover`}>
          Get started
        </Link>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <p className="hidden max-w-[10rem] truncate text-sm font-medium text-ink-secondary lg:block" title={student.fullName}>
        {firstName(student.fullName)}
      </p>
      <form action={logout}>
        <button
          type="submit"
          className="inline-flex h-11 items-center justify-center rounded-md border border-border-strong bg-surface px-3 text-sm font-semibold text-ink hover:bg-background"
        >
          Log out
        </button>
      </form>
    </div>
  );
}
