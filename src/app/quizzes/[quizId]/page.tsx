import { Suspense } from "react";
import { notFound } from "next/navigation";
import { PageHeader, SectionHeader } from "@/components/layout/PageHeader";
import { PageContainer } from "@/components/layout/PageContainer";
import { CloseQuizButton } from "@/components/quiz/DeckQuizPanel";
import { QuizAccommodation } from "@/components/quiz/QuizAccommodation";
import { QuizStart } from "@/components/quiz/QuizStart";
import { QuizTake } from "@/components/quiz/QuizTake";
import { Badge } from "@/components/ui/Badge";
import { ButtonLink } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { Avatar, List, ListRow } from "@/components/ui/List";
import { LoadingState } from "@/components/ui/LoadingState";
import { getQuizPage, type QuizHeading, type QuizQuestionStat, type QuizRosterRow } from "@/lib/data/quizzes";
import { manilaDateKey } from "@/lib/progress-summary";
import { dueDayLabel, minutesLabel, opensLabel, quizIsOpen, quizStatusLabel, secondsLabel } from "@/lib/quiz";

export const metadata = { title: "Quiz | AutoFlash" };

type Params = Promise<{ quizId: string }>;
type SearchParams = Promise<{ q?: string | string[] }>;

export default function QuizPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  return (
    <PageContainer size="narrow" compact>
      <Suspense fallback={<LoadingState title="Loading this quiz…" />}>
        <QuizBody params={params} searchParams={searchParams} />
      </Suspense>
    </PageContainer>
  );
}

