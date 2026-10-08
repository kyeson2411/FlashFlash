import Link from "next/link";
import { logout } from "@/app/actions/auth";
import { firstName, type Student } from "@/lib/auth/session";

const accountLink =
  "inline-flex h-8 items-center justify-center whitespace-nowrap rounded-md px-3 text-[13px] font-medium transition-colors";

export function AccountMenu({ student }: { student: Student | null }) {
  if (!student) {
    return (
      <div className="flex items-center gap-1">
        <Link href="/login" className={`${accountLink} text-ink-secondary hover:bg-white/5 hover:text-ink`}>
          Sign in
        </Link>
        <Link href="/register" className={`${accountLink} bg-ink text-background hover:bg-zinc-300`}>
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
          className="inline-flex h-8 items-center justify-center rounded-md border border-border-strong bg-raised px-3 text-[13px] font-medium text-ink transition-colors hover:border-zinc-600"
        >
          Log out
        </button>
      </form>
    </div>
  );
}
