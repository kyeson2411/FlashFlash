import { Suspense } from "react";
import { notFound } from "next/navigation";
import { ClassAccess } from "@/components/class/ClassAccess";
import { ClassDeckForm } from "@/components/class/ClassDeckForm";
import { ClassRosterActions } from "@/components/class/ClassRosterActions";
import { DeckSummaryCard } from "@/components/deck/DeckSummaryCard";
import { PageHeader, SectionHeader } from "@/components/layout/PageHeader";
import { Badge } from "@/components/ui/Badge";
import { ButtonLink } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Avatar, Chevron, List, ListRow } from "@/components/ui/List";
import { LoadingState } from "@/components/ui/LoadingState";
import { Modal } from "@/components/ui/Modal";
import { requireStudent } from "@/lib/auth/session";
import { manilaDateKey } from "@/lib/progress-summary";
import { getClassDetail, getStudentClass } from "@/lib/data/classes";
import { listDeckSummaries } from "@/lib/data/decks";
import { listClassQuizzes } from "@/lib/data/quizzes";
import { quizStatusLabel, sortWaiting } from "@/lib/quiz";
import { QuizCountdown } from "@/components/quiz/QuizCountdown";

export const metadata = { title: "Class | AutoFlash" };

export default function ClassPage({ params }: { params: Promise<{ classId: string }> }) {
  return (
    <Suspense fallback={<LoadingState title="Loading this class…" />}>
      <ClassBody params={params} />
    </Suspense>
  );
}

async function ClassBody({ params }: { params: Promise<{ classId: string }> }) {
  const user = await requireStudent();
  const { classId } = await params;
  if (user.role !== "teacher") return <StudentClass classId={classId} />;
  const detail = await getClassDetail(classId);
  if (!detail) notFound();
  const quizzes = await listClassQuizzes(classId);

  return (
    <div className="space-y-4">
      <PageHeader
        back={{ href: "/classes", label: "All classes" }}
        eyebrow="Class"
        title={detail.name}
        description={
          detail.codeRevoked
            ? "The join code is off. Students already in the class stay."
            : "Students join with the code below."
        }
        actions={
          <>
            {detail.decks.length > 0 && (
              <>
                <Modal
                  triggerLabel="New deck"
                  variant="secondary"
                  title="New class deck"
                  description="Name the deck, then make flashcards for it."
                >
                  <ClassDeckForm classId={detail.id} />
                </Modal>
                <ButtonLink href={`/generate?class=${detail.id}`}>Make flashcards</ButtonLink>
              </>
            )}
          </>
        }
      />

      <ClassAccess
        classId={detail.id}
        code={detail.code}
        revoked={detail.codeRevoked}
        requireApproval={detail.requireApproval}
      />

      {quizzes && quizzes.length > 0 ? (
        <section aria-labelledby="class-quizzes-heading" className="space-y-3">
          <SectionHeader id="class-quizzes-heading" title="Quizzes" count={quizzes.length} />
          <List>
            {quizzes.map((quiz) => (
              <ListRow
                key={quiz.id}
                href={`/quizzes/${quiz.id}`}
                primary={quiz.title}
                secondary={quizStatusLabel(quiz)}
                aside={<Chevron />}
              />
            ))}
          </List>
        </section>
      ) : quizzes && detail.decks.length > 0 ? (
        <section aria-labelledby="class-quizzes-heading">
          <SectionHeader id="class-quizzes-heading" title="Quizzes" />
          <p className="type-helper">Give a quiz from a class deck when you want students to answer every card once.</p>
        </section>
      ) : null}

      {detail.roster.length > 0 && detail.cardTotal > 0 && (
        <section aria-labelledby="stuck-heading" className="space-y-3">
          <SectionHeader
            id="stuck-heading"
            title="Still learning"
            action={<span className="text-[12px] text-ink-muted">Most of the class, not a ranking</span>}
          />
          {detail.stuckCards.length === 0 ? (
            <p className="type-helper">No card is still learning for most of the class.</p>
          ) : (
            <List>
              {detail.stuckCards.map((card) => (
                <ListRow
                  key={card.cardId}
                  href={`/decks/${card.deckId}`}
                  primary={card.question}
                  secondary={card.deckTitle}
                  aside={
                    <p className="font-mono text-[12px] tabular-nums text-ink-muted">
                      {card.stillLearning} of {card.students} still learning
                    </p>
                  }
                />
              ))}
            </List>
          )}
          {detail.notStarted.length > 0 && (
            <p className="type-helper">
              Have not started: {detail.notStarted.map((student) => student.name).join(", ")}.
            </p>
          )}
        </section>
      )}

      <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
        <section aria-labelledby="roster-heading">
          <SectionHeader
            id="roster-heading"
            title="Students"
            count={detail.roster.length}
            action={<span className="text-[12px] text-ink-muted">Alphabetical, not a ranking</span>}
          />
          {detail.roster.length === 0 ? (
            <EmptyState headingLevel={3} title="No students yet" description="Share the class code to invite students." />
          ) : (
            <List>
              {detail.roster.map((student) => (
                <ListRow
                  key={student.studentId}
                  leading={<Avatar name={student.name} />}
                  primary={student.name}
                  secondary={
                    student.status === "pending"
                      ? "Waiting for approval"
                      : detail.activityKnown
                        ? lastStudiedLabel(student.lastReviewedAt)
                        : undefined
                  }
                  aside={
                    <div className="flex items-center gap-3">
                      {student.status === "pending" ? (
                        <Badge tone="warning">Waiting</Badge>
                      ) : (
                        <p className="flex items-center gap-3 font-mono text-[12px] tabular-nums">
                          <span className="text-success">
                            {student.known} <span className="text-ink-muted">known</span>
                          </span>
                          <span className="text-warning">
                            {student.stillToLearn} <span className="text-ink-muted">to learn</span>
                          </span>
                        </p>
                      )}
                      <ClassRosterActions
                        classId={detail.id}
                        studentId={student.studentId}
                        pending={student.status === "pending"}
                      />
                    </div>
                  }
                />
              ))}
            </List>
          )}
        </section>

        <section aria-labelledby="class-decks-heading">
          <SectionHeader id="class-decks-heading" title="Class decks" count={detail.decks.length} />
          {detail.decks.length === 0 ? (
            <EmptyState
              headingLevel={3}
              title="Make flashcards for this class"
              description="Name a deck, then turn your notes into the cards students will study."
            >
              <div className="mx-auto max-w-sm">
                <ClassDeckForm classId={detail.id} />
              </div>
            </EmptyState>
          ) : (
            <List>
              {detail.decks.map((deck) => (
                <ListRow
                  key={deck.id}
                  href={`/decks/${deck.id}`}
                  primary={deck.title}
                  secondary={deckLine(
                    deck.cardCount,
                    deck.startedCount,
                    detail.roster.filter((student) => student.status === "active").length,
                  )}
                  aside={
                    <span className="flex items-center gap-2">
                      <Badge tone={deck.workflowStatus === "published" ? "success" : deck.workflowStatus === "teacher_reviewed" ? "warning" : "neutral"}>
                        {deck.workflowStatus === "published"
                          ? "Teacher verified"
                          : deck.workflowStatus === "teacher_reviewed"
                            ? "Reviewed"
                            : "Draft"}
                      </Badge>
                      <Chevron />
                    </span>
                  }
                />
              ))}
            </List>
          )}
        </section>
      </div>
    </div>
  );
}

