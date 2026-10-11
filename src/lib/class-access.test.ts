import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asUser, migrateTestDatabase } from "@/test/db";

describe("class access", () => {
  let db: PGlite;

  beforeAll(async () => {
    db = await migrateTestDatabase();
  }, 120_000);

  afterAll(async () => {
    await db?.close();
  });

  it("stops checking class codes after 8 wrong attempts in the window", async () => {
    const studentId = await createAccount(db, "student");
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const result = await join(db, studentId, "NOPE00");
      expect(result.error).toBe("That class code was not found.");
    }
    expect(await attemptCount(db, studentId)).toBe(8);

    const locked = await join(db, studentId, "NOPE00");
    expect(locked.error).toBe("Too many attempts. Please wait a few minutes and try again.");
    expect(await attemptCount(db, studentId)).toBe(8);

    const { classId, code } = await seedClass(db);
    const duringLock = await join(db, studentId, code);
    expect(duringLock.error).toBe("Too many attempts. Please wait a few minutes and try again.");
    expect(await memberStatus(db, classId, studentId)).toBeNull();

    await db.query(
      `update public.class_join_attempts
       set attempted_at = now() - interval '16 minutes'
       where student_id = $1::uuid`,
      [studentId],
    );
    const joined = await join(db, studentId, code);
    expect(joined.classId).toBe(classId);
    expect(joined.status).toBe("active");
  });

  it("replaces a code when it is regenerated and rejects a code that was turned off", async () => {
    const teacherId = await createAccount(db, "teacher");
    const studentId = await createAccount(db, "student");
    const newcomerId = await createAccount(db, "student");
    const { classId, code } = await seedClass(db, teacherId);

    expect((await join(db, studentId, code)).status).toBe("active");

    await asUser(db, teacherId, () => db.query(`select public.revoke_class_code($1::uuid)`, [classId]));
    expect((await join(db, newcomerId, code)).error).toBe("That class code was not found.");
    expect(await memberStatus(db, classId, studentId)).toBe("active");

    const regenerated = await asUser(db, teacherId, async () => {
      const result = await db.query<{ code: string }>(
        `select public.regenerate_class_code($1::uuid) as code`,
        [classId],
      );
      return String(result.rows[0].code);
    });
    expect(regenerated).not.toBe(code);
    expect((await join(db, newcomerId, code)).error).toBe("That class code was not found.");
    expect((await join(db, newcomerId, regenerated)).status).toBe("active");
    expect(await memberStatus(db, classId, studentId)).toBe("active");

    const revoked = await db.query<{ code_revoked_at: string | null }>(
      `select code_revoked_at from public.classes where id = $1::uuid`,
      [classId],
    );
    expect(revoked.rows[0].code_revoked_at).toBeNull();
  });

  it("keeps a new student pending until the teacher approves them", async () => {
    const teacherId = await createAccount(db, "teacher");
    const currentId = await createAccount(db, "student");
    const waitingId = await createAccount(db, "student");
    const laterId = await createAccount(db, "student");
    const outsiderId = await createAccount(db, "student");
    const { classId, code, deckId, cardId, quizId } = await seedClass(db, teacherId, { withWork: true });

    expect((await join(db, currentId, code)).status).toBe("active");
    await asUser(db, teacherId, () => db.query(`select public.set_class_approval($1::uuid, true)`, [classId]));
    expect(await memberStatus(db, classId, currentId)).toBe("active");

    expect((await join(db, waitingId, code)).status).toBe("pending");
    expect(await asUser(db, waitingId, () => flag(db, `select public.is_class_member($1::uuid) as ok`, [classId]))).toBe(false);
    expect(await visibleIds(db, waitingId, "decks", classId)).toEqual([]);
    expect(await visibleIds(db, waitingId, "quizzes", classId)).toEqual([]);
    expect(await visibleCardIds(db, waitingId, deckId)).toEqual([]);
    expect(await visibleIds(db, waitingId, "classes", classId)).toEqual([classId]);
    await expect(
      asUser(db, waitingId, () => db.query(`select public.review_flashcard($1::uuid, 'known', 'flip')`, [cardId])),
    ).rejects.toThrow(/Not allowed/);

    expect(await visibleIds(db, outsiderId, "decks", classId)).toEqual([]);
    expect(await visibleIds(db, outsiderId, "quizzes", classId)).toEqual([]);
    expect(await visibleIds(db, outsiderId, "classes", classId)).toEqual([]);
    expect(await visibleIds(db, teacherId, "decks", classId)).toEqual([deckId]);
    expect(await visibleIds(db, teacherId, "quizzes", classId)).toEqual([quizId]);
    await expect(asUser(db, waitingId, () => db.query(`select * from public.class_join_attempts`))).rejects.toThrow(
      /permission denied/i,
    );
    await expect(
      asUser(db, waitingId, () => db.query(`select public.regenerate_class_code($1::uuid)`, [classId])),
    ).rejects.toThrow(/no longer available/);
    await expect(
      asUser(db, waitingId, () => db.query(`select public.approve_class_member($1::uuid, $2::uuid)`, [classId, waitingId])),
    ).rejects.toThrow(/no longer available/);

    await asUser(db, teacherId, () => db.query(`select public.set_class_approval($1::uuid, false)`, [classId]));
    expect(await memberStatus(db, classId, waitingId)).toBe("pending");
    expect((await join(db, laterId, code)).status).toBe("active");

    await asUser(db, teacherId, () =>
      db.query(`select public.approve_class_member($1::uuid, $2::uuid)`, [classId, waitingId]),
    );
    expect(await memberStatus(db, classId, waitingId)).toBe("active");
    expect(await visibleIds(db, waitingId, "decks", classId)).toEqual([deckId]);
    expect(await visibleIds(db, waitingId, "quizzes", classId)).toEqual([quizId]);
    expect(await visibleCardIds(db, waitingId, deckId)).toEqual([cardId]);
    await asUser(db, waitingId, () => db.query(`select public.review_flashcard($1::uuid, 'known', 'flip')`, [cardId]));
    const progress = await db.query(
      `select state from public.student_card_progress where student_id = $1::uuid and card_id = $2::uuid`,
      [waitingId, cardId],
    );
    expect(progress.rows).toHaveLength(1);

    await asUser(db, teacherId, () =>
      db.query(`select public.remove_class_member($1::uuid, $2::uuid)`, [classId, waitingId]),
    );
    expect(await memberStatus(db, classId, waitingId)).toBeNull();
    expect(await visibleIds(db, waitingId, "decks", classId)).toEqual([]);
    expect(await visibleIds(db, waitingId, "classes", classId)).toEqual([]);
  });

  it("treats members added before approval existed as active", async () => {
    const teacherId = await createAccount(db, "teacher");
    const studentId = await createAccount(db, "student");
    const { classId } = await seedClass(db, teacherId);
    await db.query(`insert into public.class_members (class_id, student_id) values ($1::uuid, $2::uuid)`, [
      classId,
      studentId,
    ]);
    expect(await memberStatus(db, classId, studentId)).toBe("active");
    const approval = await db.query<{ require_approval: boolean }>(
      `select require_approval from public.classes where id = $1::uuid`,
      [classId],
    );
    expect(approval.rows[0].require_approval).toBe(false);
  });
});

