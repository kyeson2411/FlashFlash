import "server-only";
import type { Flashcard } from "@/lib/deck";
import { needStudent } from "@/lib/auth/session";
import { manilaDateKey } from "@/lib/progress-summary";
import { createClient } from "@/lib/supabase/server";
import {
  dueCloseInstant,
  quizIsOpen,
  quizMode,
  quizStatusLabel,
  sortWaiting,
  type DeckQuizOffer,
  type QuizLatePolicy,
  type QuizQuestion,
  type QuizSchedule,
  type QuizSettings,
  type QuizSettingsInput,
  type QuizTimerMode,
  type QuizWindow,
} from "@/lib/quiz";

export type { DeckQuizOffer, QuizQuestion };

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const MIGRATION_ERROR = "Quizzes need a database update. Run the latest SQL migration, then try again.";

const QUIZ_COLUMNS =
  "id, class_id, deck_id, title, due_at, closed_at, created_at, opens_at, late_policy, timer_mode, time_limit_seconds, max_attempts, shuffle_questions, shuffle_choices, allow_back, results_after_due";

export class QuizError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QuizError";
  }
}

export type StudentQuizAttempt = {
  attemptsUsed: number;
  maxAttempts: number;
  finishedCount: number;
  inProgress: boolean;
  released: boolean;
  correct: number | null;
  total: number | null;
  late: boolean;
};

export type ClassQuizRow = QuizSchedule & {
  id: string;
  title: string;
  /** Students only. Decided by the server for this student, including any extension. */
  window: QuizWindow | null;
  attempt: StudentQuizAttempt | null;
};

/** A quiz the student has not finished yet: overdue, open, or opening later. */
export type WaitingQuiz = {
  id: string;
  title: string;
  className: string;
  window: QuizWindow;
  dueAt: string | null;
  opensAt: string | null;
  inProgress: boolean;
};

export type QuizRosterRow = {
  studentId: string;
  name: string;
  status: "finished" | "in-progress" | "not-taken";
  correct: number | null;
  total: number | null;
  attempts: number;
  late: boolean;
  timedOut: boolean;
  extension: { dueAt: string | null; extraSeconds: number } | null;
  /** Latest finished attempt. Null before the results migration or without timing data. */
  avgSeconds: number | null;
  /** Times the student left the quiz page during any attempt. A note, never a penalty. */
  timesAway: number;
  secondsAway: number;
};

export type QuizQuestionStat = {
  cardId: string;
  question: string;
  expected: string;
  /** Students with a finished attempt. */
  taken: number;
  missed: number;
};

export type QuizHeading = QuizSchedule & QuizSettings & { id: string; title: string };

export type QuizPage =
  | { kind: "missing" }
  | { kind: "unavailable" }
  | {
      kind: "teacher";
      classId: string;
      deckId: string;
      className: string;
      quiz: QuizHeading;
      rows: QuizRosterRow[];
      /** Null until the results migration has run. */
      questions: QuizQuestionStat[] | null;
      minDate: string;
      maxDate: string;
    }
  | { kind: "closed"; classId: string; quiz: QuizHeading }
  | { kind: "not-open"; classId: string; quiz: QuizHeading; opensAt: string | null }
  | {
      kind: "start";
      classId: string;
      quiz: QuizHeading;
      /** Includes this student's extra time. */
      timeLimitSeconds: number | null;
      questionSeconds: number | null;
      allowBack: boolean;
      attemptNumber: number;
      maxAttempts: number;
      late: boolean;
    }
  | {
      kind: "result";
      classId: string;
      quiz: QuizHeading;
      released: boolean;
      correct: number | null;
      total: number | null;
      missed: { question: string; expected: string }[];
      late: boolean;
      timedOut: boolean;
      attemptsUsed: number;
      maxAttempts: number;
      canRetry: boolean;
      dueAt: string | null;
    }
  | {
      kind: "take";
      classId: string;
      quiz: QuizHeading;
      question: QuizQuestion;
      serverNow: string;
      resultsHidden: boolean;
    };

