import { Suspense } from "react";
import { notFound } from "next/navigation";
import { ClassCode } from "@/components/class/ClassCode";
import { ClassDeckForm } from "@/components/class/ClassDeckForm";
import { DeckSummaryCard } from "@/components/deck/DeckSummaryCard";
import { PageHeader, SectionHeader } from "@/components/layout/PageHeader";
import { ButtonLink } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Avatar, Chevron, List, ListRow } from "@/components/ui/List";
import { LoadingState } from "@/components/ui/LoadingState";
import { Modal } from "@/components/ui/Modal";
import { requireStudent } from "@/lib/auth/session";
import { getClassDetail, getStudentClass } from "@/lib/data/classes";
import { listDeckSummaries } from "@/lib/data/decks";

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

  return (
    <div className="space-y-4">
      <PageHeader
        back={{ href: "/classes", label: "All classes" }}
        eyebrow="Class"
        title={detail.name}
        description="Students join with this code."
        actions={
          <>
            <ClassCode code={detail.code} />
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
                  aside={
                    <p className="flex items-center gap-3 font-mono text-[12px] tabular-nums">
                      <span className="text-success">
                        {student.known} <span className="text-ink-muted">known</span>
                      </span>
                      <span className="text-warning">
                        {student.stillToLearn} <span className="text-ink-muted">to learn</span>
                      </span>
                    </p>
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
                  secondary={`${deck.cardCount} ${deck.cardCount === 1 ? "card" : "cards"}`}
                  aside={<Chevron />}
                />
              ))}
            </List>
          )}
        </section>
      </div>
    </div>
  );
}

async function StudentClass({ classId }: { classId: string }) {
  const klass = await getStudentClass(classId);
  if (!klass) notFound();
  const decks = (await listDeckSummaries()).filter((deck) => deck.classId === classId);

  return (
    <div className="space-y-4">
      <PageHeader
        back={{ href: "/classes", label: "My classes" }}
        eyebrow="Class"
        title={klass.name}
        description="Study the decks your teacher made for this class."
      />
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
