import "server-only";
import { needStudent } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type ClassSummary = {
  id: string;
  name: string;
  code: string;
  createdAt: string;
  studentCount: number;
  deckCount: number;
  /** Students who have not reviewed a class card. Zero when the class has no cards. */
  notStartedCount: number;
  hasCards: boolean;
  /** A card is still learning for most of the class. Not a ranking. */
  needsAttention: boolean;
};

export type StudentClassSummary = {
  id: string;
  name: string;
  deckCount: number;
  stillToLearn: number;
};

export type ClassDeck = {
  id: string;
  title: string;
  cardCount: number;
  /** Students with at least one review on a card in this deck. */
  startedCount: number;
};

export type ClassRosterRow = {
  studentId: string;
  name: string;
  known: number;
  stillToLearn: number;
  /** Latest review of a class card, or null when they have not reviewed one. */
  lastReviewedAt: string | null;
};

export type StuckCard = {
  cardId: string;
  deckId: string;
  deckTitle: string;
  question: string;
  stillLearning: number;
  students: number;
};

export type ClassDetail = {
  id: string;
  name: string;
  code: string;
  decks: ClassDeck[];
  roster: ClassRosterRow[];
  cardTotal: number;
  /** Cards most of the class has not marked as known. Not a ranking. */
  stuckCards: StuckCard[];
  /** Students with no review on any class card, in alphabetical order. */
  notStarted: { studentId: string; name: string }[];
  /** False until last_reviewed_at can be read. The roster then omits the date. */
  activityKnown: boolean;
};

