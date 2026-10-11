import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asUser, migrateTestDatabase } from "@/test/db";
import { quickQuizSettings, sortWaiting, type QuizWindow } from "@/lib/quiz";

type Summary = { quizId: string; window: QuizWindow; dueAt: string | null; inProgress: boolean };

describe("student quiz flow", () => {
  let db: PGlite;

  beforeAll(async () => {
    db = await migrateTestDatabase();
  }, 120_000);

  afterAll(async () => {
    await db?.close();
  });

  it("gives a one-click quiz with the quick settings and lets a member start it right away", async () => {
    const teacherId = await createAccount(db, "teacher");
    const { classId, deckId } = await seedDeck(db, teacherId, "Cells");
    const quizId = await give(db, teacherId, deckId, quickQuizSettings(), null);

    const stored = await db.query<Record<string, unknown>>(
      `select due_at, opens_at, late_policy, timer_mode, time_limit_seconds, max_attempts,
              shuffle_questions, shuffle_choices, allow_back, results_after_due
       from public.quizzes where id = $1::uuid`,
      [quizId],
    );
    expect(stored.rows[0]).toEqual({
      due_at: null,
      opens_at: null,
      late_policy: "block",
      timer_mode: "none",
      time_limit_seconds: null,
      max_attempts: 1,
      shuffle_questions: true,
      shuffle_choices: true,
      allow_back: false,
      results_after_due: false,
    });

    const studentId = await joinStudent(db, classId);
    const first = await asUser(db, studentId, async () => {
      const result = await db.query<{ q: unknown }>(`select public.quiz_current_question($1::uuid) as q`, [quizId]);
      return parse(result.rows[0].q) as { finished: boolean; position: number; options: string[] | null };
    });
    expect(first).toMatchObject({ finished: false, position: 1 });
    expect(first.options).toHaveLength(4);

    const outsider = await createAccount(db, "teacher");
    await expect(give(db, outsider, deckId, quickQuizSettings(), null)).rejects.toThrow(/Only the teacher/);
  });

  it("lists overdue, open, and upcoming quizzes for a student in the order they need attention", async () => {
    const teacherId = await createAccount(db, "teacher");
    const decks = [];
    let classId = "";
    for (const title of ["Overdue", "Soon", "Upcoming", "Finished"]) {
      const seeded = await seedDeck(db, teacherId, title, classId || undefined);
      classId = seeded.classId;
      decks.push(seeded.deckId);
    }
    const overdue = await give(db, teacherId, decks[0], { latePolicy: "accept" }, "2 days");
    const soon = await give(db, teacherId, decks[1], {}, "1 day");
    const upcoming = await give(
      db,
      teacherId,
      decks[2],
      { opensAt: new Date(Date.now() + 3_600_000).toISOString() },
      "3 days",
    );
    const finished = await give(db, teacherId, decks[3], {}, "1 day");
    await db.query(`update public.quizzes set due_at = now() - interval '1 hour' where id = $1::uuid`, [overdue]);

    const studentId = await joinStudent(db, classId);
    const cards = await db.query<{ cards: { id: string; answer: string }[] }>(
      `select cards from public.quizzes where id = $1::uuid`,
      [finished],
    );
    await asUser(db, studentId, async () => {
      for (const card of parse(cards.rows[0].cards) as { id: string; answer: string }[]) {
        await db.query(`select public.quiz_current_question($1::uuid)`, [finished]);
        await db.query(`select public.submit_quiz_answer($1::uuid, $2::uuid, $3, false)`, [finished, card.id, card.answer]);
      }
      await db.query(`select public.quiz_current_question($1::uuid)`, [soon]);
    });

    const summaries = await asUser(db, studentId, async () => {
      const result = await db.query<{ rows: unknown }>(`select public.my_quiz_summaries($1::uuid[]) as rows`, [
        [overdue, soon, upcoming, finished],
      ]);
      return parse(result.rows[0].rows) as (Summary & { finishedCount: number })[];
    });
    const byId = new Map(summaries.map((row) => [row.quizId, row]));
    expect(byId.get(overdue)?.window).toBe("late");
    expect(byId.get(soon)).toMatchObject({ window: "open", inProgress: true });
    expect(byId.get(upcoming)?.window).toBe("not_open");
    expect(byId.get(finished)?.finishedCount).toBe(1);

    const opensAt = new Map([[upcoming, new Date(Date.now() + 3_600_000).toISOString()]]);
    const waiting = sortWaiting(
      summaries
        .filter((row) => row.window !== "closed" && row.finishedCount === 0)
        .map((row) => ({ ...row, opensAt: opensAt.get(row.quizId) ?? null })),
    );
    expect(waiting.map((row) => row.quizId)).toEqual([overdue, soon, upcoming]);
  });
});

async function seedDeck(
  db: PGlite,
  teacherId: string,
  title: string,
  existingClassId?: string,
): Promise<{ classId: string; deckId: string }> {
  let classId = existingClassId;
  if (!classId) {
    const created = await db.query<{ id: string }>(
      `insert into public.classes (teacher_id, name, code) values ($1::uuid, 'Biology', $2) returning id`,
      [teacherId, classCode()],
    );
    classId = String(created.rows[0].id);
  }
  const deck = await db.query<{ id: string }>(
    `insert into public.decks (owner_id, title, class_id) values ($1::uuid, $2, $3::uuid) returning id`,
    [teacherId, title, classId],
  );
  const deckId = String(deck.rows[0].id);
  const words = ["Chloroplast", "Nucleus", "Ribosome", "Membrane"];
  for (const [index, word] of words.entries()) {
    await db.query(`insert into public.flashcards (deck_id, position, question, answer) values ($1::uuid, $2, $3, $4)`, [
      deckId,
      index + 1,
      `Question ${index + 1}`,
      word,
    ]);
  }
  await db.query(`update public.decks set workflow_status = 'published' where id = $1::uuid`, [deckId]);
  return { classId, deckId };
}

async function give(
  db: PGlite,
  teacherId: string,
  deckId: string,
  settings: object,
  dueIn: string | null,
): Promise<string> {
  return asUser(db, teacherId, async () => {
    const result = await db.query<{ id: string }>(
      `select public.give_class_quiz($1::uuid, case when $3::text is null then null else now() + $3::interval end, $2::jsonb) as id`,
      [deckId, JSON.stringify(settings), dueIn],
    );
    return String(result.rows[0].id);
  });
}

async function joinStudent(db: PGlite, classId: string): Promise<string> {
  const studentId = await createAccount(db, "student");
  await db.query(`insert into public.class_members (class_id, student_id) values ($1::uuid, $2::uuid)`, [
    classId,
    studentId,
  ]);
  return studentId;
}

function parse(value: unknown): unknown {
  return typeof value === "string" ? JSON.parse(value) : value;
}

async function createAccount(db: PGlite, role: "teacher" | "student"): Promise<string> {
  const id = crypto.randomUUID();
  const schoolId = `${role === "teacher" ? "T" : "S"}${id.replace(/-/g, "").slice(0, 16).toUpperCase()}`;
  await db.query(`insert into auth.users (id, raw_user_meta_data) values ($1::uuid, $2::jsonb)`, [
    id,
    JSON.stringify({
      privacy_consent: "true",
      full_name: role === "teacher" ? "Ada Teacher" : "Lin Student",
      school_id: schoolId,
      privacy_notice_version: "test",
      role,
    }),
  ]);
  return id;
}

function classCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}
