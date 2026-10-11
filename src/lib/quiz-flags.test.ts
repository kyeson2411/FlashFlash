import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asUser, migrateTestDatabase } from "@/test/db";

type Card = { id: string; question: string; answer: string };
type Fixture = { teacherId: string; classId: string; quizId: string; cards: Card[] };
type Results = {
  students: { studentId: string; avgSeconds: number | null; timesAway: number; secondsAway: number }[];
  questions: { cardId: string; question: string; expected: string; taken: number; missed: number }[];
};

describe("quiz focus flags and teacher results", () => {
  let db: PGlite;

  beforeAll(async () => {
    db = await migrateTestDatabase();
  }, 120_000);

  afterAll(async () => {
    await db?.close();
  });

  it("notes leaving the page during an open attempt without changing the score", async () => {
    const fixture = await seedQuiz(db);
    const studentId = await joinStudent(db, fixture);
    const outsider = await createAccount(db, "student");

    await expect(focus(db, outsider, fixture.quizId, true)).rejects.toThrow(/not available/);
    expect(await focus(db, studentId, fixture.quizId, true)).toBe(false);

    const first = await current(db, studentId, fixture.quizId);
    expect(await focus(db, studentId, fixture.quizId, true)).toBe(true);
    expect(await focus(db, studentId, fixture.quizId, true)).toBe(false);
    expect(await focus(db, studentId, fixture.quizId, false)).toBe(true);
    expect(await focus(db, studentId, fixture.quizId, false)).toBe(false);
    expect(await focus(db, studentId, fixture.quizId, true)).toBe(true);

    const events = await db.query<{ card_id: string; returned: boolean }>(
      `select e.card_id, e.returned_at is not null as returned
       from public.quiz_focus_events e join public.quiz_attempts t on t.id = e.attempt_id
       where t.quiz_id = $1::uuid order by e.left_at, e.returned_at nulls last`,
      [fixture.quizId],
    );
    expect(events.rows).toEqual([
      { card_id: first, returned: true },
      { card_id: first, returned: false },
    ]);

    for (const card of fixture.cards) await answer(db, studentId, fixture.quizId, card);
    const attempt = await db.query<{ correct_count: number; total_count: number }>(
      `select correct_count, total_count from public.quiz_attempts where quiz_id = $1::uuid`,
      [fixture.quizId],
    );
    expect(attempt.rows[0]).toEqual({ correct_count: 4, total_count: 4 });
    expect(await focus(db, studentId, fixture.quizId, true)).toBe(false);

    const ownView = await asUser(db, studentId, () =>
      db.query(`select id from public.quiz_focus_events`),
    );
    expect(ownView.rows).toHaveLength(0);
  });

  it("gives the teacher timing, times away, and how often each question was missed", async () => {
    const fixture = await seedQuiz(db);
    const strong = await joinStudent(db, fixture);
    const weak = await joinStudent(db, fixture);
    const working = await joinStudent(db, fixture);

    for (const card of fixture.cards) {
      await current(db, strong, fixture.quizId);
      await db.query(
        `update public.quiz_attempt_questions i set issued_at = now() - interval '10 seconds'
         from public.quiz_attempts t
         where t.id = i.attempt_id and t.quiz_id = $1::uuid and t.student_id = $2::uuid and i.card_id = $3::uuid`,
        [fixture.quizId, strong, card.id],
      );
      await answer(db, strong, fixture.quizId, card);
    }

    await current(db, weak, fixture.quizId);
    await focus(db, weak, fixture.quizId, true);
    await db.query(
      `update public.quiz_focus_events e set left_at = now() - interval '30 seconds'
       from public.quiz_attempts t where t.id = e.attempt_id and t.student_id = $1::uuid`,
      [weak],
    );
    await focus(db, weak, fixture.quizId, false);
    for (const [index, card] of fixture.cards.entries()) {
      await answer(db, weak, fixture.quizId, card, index < 2 ? "wrong" : card.answer);
    }

    await answer(db, working, fixture.quizId, fixture.cards[0], "wrong");

    await expect(results(db, strong, fixture.quizId)).rejects.toThrow(/not available/);
    const outsiderTeacher = await createAccount(db, "teacher");
    await expect(results(db, outsiderTeacher, fixture.quizId)).rejects.toThrow(/not available/);

    const summary = await results(db, fixture.teacherId, fixture.quizId);
    const byStudent = new Map(summary.students.map((row) => [row.studentId, row]));
    expect(Number(byStudent.get(strong)?.avgSeconds)).toBeGreaterThanOrEqual(10);
    expect(Number(byStudent.get(strong)?.avgSeconds)).toBeLessThan(15);
    expect(byStudent.get(strong)?.timesAway).toBe(0);
    expect(byStudent.get(weak)?.timesAway).toBe(1);
    expect(Number(byStudent.get(weak)?.secondsAway)).toBeGreaterThanOrEqual(29);
    expect(byStudent.get(working)?.avgSeconds).toBeNull();

    expect(summary.questions.map((row) => [row.cardId, row.taken, row.missed])).toEqual([
      [fixture.cards[0].id, 2, 1],
      [fixture.cards[1].id, 2, 1],
      [fixture.cards[2].id, 2, 0],
      [fixture.cards[3].id, 2, 0],
    ]);
    expect(summary.questions[0]).toMatchObject({ question: "Question 1", expected: "Chloroplast" });
  });
});

