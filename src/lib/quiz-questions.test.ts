import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asUser, migrateTestDatabase } from "@/test/db";

type Card = { id: string; question: string; answer: string };
type Fixture = { teacherId: string; classId: string; deckId: string; quizId: string; cards: Card[] };
type Question = {
  finished: boolean;
  attemptNumber: number;
  position: number;
  total: number;
  answeredCount: number;
  cardId: string;
  question: string;
  options: string[] | null;
  given: string | null;
  deadline: string | null;
  questionTimer: boolean;
  allowBack: boolean;
  feedback: boolean;
  late: boolean;
};
type Saved = {
  correct: boolean | null;
  expected: string | null;
  finished: boolean;
  timedOut: boolean;
  questionTimedOut: boolean;
  late: boolean;
  correctCount: number | null;
  total: number | null;
};

describe("quiz questions one at a time", () => {
  let db: PGlite;

  beforeAll(async () => {
    db = await migrateTestDatabase();
  }, 120_000);

  afterAll(async () => {
    await db?.close();
  });

  it("gives one question at a time and takes answers only for that question", async () => {
    const fixture = await seedQuiz(db, {});
    const studentId = await joinStudent(db, fixture);

    await expect(playIds(db, studentId, fixture.quizId)).rejects.toThrow(/not available/);

    const first = await current(db, studentId, fixture.quizId);
    expect(first).toMatchObject({ finished: false, position: 1, total: 4, answeredCount: 0, feedback: true });
    expect(first.cardId).toBe(fixture.cards[0].id);
    expect(first.options).toHaveLength(4);
    expect((await current(db, studentId, fixture.quizId)).cardId).toBe(first.cardId);
    expect(await issuedCount(db, fixture.quizId, studentId)).toBe(1);

    await expect(answer(db, studentId, fixture, 2)).rejects.toThrow(/no longer open/);
    expect(await answer(db, studentId, fixture, 0)).toMatchObject({ correct: true, finished: false });
    await expect(answer(db, studentId, fixture, 0)).rejects.toThrow(/no longer open/);

    const second = await current(db, studentId, fixture.quizId);
    expect(second).toMatchObject({ position: 2, answeredCount: 1 });
    expect(second.cardId).toBe(fixture.cards[1].id);

    await answer(db, studentId, fixture, 1, "wrong");
    await answer(db, studentId, fixture, 2);
    const last = await answer(db, studentId, fixture, 3);
    expect(last).toMatchObject({ finished: true, correctCount: 3, total: 4 });
    expect(await current(db, studentId, fixture.quizId)).toEqual({ finished: true });
  });

  it("stores an order seed for each attempt and keeps the order when the student comes back", async () => {
    const fixture = await seedQuiz(db, { shuffleQuestions: true, shuffleChoices: true, maxAttempts: 2 }, 8);
    const studentId = await joinStudent(db, fixture);

    const first = await current(db, studentId, fixture.quizId);
    const seeds = await db.query<{ order_seed: string }>(
      `select order_seed from public.quiz_attempts where quiz_id = $1::uuid and student_id = $2::uuid`,
      [fixture.quizId, studentId],
    );
    expect(seeds.rows[0].order_seed).toMatch(/^[0-9a-f]{32}$/);

    const again = await current(db, studentId, fixture.quizId);
    expect(again.cardId).toBe(first.cardId);
    expect(again.options).toEqual(first.options);

    const order = await attemptOrder(db, fixture.quizId, studentId);
    for (let index = 0; index < order.length; index += 1) {
      const next = await current(db, studentId, fixture.quizId);
      expect(next.cardId).toBe(order[index]);
      await answerCard(db, studentId, fixture, next.cardId);
    }

    await start(db, studentId, fixture.quizId);
    const retrySeeds = await db.query<{ order_seed: string }>(
      `select order_seed from public.quiz_attempts where quiz_id = $1::uuid and student_id = $2::uuid order by attempt_number`,
      [fixture.quizId, studentId],
    );
    expect(retrySeeds.rows).toHaveLength(2);
    expect(retrySeeds.rows[1].order_seed).not.toBe(retrySeeds.rows[0].order_seed);
  });

  it("times each question on the server and saves a blank when the time runs out", async () => {
    const fixture = await seedQuiz(db, { timerMode: "question", questionSeconds: 30 });
    const studentId = await joinStudent(db, fixture);

    await expect(current(db, studentId, fixture.quizId)).rejects.toThrow(/Start the quiz first/);
    await start(db, studentId, fixture.quizId);

    const first = await current(db, studentId, fixture.quizId);
    expect(first).toMatchObject({ position: 1, questionTimer: true });
    const seconds = (Date.parse(String(first.deadline)) - Date.now()) / 1000;
    expect(seconds).toBeGreaterThan(25);
    expect(seconds).toBeLessThanOrEqual(31);

    await expect(answer(db, studentId, fixture, 1)).rejects.toThrow(/no longer open/);
    await expect(answer(db, studentId, fixture, 0, "", true)).rejects.toThrow(/Enter an answer/);

    await moveDeadline(db, fixture.quizId, studentId, first.cardId, "-1 second");
    expect(await answer(db, studentId, fixture, 0, "", true)).toMatchObject({
      questionTimedOut: true,
      correct: false,
      finished: false,
    });

    const second = await current(db, studentId, fixture.quizId);
    expect(second.position).toBe(2);
    await moveDeadline(db, fixture.quizId, studentId, second.cardId, "-1 second");
    expect(await answer(db, studentId, fixture, 1)).toMatchObject({ correct: true, questionTimedOut: false });

    const third = await current(db, studentId, fixture.quizId);
    await moveDeadline(db, fixture.quizId, studentId, third.cardId, "-30 seconds");
    const fourth = await current(db, studentId, fixture.quizId);
    expect(fourth.position).toBe(4);
    expect(await answer(db, studentId, fixture, 2)).toMatchObject({ questionTimedOut: true, finished: false });

    await moveDeadline(db, fixture.quizId, studentId, fourth.cardId, "-30 seconds");
    expect(await answer(db, studentId, fixture, 3)).toMatchObject({
      questionTimedOut: true,
      finished: true,
      correctCount: 1,
      total: 4,
    });

    const saved = await db.query<{ given: string; timed_out: boolean }>(
      `select a.given, a.timed_out from public.quiz_answers a
       join public.quiz_attempts t on t.id = a.attempt_id
       join public.quiz_attempt_questions i on i.attempt_id = a.attempt_id and i.card_id = a.card_id
       where t.quiz_id = $1::uuid order by i.position`,
      [fixture.quizId],
    );
    expect(saved.rows.map((row) => row.timed_out)).toEqual([true, false, true, true]);
    expect(saved.rows.filter((row) => row.timed_out).every((row) => row.given === "")).toBe(true);
  });

  it("checks per-question settings and adds a student's extra seconds to every question", async () => {
    const teacherId = await createAccount(db, "teacher");
    const { deckId } = await seedDeck(db, teacherId);
    await expect(give(db, teacherId, deckId, { timerMode: "question", questionSeconds: 5 })).rejects.toThrow(
      /10 to 600 seconds/,
    );
    await expect(
      give(db, teacherId, deckId, { timerMode: "question", questionSeconds: 30, allowBack: true }),
    ).rejects.toThrow(/not available with a timer on each question/);
    await expect(give(db, teacherId, deckId, { timerMode: "lap" })).rejects.toThrow(/Check the quiz settings/);

    const fixture = await seedQuiz(db, { timerMode: "question", questionSeconds: 20 });
    const studentId = await joinStudent(db, fixture);
    await expect(accommodate(db, fixture.teacherId, fixture.quizId, studentId, 601)).rejects.toThrow(/600 extra seconds/);
    await accommodate(db, fixture.teacherId, fixture.quizId, studentId, 40);

    const state = await studentState(db, studentId, fixture.quizId);
    expect(state).toMatchObject({ timerMode: "question", questionSeconds: 60, timeLimitSeconds: null });

    await start(db, studentId, fixture.quizId);
    const first = await current(db, studentId, fixture.quizId);
    const seconds = (Date.parse(String(first.deadline)) - Date.now()) / 1000;
    expect(seconds).toBeGreaterThan(55);
  });

  it("lets students go back and change answers until they hand the quiz in", async () => {
    const fixture = await seedQuiz(db, { allowBack: true });
    const studentId = await joinStudent(db, fixture);

    const first = await current(db, studentId, fixture.quizId);
    expect(first).toMatchObject({ position: 1, allowBack: true, feedback: false, given: null });
    expect(await answer(db, studentId, fixture, 0, "wrong")).toMatchObject({ correct: null, expected: null, finished: false });

    expect((await current(db, studentId, fixture.quizId, 4)).position).toBe(2);
    await expect(answer(db, studentId, fixture, 3)).rejects.toThrow(/no longer open/);

    const back = await current(db, studentId, fixture.quizId, 1);
    expect(back).toMatchObject({ position: 1, given: "wrong" });
    await answer(db, studentId, fixture, 0);

    for (let position = 2; position <= 4; position += 1) {
      const next = await current(db, studentId, fixture.quizId, position);
      expect(next.position).toBe(position);
      if (position < 4) await answerCard(db, studentId, fixture, next.cardId);
    }
    expect(await attemptRows(db, fixture.quizId, studentId)).toEqual([{ finished: false, correct: null }]);

    const handedIn = await submitAttempt(db, studentId, fixture.quizId);
    expect(handedIn).toMatchObject({ finished: true, timedOut: false, correctCount: 3, total: 4 });
    expect(await attemptRows(db, fixture.quizId, studentId)).toEqual([{ finished: true, correct: 3 }]);
    await expect(answer(db, studentId, fixture, 3)).rejects.toThrow(/already finished/);
  });

  it("keeps the quiz clock running while the student is away", async () => {
    const fixture = await seedQuiz(db, { timeLimitMinutes: 5 });
    const studentId = await joinStudent(db, fixture);
    await start(db, studentId, fixture.quizId);
    await answer(db, studentId, fixture, 0);

    await db.query(
      `update public.quiz_attempts set started_at = now() - interval '5 minutes 10 seconds'
       where quiz_id = $1::uuid and student_id = $2::uuid`,
      [fixture.quizId, studentId],
    );
    expect(await current(db, studentId, fixture.quizId)).toEqual({ finished: true });
    expect((await studentState(db, studentId, fixture.quizId)).latest).toMatchObject({
      timedOut: true,
      correct: 1,
      total: 4,
    });
  });

  it("finishes an attempt that was left open when the quiz stops taking answers", async () => {
    const fixture = await seedQuiz(db, {});
    const studentId = await joinStudent(db, fixture);
    await answer(db, studentId, fixture, 0);
    await db.query(`update public.quizzes set due_at = now() - interval '1 second' where id = $1::uuid`, [
      fixture.quizId,
    ]);

    const state = await studentState(db, studentId, fixture.quizId);
    expect(state.current).toBeNull();
    expect(state.latest).toMatchObject({ timedOut: false, correct: 1, total: 4 });
  });

  it("keeps one open attempt when two tabs start the quiz", async () => {
    const fixture = await seedQuiz(db, { timeLimitMinutes: 10, maxAttempts: 3 });
    const studentId = await joinStudent(db, fixture);
    const first = await start(db, studentId, fixture.quizId);
    const second = await start(db, studentId, fixture.quizId);
    expect(second).toEqual(first);
    const tabOne = await current(db, studentId, fixture.quizId);
    const tabTwo = await current(db, studentId, fixture.quizId);
    expect(tabTwo.cardId).toBe(tabOne.cardId);
    await answerCard(db, studentId, fixture, tabOne.cardId);
    await expect(answerCard(db, studentId, fixture, tabTwo.cardId)).rejects.toThrow(/no longer open/);
    expect(await attemptRows(db, fixture.quizId, studentId)).toHaveLength(1);
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

async function current(db: PGlite, studentId: string, quizId: string, position?: number): Promise<Question> {
  return asUser(db, studentId, async () => {
    const result = await db.query<{ result: unknown }>(
      `select public.quiz_current_question($1::uuid, $2::integer) as result`,
      [quizId, position ?? null],
    );
    return parse(result.rows[0].result) as Question;
  });
}

async function answer(
  db: PGlite,
  studentId: string,
  fixture: Fixture,
  index: number,
  given = fixture.cards[index].answer,
  timeout = false,
): Promise<Saved> {
  return asUser(db, studentId, async () => {
    const result = await db.query<{ result: unknown }>(
      `select public.submit_quiz_answer($1::uuid, $2::uuid, $3, $4) as result`,
      [fixture.quizId, fixture.cards[index].id, given, timeout],
    );
    return parse(result.rows[0].result) as Saved;
  });
}

async function answerCard(db: PGlite, studentId: string, fixture: Fixture, cardId: string): Promise<Saved> {
  return answer(db, studentId, fixture, fixture.cards.findIndex((card) => card.id === cardId));
}

async function start(db: PGlite, studentId: string, quizId: string): Promise<Record<string, unknown>> {
  return asUser(db, studentId, async () => {
    const result = await db.query<{ result: unknown }>(`select public.start_quiz_attempt($1::uuid) as result`, [quizId]);
    return parse(result.rows[0].result) as Record<string, unknown>;
  });
}

async function submitAttempt(db: PGlite, studentId: string, quizId: string): Promise<Record<string, unknown>> {
  return asUser(db, studentId, async () => {
    const result = await db.query<{ result: unknown }>(`select public.submit_quiz_attempt($1::uuid) as result`, [quizId]);
    return parse(result.rows[0].result) as Record<string, unknown>;
  });
}

async function studentState(db: PGlite, studentId: string, quizId: string): Promise<Record<string, unknown>> {
  return asUser(db, studentId, async () => {
    const result = await db.query<{ state: unknown }>(`select public.quiz_student_state($1::uuid) as state`, [quizId]);
    return parse(result.rows[0].state) as Record<string, unknown>;
  });
}

async function playIds(db: PGlite, userId: string, quizId: string): Promise<string[]> {
  return asUser(db, userId, async () => {
    const result = await db.query<{ cards: unknown }>(`select public.quiz_play_cards($1::uuid) as cards`, [quizId]);
    return (parse(result.rows[0].cards) as { id: string }[]).map((card) => card.id);
  });
}

async function accommodate(db: PGlite, teacherId: string, quizId: string, studentId: string, extraSeconds: number) {
  await asUser(db, teacherId, () =>
    db.query(`select public.set_quiz_accommodation($1::uuid, $2::uuid, null, $3)`, [quizId, studentId, extraSeconds]),
  );
}

async function moveDeadline(db: PGlite, quizId: string, studentId: string, cardId: string, offset: string) {
  await db.query(
    `update public.quiz_attempt_questions i set deadline = now() + $4::interval
     from public.quiz_attempts t
     where t.id = i.attempt_id and t.quiz_id = $1::uuid and t.student_id = $2::uuid and i.card_id = $3::uuid`,
    [quizId, studentId, cardId, offset],
  );
}

async function attemptOrder(db: PGlite, quizId: string, studentId: string): Promise<string[]> {
  const result = await db.query<{ ids: string[] }>(
    `select public.quiz_attempt_order(id) as ids from public.quiz_attempts
     where quiz_id = $1::uuid and student_id = $2::uuid and finished_at is null`,
    [quizId, studentId],
  );
  return result.rows[0].ids;
}

async function issuedCount(db: PGlite, quizId: string, studentId: string): Promise<number> {
  const result = await db.query<{ n: number }>(
    `select count(*)::int as n from public.quiz_attempt_questions i
     join public.quiz_attempts t on t.id = i.attempt_id
     where t.quiz_id = $1::uuid and t.student_id = $2::uuid`,
    [quizId, studentId],
  );
  return Number(result.rows[0].n);
}

async function attemptRows(db: PGlite, quizId: string, studentId: string): Promise<{ finished: boolean; correct: number | null }[]> {
  const result = await db.query<{ finished_at: string | null; correct_count: number | null }>(
    `select finished_at, correct_count from public.quiz_attempts
     where quiz_id = $1::uuid and student_id = $2::uuid order by attempt_number`,
    [quizId, studentId],
  );
  return result.rows.map((row) => ({ finished: row.finished_at != null, correct: row.correct_count }));
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
