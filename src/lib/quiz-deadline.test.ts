import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { migrateTestDatabase, signIn } from "@/test/db";

type Card = { id: string; question: string; answer: string };

describe("record_quiz_answer deadline", () => {
  let db: PGlite;

  beforeAll(async () => {
    db = await migrateTestDatabase();
  }, 120_000);

  afterAll(async () => {
    await db?.close();
  });

  it("rejects a started attempt after the due time and keeps the earlier answer", async () => {
    const fixture = await seedOpenQuiz(db);
    await answer(db, fixture, 0);

    await db.query(`update public.quizzes set due_at = now() - interval '1 second' where id = $1::uuid`, [
      fixture.quizId,
    ]);

    await expect(answer(db, fixture, 1)).rejects.toThrow(/This quiz is closed/);
    expect(await answerCount(db, fixture.quizId)).toBe(1);
    expect(await attemptFinished(db, fixture.quizId)).toBe(false);
  });

  it("rejects a started attempt after the teacher closes the quiz", async () => {
    const fixture = await seedOpenQuiz(db);
    await answer(db, fixture, 0);

    await db.query(
      `update public.quizzes
       set due_at = now() + interval '2 days', closed_at = now()
       where id = $1::uuid`,
      [fixture.quizId],
    );

    await expect(answer(db, fixture, 1)).rejects.toThrow(/This quiz is closed/);
    expect(await answerCount(db, fixture.quizId)).toBe(1);
    expect(await attemptFinished(db, fixture.quizId)).toBe(false);
  });

  it("still saves an answer while the quiz is open", async () => {
    const fixture = await seedOpenQuiz(db);
    await answer(db, fixture, 0);
    await answer(db, fixture, 1);
    expect(await answerCount(db, fixture.quizId)).toBe(2);
    expect(await attemptFinished(db, fixture.quizId)).toBe(true);
  });

  it("does not create an attempt when the first answer arrives after the due time", async () => {
    const fixture = await seedOpenQuiz(db);
    await db.query(`update public.quizzes set due_at = now() - interval '1 second' where id = $1::uuid`, [
      fixture.quizId,
    ]);

    await expect(answer(db, fixture, 0)).rejects.toThrow(/This quiz is closed/);
    expect(await answerCount(db, fixture.quizId)).toBe(0);
    const attempts = await db.query<{ n: number }>(
      `select count(*)::int as n from public.quiz_attempts where quiz_id = $1::uuid`,
      [fixture.quizId],
    );
    expect(Number(attempts.rows[0].n)).toBe(0);
  });
});

async function answer(db: PGlite, fixture: Fixture, cardIndex: number) {
  const card = fixture.cards[cardIndex];
  return db.query(`select public.record_quiz_answer($1::uuid, $2::uuid, $3)`, [
    fixture.quizId,
    card.id,
    card.answer,
  ]);
}

async function answerCount(db: PGlite, quizId: string): Promise<number> {
  const result = await db.query<{ n: number }>(
    `select count(*)::int as n
     from public.quiz_answers a
     join public.quiz_attempts t on t.id = a.attempt_id
     where t.quiz_id = $1::uuid`,
    [quizId],
  );
  return Number(result.rows[0].n);
}

async function attemptFinished(db: PGlite, quizId: string): Promise<boolean> {
  const result = await db.query<{ finished_at: string | null }>(
    `select finished_at from public.quiz_attempts where quiz_id = $1::uuid`,
    [quizId],
  );
  return result.rows[0]?.finished_at != null;
}

type Fixture = { quizId: string; cards: Card[] };

async function seedOpenQuiz(db: PGlite): Promise<Fixture> {
  const teacherId = await createAccount(db, "teacher");
  const studentId = await createAccount(db, "student");
  const code = classCode();
  const created = await db.query<{ id: string }>(
    `insert into public.classes (teacher_id, name, code)
     values ($1::uuid, 'Biology', $2)
     returning id`,
    [teacherId, code],
  );
  const classId = created.rows[0].id;
  const deck = await db.query<{ id: string }>(
    `insert into public.decks (owner_id, title, class_id)
     values ($1::uuid, 'Cells', $2::uuid)
     returning id`,
    [teacherId, classId],
  );
  await db.query(`insert into public.class_members (class_id, student_id) values ($1::uuid, $2::uuid)`, [
    classId,
    studentId,
  ]);

  const cards: Card[] = [
    { id: crypto.randomUUID(), question: "What is the cell wall made of?", answer: "Cellulose" },
    { id: crypto.randomUUID(), question: "Where does photosynthesis happen?", answer: "Chloroplast" },
  ];
  const quiz = await db.query<{ id: string }>(
    `insert into public.quizzes (class_id, deck_id, title, cards, due_at, created_by)
     values ($1::uuid, $2::uuid, 'Cells quiz', $3::jsonb, now() + interval '2 days', $4::uuid)
     returning id`,
    [classId, deck.rows[0].id, JSON.stringify(cards), teacherId],
  );
  await signIn(db, studentId);
  return { quizId: quiz.rows[0].id, cards };
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