export type QuizAnswerSaved = {
  correct: boolean | null;
  expected: string | null;
  finished: boolean;
  /** The whole-quiz timer ran out. */
  timedOut: boolean;
  /** This question's own timer ran out, so a blank was saved. */
  questionTimedOut: boolean;
  late: boolean;
  correctCount: number | null;
  total: number | null;
};

export type QuizHandedIn = { timedOut: boolean; correctCount: number | null; total: number | null };

type QuizRow = {
  id: string;
  class_id: string;
  deck_id: string;
  title: string;
  due_at: string | null;
  closed_at: string | null;
  created_at?: string;
  opens_at?: string | null;
  late_policy?: string | null;
  timer_mode?: string | null;
  time_limit_seconds?: number | null;
  max_attempts?: number | null;
  shuffle_questions?: boolean | null;
  shuffle_choices?: boolean | null;
  allow_back?: boolean | null;
  results_after_due?: boolean | null;
};

type AttemptRow = {
  student_id: string;
  attempt_number: number;
  finished_at: string | null;
  correct_count: number | null;
  total_count: number | null;
  late: boolean;
  timed_out: boolean;
};

export async function getDeckQuizOffer(deckId: string, cards: Flashcard[]): Promise<DeckQuizOffer> {
  await needStudent();
  if (!UUID_RE.test(deckId)) return { available: false };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("quizzes")
    .select("id, due_at, closed_at, opens_at, late_policy")
    .eq("deck_id", deckId)
    .is("closed_at", null)
    .order("created_at", { ascending: false });

  if (error) {
    if (missingQuizStore(error)) return { available: false };
    console.error("[quizzes] deck offer:", error.message);
    throw new QuizError("Could not load the quiz for this deck.");
  }

  const now = new Date();
  const open = ((data ?? []) as QuizRow[]).map(scheduleOf).find((quiz) => quizIsOpen(quiz, now));
  const minDate = manilaDateKey(now);
  const mode = quizMode(cards);

  return {
    available: true,
    ready: mode !== null,
    choice: mode === "choice",
    minDate,
    maxDate: shiftDateKey(minDate, 366),
    openQuiz: open ? { id: open.id, status: quizStatusLabel(open, now) } : null,
  };
}

export async function giveQuiz(deckId: string, dueDate: string, settings: QuizSettingsInput): Promise<string> {
  await needStudent();
  if (!UUID_RE.test(deckId)) throw new QuizError("That deck is no longer available.");
  const dueAt = dueDate ? dueCloseInstant(dueDate) : null;
  if (dueDate && !dueAt) throw new QuizError("Choose today or a later day.");

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("give_class_quiz", {
    p_deck_id: deckId,
    p_due_at: dueAt,
    p_settings: settings,
  });
  if (error) throw new QuizError(quizError(error, "This quiz could not be given. Please try again."));
  if (typeof data !== "string" || !UUID_RE.test(data)) throw new QuizError("This quiz could not be given. Please try again.");
  return data;
}

export async function closeQuiz(quizId: string): Promise<void> {
  await needStudent();
  if (!UUID_RE.test(quizId)) throw new QuizError("That quiz is not available.");
  const supabase = await createClient();
  const { error } = await supabase.rpc("close_class_quiz", { p_quiz_id: quizId });
  if (error) throw new QuizError(quizError(error, "This quiz could not be closed. Please try again."));
}

export async function startQuizAttempt(quizId: string): Promise<void> {
  await needStudent();
  if (!UUID_RE.test(quizId)) throw new QuizError("That quiz is not available.");
  const supabase = await createClient();
  const { error } = await supabase.rpc("start_quiz_attempt", { p_quiz_id: quizId });
  if (error) throw new QuizError(quizError(error, "This quiz could not be started. Please try again."));
}

