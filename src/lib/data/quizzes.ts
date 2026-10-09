import "server-only";
import type { Flashcard } from "@/lib/deck";
import { needStudent } from "@/lib/auth/session";
import { manilaDateKey } from "@/lib/progress-summary";
import { createClient } from "@/lib/supabase/server";
import {
  dueCloseInstant,
  dueDayLabel,
  quizIsOpen,
  quizMode,
  type DeckQuizOffer,
  type QuizAnswerMode,
  type QuizCardView,
  type QuizSchedule,
} from "@/lib/quiz";

export type { DeckQuizOffer, QuizCardView };

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const MIGRATION_ERROR = "Quizzes need a database update. Run the latest SQL migration, then try again.";

export class QuizError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QuizError";
  }
}

export type ClassQuizRow = QuizSchedule & {
  id: string;
  title: string;
  attempt: { finishedAt: string | null; correct: number | null; total: number | null } | null;
};

export type WaitingQuiz = {
  id: string;
  title: string;
  className: string;
  dueLabel: string | null;
};

export type QuizRosterRow = {
  studentId: string;
  name: string;
  status: "finished" | "in-progress" | "not-taken";
  correct: number | null;
  total: number | null;
};

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
    }
  | { kind: "closed"; classId: string; quiz: QuizHeading }
  | {
      kind: "result";
      classId: string;
      quiz: QuizHeading;
      correct: number;
      total: number;
      missed: { question: string; expected: string }[];
    }
  | {
      kind: "take";
      classId: string;
      quiz: QuizHeading;
      mode: QuizAnswerMode;
      cards: QuizCardView[];
      answeredCount: number;
      total: number;
    };

export type QuizHeading = QuizSchedule & { id: string; title: string };

type QuizRow = {
  id: string;
  class_id: string;
  deck_id: string;
  title: string;
  cards?: unknown;
  due_at: string | null;
  closed_at: string | null;
  created_at?: string;
};

type AttemptRow = {
  quiz_id?: string;
  student_id?: string;
  finished_at: string | null;
  correct_count: number | null;
  total_count: number | null;
};

export async function getDeckQuizOffer(deckId: string, cards: Flashcard[]): Promise<DeckQuizOffer> {
  await needStudent();
  if (!UUID_RE.test(deckId)) return { available: false };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("quizzes")
    .select("id, due_at, closed_at")
    .eq("deck_id", deckId)
    .is("closed_at", null)
    .order("created_at", { ascending: false });

  if (error) {
    if (missingQuizStore(error)) return { available: false };
    console.error("[quizzes] deck offer:", error.message);
    throw new QuizError("Could not load the quiz for this deck.");
  }

  const now = new Date();
  const open = (data ?? [])
    .map((row) => ({
      id: String(row.id),
      dueAt: row.due_at ? String(row.due_at) : null,
      closedAt: row.closed_at ? String(row.closed_at) : null,
    }))
    .find((quiz) => quizIsOpen(quiz, now));

  const minDate = manilaDateKey(now);
  const maxDate = shiftDateKey(minDate, 366);

  return {
    available: true,
    ready: quizMode(cards) !== null,
    minDate,
    maxDate,
    openQuiz: open ? { id: open.id, dueLabel: dueDayLabel(open.dueAt) } : null,
  };
}

