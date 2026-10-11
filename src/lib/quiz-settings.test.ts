import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asUser, migrateTestDatabase } from "@/test/db";

type Card = { id: string; question: string; answer: string };
type Fixture = { teacherId: string; classId: string; deckId: string; quizId: string; cards: Card[] };
type Answer = {
  correct: boolean | null;
  expected: string | null;
  finished: boolean;
  timedOut: boolean;
  late: boolean;
  correctCount: number | null;
  total: number | null;
};

describe("quiz settings", () => {
  let db: PGlite;

  beforeAll(async () => {
    db = await migrateTestDatabase();
  }, 120_000);

  afterAll(async () => {
    await db?.close();
  });

  it("stores settings, validates them, and keeps the old two-argument call working", async () => {
    const teacherId = await createAccount(db, "teacher");
    const { classId, deckId } = await seedDeck(db, teacherId);

    await expect(give(db, teacherId, deckId, { timeLimitMinutes: 0 })).rejects.toThrow(/1 to 240 minutes/);
    await expect(give(db, teacherId, deckId, { maxAttempts: 11 })).rejects.toThrow(/1 to 10 attempts/);
    await expect(give(db, teacherId, deckId, { latePolicy: "sometimes" })).rejects.toThrow(/Check the quiz settings/);
    await expect(give(db, teacherId, deckId, { opensAt: "not a time" })).rejects.toThrow(/Check the quiz settings/);
    await expect(
      give(db, teacherId, deckId, { opensAt: new Date(Date.now() + 3 * 86_400_000).toISOString() }),
    ).rejects.toThrow(/before the due date/);

    const quizId = await give(db, teacherId, deckId, {
      opensAt: new Date(Date.now() + 3_600_000).toISOString(),
      latePolicy: "accept",
      timeLimitMinutes: 15,
      maxAttempts: 3,
      shuffleQuestions: true,
      shuffleChoices: true,
      resultsAfterDue: true,
    });
    const stored = await db.query<Record<string, unknown>>(
      `select late_policy, timer_mode, time_limit_seconds, max_attempts, shuffle_questions,
              shuffle_choices, results_after_due, opens_at is not null as has_open
       from public.quizzes where id = $1::uuid`,
      [quizId],
    );
    expect(stored.rows[0]).toEqual({
      late_policy: "accept",
      timer_mode: "quiz",
      time_limit_seconds: 900,
      max_attempts: 3,
      shuffle_questions: true,
      shuffle_choices: true,
      results_after_due: true,
      has_open: true,
    });

    await db.query(`update public.quizzes set closed_at = now() where id = $1::uuid`, [quizId]);
    const plain = await asUser(db, teacherId, async () => {
      const result = await db.query<{ id: string }>(
        `select public.give_class_quiz($1::uuid, now() + interval '2 days') as id`,
        [deckId],
      );
      return String(result.rows[0].id);
    });
    const defaults = await db.query<Record<string, unknown>>(
      `select late_policy, timer_mode, max_attempts, results_after_due, opens_at, class_id
       from public.quizzes where id = $1::uuid`,
      [plain],
    );
    expect(defaults.rows[0]).toEqual({
      late_policy: "block",
      timer_mode: "none",
      max_attempts: 1,
      results_after_due: false,
      opens_at: null,
      class_id: classId,
    });
  });

  it("rejects answers and questions before the open time", async () => {
    const fixture = await seedQuiz(db, { opensAt: new Date(Date.now() + 3_600_000).toISOString() });
    const studentId = await joinStudent(db, fixture);

    await expect(answer(db, studentId, fixture, 0)).rejects.toThrow(/not open yet/);
    await expect(current(db, studentId, fixture.quizId)).rejects.toThrow(/not open yet/);
    await expect(start(db, studentId, fixture.quizId)).rejects.toThrow(/not open yet/);
    expect(await attemptRows(db, fixture.quizId, studentId)).toHaveLength(0);
    expect(await playIds(db, fixture.teacherId, fixture.quizId)).toHaveLength(fixture.cards.length);

    await db.query(`update public.quizzes set opens_at = now() - interval '1 minute' where id = $1::uuid`, [
      fixture.quizId,
    ]);
    expect((await answer(db, studentId, fixture, 0)).correct).toBe(true);
  });

  it("accepts and marks late answers only when the late policy allows it", async () => {
    const blocked = await seedQuiz(db, { latePolicy: "block" });
    const blockedStudent = await joinStudent(db, blocked);
    await answer(db, blockedStudent, blocked, 0);
    await pastDue(db, blocked.quizId);
    await expect(answer(db, blockedStudent, blocked, 1)).rejects.toThrow(/This quiz is closed/);

    const late = await seedQuiz(db, { latePolicy: "accept" });
    const lateStudent = await joinStudent(db, late);
    const onTime = await answer(db, lateStudent, late, 0);
    expect(onTime.late).toBe(false);
    await pastDue(db, late.quizId);

    const second = await answer(db, lateStudent, late, 1);
    expect(second.late).toBe(true);
    for (let index = 2; index < late.cards.length; index += 1) await answer(db, lateStudent, late, index);

    const answers = await db.query<{ late: boolean }>(
      `select a.late from public.quiz_answers a
       join public.quiz_attempts t on t.id = a.attempt_id
       where t.quiz_id = $1::uuid order by a.answered_at, a.late`,
      [late.quizId],
    );
    expect(answers.rows.map((row) => row.late)).toEqual([false, true, true, true]);
    const attempt = await attemptRows(db, late.quizId, lateStudent);
    expect(attempt[0]).toMatchObject({ finished: true, late: true });

    const closer = await joinStudent(db, late);
    await db.query(`update public.quizzes set closed_at = now() where id = $1::uuid`, [late.quizId]);
    await expect(answer(db, closer, late, 0)).rejects.toThrow(/This quiz is closed/);
  });

  it("lets one student answer after the due date when the teacher gives them a later day", async () => {
    const fixture = await seedQuiz(db, {});
    const extendedId = await joinStudent(db, fixture);
    const otherId = await joinStudent(db, fixture);
    const outsiderTeacher = await createAccount(db, "teacher");

    const later = new Date(Date.now() + 5 * 86_400_000).toISOString();
    await expect(accommodate(db, outsiderTeacher, fixture.quizId, extendedId, later, 0)).rejects.toThrow(
      /not available/,
    );
    await expect(accommodate(db, extendedId, fixture.quizId, extendedId, later, 0)).rejects.toThrow(/not available/);
    await expect(
      accommodate(db, fixture.teacherId, fixture.quizId, extendedId, new Date(Date.now() + 3_600_000).toISOString(), 0),
    ).rejects.toThrow(/after the quiz due date/);
    await expect(accommodate(db, fixture.teacherId, fixture.quizId, extendedId, null, 600)).rejects.toThrow(
      /no time limit/,
    );

    await accommodate(db, fixture.teacherId, fixture.quizId, extendedId, later, 0);
    await db.query(`update public.quizzes set due_at = now() - interval '1 minute' where id = $1::uuid`, [
      fixture.quizId,
    ]);

    expect((await answer(db, extendedId, fixture, 0)).late).toBe(false);
    await expect(answer(db, otherId, fixture, 0)).rejects.toThrow(/This quiz is closed/);

    const own = await asUser(db, otherId, () =>
      db.query(`select student_id from public.quiz_accommodations where quiz_id = $1::uuid`, [fixture.quizId]),
    );
    expect(own.rows).toHaveLength(0);

    await accommodate(db, fixture.teacherId, fixture.quizId, extendedId, null, 0);
    await expect(answer(db, extendedId, fixture, 1)).rejects.toThrow(/This quiz is closed/);
  });

  it("needs a start for a timed quiz and finishes the attempt when time runs out", async () => {
    const fixture = await seedQuiz(db, { timeLimitMinutes: 10 });
    const studentId = await joinStudent(db, fixture);
    const slowId = await joinStudent(db, fixture);

    await expect(answer(db, studentId, fixture, 0)).rejects.toThrow(/Start the quiz first/);
    await expect(current(db, studentId, fixture.quizId)).rejects.toThrow(/Start the quiz first/);

    const started = await start(db, studentId, fixture.quizId);
    expect(started.attemptNumber).toBe(1);
    expect(typeof started.deadline).toBe("string");
    expect((await start(db, studentId, fixture.quizId)).attemptNumber).toBe(1);
    expect(await current(db, studentId, fixture.quizId)).toMatchObject({
      position: 1,
      total: fixture.cards.length,
      deadline: started.deadline,
    });

    await answer(db, studentId, fixture, 0);
    await db.query(
      `update public.quiz_attempts set started_at = now() - interval '10 minutes 6 seconds'
       where quiz_id = $1::uuid and student_id = $2::uuid`,
      [fixture.quizId, studentId],
    );
    const timedOut = await answer(db, studentId, fixture, 1);
    expect(timedOut).toMatchObject({ timedOut: true, finished: true, correct: null, correctCount: 1, total: 4 });
    expect((await attemptRows(db, fixture.quizId, studentId))[0]).toMatchObject({
      finished: true,
      timedOut: true,
      correct: 1,
      total: 4,
    });
    expect(await answerCount(db, fixture.quizId, studentId)).toBe(1);
    await expect(answer(db, studentId, fixture, 1)).rejects.toThrow(/already finished/);

    await accommodate(db, fixture.teacherId, fixture.quizId, slowId, null, 300);
    await start(db, slowId, fixture.quizId);
    await db.query(
      `update public.quiz_attempts set started_at = now() - interval '12 minutes'
       where quiz_id = $1::uuid and student_id = $2::uuid`,
      [fixture.quizId, slowId],
    );
    expect((await answer(db, slowId, fixture, 0)).timedOut).toBe(false);
  });

  it("finishes an abandoned timed attempt when the teacher or student opens the quiz", async () => {
    const fixture = await seedQuiz(db, { timeLimitMinutes: 5 });
    const studentId = await joinStudent(db, fixture);
    await start(db, studentId, fixture.quizId);
    await db.query(
      `update public.quiz_attempts set started_at = now() - interval '6 minutes'
       where quiz_id = $1::uuid and student_id = $2::uuid`,
      [fixture.quizId, studentId],
    );
    const outsider = await createAccount(db, "student");
    await expect(
      asUser(db, outsider, () => db.query(`select public.finalize_quiz_attempts($1::uuid)`, [fixture.quizId])),
    ).rejects.toThrow(/not available/);

    await asUser(db, fixture.teacherId, () =>
      db.query(`select public.finalize_quiz_attempts($1::uuid)`, [fixture.quizId]),
    );
    expect((await attemptRows(db, fixture.quizId, studentId))[0]).toMatchObject({
      finished: true,
      timedOut: true,
      correct: 0,
    });
  });

  it("limits attempts and allows only one unfinished attempt at a time", async () => {
    const fixture = await seedQuiz(db, { maxAttempts: 2 });
    const studentId = await joinStudent(db, fixture);

    await finishAll(db, studentId, fixture);
    await expect(answer(db, studentId, fixture, 0)).rejects.toThrow(/Start the quiz first/);

    expect((await start(db, studentId, fixture.quizId)).attemptNumber).toBe(2);
    expect((await start(db, studentId, fixture.quizId)).attemptNumber).toBe(2);
    await expect(
      db.query(
        `insert into public.quiz_attempts (quiz_id, student_id, attempt_number)
         values ($1::uuid, $2::uuid, 3)`,
        [fixture.quizId, studentId],
      ),
    ).rejects.toThrow(/duplicate key|unique/i);

    await finishAll(db, studentId, fixture);
    await expect(start(db, studentId, fixture.quizId)).rejects.toThrow(/used every attempt/);
    await expect(answer(db, studentId, fixture, 0)).rejects.toThrow(/already finished/);
    expect(await attemptRows(db, fixture.quizId, studentId)).toHaveLength(2);
  });

  it("hides scores and saved answers from students until results are released", async () => {
    const fixture = await seedQuiz(db, { resultsAfterDue: true });
    const studentId = await joinStudent(db, fixture);

    const first = await answer(db, studentId, fixture, 0);
    expect(first).toMatchObject({ correct: null, expected: null });
    const last = await finishAll(db, studentId, fixture);
    expect(last).toMatchObject({ finished: true, correctCount: null, total: null, correct: null, expected: null });

    expect(await ownAttemptRows(db, studentId, fixture.quizId)).toBe(0);
    expect(await ownAnswerRows(db, studentId, fixture.quizId)).toBe(0);
    const hidden = await state(db, studentId, fixture.quizId);
    expect(hidden.released).toBe(false);
    expect(hidden.latest).toMatchObject({ correct: null, total: null, missed: null });
    expect(await summary(db, studentId, fixture.quizId)).toMatchObject({ released: false, correct: null, finishedCount: 1 });

    const teacherView = await asUser(db, fixture.teacherId, () =>
      db.query<{ correct_count: number }>(`select correct_count from public.quiz_attempts where quiz_id = $1::uuid`, [
        fixture.quizId,
      ]),
    );
    expect(teacherView.rows[0].correct_count).toBe(4);

    await pastDue(db, fixture.quizId);
    expect(await ownAttemptRows(db, studentId, fixture.quizId)).toBe(1);
    expect(await ownAnswerRows(db, studentId, fixture.quizId)).toBe(4);
    const shown = await state(db, studentId, fixture.quizId);
    expect(shown.released).toBe(true);
    expect(shown.latest).toMatchObject({ correct: 4, total: 4, missed: [] });
  });

  it("waits for the teacher to close the quiz when results wait and late work is accepted", async () => {
    const fixture = await seedQuiz(db, { resultsAfterDue: true, latePolicy: "accept" });
    const studentId = await joinStudent(db, fixture);
    await finishAll(db, studentId, fixture);
    await pastDue(db, fixture.quizId);
    expect((await state(db, studentId, fixture.quizId)).released).toBe(false);
    await db.query(`update public.quizzes set closed_at = now() where id = $1::uuid`, [fixture.quizId]);
    expect((await state(db, studentId, fixture.quizId)).released).toBe(true);
  });

  it("gives each student a stable shuffled order only when shuffling is on", async () => {
    const shuffled = await seedQuiz(db, { shuffleQuestions: true, shuffleChoices: true }, 8);
    const orders: string[][] = [];
    let firstStudent = "";
    for (let index = 0; index < 4; index += 1) {
      const studentId = await joinStudent(db, shuffled);
      if (!firstStudent) firstStudent = studentId;
      await current(db, studentId, shuffled.quizId);
      orders.push(await attemptOrder(db, shuffled.quizId, studentId));
    }
    await current(db, firstStudent, shuffled.quizId);
    expect(await attemptOrder(db, shuffled.quizId, firstStudent)).toEqual(orders[0]);
    expect(new Set(orders.map((order) => order.join(","))).size).toBeGreaterThan(1);
    for (const order of orders) expect([...order].sort()).toEqual(shuffled.cards.map((card) => card.id).sort());

    const plain = await seedQuiz(db, {}, 8);
    for (let index = 0; index < 3; index += 1) {
      const studentId = await joinStudent(db, plain);
      expect((await current(db, studentId, plain.quizId)).cardId).toBe(plain.cards[0].id);
      expect(await attemptOrder(db, plain.quizId, studentId)).toEqual(plain.cards.map((card) => card.id));
    }
    expect(await playIds(db, plain.teacherId, plain.quizId)).toEqual(plain.cards.map((card) => card.id));
  });
});