function deckLine(cards: number, started: number, students: number): string {
  const cardText = cards === 1 ? "1 card" : `${cards} cards`;
  if (students === 0 || cards === 0) return cardText;
  return `${cardText} · ${started} of ${students} started`;
}

function lastStudiedLabel(iso: string | null): string {
  if (!iso) return "Not yet";
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return "Not yet";
  if (manilaDateKey(when) === manilaDateKey(new Date())) return "Last studied today";
  const day = new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    timeZone: "Asia/Manila",
  }).format(when);
  return `Last studied ${day}`;
}

async function StudentClass({ classId }: { classId: string }) {
  const klass = await getStudentClass(classId);
  if (!klass) notFound();
  if (klass.pending) {
    return (
      <div className="space-y-4">
        <PageHeader
          back={{ href: "/classes", label: "My classes" }}
          eyebrow="Class"
          title={klass.name}
          description="Waiting for your teacher to approve you."
        />
        <EmptyState
          title="Waiting for approval"
          description="You cannot open decks or quizzes in this class until your teacher approves you."
        />
      </div>
    );
  }
  const [decks, quizzes] = await Promise.all([
    listDeckSummaries().then((rows) => rows.filter((deck) => deck.classId === classId)),
    listClassQuizzes(classId),
  ]);
  const serverNow = new Date().toISOString();

  return (
    <div className="space-y-4">
      <PageHeader
        back={{ href: "/classes", label: "My classes" }}
        eyebrow="Class"
        title={klass.name}
        description="Study the decks your teacher made for this class."
      />
      {quizzes && quizzes.length > 0 && (
        <section aria-labelledby="student-quizzes-heading" className="space-y-3">
          <SectionHeader id="student-quizzes-heading" title="Quizzes" count={quizzes.length} />
          <List>
            {sortWaiting(
              quizzes.map((quiz) => ({
                ...quiz,
                window: (quiz.attempt?.finishedCount ?? 0) > 0 ? ("closed" as const) : (quiz.window ?? "closed"),
                access: quiz.window ?? "closed",
              })),
            ).map((quiz) => {
              const attempt = quiz.attempt;
              const access = quiz.access;
              const finished = (attempt?.finishedCount ?? 0) > 0;
              const canOpen = access !== "closed" || finished;
              const score =
                finished && attempt && attempt.correct !== null && attempt.total !== null
                  ? `${attempt.correct} of ${attempt.total}`
                  : null;
              const secondary = finished ? (
                score ? (
                  "Finished"
                ) : (
                  "Finished · Score after results are released"
                )
              ) : access === "closed" ? (
                quizStatusLabel(quiz, new Date(), access)
              ) : (
                <>
                  {attempt?.inProgress ? "In progress · " : null}
                  <QuizCountdown dueAt={quiz.dueAt} opensAt={quiz.opensAt ?? null} window={access} serverNow={serverNow} />
                </>
              );
              return (
                <ListRow
                  key={quiz.id}
                  href={canOpen ? `/quizzes/${quiz.id}` : undefined}
                  primary={quiz.title}
                  secondary={secondary}
                  aside={
                    <span className="flex items-center gap-2">
                      {access === "late" && !finished ? <Badge tone="warning">Overdue</Badge> : null}
                      {attempt?.late ? <Badge tone="warning">Late</Badge> : null}
                      {score ? (
                        <p className="font-mono text-[12px] tabular-nums text-ink-secondary">{score}</p>
                      ) : canOpen ? (
                        <Chevron />
                      ) : null}
                    </span>
                  }
                />
              );
            })}
          </List>
        </section>
      )}
      {decks.length === 0 ? (
        <EmptyState title="No decks yet" description="Your teacher has not added decks to this class yet." />
      ) : (
        <section aria-labelledby="class-decks-heading">
          <SectionHeader id="class-decks-heading" title="Class decks" count={decks.length} />
          <List>
            {decks.map((deck) => (
              <DeckSummaryCard key={deck.id} deck={deck} />
            ))}
          </List>
        </section>
      )}
    </div>
  );
}
