import { Suspense } from "react";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageContainer } from "@/components/layout/PageContainer";
import { CloseQuizButton } from "@/components/quiz/DeckQuizPanel";
import { QuizTake } from "@/components/quiz/QuizTake";
import { ButtonLink } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { Avatar, List, ListRow } from "@/components/ui/List";
import { LoadingState } from "@/components/ui/LoadingState";
import { getQuizPage } from "@/lib/data/quizzes";
import { quizIsOpen, quizStatusLabel } from "@/lib/quiz";

export const metadata = { title: "Quiz | AutoFlash" };

export default function QuizPage({ params }: { params: Promise<{ quizId: string }> }) {
  return (
    <PageContainer size="narrow" compact>
      <Suspense fallback={<LoadingState title="Loading this quiz…" />}>
        <QuizBody params={params} />
      </Suspense>
    </PageContainer>
  );
}

async function QuizBody({ params }: { params: Promise<{ quizId: string }> }) {
  const { quizId } = await params;
  const page = await getQuizPage(quizId);
  if (page.kind === "missing") notFound();
  if (page.kind === "unavailable") {
    return (
      <Alert tone="warning" title="Quizzes need a database update">
        Run the latest SQL migration, then reload this page.
      </Alert>
    );
  }

  if (page.kind === "teacher") {
    return (
      <div className="space-y-4">
        <PageHeader
          back={{ href: `/classes/${page.classId}`, label: page.className }}
          eyebrow="Quiz"
          title={page.quiz.title}
          description={quizStatusLabel(page.quiz)}
          actions={
            quizIsOpen(page.quiz) ? (
              <CloseQuizButton quizId={page.quiz.id} classId={page.classId} deckId={page.deckId} />
            ) : null
          }
        />
        <section aria-labelledby="quiz-roster-heading" className="space-y-3">
          <h2 id="quiz-roster-heading" className="type-section">
            Students
          </h2>
          <p className="text-[12px] text-ink-muted">Alphabetical, not a ranking</p>
          {page.rows.length === 0 ? (
            <p className="type-helper">No students have joined this class yet.</p>
          ) : (
            <List>
              {page.rows.map((row) => (
                <ListRow
                  key={row.studentId}
                  leading={<Avatar name={row.name} />}
                  primary={row.name}
                  secondary={row.status === "in-progress" ? "In progress" : row.status === "not-taken" ? "Not yet" : undefined}
                  aside={
                    row.status === "finished" && row.correct !== null && row.total !== null ? (
                      <p className="font-mono text-[12px] tabular-nums text-ink-secondary">
                        {row.correct} of {row.total}
                      </p>
                    ) : null
                  }
                />
              ))}
            </List>
          )}
        </section>
      </div>
    );
  }

  if (page.kind === "closed") {
    return (
      <div className="space-y-4">
        <PageHeader
          back={{ href: `/classes/${page.classId}`, label: "Class" }}
          eyebrow="Quiz"
          title={page.quiz.title}
          description="This quiz is closed."
        />
        <ButtonLink href={`/classes/${page.classId}`} variant="secondary">
          Back to class
        </ButtonLink>
      </div>
    );
  }

  if (page.kind === "result") {
    return (
      <div className="space-y-5">
        <PageHeader
          back={{ href: `/classes/${page.classId}`, label: "Class" }}
          eyebrow="Quiz"
          title={page.quiz.title}
          description="This quiz does not change what you still need to study."
        />
        <p className="text-2xl font-semibold text-ink">
          {page.correct} of {page.total}
        </p>
        {page.missed.length > 0 ? (
          <section aria-labelledby="missed-heading" className="space-y-3">
            <h2 id="missed-heading" className="type-section">
              Questions to look at again
            </h2>
            <ul className="space-y-3">
              {page.missed.map((card, index) => (
                <li key={`${card.question}-${index}`} className="space-y-1 rounded-lg border border-border bg-surface p-4">
                  <p className="text-sm font-semibold text-ink [overflow-wrap:anywhere]">{card.question}</p>
                  <p className="text-sm text-ink-secondary [overflow-wrap:anywhere]">{card.expected}</p>
                </li>
              ))}
            </ul>
          </section>
        ) : (
          <p className="type-body">Every answer matched.</p>
        )}
      </div>
    );
  }

  return (
    <QuizTake
      quizId={page.quiz.id}
      classId={page.classId}
      title={page.quiz.title}
      mode={page.mode}
      cards={page.cards}
      answeredCount={page.answeredCount}
      total={page.total}
    />
  );
}