async function seedDeck(db: PGlite, teacherId: string, cardCount = 4): Promise<{ classId: string; deckId: string; cards: Card[] }> {
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
  const words = ["Chloroplast", "Nucleus", "Ribosome", "Membrane", "Vacuole", "Cytoplasm", "Mitochondria", "Golgi"];
  const cards: Card[] = [];
  for (let index = 0; index < cardCount; index += 1) {
    const row = await db.query<{ id: string }>(
      `insert into public.flashcards (deck_id, position, question, answer) values ($1::uuid, $2, $3, $4) returning id`,
      [deckId, index + 1, `Question ${index + 1}`, words[index]],
    );
    cards.push({ id: String(row.rows[0].id), question: `Question ${index + 1}`, answer: words[index] });
  }
  await db.query(`update public.decks set workflow_status = 'published' where id = $1::uuid`, [deckId]);
  return { classId, deckId, cards };
}

async function seedQuiz(db: PGlite, settings: Record<string, unknown>, cardCount = 4): Promise<Fixture> {
  const teacherId = await createAccount(db, "teacher");
  const { classId, deckId, cards } = await seedDeck(db, teacherId, cardCount);
  const quizId = await give(db, teacherId, deckId, settings);
  return { teacherId, classId, deckId, quizId, cards };
}