export async function giveQuiz(deckId: string, dueDate: string): Promise<string> {
  await needStudent();
  if (!UUID_RE.test(deckId)) throw new QuizError("That deck is no longer available.");
  const dueAt = dueDate ? dueCloseInstant(dueDate) : null;
  if (dueDate && !dueAt) throw new QuizError("Choose today or a later day.");

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("give_class_quiz", {
    p_deck_id: deckId,
    p_due_at: dueAt,
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

export async function answerQuiz(
  quizId: string,
  cardId: string,
  given: string,
): Promise<{ correct: boolean; expected: string; finished: boolean; correctCount: number | null; total: number | null }> {
  await needStudent();
  if (!UUID_RE.test(quizId) || !UUID_RE.test(cardId)) throw new QuizError("That card is not in this quiz.");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("record_quiz_answer", {
    p_quiz_id: quizId,
    p_card_id: cardId,
    p_given: given,
  });
  if (error) throw new QuizError(quizError(error, "Your answer could not be saved. Please try again."));
  const payload = asRecord(data);
  if (!payload || typeof payload.correct !== "boolean" || typeof payload.expected !== "string" || typeof payload.finished !== "boolean") {
    throw new QuizError("Your answer could not be saved. Please try again.");
  }
  return {
    correct: payload.correct,
    expected: payload.expected,
    finished: payload.finished,
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
    .select("id, class_id, deck_id, title, due_at, closed_at, created_at")
    .eq("class_id", classId)
    .order("created_at", { ascending: false });

  if (error) {
    if (missingQuizStore(error)) return null;
    console.error("[quizzes] class list:", error.message);
    throw new QuizError("Could not load quizzes.");
  }

  const rows = (data ?? []) as QuizRow[];
  const attempts = new Map<string, AttemptRow>();
  if (student.role !== "teacher" && rows.length > 0) {
    const { data: attemptRows, error: attemptError } = await supabase
      .from("quiz_attempts")
      .select("quiz_id, finished_at, correct_count, total_count")
      .eq("student_id", student.id)
      .in(
        "quiz_id",
        rows.map((row) => row.id),
      );
    if (attemptError) {
      console.error("[quizzes] attempts:", attemptError.message);
      throw new QuizError("Could not load quizzes.");
    }
    for (const attempt of (attemptRows ?? []) as AttemptRow[]) {
      if (attempt.quiz_id) attempts.set(String(attempt.quiz_id), attempt);
    }
  }

  return rows.map((row) => {
    const attempt = attempts.get(String(row.id));
    return {
      id: String(row.id),
      title: String(row.title),
      dueAt: row.due_at ? String(row.due_at) : null,
      closedAt: row.closed_at ? String(row.closed_at) : null,
      attempt: attempt
        ? {
            finishedAt: attempt.finished_at ? String(attempt.finished_at) : null,
            correct: attempt.correct_count,
            total: attempt.total_count,
          }
        : null,
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
    .select("id, class_id, title, due_at, closed_at")
    .in("class_id", classIds)
    .order("created_at", { ascending: false });
  if (error) {
    if (missingQuizStore(error)) return null;
    console.error("[quizzes] waiting:", error.message);
    return [];
  }

  const rows = (data ?? []) as QuizRow[];
  const now = new Date();
  const open = rows.filter((row) =>
    quizIsOpen({ dueAt: row.due_at ? String(row.due_at) : null, closedAt: row.closed_at ? String(row.closed_at) : null }, now),
  );
  if (open.length === 0) return [];

  const { data: attemptRows, error: attemptError } = await supabase
    .from("quiz_attempts")
    .select("quiz_id, finished_at")
    .eq("student_id", student.id)
    .in(
      "quiz_id",
      open.map((row) => row.id),
    );
  if (attemptError) {
    console.error("[quizzes] waiting attempts:", attemptError.message);
    return [];
  }
  const finished = new Set(
    ((attemptRows ?? []) as { quiz_id: string; finished_at: string | null }[])
      .filter((row) => row.finished_at)
      .map((row) => String(row.quiz_id)),
  );
  const waiting = open.filter((row) => !finished.has(String(row.id)));
  if (waiting.length === 0) return [];

  const { data: classes, error: classError } = await supabase
    .from("classes")
    .select("id, name")
    .in(
      "id",
      [...new Set(waiting.map((row) => String(row.class_id)))],
    );
  if (classError) {
    console.error("[quizzes] class names:", classError.message);
    return [];
  }
  const names = new Map((classes ?? []).map((row) => [String(row.id), String(row.name)]));

  return waiting.map((row) => ({
    id: String(row.id),
    title: String(row.title),
    className: names.get(String(row.class_id)) ?? "Class",
    dueLabel: dueDayLabel(row.due_at ? String(row.due_at) : null),
  }));
}

export async function getQuizPage(quizId: string): Promise<QuizPage> {
  const student = await needStudent();
  if (!UUID_RE.test(quizId)) return { kind: "missing" };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("quizzes")
    .select("id, class_id, deck_id, title, due_at, closed_at")
    .eq("id", quizId)
    .maybeSingle();

  if (error) {
    if (missingQuizStore(error)) return { kind: "unavailable" };
    console.error("[quizzes] page:", error.message);
    throw new QuizError("Could not load this quiz.");
  }
  if (!data) return { kind: "missing" };

  const row = data as QuizRow;
  const quiz: QuizHeading = {
    id: String(row.id),
    title: String(row.title),
    dueAt: row.due_at ? String(row.due_at) : null,
    closedAt: row.closed_at ? String(row.closed_at) : null,
  };
  const className = await classNameOf(String(row.class_id));

  if (student.role === "teacher") {
    return {
      kind: "teacher",
      classId: String(row.class_id),
      deckId: String(row.deck_id),
      className,
      quiz,
      rows: await roster(String(row.class_id), quiz.id),
    };
  }

  const { data: attempt, error: attemptError } = await supabase
    .from("quiz_attempts")
    .select("id, finished_at, correct_count, total_count")
    .eq("quiz_id", quiz.id)
    .eq("student_id", student.id)
    .maybeSingle();
  if (attemptError) {
    console.error("[quizzes] attempt:", attemptError.message);
    throw new QuizError("Could not load this quiz.");
  }

  if (attempt?.finished_at) {
    const { data: answers, error: answerError } = await supabase
      .from("quiz_answers")
      .select("question, expected, correct")
      .eq("attempt_id", attempt.id);
    if (answerError) {
      console.error("[quizzes] answers:", answerError.message);
      throw new QuizError("Could not load this quiz.");
    }
    const missed = ((answers ?? []) as { question: string; expected: string; correct: boolean }[])
      .filter((answer) => !answer.correct)
      .map((answer) => ({ question: String(answer.question), expected: String(answer.expected) }));
    return {
      kind: "result",
      classId: String(row.class_id),
      quiz,
      correct: Number(attempt.correct_count ?? 0),
      total: Number(attempt.total_count ?? 0),
      missed,
    };
  }

  if (!attempt && !quizIsOpen(quiz)) {
    return { kind: "closed", classId: String(row.class_id), quiz };
  }

  const { data: play, error: playError } = await supabase.rpc("quiz_play_cards", { p_quiz_id: quiz.id });
  if (playError) {
    if (missingQuizStore(playError)) return { kind: "unavailable" };
    console.error("[quizzes] play:", playError.message);
    throw new QuizError("Could not load this quiz.");
  }
  const playCards = parsePlayCards(play);
  const mode: QuizAnswerMode | null = playCards.length > 0 && playCards.every((card) => card.options) ? "choice" : playCards.length > 0 ? "typing" : null;
  if (!mode) return { kind: "closed", classId: String(row.class_id), quiz };

  const answered = new Set<string>();
  if (attempt) {
    const { data: answers, error: answerError } = await supabase
      .from("quiz_answers")
      .select("card_id")
      .eq("attempt_id", attempt.id);
    if (answerError) {
      console.error("[quizzes] answered:", answerError.message);
      throw new QuizError("Could not load this quiz.");
    }
    for (const answer of answers ?? []) answered.add(String(answer.card_id));
  }

  return {
    kind: "take",
    classId: String(row.class_id),
    quiz,
    mode,
    cards: playCards
      .filter((card) => !answered.has(card.id))
      .map((card) => ({
        id: card.id,
        question: card.question,
        options: mode === "choice" ? card.options : null,
      })),
    answeredCount: answered.size,
    total: playCards.length,
  };
}

async function roster(classId: string, quizId: string): Promise<QuizRosterRow[]> {
  const supabase = await createClient();
  const { data: members, error } = await supabase.from("class_members").select("student_id").eq("class_id", classId);
  if (error) {
    console.error("[quizzes] roster:", error.message);
    throw new QuizError("Could not load who has finished.");
  }
  const studentIds = (members ?? []).map((row) => String(row.student_id));
  if (studentIds.length === 0) return [];

  const { data: profiles, error: profileError } = await supabase
    .from("profiles")
    .select("id, full_name")
    .in("id", studentIds);
  if (profileError) {
    console.error("[quizzes] names:", profileError.message);
    throw new QuizError("Could not load who has finished.");
  }
  const names = new Map((profiles ?? []).map((row) => [String(row.id), String(row.full_name)]));

  const { data: attempts, error: attemptError } = await supabase
    .from("quiz_attempts")
    .select("student_id, finished_at, correct_count, total_count")
    .eq("quiz_id", quizId);
  if (attemptError) {
    console.error("[quizzes] roster attempts:", attemptError.message);
    throw new QuizError("Could not load who has finished.");
  }
  const byStudent = new Map(
    ((attempts ?? []) as AttemptRow[])
      .filter((row) => row.student_id)
      .map((row) => [String(row.student_id), row]),
  );

  return studentIds
    .map((studentId) => {
      const attempt = byStudent.get(studentId);
      const status: QuizRosterRow["status"] = !attempt ? "not-taken" : attempt.finished_at ? "finished" : "in-progress";
      return {
        studentId,
        name: names.get(studentId) || "Student",
        status,
        correct: status === "finished" ? attempt?.correct_count ?? null : null,
        total: status === "finished" ? attempt?.total_count ?? null : null,
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name) || left.studentId.localeCompare(right.studentId));
}

async function classNameOf(classId: string): Promise<string> {
  const supabase = await createClient();
  const { data } = await supabase.from("classes").select("name").eq("id", classId).maybeSingle();
  return data?.name ? String(data.name) : "Class";
}

function parsePlayCards(value: unknown): QuizCardView[] {
  let parsed = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    if (typeof row.id !== "string" || typeof row.question !== "string") return [];
    const options =
      Array.isArray(row.options) && row.options.every((option) => typeof option === "string") ? row.options : null;
    return [{ id: row.id, question: row.question, options }];
  });
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value === "string") {
    try {
      return asRecord(JSON.parse(value));
    } catch {
      return null;
    }
  }
  if (value && typeof value === "object") return value as Record<string, unknown>;
  return null;
}

function missingQuizStore(error: { code?: string; message?: string }): boolean {
  const message = error.message ?? "";
  return error.code === "42P01" || error.code === "PGRST205" || error.code === "PGRST202" || /schema cache|does not exist/i.test(message);
}

function quizError(error: { code?: string; message?: string }, fallback: string): string {
  if (missingQuizStore(error)) return MIGRATION_ERROR;
  const message = error.message ?? "";
  const known = [
    "This deck already has an open quiz.",
    "This quiz is closed.",
    "This quiz is already finished.",
    "This quiz is already closed.",
    "Enter an answer.",
    "That card is not in this quiz.",
    "Choose today or a later day.",
    "Only the teacher of this class can give a quiz.",
    "This deck has no cards.",
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
