import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asUser, migrateTestDatabase } from "@/test/db";
import { isHardCard } from "@/lib/deck";

describe("isHardCard", () => {
  it("counts only students who studied the card", () => {
    expect(isHardCard(0, 0)).toBe(false);
    expect(isHardCard(1, 2)).toBe(false);
    expect(isHardCard(2, 3)).toBe(true);
    expect(isHardCard(1, 1)).toBe(true);
    expect(isHardCard(0, 4)).toBe(false);
  });
});

describe("review decks", () => {
  let db: PGlite;

  beforeAll(async () => {
    db = await migrateTestDatabase();
  }, 120_000);

  afterAll(async () => {
    await db?.close();
  });

  it("copies the chosen cards into a new draft deck once each, in the order given", async () => {
    const teacherId = await createAccount(db, "teacher");
    const classId = await createClass(db, teacherId);
    const fil = await seedDeck(db, teacherId, classId, "Fil", [
      ["Who led the Katipunan?", "Bonifacio"],
      ["When is Independence Day?", "June 12"],
    ]);
    const quiz = await seedDeck(db, teacherId, classId, "testq", [
      ["  who led the katipunan?", "Andres Bonifacio"],
      ["Who declared Martial Law?", "Marcos"],
    ]);

    const deckId = await review(db, teacherId, classId, "Review: Oct 11", [
      fil.cards[1],
      fil.cards[0],
      quiz.cards[0],
      quiz.cards[1],
    ]);

    const deck = await db.query<{ title: string; class_id: string; owner_id: string; workflow_status: string }>(
      `select title, class_id, owner_id, workflow_status from public.decks where id = $1::uuid`,
      [deckId],
    );
    expect(deck.rows[0]).toEqual({
      title: "Review: Oct 11",
      class_id: classId,
      owner_id: teacherId,
      workflow_status: "draft",
    });

    const copies = await db.query<{ position: number; question: string; answer: string }>(
      `select position, question, answer from public.flashcards where deck_id = $1::uuid order by position`,
      [deckId],
    );
    expect(copies.rows).toEqual([
      { position: 1, question: "When is Independence Day?", answer: "June 12" },
      { position: 2, question: "Who led the Katipunan?", answer: "Bonifacio" },
      { position: 3, question: "Who declared Martial Law?", answer: "Marcos" },
    ]);

    const originals = await db.query<{ n: number }>(
      `select count(*)::int as n from public.flashcards where deck_id = any($1::uuid[])`,
      [[fil.deckId, quiz.deckId]],
    );
    expect(originals.rows[0].n).toBe(4);
  });

  it("rejects other people, cards from another class, and bad input", async () => {
    const teacherId = await createAccount(db, "teacher");
    const classId = await createClass(db, teacherId);
    const own = await seedDeck(db, teacherId, classId, "Own", [["Q one", "A"]]);

    const otherTeacher = await createAccount(db, "teacher");
    const otherClass = await createClass(db, otherTeacher);
    const foreign = await seedDeck(db, otherTeacher, otherClass, "Foreign", [["Q two", "B"]]);

    const student = await createAccount(db, "student");
    await db.query(`insert into public.class_members (class_id, student_id) values ($1::uuid, $2::uuid)`, [
      classId,
      student,
    ]);

    await expect(review(db, otherTeacher, classId, "Steal", own.cards)).rejects.toThrow(/no longer available/);
    await expect(review(db, student, classId, "Mine", own.cards)).rejects.toThrow(/no longer available/);
    await expect(review(db, teacherId, classId, "Mixed", [...own.cards, ...foreign.cards])).rejects.toThrow(
      /no longer in this class/,
    );
    await expect(review(db, teacherId, classId, "   ", own.cards)).rejects.toThrow(/deck name/);
    await expect(review(db, teacherId, classId, "Empty", [])).rejects.toThrow(/1 to 100 cards/);
    const many = Array.from({ length: 101 }, () => own.cards[0]);
    await expect(review(db, teacherId, classId, "Many", many)).rejects.toThrow(/1 to 100 cards/);
  });
});

async function review(db: PGlite, userId: string, classId: string, title: string, cardIds: string[]): Promise<string> {
  return asUser(db, userId, async () => {
    const result = await db.query<{ id: string }>(
      `select public.create_review_deck($1::uuid, $2, $3::uuid[]) as id`,
      [classId, title, cardIds],
    );
    return String(result.rows[0].id);
  });
}

async function createClass(db: PGlite, teacherId: string): Promise<string> {
  const created = await db.query<{ id: string }>(
    `insert into public.classes (teacher_id, name, code) values ($1::uuid, 'History', $2) returning id`,
    [teacherId, classCode()],
  );
  return String(created.rows[0].id);
}

async function seedDeck(
  db: PGlite,
  teacherId: string,
  classId: string,
  title: string,
  cards: [string, string][],
): Promise<{ deckId: string; cards: string[] }> {
  const deck = await db.query<{ id: string }>(
    `insert into public.decks (owner_id, title, class_id) values ($1::uuid, $2, $3::uuid) returning id`,
    [teacherId, title, classId],
  );
  const deckId = String(deck.rows[0].id);
  const ids: string[] = [];
  for (const [index, [question, answer]] of cards.entries()) {
    const card = await db.query<{ id: string }>(
      `insert into public.flashcards (deck_id, position, question, answer) values ($1::uuid, $2, $3, $4) returning id`,
      [deckId, index + 1, question, answer],
    );
    ids.push(String(card.rows[0].id));
  }
  await db.query(`update public.decks set workflow_status = 'published' where id = $1::uuid`, [deckId]);
  return { deckId, cards: ids };
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