async function give(db: PGlite, teacherId: string, deckId: string, settings: Record<string, unknown>): Promise<string> {
  return asUser(db, teacherId, async () => {
    const result = await db.query<{ id: string }>(
      `select public.give_class_quiz($1::uuid, now() + interval '2 days', $2::jsonb) as id`,
      [deckId, JSON.stringify(settings)],
    );
    return String(result.rows[0].id);
  });
}

async function joinStudent(db: PGlite, fixture: Fixture): Promise<string> {
  const studentId = await createAccount(db, "student");
  await db.query(`insert into public.class_members (class_id, student_id) values ($1::uuid, $2::uuid)`, [
    fixture.classId,
    studentId,
  ]);
  return studentId;
}

async function answer(db: PGlite, studentId: string, fixture: Fixture, index: number): Promise<Answer> {
  const card = fixture.cards[index];
  return asUser(db, studentId, async () => {
    const result = await db.query<{ result: unknown }>(
      `select public.record_quiz_answer($1::uuid, $2::uuid, $3) as result`,
      [fixture.quizId, card.id, card.answer],
    );
    return parse(result.rows[0].result) as Answer;
  });
}

/** Answers every remaining question correctly, in the order the server gives them. */
async function finishAll(db: PGlite, studentId: string, fixture: Fixture): Promise<Answer> {
  for (let guard = 0; guard <= fixture.cards.length; guard += 1) {
    const next = await current(db, studentId, fixture.quizId);
    if (next.finished) break;
    const index = fixture.cards.findIndex((card) => card.id === next.cardId);
    const saved = await answer(db, studentId, fixture, index);
    if (saved.finished) return saved;
  }
  throw new Error("The attempt did not finish.");
}