export async function setQuizAccommodation(
  quizId: string,
  studentId: string,
  dueDate: string,
  extraSeconds: number,
): Promise<void> {
  await needStudent();
  if (!UUID_RE.test(quizId) || !UUID_RE.test(studentId)) throw new QuizError("That quiz is not available.");
  if (!Number.isInteger(extraSeconds) || extraSeconds < 0 || extraSeconds > 14_400) {
    throw new QuizError("Choose up to 240 extra minutes.");
  }
  const dueAt = dueDate ? dueCloseInstant(dueDate) : null;
  if (dueDate && !dueAt) throw new QuizError("Choose a day after the quiz due date.");

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_quiz_accommodation", {
    p_quiz_id: quizId,
    p_student_id: studentId,
    p_due_at: dueAt,
    p_extra_seconds: extraSeconds,
  });
  if (error) throw new QuizError(quizError(error, "This change could not be saved. Please try again."));
}

/** timeout: the question's own timer ran out on screen. The server checks it. */
export async function answerQuiz(
  quizId: string,
  cardId: string,
  given: string,
  timeout: boolean,
): Promise<QuizAnswerSaved> {
  await needStudent();
  if (!UUID_RE.test(quizId) || !UUID_RE.test(cardId)) throw new QuizError("That card is not in this quiz.");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("submit_quiz_answer", {
    p_quiz_id: quizId,
    p_card_id: cardId,
    p_given: given,
    p_timeout: timeout,
  });
  if (error) throw new QuizError(quizError(error, "Your answer could not be saved. Please try again."));
  const payload = asRecord(data);
  if (!payload || typeof payload.finished !== "boolean") {
    throw new QuizError("Your answer could not be saved. Please try again.");
  }
  return {
    correct: typeof payload.correct === "boolean" ? payload.correct : null,
    expected: typeof payload.expected === "string" ? payload.expected : null,
    finished: payload.finished,
    timedOut: payload.timedOut === true,
    questionTimedOut: payload.questionTimedOut === true,
    late: payload.late === true,
    correctCount: typeof payload.correctCount === "number" ? payload.correctCount : null,
    total: typeof payload.total === "number" ? payload.total : null,
  };
}

/** Notes that the student left (away) or came back to the quiz page. Failures are ignored. */
export async function logQuizFocus(quizId: string, away: boolean): Promise<void> {
  await needStudent();
  if (!UUID_RE.test(quizId)) return;
  const supabase = await createClient();
  const { error } = await supabase.rpc("log_quiz_focus", { p_quiz_id: quizId, p_away: away });
  if (error && !missingQuizStore(error)) console.error("[quizzes] focus:", error.message);
}

export async function handInQuiz(quizId: string): Promise<QuizHandedIn> {
  await needStudent();
  if (!UUID_RE.test(quizId)) throw new QuizError("That quiz is not available.");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("submit_quiz_attempt", { p_quiz_id: quizId });
  if (error) throw new QuizError(quizError(error, "This quiz could not be handed in. Please try again."));
  const payload = asRecord(data);
  if (!payload || payload.finished !== true) throw new QuizError("This quiz could not be handed in. Please try again.");
  return {
    timedOut: payload.timedOut === true,
    correctCount: typeof payload.correctCount === "number" ? payload.correctCount : null,
    total: typeof payload.total === "number" ? payload.total : null,
  };
}

export async function listClassQuizzes(classId: string): Promise<ClassQuizRow[] | null> {
  const student = await needStudent();
  if (!UUID_RE.test(classId)) return [];
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("quizzes")
    .select(QUIZ_COLUMNS)
    .eq("class_id", classId)
    .order("created_at", { ascending: false });

  if (error) {
    if (missingQuizStore(error)) return null;
    console.error("[quizzes] class list:", error.message);
    throw new QuizError("Could not load quizzes.");
  }

  const rows = (data ?? []) as QuizRow[];
  if (student.role === "teacher" || rows.length === 0) {
    return rows.map((row) => ({ ...scheduleOf(row), title: String(row.title), window: null, attempt: null }));
  }

  const summaries = await loadSummaries(rows.map((row) => String(row.id)));
  if (!summaries) return null;
  return rows.map((row) => {
    const mine = summaries.get(String(row.id));
    return {
      ...scheduleOf(row),
      dueAt: mine ? mine.dueAt : row.due_at ? String(row.due_at) : null,
      title: String(row.title),
      window: mine?.window ?? "closed",
      attempt: mine?.attempt ?? null,
    };
  });
}