export async function listTeacherClasses(): Promise<ClassSummary[]> {
  const teacher = await needStudent();
  if (teacher.role !== "teacher") return [];
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("classes")
    .select("id, name, code, created_at")
    .eq("teacher_id", teacher.id);

  if (error) {
    console.error("[classes] list:", error.message);
    throw new Error("Could not load your classes.");
  }

  const classes = data ?? [];
  const classIds = classes.map((row) => String(row.id));
  if (classIds.length === 0) return [];

  const { data: members, error: memberError } = await supabase
    .from("class_members")
    .select("class_id, student_id")
    .in("class_id", classIds);

  if (memberError) {
    console.error("[classes] list members:", memberError.message);
    throw new Error("Could not load your classes.");
  }

  const { data: decks, error: deckError } = await supabase
    .from("decks")
    .select("id, class_id")
    .in("class_id", classIds);

  if (deckError) {
    console.error("[classes] list decks:", deckError.message);
    throw new Error("Could not load your classes.");
  }

  const deckIds = (decks ?? []).map((deck) => String(deck.id));
  const { data: cards, error: cardError } = deckIds.length
    ? await supabase.from("flashcards").select("id, deck_id").in("deck_id", deckIds)
    : { data: [], error: null };

  if (cardError) {
    console.error("[classes] list cards:", cardError.message);
    throw new Error("Could not load your classes.");
  }

  const cardIds = (cards ?? []).map((card) => String(card.id));
  const { data: progress, error: progressError } = cardIds.length
    ? await supabase.from("student_card_progress").select("student_id, card_id, state").in("card_id", cardIds)
    : { data: [], error: null };

  if (progressError) {
    console.error("[classes] list progress:", progressError.message);
    throw new Error("Could not load your classes.");
  }

  const classByDeck = new Map((decks ?? []).map((deck) => [String(deck.id), String(deck.class_id)]));
  const classByCard = new Map<string, string>();
  const studentsByClass = new Map<string, Set<string>>();
  const decksByClass = new Map<string, number>();
  const cardsByClass = new Map<string, string[]>();
  const knownByCard = new Map<string, number>();
  const startedByClass = new Map<string, Set<string>>();

  for (const member of members ?? []) {
    const classId = String(member.class_id);
    const students = studentsByClass.get(classId) ?? new Set<string>();
    students.add(String(member.student_id));
    studentsByClass.set(classId, students);
  }
  for (const deck of decks ?? []) {
    const classId = String(deck.class_id);
    decksByClass.set(classId, (decksByClass.get(classId) ?? 0) + 1);
  }
  for (const card of cards ?? []) {
    const classId = classByDeck.get(String(card.deck_id));
    if (!classId) continue;
    const cardId = String(card.id);
    classByCard.set(cardId, classId);
    const list = cardsByClass.get(classId) ?? [];
    list.push(cardId);
    cardsByClass.set(classId, list);
  }
  for (const row of progress ?? []) {
    const cardId = String(row.card_id);
    const classId = classByCard.get(cardId);
    if (!classId) continue;
    const studentId = String(row.student_id);
    if (!studentsByClass.get(classId)?.has(studentId)) continue;
    if (row.state === "known") knownByCard.set(cardId, (knownByCard.get(cardId) ?? 0) + 1);
    const started = startedByClass.get(classId) ?? new Set<string>();
    started.add(studentId);
    startedByClass.set(classId, started);
  }

  return classes
    .map((row) => {
      const id = String(row.id);
      const studentCount = studentsByClass.get(id)?.size ?? 0;
      const classCards = cardsByClass.get(id) ?? [];
      const started = startedByClass.get(id)?.size ?? 0;
      return {
        id,
        name: String(row.name),
        code: String(row.code),
        createdAt: String(row.created_at),
        studentCount,
        deckCount: decksByClass.get(id) ?? 0,
        hasCards: classCards.length > 0,
        notStartedCount: classCards.length === 0 ? 0 : Math.max(0, studentCount - started),
        needsAttention: classCards.some((cardId) =>
          majorityStillLearning(studentCount - (knownByCard.get(cardId) ?? 0), studentCount),
        ),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

function majorityStillLearning(stillLearning: number, students: number): boolean {
  return students > 0 && stillLearning * 2 > students;
}

const CLASS_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function classCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, (byte) => CLASS_CODE_ALPHABET[byte % CLASS_CODE_ALPHABET.length]).join("");
}

export async function createClass(name: string): Promise<ClassSummary> {
  const teacher = await needStudent();
  if (teacher.role !== "teacher") throw new Error("Only a teacher can create a class.");
  const clean = name.trim();
  if (clean.length < 1 || clean.length > 80) {
    throw new Error("Enter a class name between 1 and 80 characters.");
  }

  const supabase = await createClient();
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = classCode();
    const { data, error } = await supabase
      .from("classes")
      .insert({ teacher_id: teacher.id, name: clean, code })
      .select("id, name, code")
      .single();

    if (!error && data?.id && data.code) {
      return {
        id: String(data.id),
        name: String(data.name ?? clean),
        code: String(data.code),
        createdAt: "",
        studentCount: 0,
        deckCount: 0,
        notStartedCount: 0,
        hasCards: false,
        needsAttention: false,
      };
    }
    if (error?.code === "23505") continue;
    console.error("[classes] create:", error?.message ?? "no row");
    throw new Error("Your class could not be created. Please try again.");
  }

  throw new Error("Your class could not be created. Please try again.");
}

export async function joinClass(code: string): Promise<string> {
  await needStudent();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("join_class", { p_code: code.trim() });
  if (error || !data) {
    console.error("[classes] join:", error?.message ?? "no id");
    throw new Error("That class code was not found.");
  }
  return String(data);
}

export async function listStudentClasses(): Promise<StudentClassSummary[]> {
  const student = await needStudent();
  if (student.role !== "student") return [];

  const supabase = await createClient();
  const { data: memberships, error } = await supabase
    .from("class_members")
    .select("class_id")
    .eq("student_id", student.id);

  if (error) {
    console.error("[classes] student list:", error.message);
    throw new Error("Could not load your classes.");
  }

  const classIds = (memberships ?? []).map((row) => String(row.class_id));
  if (classIds.length === 0) return [];

  const { data: classes, error: classError } = await supabase
    .from("classes")
    .select("id, name")
    .in("id", classIds);

  if (classError) {
    console.error("[classes] student names:", classError.message);
    throw new Error("Could not load your classes.");
  }

  const { data: decks, error: deckError } = await supabase
    .from("decks")
    .select("id, class_id")
    .in("class_id", classIds);

  if (deckError) {
    console.error("[classes] student decks:", deckError.message);
    throw new Error("Could not load your classes.");
  }

  const deckIds = (decks ?? []).map((deck) => String(deck.id));
  const { data: cards, error: cardError } = deckIds.length
    ? await supabase.from("flashcards").select("id, deck_id").in("deck_id", deckIds)
    : { data: [], error: null };

  if (cardError) {
    console.error("[classes] student cards:", cardError.message);
    throw new Error("Could not load your classes.");
  }

  const cardIds = (cards ?? []).map((card) => String(card.id));
  const { data: knownRows, error: progressError } = cardIds.length
    ? await supabase
        .from("student_card_progress")
        .select("card_id")
        .eq("student_id", student.id)
        .eq("state", "known")
        .in("card_id", cardIds)
    : { data: [], error: null };

  if (progressError) {
    console.error("[classes] student progress:", progressError.message);
    throw new Error("Could not load your classes.");
  }

  const known = new Set((knownRows ?? []).map((row) => String(row.card_id)));
  const classByDeck = new Map((decks ?? []).map((deck) => [String(deck.id), String(deck.class_id)]));
  const deckCount = new Map<string, number>();
  const stillToLearn = new Map<string, number>();
  for (const deck of decks ?? []) {
    const classId = String(deck.class_id);
    deckCount.set(classId, (deckCount.get(classId) ?? 0) + 1);
  }
  for (const card of cards ?? []) {
    const classId = classByDeck.get(String(card.deck_id));
    if (!classId || known.has(String(card.id))) continue;
    stillToLearn.set(classId, (stillToLearn.get(classId) ?? 0) + 1);
  }

  return (classes ?? [])
    .map((klass) => ({
      id: String(klass.id),
      name: String(klass.name),
      deckCount: deckCount.get(String(klass.id)) ?? 0,
      stillToLearn: stillToLearn.get(String(klass.id)) ?? 0,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

export async function getStudentClass(classId: string): Promise<{ id: string; name: string } | null> {
  const student = await needStudent();
  if (student.role !== "student" || !UUID_RE.test(classId)) return null;

  const supabase = await createClient();
  const { data, error } = await supabase.from("classes").select("id, name").eq("id", classId).maybeSingle();
  if (error) {
    console.error("[classes] student class:", error.message);
    throw new Error("Could not load this class.");
  }
  if (!data) return null;
  return { id: String(data.id), name: String(data.name) };
}

export async function getClassDetail(classId: string): Promise<ClassDetail | null> {
  const teacher = await needStudent();
  if (teacher.role !== "teacher" || !UUID_RE.test(classId)) return null;

  const supabase = await createClient();
  const { data: klass, error } = await supabase
    .from("classes")
    .select("id, name, code")
    .eq("id", classId)
    .eq("teacher_id", teacher.id)
    .maybeSingle();

  if (error) {
    console.error("[classes] detail:", error.message);
    throw new Error("Could not load this class.");
  }
  if (!klass) return null;

  const { data: decks, error: deckError } = await supabase
    .from("decks")
    .select("id, title")
    .eq("class_id", classId)
    .order("created_at", { ascending: false });

  if (deckError) {
    console.error("[classes] decks:", deckError.message);
    throw new Error("Could not load this class.");
  }

  const deckIds = (decks ?? []).map((deck) => String(deck.id));
  const { data: cards, error: cardError } = deckIds.length
    ? await supabase.from("flashcards").select("id, deck_id, question").in("deck_id", deckIds)
    : { data: [], error: null };

  if (cardError) {
    console.error("[classes] cards:", cardError.message);
    throw new Error("Could not load this class.");
  }

  const cardIds = (cards ?? []).map((card) => String(card.id));
  const counts = new Map<string, number>();
  for (const card of cards ?? []) {
    const deckId = String(card.deck_id);
    counts.set(deckId, (counts.get(deckId) ?? 0) + 1);
  }

  const { data: members, error: memberError } = await supabase
    .from("class_members")
    .select("student_id")
    .eq("class_id", classId);

  if (memberError) {
    console.error("[classes] members:", memberError.message);
    throw new Error("Could not load this class.");
  }

  const studentIds = (members ?? []).map((member) => String(member.student_id));
  const { data: profiles, error: profileError } = studentIds.length
    ? await supabase.from("profiles").select("id, full_name").in("id", studentIds)
    : { data: [], error: null };

  if (profileError) {
    console.error("[classes] names:", profileError.message);
    throw new Error("Could not load this class.");
  }

  const names = new Map((profiles ?? []).map((profile) => [String(profile.id), String(profile.full_name)]));
  const knownByStudent = new Map<string, number>();
  const knownByCard = new Map<string, number>();
  const started = new Set<string>();
  const startedByDeck = new Map<string, Set<string>>();
  const lastReviewed = new Map<string, string>();
  const deckByCard = new Map((cards ?? []).map((card) => [String(card.id), String(card.deck_id)]));
  const activity = await loadClassProgress(cardIds, studentIds);
  for (const row of activity.rows) {
    const studentId = String(row.student_id);
    const cardId = String(row.card_id);
    started.add(studentId);
    const deckId = deckByCard.get(cardId);
    if (deckId) {
      const deckStudents = startedByDeck.get(deckId) ?? new Set<string>();
      deckStudents.add(studentId);
      startedByDeck.set(deckId, deckStudents);
    }
    rememberReview(lastReviewed, studentId, row.last_reviewed_at);
    if (row.state !== "known") continue;
    knownByStudent.set(studentId, (knownByStudent.get(studentId) ?? 0) + 1);
    knownByCard.set(cardId, (knownByCard.get(cardId) ?? 0) + 1);
  }

  const roster = studentIds
    .map((studentId) => {
      const known = knownByStudent.get(studentId) ?? 0;
      return {
        studentId,
        name: names.get(studentId) ?? "Student",
        known,
        stillToLearn: Math.max(0, cardIds.length - known),
        lastReviewedAt: lastReviewed.get(studentId) ?? null,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));

  const deckTitles = new Map((decks ?? []).map((deck) => [String(deck.id), String(deck.title)]));
  const students = studentIds.length;
  const stuckCards: StuckCard[] = (cards ?? [])
    .map((card) => {
      const known = knownByCard.get(String(card.id)) ?? 0;
      return {
        cardId: String(card.id),
        deckId: String(card.deck_id),
        deckTitle: deckTitles.get(String(card.deck_id)) ?? "Deck",
        question: String(card.question),
        stillLearning: Math.max(0, students - known),
        students,
      };
    })
    .filter((card) => majorityStillLearning(card.stillLearning, card.students))
    .sort(
      (a, b) =>
        b.stillLearning - a.stillLearning || a.question.localeCompare(b.question, undefined, { sensitivity: "base" }),
    );

  const notStarted = cardIds.length === 0 ? [] : roster.filter((student) => !started.has(student.studentId));

  return {
    id: String(klass.id),
    name: String(klass.name),
    code: String(klass.code),
    cardTotal: cardIds.length,
    decks: (decks ?? []).map((deck) => ({
      id: String(deck.id),
      title: String(deck.title),
      cardCount: counts.get(String(deck.id)) ?? 0,
      startedCount: startedByDeck.get(String(deck.id))?.size ?? 0,
    })),
    roster,
    stuckCards,
    notStarted,
    activityKnown: activity.known,
  };
}

type ProgressActivity = {
  student_id: string;
  card_id: string;
  state: string;
  last_reviewed_at?: string | null;
};

async function loadClassProgress(cardIds: string[], studentIds: string[]): Promise<{ rows: ProgressActivity[]; known: boolean }> {
  if (cardIds.length === 0 || studentIds.length === 0) return { rows: [], known: true };
  const supabase = await createClient();
  const full = await supabase
    .from("student_card_progress")
    .select("student_id, card_id, state, last_reviewed_at")
    .in("card_id", cardIds)
    .in("student_id", studentIds);

  if (!full.error) return { rows: (full.data ?? []) as ProgressActivity[], known: true };
  if (!/last_reviewed_at|column/i.test(full.error.message)) {
    console.error("[classes] progress:", full.error.message);
    throw new Error("Could not load this class.");
  }

  console.error("[classes] last_reviewed_at is not readable. Run the latest SQL migration.");
  const basic = await supabase
    .from("student_card_progress")
    .select("student_id, card_id, state")
    .in("card_id", cardIds)
    .in("student_id", studentIds);

  if (basic.error) {
    console.error("[classes] progress:", basic.error.message);
    throw new Error("Could not load this class.");
  }
  return { rows: (basic.data ?? []) as ProgressActivity[], known: false };
}

function rememberReview(latest: Map<string, string>, studentId: string, reviewedAt: string | null | undefined) {
  if (!reviewedAt) return;
  const at = Date.parse(reviewedAt);
  if (Number.isNaN(at)) return;
  const previous = latest.get(studentId);
  if (!previous || at > Date.parse(previous)) latest.set(studentId, new Date(at).toISOString());
}

export async function createClassDeck(classId: string, title: string): Promise<string> {
  const teacher = await needStudent();
  if (teacher.role !== "teacher" || !UUID_RE.test(classId)) {
    throw new Error("That class is no longer available.");
  }
  const clean = title.trim();
  if (clean.length < 1 || clean.length > 200) {
    throw new Error("Enter a deck name between 1 and 200 characters.");
  }

  const supabase = await createClient();
  const { data: klass, error: classError } = await supabase
    .from("classes")
    .select("id")
    .eq("id", classId)
    .eq("teacher_id", teacher.id)
    .maybeSingle();

  if (classError || !klass) throw new Error("That class is no longer available.");

  const { data, error } = await supabase
    .from("decks")
    .insert({ title: clean, class_id: classId })
    .select("id")
    .single();

  if (error || !data?.id) {
    console.error("[classes] create deck:", error?.message ?? "no id");
    throw new Error("Your deck could not be created. Please try again.");
  }
  return String(data.id);
}