async function current(db: PGlite, studentId: string, quizId: string): Promise<Record<string, unknown>> {
  return asUser(db, studentId, async () => {
    const result = await db.query<{ result: unknown }>(`select public.quiz_current_question($1::uuid) as result`, [
      quizId,
    ]);
    return parse(result.rows[0].result) as Record<string, unknown>;
  });
}

async function attemptOrder(db: PGlite, quizId: string, studentId: string): Promise<string[]> {
  const result = await db.query<{ ids: string[] }>(
    `select public.quiz_attempt_order(id) as ids from public.quiz_attempts
     where quiz_id = $1::uuid and student_id = $2::uuid and finished_at is null`,
    [quizId, studentId],
  );
  return result.rows[0].ids;
}

async function start(db: PGlite, studentId: string, quizId: string): Promise<{ attemptNumber: number; deadline: unknown }> {
  return asUser(db, studentId, async () => {
    const result = await db.query<{ result: unknown }>(`select public.start_quiz_attempt($1::uuid) as result`, [quizId]);
    return parse(result.rows[0].result) as { attemptNumber: number; deadline: unknown };
  });
}

async function playIds(db: PGlite, userId: string, quizId: string): Promise<string[]> {
  return asUser(db, userId, async () => {
    const result = await db.query<{ cards: unknown }>(`select public.quiz_play_cards($1::uuid) as cards`, [quizId]);
    return (parse(result.rows[0].cards) as { id: string }[]).map((card) => card.id);
  });
}