export async function listWaitingQuizzes(): Promise<WaitingQuiz[] | null> {
  const student = await needStudent();
  if (student.role === "teacher") return [];
  const supabase = await createClient();
  const { data: memberships, error: memberError } = await supabase
    .from("class_members")
    .select("class_id")
    .eq("student_id", student.id);
  if (memberError) {
    console.error("[quizzes] memberships:", memberError.message);
    return [];
  }
  const classIds = (memberships ?? []).map((row) => String(row.class_id));
  if (classIds.length === 0) return [];

  const { data, error } = await supabase
    .from("quizzes")
    .select("id, class_id, title, due_at, closed_at, opens_at")
    .in("class_id", classIds)
    .is("closed_at", null)
    .order("created_at", { ascending: false });
  if (error) {
    if (missingQuizStore(error)) return null;
    console.error("[quizzes] waiting:", error.message);
    return [];
  }

  const rows = (data ?? []) as QuizRow[];
  if (rows.length === 0) return [];
  const summaries = await loadSummaries(rows.map((row) => String(row.id)));
  if (!summaries) return null;

  const waiting = rows.filter((row) => {
    const mine = summaries.get(String(row.id));
    return !!mine && mine.window !== "closed" && (mine.attempt?.finishedCount ?? 0) === 0;
  });
  if (waiting.length === 0) return [];

  const { data: classes, error: classError } = await supabase
    .from("classes")
    .select("id, name")
    .in("id", [...new Set(waiting.map((row) => String(row.class_id)))]);
  if (classError) {
    console.error("[quizzes] class names:", classError.message);
    return [];
  }
  const names = new Map((classes ?? []).map((row) => [String(row.id), String(row.name)]));

  return sortWaiting(
    waiting.map((row) => {
      const mine = summaries.get(String(row.id));
      return {
        id: String(row.id),
        title: String(row.title),
        className: names.get(String(row.class_id)) ?? "Class",
        window: mine?.window ?? "closed",
        dueAt: mine?.dueAt ?? null,
        opensAt: row.opens_at ? String(row.opens_at) : null,
        inProgress: mine?.attempt?.inProgress === true,
      };
    }),
  );
}

