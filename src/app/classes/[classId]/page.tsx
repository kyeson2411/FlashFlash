import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { ClassCode } from "@/components/class/ClassCode";
import { ClassDeckForm } from "@/components/class/ClassDeckForm";
import { DeckSummaryCard } from "@/components/deck/DeckSummaryCard";
import { ButtonLink } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { LoadingState } from "@/components/ui/LoadingState";
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
    <div className="space-y-10">
      <div className="space-y-3">
        <ButtonLink href="/classes" variant="ghost" className="-ml-3 h-11 px-3 text-sm">
          <span aria-hidden="true">←</span> All classes
        </ButtonLink>
        <div className="af-view-heading">
          <p className="af-eyebrow">Class</p>
          <h1>{detail.name}</h1>
          <p>Students join with this code. The list below is alphabetical, not a ranking.</p>
        </div>
        <ClassCode code={detail.code} />
      </div>

      <section className="space-y-4">
        <h2 className="type-section">Students</h2>
        {detail.roster.length === 0 ? (
          <p className="type-body">No students have joined yet.</p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
            {detail.roster.map((student) => (
              <li key={student.studentId} className="flex flex-wrap items-baseline justify-between gap-3 px-4 py-3">
                <span className="font-semibold text-ink">{student.name}</span>
                <span className="type-helper">
                  {student.known} known · {student.stillToLearn} still to learn
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="type-section">Class decks</h2>
          {detail.decks.length > 0 && (
            <ButtonLink href={`/generate?class=${detail.id}`}>Make flashcards</ButtonLink>
          )}
        </div>
        {detail.decks.length === 0 ? (
          <EmptyState
            title="Make flashcards for this class"
            description="Name a deck, then turn your notes into the cards students will study."
          >
            <ClassDeckForm classId={detail.id} />
          </EmptyState>
        ) : (
          <ul className="grid gap-3">
            {detail.decks.map((deck) => (
              <li key={deck.id}>
                <Link href={`/decks/${deck.id}`} className="af-deck-tile block space-y-1">
                  <span className="text-lg font-semibold text-ink">{deck.title}</span>
                  <span className="type-helper block">
                    {deck.cardCount} {deck.cardCount === 1 ? "card" : "cards"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        {detail.decks.length > 0 && (
          <div className="max-w-xl rounded-lg border border-border bg-surface p-5">
            <h3 className="type-section">Another deck</h3>
            <div className="mt-4">
              <ClassDeckForm classId={detail.id} />
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

async function StudentClass({ classId }: { classId: string }) {
  const klass = await getStudentClass(classId);
  if (!klass) notFound();
  const decks = (await listDeckSummaries()).filter((deck) => deck.classId === classId);

  return (
    <div className="space-y-8">
      <ButtonLink href="/classes" variant="ghost" className="-ml-3 h-11 px-3 text-sm">
        <span aria-hidden="true">←</span> My classes
      </ButtonLink>
      <div className="af-view-heading">
        <p className="af-eyebrow">Class</p>
        <h1>{klass.name}</h1>
        <p>Study the decks your teacher made for this class.</p>
      </div>
      {decks.length === 0 ? (
        <EmptyState
          title="No decks yet"
          description="Your teacher has not added decks to this class yet."
        />
      ) : (
        <div className="af-deck-grid">
          {decks.map((deck) => (
            <DeckSummaryCard key={deck.id} deck={deck} />
          ))}
        </div>
      )}
    </div>
  );
}