async function state(db: PGlite, studentId: string, quizId: string): Promise<Record<string, unknown>> {
  return asUser(db, studentId, async () => {
    const result = await db.query<{ state: unknown }>(`select public.quiz_student_state($1::uuid) as state`, [quizId]);
    return parse(result.rows[0].state) as Record<string, unknown>;
  });
}

async function summary(db: PGlite, studentId: string, quizId: string): Promise<Record<string, unknown>> {
  return asUser(db, studentId, async () => {
    const result = await db.query<{ rows: unknown }>(`select public.my_quiz_summaries(array[$1::uuid]) as rows`, [quizId]);
    return (parse(result.rows[0].rows) as Record<string, unknown>[])[0];
  });
}

async function accommodate(
  db: PGlite,
  userId: string,
  quizId: string,
  studentId: string,
  dueAt: string | null,
  extraSeconds: number,
): Promise<void> {
  await asUser(db, userId, () =>
    db.query(`select public.set_quiz_accommodation($1::uuid, $2::uuid, $3::timestamptz, $4)`, [
      quizId,
      studentId,
      dueAt,
      extraSeconds,
    ]),
  );
}

async function pastDue(db: PGlite, quizId: string): Promise<void> {
  await db.query(
    `update public.quizzes set opens_at = null, due_at = now() - interval '1 second' where id = $1::uuid`,
    [quizId],
  );
}