async function QuizBody({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const [{ quizId }, { q }] = await Promise.all([params, searchParams]);
  const asked = Number(Array.isArray(q) ? q[0] : q);
  const page = await getQuizPage(quizId, Number.isInteger(asked) && asked > 0 ? asked : null);
  if (page.kind === "missing") notFound();
  if (page.kind === "unavailable") {
    return (
      <Alert tone="warning" title="Quizzes need a database update">
        Run the latest SQL migration, then reload this page.
      </Alert>
    );
  }

  if (page.kind === "teacher") {
    const timer = page.quiz.timerMode === "none" ? null : page.quiz.timerMode;
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
        <ul className="type-helper list-disc space-y-1 pl-5">
          {settingsLines(page.quiz).map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <p className="type-body">{resultsLine(page.rows)}</p>
        <section aria-labelledby="quiz-roster-heading" className="space-y-3">
          <h2 id="quiz-roster-heading" className="type-section">
            Students
          </h2>
          <p className="text-[12px] text-ink-muted">
            Alphabetical, not a ranking. Scores and time per question are from each student&apos;s latest attempt.
            &ldquo;Left the page&rdquo; is a note, not a penalty: switching tabs, apps, or windows all count.
          </p>
          {page.rows.length === 0 ? (
            <p className="type-helper">No students have joined this class yet.</p>
          ) : (
            <List>
              {page.rows.map((row) => (
                <ListRow
                  key={row.studentId}
                  leading={<Avatar name={row.name} />}
                  primary={row.name}
                  secondary={rosterLine(row, page.quiz.maxAttempts, page.quiz.timerMode === "question")}
                  aside={
                    <span className="flex flex-wrap items-center justify-end gap-2">
                      {row.timesAway > 0 ? (
                        <Badge>
                          Left the page {row.timesAway === 1 ? "once" : `${row.timesAway} times`}
                        </Badge>
                      ) : null}
                      {row.late ? <Badge tone="warning">Late</Badge> : null}
                      {row.timedOut ? <Badge>Time ran out</Badge> : null}
                      {row.correct !== null && row.total !== null ? (
                        <span className="font-mono text-[12px] tabular-nums text-ink-secondary">
                          {row.correct} of {row.total}
                        </span>
                      ) : null}
                    </span>
                  }
                >
                  {quizIsOpen(page.quiz) ? (
                    <QuizAccommodation
                      quizId={page.quiz.id}
                      studentId={row.studentId}
                      name={row.name}
                      timer={timer}
                      hasDueDate={!!page.quiz.dueAt}
                      minDate={page.minDate}
                      maxDate={page.maxDate}
                      current={
                        row.extension
                          ? {
                              dueDate: row.extension.dueAt ? dueDateKey(row.extension.dueAt) : "",
                              extra:
                                timer === "question"
                                  ? row.extension.extraSeconds
                                  : Math.round(row.extension.extraSeconds / 60),
                            }
                          : null
                      }
                    />
                  ) : null}
                </ListRow>
              ))}
            </List>
          )}
        </section>
        {page.questions ? <MissedQuestions questions={page.questions} /> : null}
      </div>
    );
  }

  const back = { href: `/classes/${page.classId}`, label: "Class" };

  if (page.kind === "closed") {
    return (
      <div className="space-y-4">
        <PageHeader back={back} eyebrow="Quiz" title={page.quiz.title} description="This quiz is closed." />
        <ButtonLink href={`/classes/${page.classId}`} variant="secondary">
          Back to class
        </ButtonLink>
      </div>
    );
  }

  if (page.kind === "not-open") {
    const opens = opensLabel(page.opensAt);
    return (
      <div className="space-y-4">
        <PageHeader
          back={back}
          eyebrow="Quiz"
          title={page.quiz.title}
          description={opens ? `This quiz opens ${opens}.` : "This quiz is not open yet."}
        />
        <ButtonLink href={`/classes/${page.classId}`} variant="secondary">
          Back to class
        </ButtonLink>
      </div>
    );
  }

  if (page.kind === "start") {
    return (
      <div className="space-y-5">
        <PageHeader back={back} eyebrow="Quiz" title={page.quiz.title} description={quizStatusLabel(page.quiz)} />
        <ul className="type-body list-disc space-y-1 pl-5">
          {page.timeLimitSeconds !== null ? (
            <li>
              You have {minutesLabel(page.timeLimitSeconds)} once you start. The timer keeps running if you leave this page.
            </li>
          ) : null}
          {page.questionSeconds !== null ? (
            <li>
              You have {secondsLabel(page.questionSeconds)} for each question. When time runs out, what you typed is saved
              and the quiz moves on. The timer keeps running if you leave this page.
            </li>
          ) : null}
          <li>
            {page.allowBack
              ? "You can go back and change answers until you hand in the quiz."
              : "Questions come one at a time. You cannot go back to an earlier question."}
          </li>
          {page.maxAttempts > 1 ? (
            <li>
              This is attempt {page.attemptNumber} of {page.maxAttempts}.
            </li>
          ) : null}
          {page.allowBack ? null : <li>Each answer is saved as soon as you give it.</li>}
          <li>Leaving this page during the quiz is noted for your teacher. It does not change your score.</li>
          {page.late ? <li>The due date has passed. Answers you give now are marked late.</li> : null}
        </ul>
        <QuizStart quizId={page.quiz.id} label="Start quiz" warning={startWarning(page.quiz)} />
      </div>
    );
  }

  if (page.kind === "result") {
    const due = dueDayLabel(page.dueAt);
    const scored = page.released && page.correct !== null && page.total !== null ? { correct: page.correct, total: page.total } : null;
    const missedCount = scored ? scored.total - scored.correct : 0;
    return (
      <div className="max-w-3xl space-y-6">
        <PageHeader back={back} eyebrow="Quiz result" title={page.quiz.title} />
        <section aria-labelledby="score-heading" className="space-y-5 rounded-lg border border-border bg-surface p-5 sm:p-6">
          {scored ? (
            <div className="space-y-3">
              <h2 id="score-heading" className="text-[13px] font-medium text-ink-muted">
                Your score
              </h2>
              <p className="text-4xl font-semibold tracking-tight text-ink tabular-nums">
                {scored.correct} <span className="text-2xl font-medium text-ink-secondary">of {scored.total}</span>
              </p>
              {scored.total > 0 ? (
                <div
                  role="img"
                  aria-label={`${scored.correct} correct, ${missedCount} missed`}
                  className="flex h-2.5 overflow-hidden rounded-full bg-raised"
                >
                  <span className="bg-success-fill" style={{ width: `${(scored.correct / scored.total) * 100}%` }} />
                  <span className="bg-warning-fill" style={{ width: `${(missedCount / scored.total) * 100}%` }} />
                </div>
              ) : null}
              <p className="text-sm text-ink-secondary">
                {missedCount === 0
                  ? "Every answer matched."
                  : `${missedCount} ${missedCount === 1 ? "question" : "questions"} to look at again.`}
                {missedCount > 0 && page.missed.length === 0 ? " Questions you did not answer count as missed." : null}
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              <h2 id="score-heading" className="text-xl font-semibold text-ink">
                Answers saved
              </h2>
              <p className="text-sm text-ink-secondary">
                {page.quiz.latePolicy === "accept" || !due
                  ? "Your score appears when your teacher closes the quiz."
                  : `Your score appears after ${due}.`}
              </p>
            </div>
          )}
          {page.late || page.timedOut || page.maxAttempts > 1 ? (
            <div className="flex flex-wrap gap-2">
              {page.late ? <Badge tone="warning">Late</Badge> : null}
              {page.timedOut ? <Badge>Time ran out</Badge> : null}
              {page.maxAttempts > 1 ? (
                <Badge>
                  Attempt {page.attemptsUsed} of {page.maxAttempts}
                </Badge>
              ) : null}
            </div>
          ) : null}
          <div className="flex flex-wrap items-start gap-2 border-t border-border pt-5">
            <ButtonLink href={`/decks/${page.deckId}/study`}>Study this deck</ButtonLink>
            {page.canRetry ? (
              <QuizStart quizId={page.quiz.id} label="Try again" variant="secondary" warning={startWarning(page.quiz)} />
            ) : null}
            <ButtonLink href={back.href} variant="ghost">
              Back to class
            </ButtonLink>
          </div>
        </section>
        <p className="type-helper">This quiz does not change what you still need to study.</p>
        {scored && page.missed.length > 0 ? (
          <section aria-labelledby="missed-heading">
            <SectionHeader id="missed-heading" title="Questions to look at again" count={page.missed.length} />
            <ul className="space-y-3">
              {page.missed.map((card, index) => (
                <li key={`${card.question}-${index}`} className="space-y-3 rounded-lg border border-border bg-surface p-4">
                  <p className="text-base font-semibold text-ink [overflow-wrap:anywhere]">{card.question}</p>
                  <div className="space-y-0.5">
                    <p className="text-[13px] font-medium text-ink-muted">Correct answer</p>
                    <p className="text-sm text-ink [overflow-wrap:anywhere]">{card.expected}</p>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    );
  }

  return (
    <QuizTake
      key={page.question.cardId}
      quizId={page.quiz.id}
      classId={page.classId}
      title={page.quiz.title}
      question={page.question}
      serverNow={page.serverNow}
    />
  );
}

function startWarning(quiz: QuizHeading): string | undefined {
  if (quiz.timerMode === "quiz") {
    return "The timer starts as soon as you press Start now. It keeps running if you close this page or lose your connection.";
  }
  if (quiz.timerMode === "question") {
    return "Each question's timer starts when it appears and keeps running if you close this page or lose your connection.";
  }
  return undefined;
}

function settingsLines(quiz: QuizHeading): string[] {
  const opens = opensLabel(quiz.opensAt);
  return [
    opens ? `Opens ${opens}` : null,
    quiz.dueAt
      ? quiz.latePolicy === "accept"
        ? "Accepts answers after the due date and marks them late"
        : "Stops taking answers at the end of the due date"
      : null,
    quiz.timeLimitSeconds !== null
      ? `Time limit: ${minutesLabel(quiz.timeLimitSeconds)}`
      : quiz.questionSeconds !== null
        ? `${secondsLabel(quiz.questionSeconds)} for each question`
        : "No time limit",
    quiz.allowBack ? "Students can go back and change answers until they hand it in" : "One question at a time, no going back",
    quiz.maxAttempts > 1 ? `${quiz.maxAttempts} attempts allowed` : "One attempt",
    quiz.shuffleQuestions ? "Questions shuffled for each student" : null,
    quiz.shuffleChoices ? "Answer choices shuffled for each student" : null,
    quiz.resultsAfterDue
      ? "Scores hidden from students until results are released"
      : quiz.allowBack
        ? "Scores shown when the student hands it in"
        : "Scores shown right after each answer",
  ].filter((line): line is string => !!line);
}

function MissedQuestions({ questions }: { questions: QuizQuestionStat[] }) {
  const taken = questions[0]?.taken ?? 0;
  const missed = questions.filter((card) => card.missed > 0).sort((left, right) => right.missed - left.missed);
  return (
    <section aria-labelledby="quiz-missed-heading" className="space-y-3">
      <h2 id="quiz-missed-heading" className="type-section">
        Questions students missed
      </h2>
      {taken === 0 ? (
        <p className="type-helper">This fills in once a student finishes the quiz.</p>
      ) : missed.length === 0 ? (
        <p className="type-helper">Every student who finished answered every question correctly.</p>
      ) : (
        <>
          <p className="text-[12px] text-ink-muted">
            Most missed first. Out of {taken === 1 ? "1 student" : `${taken} students`} who finished. Blank answers count as
            missed.
          </p>
          <List>
            {missed.map((card) => (
              <ListRow
                key={card.cardId}
                primary={card.question}
                secondary={`Answer: ${card.expected}`}
                aside={
                  <span className="font-mono text-[12px] tabular-nums text-ink-secondary">
                    {card.missed} of {card.taken} missed
                  </span>
                }
              />
            ))}
          </List>
        </>
      )}
    </section>
  );
}

function resultsLine(rows: QuizRosterRow[]): string {
  if (rows.length === 0) return "No students yet.";
  const finished = rows.filter((row) => row.status === "finished");
  const inProgress = rows.filter((row) => row.status === "in-progress").length;
  const late = rows.filter((row) => row.late).length;
  const scored = finished.filter((row) => row.correct !== null && row.total);
  const average =
    scored.length > 0
      ? Math.round((scored.reduce((sum, row) => sum + row.correct! / row.total!, 0) / scored.length) * 100)
      : null;
  return [
    `${finished.length} of ${rows.length} finished`,
    inProgress > 0 ? `${inProgress} in progress` : null,
    late > 0 ? `${late} late` : null,
    average !== null ? `Average score ${average}%` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

function rosterLine(row: QuizRosterRow, maxAttempts: number, perQuestion: boolean): string {
  const extra = row.extension?.extraSeconds ?? 0;
  const parts = [
    row.status === "in-progress" ? "In progress" : row.status === "not-taken" ? "Not yet" : "Finished",
    maxAttempts > 1 && row.attempts > 0 ? `Attempt ${row.attempts} of ${maxAttempts}` : null,
    row.avgSeconds !== null ? `About ${durationLabel(row.avgSeconds)} per question` : null,
    row.secondsAway > 0 ? `Away ${durationLabel(row.secondsAway)} in total` : null,
    row.extension?.dueAt ? `Due ${dueDayLabel(row.extension.dueAt)}` : null,
    extra > 0 ? (perQuestion ? `+${secondsLabel(extra)} per question` : `+${minutesLabel(extra)}`) : null,
  ];
  return parts.filter(Boolean).join(" · ");
}

function durationLabel(seconds: number): string {
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))} s`;
  const minutes = Math.round(seconds / 60);
  return minutes === 1 ? "1 min" : `${minutes} min`;
}

function dueDateKey(dueAt: string): string {
  const end = new Date(dueAt);
  return Number.isNaN(end.getTime()) ? "" : manilaDateKey(new Date(end.getTime() - 1));
}