/** position: the question a student asked for, used only when the quiz lets them go back. */
export async function getQuizPage(quizId: string, position: number | null = null, retried = false): Promise<QuizPage> {
  const student = await needStudent();
  if (!UUID_RE.test(quizId)) return { kind: "missing" };
  const supabase = await createClient();

  if (student.role === "teacher") {
    const finalized = await supabase.rpc("finalize_quiz_attempts", { p_quiz_id: quizId });
    if (finalized.error && !/not available/i.test(finalized.error.message)) {
      if (missingQuizStore(finalized.error)) return { kind: "unavailable" };
      console.error("[quizzes] finalize:", finalized.error.message);
    }
  }

  const { data, error } = await supabase.from("quizzes").select(QUIZ_COLUMNS).eq("id", quizId).maybeSingle();
  if (error) {
    if (missingQuizStore(error)) return { kind: "unavailable" };
    console.error("[quizzes] page:", error.message);
    throw new QuizError("Could not load this quiz.");
  }
  if (!data) return { kind: "missing" };

  const row = data as QuizRow;
  const quiz = headingOf(row);
  const classId = String(row.class_id);

  if (student.role === "teacher") {
    const now = new Date();
    const minDate = manilaDateKey(now);
    const [className, results] = await Promise.all([classNameOf(classId), teacherResults(quiz.id)]);
    return {
      kind: "teacher",
      classId,
      deckId: String(row.deck_id),
      className,
      quiz,
      rows: await roster(classId, quiz.id, results?.students ?? new Map()),
      questions: results?.questions ?? null,
      minDate,
      maxDate: shiftDateKey(minDate, 366),
    };
  }

  const { data: stateData, error: stateError } = await supabase.rpc("quiz_student_state", { p_quiz_id: quiz.id });
  if (stateError) {
    if (missingQuizStore(stateError)) return { kind: "unavailable" };
    if (/not available/i.test(stateError.message)) return { kind: "missing" };
    console.error("[quizzes] state:", stateError.message);
    throw new QuizError("Could not load this quiz.");
  }
  const state = parseState(stateData);
  if (!state) throw new QuizError("Could not load this quiz.");
  const accepting = state.window === "open" || state.window === "late";
  const studentQuiz: QuizHeading = { ...quiz, dueAt: state.dueAt };

  const firstUntimed = state.timerMode === "none" && state.attemptsUsed === 0;
  if (accepting && (state.current || firstUntimed)) {
    const take = await takePage(classId, studentQuiz, state, position);
    if (take !== "finished") return take;
    if (!retried) return getQuizPage(quizId, null, true);
    throw new QuizError("Could not load this quiz.");
  }

  if (state.latest) {
    return {
      kind: "result",
      classId,
      quiz: studentQuiz,
      released: state.released,
      correct: state.latest.correct,
      total: state.latest.total,
      missed: state.latest.missed ?? [],
      late: state.latest.late,
      timedOut: state.latest.timedOut,
      attemptsUsed: state.attemptsUsed,
      maxAttempts: state.maxAttempts,
      canRetry: accepting && !state.current && state.attemptsUsed < state.maxAttempts,
      dueAt: state.dueAt,
    };
  }

  if (state.window === "not_open") return { kind: "not-open", classId, quiz: studentQuiz, opensAt: state.opensAt };
  if (!accepting) return { kind: "closed", classId, quiz: studentQuiz };

  return {
    kind: "start",
    classId,
    quiz: studentQuiz,
    timeLimitSeconds: state.timeLimitSeconds,
    questionSeconds: state.questionSeconds,
    allowBack: state.allowBack,
    attemptNumber: state.attemptsUsed + 1,
    maxAttempts: state.maxAttempts,
    late: state.window === "late",
  };
}

type StudentState = {
  window: QuizWindow;
  now: string;
  opensAt: string | null;
  dueAt: string | null;
  timerMode: QuizTimerMode;
  timeLimitSeconds: number | null;
  questionSeconds: number | null;
  allowBack: boolean;
  maxAttempts: number;
  attemptsUsed: number;
  resultsAfterDue: boolean;
  released: boolean;
  current: { attemptNumber: number; deadline: string | null; answeredCount: number } | null;
  latest: {
    correct: number | null;
    total: number | null;
    late: boolean;
    timedOut: boolean;
    missed: { question: string; expected: string }[] | null;
  } | null;
};

/** "finished" means the attempt ended on the server while loading, so the state is stale. */
async function takePage(
  classId: string,
  quiz: QuizHeading,
  state: StudentState,
  position: number | null,
): Promise<QuizPage | "finished"> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("quiz_current_question", {
    p_quiz_id: quiz.id,
    p_position: position,
  });
  if (error) {
    if (missingQuizStore(error)) return { kind: "unavailable" };
    if (/closed|not open|finished|start the quiz/i.test(error.message)) return "finished";
    console.error("[quizzes] question:", error.message);
    throw new QuizError("Could not load this quiz.");
  }
  const payload = asRecord(data);
  if (!payload || payload.finished === true) return "finished";
  const question = parseQuestion(payload);
  if (!question) throw new QuizError("Could not load this quiz.");

  return {
    kind: "take",
    classId,
    quiz,
    question,
    serverNow: typeof payload.now === "string" ? payload.now : state.now,
    resultsHidden: state.resultsAfterDue,
  };
}

