import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asUser, migrateTestDatabase } from "@/test/db";
import { deckWorkflowStep } from "@/lib/deck";

describe("deckWorkflowStep", () => {
  it("offers one next action per status", () => {
    expect(deckWorkflowStep("draft")).toEqual({ index: 0, next: "teacher_reviewed", nextLine: "Next: mark reviewed" });
    expect(deckWorkflowStep("teacher_reviewed")).toEqual({ index: 1, next: "published", nextLine: "Next: publish" });
    expect(deckWorkflowStep("published")).toEqual({ index: 2, next: null, nextLine: "Ready to give as a quiz" });
  });
});

describe("deck workflow", () => {
  let db: PGlite;

  beforeAll(async () => {
    db = await migrateTestDatabase();
  }, 120_000);

  afterAll(async () => {
    await db?.close();
  });

  it("hides a class deck until it is published and records each later edit", async () => {
    const teacherId = await createAccount(db, "teacher");
    const studentId = await createAccount(db, "student");
    const { classId, code } = await seedClass(db, teacherId);
    expect((await join(db, studentId, code)).status).toBe("active");

    const deckId = await insertDeck(db, teacherId, classId);
    expect(await workflowStatus(db, deckId)).toBe("draft");
    expect(await visibleDeckIds(db, studentId, classId)).toEqual([]);
    await expect(setWorkflow(db, studentId, deckId, "teacher_reviewed")).rejects.toThrow(/no longer available/);
    await expect(setWorkflow(db, teacherId, deckId, "published")).rejects.toThrow(/reviewed before publishing/);

    expect(await setWorkflow(db, teacherId, deckId, "teacher_reviewed")).toBe("teacher_reviewed");
    expect(await visibleDeckIds(db, studentId, classId)).toEqual([]);
    await expect(setWorkflow(db, teacherId, deckId, "published")).rejects.toThrow(/no cards/);
    await expect(giveQuiz(db, teacherId, deckId)).rejects.toThrow(/Publish this deck before giving it as a quiz/);

    const cardId = await insertCard(db, deckId, "Where does photosynthesis happen?", "Chloroplast");
    expect(await visibleCardIds(db, studentId, deckId)).toEqual([]);
    await expect(review(db, studentId, cardId)).rejects.toThrow(/Not allowed/);

    expect(await setWorkflow(db, teacherId, deckId, "published")).toBe("published");
    const published = await versionTexts(db, deckId);
    expect(published.map((row) => row.number)).toEqual([1]);
    expect(published[0].cards).toContain("Where does photosynthesis happen?");
    expect(await visibleDeckIds(db, studentId, classId)).toEqual([deckId]);
    expect(await visibleCardIds(db, studentId, deckId)).toEqual([cardId]);

    await review(db, studentId, cardId);
    await undo(db, studentId, cardId);
    expect(await giveQuiz(db, teacherId, deckId)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );

    await asUser(db, teacherId, () =>
      db.query(`update public.flashcards set question = 'What organelle makes sugar?' where id = $1::uuid`, [cardId]),
    );
    await asUser(db, teacherId, () =>
      db.query(
        `insert into public.flashcards (deck_id, position, question, answer)
         values ($1::uuid, 2, 'Second question', 'Second answer'),
                ($1::uuid, 3, 'Third question', 'Third answer')`,
        [deckId],
      ),
    );

    const edited = await versionTexts(db, deckId);
    expect(edited.map((row) => row.number)).toEqual([1, 2, 3]);
    expect(edited[0].cards).toContain("Where does photosynthesis happen?");
    expect(edited[1].cards).toContain("What organelle makes sugar?");
    expect(edited[2].cards).toContain("Second question");
    expect(edited[2].cards).toContain("Third question");
    expect(await asUser(db, studentId, () => versionNumbers(db, deckId))).toEqual([]);
    expect(await asUser(db, teacherId, () => versionNumbers(db, deckId))).toEqual([3, 2, 1]);
    await expect(insertVersion(db, teacherId, deckId)).rejects.toThrow(/permission denied/i);

    await asUser(db, teacherId, () => db.query(`delete from public.flashcards where deck_id = $1::uuid`, [deckId]));
    const cleared = await versionTexts(db, deckId);
    expect(cleared.map((row) => row.number)).toEqual([1, 2, 3, 4]);
    expect(cleared[3].cards).toBe("[]");
    expect(await visibleCardIds(db, studentId, deckId)).toEqual([]);
  });

  it("leaves personal decks unpublished and still hides a draft from people who should not study it", async () => {
    const teacherId = await createAccount(db, "teacher");
    const studentId = await createAccount(db, "student");
    const waitingId = await createAccount(db, "student");
    const outsiderId = await createAccount(db, "student");
    const { classId, code } = await seedClass(db, teacherId);

    const personal = await asUser(db, teacherId, async () => {
      const result = await db.query<{ workflow_status: string | null }>(
        `insert into public.decks (owner_id, title, workflow_status)
         values ($1::uuid, 'My notes', 'published')
         returning workflow_status`,
        [teacherId],
      );
      return result.rows[0].workflow_status;
    });
    expect(personal).toBeNull();
    const personalId = await ownedDeckId(db, teacherId, "My notes");
    await insertCard(db, personalId, "Personal question", "Personal answer");
    expect(await versionTexts(db, personalId)).toEqual([]);
    expect(await visibleDeckIds(db, teacherId, null)).toContain(personalId);

    const forced = await asUser(db, teacherId, async () => {
      const result = await db.query<{ id: string; workflow_status: string | null }>(
        `insert into public.decks (owner_id, title, class_id, workflow_status)
         values ($1::uuid, 'Sneak', $2::uuid, 'published')
         returning id, workflow_status`,
        [teacherId, classId],
      );
      return result.rows[0];
    });
    expect(forced.workflow_status).toBe("draft");

    expect((await join(db, studentId, code)).status).toBe("active");
    expect(await visibleDeckIds(db, studentId, classId)).toEqual([]);
    expect(await visibleDeckIds(db, outsiderId, classId)).toEqual([]);

    const liveId = await insertDeck(db, teacherId, classId, "Live");
    await db.query(`update public.decks set workflow_status = 'published' where id = $1::uuid`, [liveId]);
    const cardId = await insertCard(db, liveId, "Visible question", "Visible answer");
    expect(await visibleDeckIds(db, studentId, classId)).toEqual([liveId]);
    expect(await visibleCardIds(db, studentId, liveId)).toEqual([cardId]);
    expect(await visibleDeckIds(db, outsiderId, classId)).toEqual([]);

    await asUser(db, teacherId, () => db.query(`select public.set_class_approval($1::uuid, true)`, [classId]));
    expect((await join(db, waitingId, code)).status).toBe("pending");
    expect(await visibleDeckIds(db, waitingId, classId)).toEqual([]);
    expect(await visibleCardIds(db, waitingId, liveId)).toEqual([]);
    await expect(review(db, waitingId, cardId)).rejects.toThrow(/Not allowed/);
    expect(await visibleDeckIds(db, studentId, classId)).toEqual([liveId]);
  });
});