async function seedQuiz(db: PGlite): Promise<Fixture> {
  const teacherId = await createAccount(db, "teacher");
  const created = await db.query<{ id: string }>(
    `insert into public.classes (teacher_id, name, code) values ($1::uuid, 'Biology', $2) returning id`,
    [teacherId, classCode()],
  );
  const classId = String(created.rows[0].id);
  const deck = await db.query<{ id: string }>(
    `insert into public.decks (owner_id, title, class_id) values ($1::uuid, 'Cells', $2::uuid) returning id`,
    [teacherId, classId],
  );
  const deckId = String(deck.rows[0].id);
  const words = ["Chloroplast", "Nucleus", "Ribosome", "Membrane"];
  const cards: Card[] = [];
  for (const [index, word] of words.entries()) {
    const row = await db.query<{ id: string }>(
      `insert into public.flashcards (deck_id, position, question, answer) values ($1::uuid, $2, $3, $4) returning id`,
      [deckId, index + 1, `Question ${index + 1}`, word],
    );
    cards.push({ id: String(row.rows[0].id), question: `Question ${index + 1}`, answer: word });
  }
  await db.query(`update public.decks set workflow_status = 'published' where id = $1::uuid`, [deckId]);
  const quizId = await asUser(db, teacherId, async () => {
    const result = await db.query<{ id: string }>(
      `select public.give_class_quiz($1::uuid, now() + interval '2 days', '{}'::jsonb) as id`,
      [deckId],
    );
    return String(result.rows[0].id);
  });
  return { teacherId, classId, quizId, cards };
}

async function joinStudent(db: PGlite, fixture: Fixture): Promise<string> {
  const studentId = await createAccount(db, "student");
  await db.query(`insert into public.class_members (class_id, student_id) values ($1::uuid, $2::uuid)`, [
    fixture.classId,
    studentId,
  ]);
  return studentId;
}

async function current(db: PGlite, studentId: string, quizId: string): Promise<string> {
  return asUser(db, studentId, async () => {
    const result = await db.query<{ result: unknown }>(`select public.quiz_current_question($1::uuid) as result`, [
      quizId,
    ]);
    return String((parse(result.rows[0].result) as { cardId: string }).cardId);
  });
}

async function answer(db: PGlite, studentId: string, quizId: string, card: Card, given = card.answer) {
  await asUser(db, studentId, () =>
    db.query(`select public.submit_quiz_answer($1::uuid, $2::uuid, $3, false)`, [quizId, card.id, given]),
  );
}

async function focus(db: PGlite, studentId: string, quizId: string, away: boolean): Promise<boolean> {
  return asUser(db, studentId, async () => {
    const result = await db.query<{ stored: boolean }>(`select public.log_quiz_focus($1::uuid, $2) as stored`, [
      quizId,
      away,
    ]);
    return result.rows[0].stored;
  });
}

async function results(db: PGlite, userId: string, quizId: string): Promise<Results> {
  return asUser(db, userId, async () => {
    const result = await db.query<{ result: unknown }>(`select public.quiz_teacher_results($1::uuid) as result`, [
      quizId,
    ]);
    return parse(result.rows[0].result) as Results;
  });
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