function parseQuestion(row: Record<string, unknown>): QuizQuestion | null {
  if (typeof row.cardId !== "string" || typeof row.question !== "string") return null;
  const options =
    Array.isArray(row.options) && row.options.length > 0 && row.options.every((option) => typeof option === "string")
      ? (row.options as string[])
      : null;
  return {
    cardId: row.cardId,
    position: Number(row.position ?? 1),
    total: Number(row.total ?? 1),
    answeredCount: Number(row.answeredCount ?? 0),
    question: row.question,
    options,
    given: typeof row.given === "string" ? row.given : null,
    deadline: typeof row.deadline === "string" ? row.deadline : null,
    questionTimer: row.questionTimer === true,
    allowBack: row.allowBack === true,
    feedback: row.feedback === true,
    late: row.late === true,
  };
}

async function loadSummaries(
  quizIds: string[],
): Promise<Map<string, { window: QuizWindow; dueAt: string | null; attempt: StudentQuizAttempt | null }> | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("my_quiz_summaries", { p_quiz_ids: quizIds });
  if (error) {
    if (missingQuizStore(error)) return null;
    console.error("[quizzes] summaries:", error.message);
    throw new QuizError("Could not load quizzes.");
  }
  const parsed = parseJson(data);
  const map = new Map<string, { window: QuizWindow; dueAt: string | null; attempt: StudentQuizAttempt | null }>();
  if (!Array.isArray(parsed)) return map;
  for (const item of parsed) {
    const row = asRecord(item);
    if (!row || typeof row.quizId !== "string") continue;
    const attemptsUsed = Number(row.attemptsUsed ?? 0);
    map.set(row.quizId, {
      window: windowOf(row.window),
      dueAt: typeof row.dueAt === "string" ? row.dueAt : null,
      attempt:
        attemptsUsed > 0
          ? {
              attemptsUsed,
              maxAttempts: Number(row.maxAttempts ?? 1),
              finishedCount: Number(row.finishedCount ?? 0),
              inProgress: row.inProgress === true,
              released: row.released === true,
              correct: typeof row.correct === "number" ? row.correct : null,
              total: typeof row.total === "number" ? row.total : null,
              late: row.late === true,
            }
          : null,
    });
  }
  return map;
}

type StudentStat = { avgSeconds: number | null; timesAway: number; secondsAway: number };

async function teacherResults(
  quizId: string,
): Promise<{ students: Map<string, StudentStat>; questions: QuizQuestionStat[] } | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("quiz_teacher_results", { p_quiz_id: quizId });
  if (error) {
    if (!missingQuizStore(error)) console.error("[quizzes] results:", error.message);
    return null;
  }
  const payload = asRecord(data);
  if (!payload) return null;

  const students = new Map<string, StudentStat>();
  for (const item of Array.isArray(payload.students) ? payload.students : []) {
    const stat = asRecord(item);
    if (!stat || typeof stat.studentId !== "string") continue;
    const avg = Number(stat.avgSeconds);
    students.set(stat.studentId, {
      avgSeconds: stat.avgSeconds !== null && Number.isFinite(avg) ? avg : null,
      timesAway: Number(stat.timesAway ?? 0) || 0,
      secondsAway: Number(stat.secondsAway ?? 0) || 0,
    });
  }

  const questions = (Array.isArray(payload.questions) ? payload.questions : []).flatMap((item) => {
    const stat = asRecord(item);
    if (!stat || typeof stat.cardId !== "string" || typeof stat.question !== "string") return [];
    return [
      {
        cardId: stat.cardId,
        question: stat.question,
        expected: typeof stat.expected === "string" ? stat.expected : "",
        taken: Number(stat.taken ?? 0) || 0,
        missed: Number(stat.missed ?? 0) || 0,
      },
    ];
  });
  return { students, questions };
}