async function seedClass(db: PGlite, teacherId: string): Promise<{ classId: string; code: string }> {
  const code = classCode();
  const created = await db.query<{ id: string }>(
    `insert into public.classes (teacher_id, name, code)
     values ($1::uuid, 'Biology', $2)
     returning id`,
    [teacherId, code],
  );
  return { classId: String(created.rows[0].id), code };
}

async function insertDeck(db: PGlite, ownerId: string, classId: string, title = "Cells"): Promise<string> {
  const result = await db.query<{ id: string }>(
    `insert into public.decks (owner_id, title, class_id)
     values ($1::uuid, $2, $3::uuid)
     returning id`,
    [ownerId, title, classId],
  );
  return String(result.rows[0].id);
}

async function insertCard(db: PGlite, deckId: string, question: string, answer: string): Promise<string> {
  const result = await db.query<{ id: string }>(
    `insert into public.flashcards (deck_id, position, question, answer)
     values ($1::uuid, 1, $2, $3)
     returning id`,
    [deckId, question, answer],
  );
  return String(result.rows[0].id);
}

async function workflowStatus(db: PGlite, deckId: string): Promise<string | null> {
  const result = await db.query<{ workflow_status: string | null }>(
    `select workflow_status from public.decks where id = $1::uuid`,
    [deckId],
  );
  return result.rows[0]?.workflow_status ?? null;
}