async function attemptRows(
  db: PGlite,
  quizId: string,
  studentId: string,
): Promise<{ finished: boolean; late: boolean; timedOut: boolean; correct: number | null; total: number | null }[]> {
  const result = await db.query<{
    finished_at: string | null;
    late: boolean;
    timed_out: boolean;
    correct_count: number | null;
    total_count: number | null;
  }>(
    `select finished_at, late, timed_out, correct_count, total_count
     from public.quiz_attempts
     where quiz_id = $1::uuid and student_id = $2::uuid
     order by attempt_number`,
    [quizId, studentId],
  );
  return result.rows.map((row) => ({
    finished: row.finished_at != null,
    late: row.late,
    timedOut: row.timed_out,
    correct: row.correct_count,
    total: row.total_count,
  }));
}

async function answerCount(db: PGlite, quizId: string, studentId: string): Promise<number> {
  const result = await db.query<{ n: number }>(
    `select count(*)::int as n from public.quiz_answers a
     join public.quiz_attempts t on t.id = a.attempt_id
     where t.quiz_id = $1::uuid and t.student_id = $2::uuid`,
    [quizId, studentId],
  );
  return Number(result.rows[0].n);
}

async function ownAttemptRows(db: PGlite, studentId: string, quizId: string): Promise<number> {
  return asUser(db, studentId, async () => {
    const result = await db.query<{ n: number }>(
      `select count(*)::int as n from public.quiz_attempts where quiz_id = $1::uuid`,
      [quizId],
    );
    return Number(result.rows[0].n);
  });
}

async function ownAnswerRows(db: PGlite, studentId: string, quizId: string): Promise<number> {
  const attempts = await db.query<{ id: string }>(
    `select id from public.quiz_attempts where quiz_id = $1::uuid and student_id = $2::uuid`,
    [quizId, studentId],
  );
  const ids = attempts.rows.map((row) => String(row.id));
  return asUser(db, studentId, async () => {
    const result = await db.query<{ n: number }>(
      `select count(*)::int as n from public.quiz_answers where attempt_id = any ($1::uuid[])`,
      [ids],
    );
    return Number(result.rows[0].n);
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
