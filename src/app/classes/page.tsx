import Link from "next/link";
import { Suspense } from "react";
import { CreateClassForm } from "@/components/class/CreateClassForm";
import { JoinClassForm } from "@/components/class/JoinClassForm";
import { LoadingState } from "@/components/ui/LoadingState";
import { requireStudent } from "@/lib/auth/session";
import { listStudentClasses, listTeacherClasses } from "@/lib/data/classes";

export const metadata = { title: "Classes | AutoFlash" };

export default function ClassesPage() {
  return (
    <Suspense fallback={<LoadingState title="Loading your classes…" />}>
      <ClassesHome />
    </Suspense>
  );
}

async function ClassesHome() {
  const user = await requireStudent();
  if (user.role !== "teacher") return <StudentClasses />;
  const classes = await listTeacherClasses();

  return (
    <div className="space-y-10">
      <div className="af-view-heading">
        <p className="af-eyebrow">Your classes</p>
        <h1>Classes</h1>
        <p>Create a class, share the code, and add the flashcards your students will study.</p>
      </div>

      <section className="max-w-xl space-y-4 rounded-lg border border-border bg-surface p-5">
        <h2 className="type-section">New class</h2>
        <CreateClassForm />
      </section>

      <section className="space-y-4">
        <h2 className="type-section">Your classes</h2>
        {classes.length === 0 ? (
          <p className="type-body">You have not created a class yet.</p>
        ) : (
          <ul className="grid gap-3">
            {classes.map((klass) => (
              <li key={klass.id}>
                <Link href={`/classes/${klass.id}`} className="af-deck-tile block space-y-1">
                  <span className="text-lg font-semibold text-ink">{klass.name}</span>
                  <span className="type-helper block font-mono tracking-widest">{klass.code}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

async function StudentClasses() {
  const classes = await listStudentClasses();

  return (
    <div className="space-y-10">
      <div className="af-view-heading">
        <p className="af-eyebrow">Your classes</p>
        <h1>My classes</h1>
        <p>
          {classes.length === 0
            ? "Enter the code from your teacher."
            : "Open a class to study the decks your teacher made."}
        </p>
      </div>

      {classes.length > 0 && (
        <ul className="grid gap-3">
          {classes.map((klass) => (
            <li key={klass.id}>
              <Link href={`/classes/${klass.id}`} className="af-deck-tile block space-y-1">
                <span className="text-lg font-semibold text-ink">{klass.name}</span>
                <span className="type-helper block">
                  {klass.deckCount === 0
                    ? "No decks yet"
                    : `${klass.deckCount} ${klass.deckCount === 1 ? "deck" : "decks"} · ${klass.stillToLearn} still to learn`}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <section className="max-w-xl space-y-4 rounded-lg border border-border bg-surface p-5">
        <h2 className="type-section">{classes.length === 0 ? "Join a class" : "Have a code?"}</h2>
        {classes.length > 0 && <p className="type-helper">Enter a code to join another class.</p>}
        <JoinClassForm />
      </section>
    </div>
  );
}