async function setWorkflow(
  db: PGlite,
  userId: string,
  deckId: string,
  status: "teacher_reviewed" | "published",
): Promise<string> {
  return asUser(db, userId, async () => {
    const result = await db.query<{ status: string }>(
      `select public.set_deck_workflow($1::uuid, $2) as status`,
      [deckId, status],
    );
    return String(result.rows[0].status);
  });
}

async function giveQuiz(db: PGlite, teacherId: string, deckId: string): Promise<string> {
  return asUser(db, teacherId, async () => {
    const result = await db.query<{ id: string }>(
      `select public.give_class_quiz($1::uuid, now() + interval '1 day') as id`,
      [deckId],
    );
    return String(result.rows[0].id);
  });
}

async function review(db: PGlite, studentId: string, cardId: string): Promise<void> {
  await asUser(db, studentId, () => db.query(`select public.review_flashcard($1::uuid, 'known', 'flip')`, [cardId]));
}

async function undo(db: PGlite, studentId: string, cardId: string): Promise<void> {
  await asUser(db, studentId, () => db.query(`select public.undo_last_review($1::uuid)`, [cardId]));
}

async function versionTexts(db: PGlite, deckId: string): Promise<{ number: number; cards: string }[]> {
  const result = await db.query<{ version_number: number; cards: string }>(
    `select version_number, cards::text as cards
     from public.deck_versions
     where deck_id = $1::uuid
     order by version_number`,
    [deckId],
  );
  return result.rows.map((row) => ({ number: Number(row.version_number), cards: String(row.cards) }));
}

async function versionNumbers(db: PGlite, deckId: string): Promise<number[]> {
  const result = await db.query<{ version_number: number }>(
    `select version_number
     from public.deck_versions
     where deck_id = $1::uuid
     order by version_number desc`,
    [deckId],
  );
  return result.rows.map((row) => Number(row.version_number));
}

async function insertVersion(db: PGlite, userId: string, deckId: string): Promise<void> {
  await asUser(db, userId, () =>
    db.query(
      `insert into public.deck_versions (deck_id, version_number, cards, edited_by)
       values ($1::uuid, 99, '[]'::jsonb, $2::uuid)`,
      [deckId, userId],
    ),
  );
}

async function visibleDeckIds(db: PGlite, userId: string, classId: string | null): Promise<string[]> {
  return asUser(db, userId, async () => {
    const result = classId
      ? await db.query<{ id: string }>(`select id from public.decks where class_id = $1::uuid`, [classId])
      : await db.query<{ id: string }>(`select id from public.decks where class_id is null`);
    return result.rows.map((row) => String(row.id)).sort();
  });
}

async function visibleCardIds(db: PGlite, userId: string, deckId: string): Promise<string[]> {
  return asUser(db, userId, async () => {
    const result = await db.query<{ id: string }>(`select id from public.flashcards where deck_id = $1::uuid`, [deckId]);
    return result.rows.map((row) => String(row.id)).sort();
  });
}

async function ownedDeckId(db: PGlite, ownerId: string, title: string): Promise<string> {
  const result = await db.query<{ id: string }>(
    `select id from public.decks where owner_id = $1::uuid and title = $2`,
    [ownerId, title],
  );
  return String(result.rows[0].id);
}

async function join(db: PGlite, studentId: string, code: string): Promise<{ status?: string; error?: string }> {
  return asUser(db, studentId, async () => {
    const result = await db.query<{ result: unknown }>(`select public.join_class($1) as result`, [code]);
    const parsed = typeof result.rows[0].result === "string" ? JSON.parse(result.rows[0].result) : result.rows[0].result;
    if (!parsed || typeof parsed !== "object") return {};
    const row = parsed as Record<string, unknown>;
    return {
      status: typeof row.status === "string" ? row.status : undefined,
      error: typeof row.error === "string" ? row.error : undefined,
    };
  });
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