async function roster(classId: string, quizId: string, stats: Map<string, StudentStat>): Promise<QuizRosterRow[]> {
  const supabase = await createClient();
  const { data: members, error } = await supabase
    .from("class_members")
    .select("student_id, status")
    .eq("class_id", classId);
  if (error) {
    console.error("[quizzes] roster:", error.message);
    throw new QuizError("Could not load who has finished.");
  }
  const studentIds = (members ?? []).filter((row) => row.status !== "pending").map((row) => String(row.student_id));
  if (studentIds.length === 0) return [];

  const [profiles, attempts, extensions] = await Promise.all([
    supabase.from("profiles").select("id, full_name").in("id", studentIds),
    supabase
      .from("quiz_attempts")
      .select("student_id, attempt_number, finished_at, correct_count, total_count, late, timed_out")
      .eq("quiz_id", quizId),
    supabase.from("quiz_accommodations").select("student_id, due_at, extra_seconds").eq("quiz_id", quizId),
  ]);
  const failed = profiles.error ?? attempts.error ?? extensions.error;
  if (failed) {
    console.error("[quizzes] roster detail:", failed.message);
    throw new QuizError("Could not load who has finished.");
  }

  const names = new Map((profiles.data ?? []).map((row) => [String(row.id), String(row.full_name)]));
  const byStudent = new Map<string, AttemptRow[]>();
  for (const attempt of (attempts.data ?? []) as AttemptRow[]) {
    const list = byStudent.get(String(attempt.student_id)) ?? [];
    list.push(attempt);
    byStudent.set(String(attempt.student_id), list);
  }
  const extensionBy = new Map(
    (extensions.data ?? []).map((row) => [
      String(row.student_id),
      { dueAt: row.due_at ? String(row.due_at) : null, extraSeconds: Number(row.extra_seconds ?? 0) },
    ]),
  );

  return studentIds
    .map((studentId) => {
      const list = byStudent.get(studentId) ?? [];
      const latest = list
        .filter((attempt) => attempt.finished_at)
        .sort((left, right) => right.attempt_number - left.attempt_number)[0];
      const status: QuizRosterRow["status"] = list.some((attempt) => !attempt.finished_at)
        ? "in-progress"
        : latest
          ? "finished"
          : "not-taken";
      return {
        studentId,
        name: names.get(studentId) || "Student",
        status,
        correct: latest?.correct_count ?? null,
        total: latest?.total_count ?? null,
        attempts: list.length,
        late: list.some((attempt) => attempt.late),
        timedOut: !!latest?.timed_out,
        extension: extensionBy.get(studentId) ?? null,
        avgSeconds: stats.get(studentId)?.avgSeconds ?? null,
        timesAway: stats.get(studentId)?.timesAway ?? 0,
        secondsAway: stats.get(studentId)?.secondsAway ?? 0,
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name) || left.studentId.localeCompare(right.studentId));
}

async function classNameOf(classId: string): Promise<string> {
  const supabase = await createClient();
  const { data } = await supabase.from("classes").select("name").eq("id", classId).maybeSingle();
  return data?.name ? String(data.name) : "Class";
}

function scheduleOf(row: QuizRow): QuizSchedule & { id: string } {
  return {
    id: String(row.id),
    dueAt: row.due_at ? String(row.due_at) : null,
    closedAt: row.closed_at ? String(row.closed_at) : null,
    opensAt: row.opens_at ? String(row.opens_at) : null,
    latePolicy: latePolicyOf(row.late_policy),
  };
}

function headingOf(row: QuizRow): QuizHeading {
  const seconds = typeof row.time_limit_seconds === "number" ? row.time_limit_seconds : null;
  const timerMode = seconds === null ? "none" : timerModeOf(row.timer_mode ?? "quiz");
  return {
    ...scheduleOf(row),
    title: String(row.title),
    opensAt: row.opens_at ? String(row.opens_at) : null,
    latePolicy: latePolicyOf(row.late_policy),
    timerMode,
    timeLimitSeconds: timerMode === "quiz" ? seconds : null,
    questionSeconds: timerMode === "question" ? seconds : null,
    maxAttempts: typeof row.max_attempts === "number" ? row.max_attempts : 1,
    shuffleQuestions: row.shuffle_questions === true,
    shuffleChoices: row.shuffle_choices === true,
    allowBack: row.allow_back === true,
    resultsAfterDue: row.results_after_due === true,
  };
}

function latePolicyOf(value: unknown): QuizLatePolicy {
  return value === "accept" ? "accept" : "block";
}

function timerModeOf(value: unknown): QuizTimerMode {
  return value === "quiz" || value === "question" ? value : "none";
}

function windowOf(value: unknown): QuizWindow {
  return value === "not_open" || value === "open" || value === "late" ? value : "closed";
}

function parseState(value: unknown): StudentState | null {
  const row = asRecord(value);
  if (!row) return null;
  const current = asRecord(row.current);
  const latest = asRecord(row.latest);
  return {
    window: windowOf(row.window),
    now: typeof row.now === "string" ? row.now : new Date().toISOString(),
    opensAt: typeof row.opensAt === "string" ? row.opensAt : null,
    dueAt: typeof row.dueAt === "string" ? row.dueAt : null,
    timerMode: timerModeOf(row.timerMode ?? (typeof row.timeLimitSeconds === "number" ? "quiz" : "none")),
    timeLimitSeconds: typeof row.timeLimitSeconds === "number" ? row.timeLimitSeconds : null,
    questionSeconds: typeof row.questionSeconds === "number" ? row.questionSeconds : null,
    allowBack: row.allowBack === true,
    maxAttempts: Number(row.maxAttempts ?? 1),
    attemptsUsed: Number(row.attemptsUsed ?? 0),
    resultsAfterDue: row.resultsAfterDue === true,
    released: row.released === true,
    current: current
      ? {
          attemptNumber: Number(current.attemptNumber ?? 1),
          deadline: typeof current.deadline === "string" ? current.deadline : null,
          answeredCount: Number(current.answeredCount ?? 0),
        }
      : null,
    latest: latest
      ? {
          correct: typeof latest.correct === "number" ? latest.correct : null,
          total: typeof latest.total === "number" ? latest.total : null,
          late: latest.late === true,
          timedOut: latest.timedOut === true,
          missed: Array.isArray(latest.missed)
            ? latest.missed.flatMap((item) => {
                const missed = asRecord(item);
                return missed && typeof missed.question === "string" && typeof missed.expected === "string"
                  ? [{ question: missed.question, expected: missed.expected }]
                  : [];
              })
            : null,
        }
      : null,
  };
}

function parseJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  const parsed = parseJson(value);
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  return null;
}