type JoinResult = { error?: string; classId?: string; status?: string };

async function join(db: PGlite, studentId: string, code: string): Promise<JoinResult> {
  return asUser(db, studentId, async () => {
    const result = await db.query<{ result: unknown }>(`select public.join_class($1) as result`, [code]);
    return asJoinResult(result.rows[0].result);
  });
}

async function attemptCount(db: PGlite, studentId: string): Promise<number> {
  const result = await db.query<{ n: number }>(
    `select count(*)::int as n from public.class_join_attempts where student_id = $1::uuid`,
    [studentId],
  );
  return Number(result.rows[0].n);
}

async function memberStatus(db: PGlite, classId: string, studentId: string): Promise<string | null> {
  const result = await db.query<{ status: string }>(
    `select status from public.class_members where class_id = $1::uuid and student_id = $2::uuid`,
    [classId, studentId],
  );
  return result.rows[0]?.status ?? null;
}

async function visibleIds(
  db: PGlite,
  userId: string,
  table: "decks" | "quizzes" | "classes",
  classId: string,
): Promise<string[]> {
  const column = table === "classes" ? "id" : "class_id";
  return asUser(db, userId, async () => {
    const result = await db.query<{ id: string }>(
      `select id from public.${table} where ${column} = $1::uuid`,
      [classId],
    );
    return result.rows.map((row) => String(row.id)).sort();
  });
}

async function visibleCardIds(db: PGlite, userId: string, deckId: string): Promise<string[]> {
  return asUser(db, userId, async () => {
    const result = await db.query<{ id: string }>(`select id from public.flashcards where deck_id = $1::uuid`, [deckId]);
    return result.rows.map((row) => String(row.id)).sort();
  });
}

async function flag(db: PGlite, sql: string, params: unknown[]): Promise<boolean> {
  const result = await db.query<{ ok: boolean }>(sql, params);
  return result.rows[0].ok === true;
}

async function seedClass(
  db: PGlite,
  teacherId = "",
  options: { withWork?: boolean } = {},
): Promise<{ classId: string; code: string; deckId: string; cardId: string; quizId: string }> {
  const ownerId = teacherId || (await createAccount(db, "teacher"));
  const code = classCode();
  const created = await db.query<{ id: string }>(
    `insert into public.classes (teacher_id, name, code)
     values ($1::uuid, 'Biology', $2)
     returning id`,
    [ownerId, code],
  );
  const classId = String(created.rows[0].id);
  const deck = await db.query<{ id: string }>(
    `insert into public.decks (owner_id, title, class_id)
     values ($1::uuid, 'Cells', $2::uuid)
     returning id`,
    [ownerId, classId],
  );
  const deckId = String(deck.rows[0].id);
  await db.query(`update public.decks set workflow_status = 'published' where id = $1::uuid`, [deckId]);
  let cardId = "";
  let quizId = "";
  if (options.withWork) {
    const card = await db.query<{ id: string }>(
      `insert into public.flashcards (deck_id, position, question, answer)
       values ($1::uuid, 1, 'Where does photosynthesis happen?', 'Chloroplast')
       returning id`,
      [deckId],
    );
    cardId = String(card.rows[0].id);
    const quiz = await db.query<{ id: string }>(
      `insert into public.quizzes (class_id, deck_id, title, cards, due_at, created_by)
       values ($1::uuid, $2::uuid, 'Cells quiz', $3::jsonb, now() + interval '2 days', $4::uuid)
       returning id`,
      [classId, deckId, JSON.stringify([{ id: cardId, question: "Where does photosynthesis happen?", answer: "Chloroplast" }]), ownerId],
    );
    quizId = String(quiz.rows[0].id);
  }
  return { classId, code, deckId, cardId, quizId };
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

function asJoinResult(value: unknown): JoinResult {
  const parsed = typeof value === "string" ? JSON.parse(value) : value;
  if (!parsed || typeof parsed !== "object") return {};
  const row = parsed as Record<string, unknown>;
  return {
    error: typeof row.error === "string" ? row.error : undefined,
    classId: typeof row.classId === "string" ? row.classId : undefined,
    status: typeof row.status === "string" ? row.status : undefined,
  };
}
