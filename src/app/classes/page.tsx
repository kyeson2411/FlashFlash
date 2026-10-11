import Link from "next/link";
import { Suspense } from "react";
import { CreateClassForm } from "@/components/class/CreateClassForm";
import { JoinClassForm } from "@/components/class/JoinClassForm";
import { UpNext } from "@/components/deck/UpNext";
import { PageHeader, SectionHeader } from "@/components/layout/PageHeader";
import { QuizCountdown } from "@/components/quiz/QuizCountdown";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { Chevron } from "@/components/ui/List";
import { LoadingState } from "@/components/ui/LoadingState";
import { Modal } from "@/components/ui/Modal";
import { requireStudent } from "@/lib/auth/session";
import { listStudentClasses, listTeacherClasses, type ClassSummary, type StudentClassSummary } from "@/lib/data/classes";
import { listWaitingQuizzes, type WaitingQuiz } from "@/lib/data/quizzes";
import { pickTeacherNext, teacherNextDetail } from "@/lib/teacher-next";

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
  const next = pickTeacherNext(classes);

  return (
    <div className="space-y-8">
      <PageHeader
        title="Classes"
        description={
          classes.length === 0
            ? "Create a class to get a code you can share with your students."
            : "Open a class to see decks, who has started, and cards that are hard."
        }
        actions={
          <Modal
            triggerLabel="Create class"
            variant={classes.length === 0 ? "primary" : "secondary"}
            title="Create a class"
            description="You will get a code to share with your students."
          >
            <CreateClassForm />
          </Modal>
        }
      />

      {next ? (
        <UpNext
          heading={next.name}
          detail={teacherNextDetail(next)}
          href={`/classes/${next.id}`}
          action="Open class"
        />
      ) : null}

      {classes.length === 0 ? (
        <EmptyState title="No classes yet" description="Use Create class to make your first one." />
      ) : (
        <section aria-labelledby="class-list-heading">
          <SectionHeader id="class-list-heading" title="Your classes" count={classes.length} />
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {classes.map((klass) => (
              <TeacherClassTile key={klass.id} klass={klass} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function TeacherClassTile({ klass }: { klass: ClassSummary }) {
  const students = klass.studentCount === 1 ? "1 student" : `${klass.studentCount} students`;
  const decks = klass.deckCount === 1 ? "1 deck" : `${klass.deckCount} decks`;
  return (
    <li className="relative flex flex-col gap-5 rounded-lg border border-border bg-surface p-5 transition-colors hover:border-border-strong">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-ink [overflow-wrap:anywhere]">
            <Link href={`/classes/${klass.id}`} className="after:absolute after:inset-0 after:content-['']">
              {klass.name}
            </Link>
          </h3>
          <p className="mt-0.5 text-sm text-ink-secondary">
            Code <span className="font-mono tracking-widest text-ink">{klass.code}</span>
          </p>
        </div>
        {klass.pendingCount > 0 ? (
          <Badge tone="warning">Waiting</Badge>
        ) : klass.hardCardCount > 0 ? (
          <Badge tone="warning">Needs a look</Badge>
        ) : null}
      </div>
      <div className="mt-auto space-y-2">
        {klass.pendingCount > 0 ? (
          <Stat value={klass.pendingCount} label="waiting to join" />
        ) : klass.hardCardCount > 0 ? (
          <Stat value={klass.hardCardCount} label={klass.hardCardCount === 1 ? "hard card" : "hard cards"} />
        ) : klass.notStartedCount > 0 ? (
          <Stat
            value={klass.notStartedCount}
            label={klass.notStartedCount === 1 ? "has not started" : "have not started"}
          />
        ) : klass.studentCount === 0 ? (
          <p className="text-sm text-ink-secondary">No students yet. Share the code so they can join.</p>
        ) : klass.hasCards ? (
          <p className="text-sm font-semibold text-success">Everyone has started</p>
        ) : (
          <Stat value={klass.studentCount} label={klass.studentCount === 1 ? "student" : "students"} />
        )}
        {klass.studentCount > 0 || klass.deckCount > 0 ? (
          <p className="text-sm text-ink-secondary">
            {students}, {decks}
          </p>
        ) : null}
      </div>
    </li>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <p className="flex items-baseline gap-2">
      <span className="text-3xl font-semibold leading-none tabular-nums text-ink">{value}</span>
      <span className="text-sm text-ink-secondary">{label}</span>
    </p>
  );
}

async function StudentClasses() {
  const [classes, waiting] = await Promise.all([listStudentClasses(), listWaitingQuizzes()]);
  const openQuizzes = (waiting ?? []).filter((quiz) => quiz.window === "open" || quiz.window === "late");
  const nextQuiz = openQuizzes.find((quiz) => quiz.window === "late") ?? openQuizzes[0];
  const nextClass = classes
    .filter((klass) => !klass.pending && klass.stillToLearn > 0)
    .reduce<StudentClassSummary | null>((best, klass) => (!best || klass.stillToLearn > best.stillToLearn ? klass : best), null);
  const serverNow = new Date().toISOString();

  return (
    <div className="space-y-8">
      <PageHeader
        title="My classes"
        description={
          classes.length === 0
            ? "Enter the code from your teacher to join a class."
            : "Decks and quizzes from your teachers, one class at a time."
        }
        actions={
          <Modal
            triggerLabel="Join class"
            variant={classes.length === 0 ? "primary" : "secondary"}
            title="Join a class"
            description="Enter the 6-character code from your teacher."
          >
            <JoinClassForm />
          </Modal>
        }
      />

      {nextQuiz ? (
        <UpNext
          heading={`Quiz: ${nextQuiz.title}`}
          detail={
            <>
              {nextQuiz.className} · {nextQuiz.inProgress ? "In progress · " : null}
              <QuizCountdown dueAt={nextQuiz.dueAt} opensAt={nextQuiz.opensAt} window={nextQuiz.window} serverNow={serverNow} />
            </>
          }
          href={`/quizzes/${nextQuiz.id}`}
          action={nextQuiz.inProgress ? "Continue quiz" : "Take quiz"}
        />
      ) : nextClass ? (
        <UpNext
          heading={nextClass.name}
          detail={`${nextClass.stillToLearn} ${nextClass.stillToLearn === 1 ? "card" : "cards"} to learn in this class.`}
          href={`/classes/${nextClass.id}`}
          action="Open class"
        />
      ) : null}

      {classes.length === 0 ? (
        <EmptyState title="No classes yet" description="Use Join class to enter the code your teacher gave you." />
      ) : (
        <section aria-labelledby="class-list-heading">
          <SectionHeader id="class-list-heading" title="Joined classes" count={classes.length} />
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {classes.map((klass) => (
              <ClassTile
                key={klass.id}
                klass={klass}
                quizzes={openQuizzes.filter((quiz) => quiz.classId === klass.id)}
              />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function ClassTile({ klass, quizzes }: { klass: StudentClassSummary; quizzes: WaitingQuiz[] }) {
  const overdue = quizzes.some((quiz) => quiz.window === "late");
  return (
    <li className="relative flex flex-col gap-5 rounded-lg border border-border bg-surface p-5 transition-colors hover:border-border-strong">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-ink [overflow-wrap:anywhere]">
            <Link href={`/classes/${klass.id}`} className="after:absolute after:inset-0 after:content-['']">
              {klass.name}
            </Link>
          </h3>
          <p className="mt-0.5 text-sm text-ink-secondary">
            {klass.pending
              ? "Waiting for your teacher to approve you"
              : klass.deckCount === 0
                ? "No decks yet"
                : `${klass.deckCount} ${klass.deckCount === 1 ? "deck" : "decks"}`}
          </p>
        </div>
        {klass.pending ? <Badge tone="warning">Waiting</Badge> : overdue ? <Badge tone="warning">Overdue quiz</Badge> : null}
      </div>
      {klass.pending ? null : (
        <div className="mt-auto flex items-end justify-between gap-3">
          {klass.deckCount === 0 ? (
            <p className="text-sm text-ink-secondary">Your teacher has not added decks yet.</p>
          ) : klass.stillToLearn > 0 ? (
            <p className="flex items-baseline gap-2">
              <span className="text-3xl font-semibold leading-none tabular-nums text-ink">{klass.stillToLearn}</span>
              <span className="text-sm text-ink-secondary">to learn</span>
            </p>
          ) : (
            <p className="text-sm font-semibold text-success">All known</p>
          )}
          {quizzes.length > 0 ? (
            <p className="flex items-center gap-1.5 text-sm font-medium text-primary">
              <span aria-hidden="true" className="size-2 rounded-full bg-primary" />
              {quizzes.length === 1 ? "1 quiz open" : `${quizzes.length} quizzes open`}
            </p>
          ) : (
            <Chevron />
          )}
        </div>
      )}
    </li>
  );
}