function missingQuizStore(error: { code?: string; message?: string }): boolean {
  const message = error.message ?? "";
  return (
    error.code === "42P01" ||
    error.code === "42703" ||
    error.code === "PGRST205" ||
    error.code === "PGRST202" ||
    /schema cache|does not exist/i.test(message)
  );
}

function quizError(error: { code?: string; message?: string }, fallback: string): string {
  if (missingQuizStore(error)) return MIGRATION_ERROR;
  const message = error.message ?? "";
  const known = [
    "This deck already has an open quiz.",
    "This quiz is closed.",
    "This quiz is not open yet.",
    "This quiz is already finished.",
    "This quiz is already closed.",
    "Start the quiz first.",
    "You have used every attempt for this quiz.",
    "Enter an answer.",
    "That card is not in this quiz.",
    "Choose today or a later day.",
    "Only the teacher of this class can give a quiz.",
    "This deck has no cards.",
    "Publish this deck before giving it as a quiz.",
    "Check the quiz settings.",
    "Choose a time limit from 1 to 240 minutes.",
    "Choose from 1 to 10 attempts.",
    "Choose an open time within a year.",
    "Choose an open time before the due date.",
    "Choose up to 240 extra minutes.",
    "Choose up to 600 extra seconds for each question.",
    "Choose from 10 to 600 seconds for each question.",
    "Going back is not available with a timer on each question.",
    "This question is no longer open. Reload the quiz to continue.",
    "This quiz has no time limit.",
    "Choose a day after the quiz due date.",
    "That student is no longer in this class.",
    "That quiz is not available.",
  ];
  return known.find((item) => message.includes(item)) ?? fallback;
}

function shiftDateKey(key: string, days: number): string {
  const [year, month, day] = key.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
