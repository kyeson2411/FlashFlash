import "server-only";
import { needStudent } from "@/lib/auth/session";
import type { DeckWorkflowStatus } from "@/lib/deck";
import { JOIN_LIMIT_MESSAGE } from "@/lib/limits";
import { createClient } from "@/lib/supabase/server";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type ClassSummary = {
  id: string;
  name: string;
  code: string;
  createdAt: string;
  studentCount: number;
  /** Students who joined but cannot study until the teacher approves them. */
  pendingCount: number;
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
  pending: boolean;
};

export type ClassDeck = {
  id: string;
  title: string;
  cardCount: number;
  /** Students with at least one review on a card in this deck. */
  startedCount: number;
  workflowStatus: DeckWorkflowStatus;
};

export type ClassRosterRow = {
  studentId: string;
  name: string;
  known: number;
  stillToLearn: number;
  status: "active" | "pending";
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
  requireApproval: boolean;
  codeRevoked: boolean;
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

  const listedMembers = await supabase
    .from("class_members")
    .select("class_id, student_id, status")
    .in("class_id", classIds);
  const members = listedMembers.error && missingColumn(listedMembers.error, "status")
    ? (
        await supabase.from("class_members").select("class_id, student_id").in("class_id", classIds)
      ).data?.map((row) => ({ ...row, status: "active" }))
    : listedMembers.data;
  const memberError = listedMembers.error && missingColumn(listedMembers.error, "status") ? null : listedMembers.error;

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
  const pendingByClass = new Map<string, number>();
  const decksByClass = new Map<string, number>();
  const cardsByClass = new Map<string, string[]>();
  const knownByCard = new Map<string, number>();
  const startedByClass = new Map<string, Set<string>>();

  for (const member of members ?? []) {
    const classId = String(member.class_id);
    if (member.status === "pending") {
      pendingByClass.set(classId, (pendingByClass.get(classId) ?? 0) + 1);
      continue;
    }
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
        pendingCount: pendingByClass.get(id) ?? 0,
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
        pendingCount: 0,
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

export async function joinClass(code: string): Promise<{ classId: string; pending: boolean }> {
  const student = await needStudent();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("join_class", { p_code: code.trim() });
  if (error) {
    console.error("[classes] join:", error.message);
    throw new Error(joinFailure(error.message));
  }
  const payload = asRecord(data);
  if (payload && typeof payload.error === "string") {
    throw new Error(payload.error === JOIN_LIMIT_MESSAGE ? JOIN_LIMIT_MESSAGE : "That class code was not found.");
  }
  const classId = payload && typeof payload.classId === "string" ? payload.classId : null;
  if (!payload || !classId || !UUID_RE.test(classId)) {
    // The previous join_class returned a bare class id.
    if (typeof data === "string" && UUID_RE.test(data)) return { classId: data, pending: false };
    console.error("[classes] join: no id");
    throw new Error("That class code was not found.");
  }
  if (payload.status === "pending" || payload.status === "active") {
    return { classId, pending: payload.status === "pending" };
  }

  const { data: member, error: statusError } = await supabase
    .from("class_members")
    .select("status")
    .eq("class_id", classId)
    .eq("student_id", student.id)
    .maybeSingle();
  if (statusError) {
    if (missingColumn(statusError, "status")) return { classId, pending: false };
    console.error("[classes] join status:", statusError.message);
  }
  return { classId, pending: member?.status === "pending" };
}

export async function listStudentClasses(): Promise<StudentClassSummary[]> {
  const student = await needStudent();
  if (student.role !== "student") return [];

  const supabase = await createClient();
  const listed = await supabase
    .from("class_members")
    .select("class_id, status")
    .eq("student_id", student.id);
  const memberships = listed.error && missingColumn(listed.error, "status")
    ? (await supabase.from("class_members").select("class_id").eq("student_id", student.id)).data?.map((row) => ({
        ...row,
        status: "active",
      }))
    : listed.data;
  const error = listed.error && missingColumn(listed.error, "status") ? null : listed.error;

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

  const pendingByClass = new Map(
    (memberships ?? []).map((row) => [String(row.class_id), row.status === "pending"]),
  );

  return (classes ?? [])
    .map((klass) => ({
      id: String(klass.id),
      name: String(klass.name),
      deckCount: deckCount.get(String(klass.id)) ?? 0,
      stillToLearn: stillToLearn.get(String(klass.id)) ?? 0,
      pending: pendingByClass.get(String(klass.id)) ?? false,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

export async function getStudentClass(
  classId: string,
): Promise<{ id: string; name: string; pending: boolean } | null> {
  const student = await needStudent();
  if (student.role !== "student" || !UUID_RE.test(classId)) return null;

  const supabase = await createClient();
  const membership = await supabase
    .from("class_members")
    .select("status")
    .eq("class_id", classId)
    .eq("student_id", student.id)
    .maybeSingle();
  let pending = false;
  if (membership.error) {
    if (!missingColumn(membership.error, "status")) {
      console.error("[classes] student membership:", membership.error.message);
      throw new Error("Could not load this class.");
    }
  } else if (!membership.data) {
    return null;
  } else {
    pending = membership.data.status === "pending";
  }

  const { data, error } = await supabase.from("classes").select("id, name").eq("id", classId).maybeSingle();
  if (error) {
    console.error("[classes] student class:", error.message);
    throw new Error("Could not load this class.");
  }
  if (!data) return null;
  return { id: String(data.id), name: String(data.name), pending };
}

export async function getClassDetail(classId: string): Promise<ClassDetail | null> {
  const teacher = await needStudent();
  if (teacher.role !== "teacher" || !UUID_RE.test(classId)) return null;

  const supabase = await createClient();
  const loaded = await supabase
    .from("classes")
    .select("id, name, code, require_approval, code_revoked_at")
    .eq("id", classId)
    .eq("teacher_id", teacher.id)
    .maybeSingle();
  const klass = loaded.error && missingColumn(loaded.error, "require_approval")
    ? (
        await supabase.from("classes").select("id, name, code").eq("id", classId).eq("teacher_id", teacher.id).maybeSingle()
      ).data
    : loaded.data;
  const detailError = loaded.error && missingColumn(loaded.error, "require_approval") ? null : loaded.error;

  if (detailError) {
    console.error("[classes] detail:", detailError.message);
    throw new Error("Could not load this class.");
  }
  if (!klass) return null;

  const withStatus = await supabase
    .from("decks")
    .select("id, title, workflow_status")
    .eq("class_id", classId)
    .order("created_at", { ascending: false });
  const plainDecks =
    withStatus.error && /workflow_status/i.test(withStatus.error.message)
      ? await supabase.from("decks").select("id, title").eq("class_id", classId).order("created_at", { ascending: false })
      : null;
  const decks = plainDecks ? plainDecks.data : withStatus.data;
  const deckError = plainDecks ? plainDecks.error : withStatus.error;

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

  const loadedMembers = await supabase
    .from("class_members")
    .select("student_id, status")
    .eq("class_id", classId);
  const members = loadedMembers.error && missingColumn(loadedMembers.error, "status")
    ? (
        await supabase.from("class_members").select("student_id").eq("class_id", classId)
      ).data?.map((row) => ({ ...row, status: "active" }))
    : loadedMembers.data;
  const memberError = loadedMembers.error && missingColumn(loadedMembers.error, "status") ? null : loadedMembers.error;

  if (memberError) {
    console.error("[classes] members:", memberError.message);
    throw new Error("Could not load this class.");
  }

  const memberRows = (members ?? []).map((member) => ({
    studentId: String(member.student_id),
    status: member.status === "pending" ? ("pending" as const) : ("active" as const),
  }));
  const studentIds = memberRows.map((member) => member.studentId);
  const activeIds = memberRows.filter((member) => member.status === "active").map((member) => member.studentId);
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
  const activity = await loadClassProgress(cardIds, activeIds);
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

  const roster = memberRows
    .map((member) => {
      const known = knownByStudent.get(member.studentId) ?? 0;
      return {
        studentId: member.studentId,
        name: names.get(member.studentId) ?? "Student",
        known,
        stillToLearn: Math.max(0, cardIds.length - known),
        status: member.status,
        lastReviewedAt: lastReviewed.get(member.studentId) ?? null,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));

  const deckTitles = new Map((decks ?? []).map((deck) => [String(deck.id), String(deck.title)]));
  const students = activeIds.length;
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

  const notStarted =
    cardIds.length === 0
      ? []
      : roster.filter((student) => student.status === "active" && !started.has(student.studentId));

  return {
    id: String(klass.id),
    name: String(klass.name),
    code: String(klass.code),
    requireApproval: "require_approval" in klass && klass.require_approval === true,
    codeRevoked: "code_revoked_at" in klass && Boolean(klass.code_revoked_at),
    cardTotal: cardIds.length,
    decks: (decks ?? []).map((deck) => ({
      id: String(deck.id),
      title: String(deck.title),
      cardCount: counts.get(String(deck.id)) ?? 0,
      startedCount: startedByDeck.get(String(deck.id))?.size ?? 0,
      workflowStatus: classWorkflow("workflow_status" in deck ? deck.workflow_status : "published"),
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

function classWorkflow(value: unknown): DeckWorkflowStatus {
  if (value === "draft" || value === "teacher_reviewed" || value === "published") return value;
  return "published";
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

export async function regenerateClassCode(classId: string): Promise<void> {
  await classRpc("regenerate_class_code", { p_class_id: classId }, "A new code could not be made. Please try again.");
}

export async function revokeClassCode(classId: string): Promise<void> {
  await classRpc("revoke_class_code", { p_class_id: classId }, "This code could not be turned off. Please try again.");
}

export async function setClassApproval(classId: string, required: boolean): Promise<void> {
  await classRpc(
    "set_class_approval",
    { p_class_id: classId, p_required: required },
    "Approval could not be changed. Please try again.",
  );
}

export async function approveClassMember(classId: string, studentId: string): Promise<void> {
  await classRpc(
    "approve_class_member",
    { p_class_id: classId, p_student_id: studentId },
    "That student could not be approved. Please try again.",
  );
}

export async function removeClassMember(classId: string, studentId: string): Promise<void> {
  await classRpc(
    "remove_class_member",
    { p_class_id: classId, p_student_id: studentId },
    "That student could not be removed. Please try again.",
  );
}

async function classRpc(
  fn: "regenerate_class_code" | "revoke_class_code" | "set_class_approval" | "approve_class_member" | "remove_class_member",
  args: Record<string, string | boolean>,
  fallback: string,
): Promise<void> {
  const teacher = await needStudent();
  if (teacher.role !== "teacher") throw new Error("That class is no longer available.");
  const classId = String(args.p_class_id ?? "");
  const studentId = args.p_student_id;
  if (!UUID_RE.test(classId) || (typeof studentId === "string" && !UUID_RE.test(studentId))) {
    throw new Error("That class is no longer available.");
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc(fn, args);
  if (error) {
    console.error(`[classes] ${fn}:`, error.message);
    throw new Error(classRpcMessage(error.message, fallback));
  }
}

function classRpcMessage(message: string, fallback: string): string {
  if (/schema cache|does not exist|could not find the function/i.test(message)) {
    return "Class settings need a database update. Run the latest SQL migration, then try again.";
  }
  const known = [
    "That class is no longer available.",
    "Could not create a class code. Please try again.",
    "That student is not waiting for approval.",
    "That student is no longer in this class.",
  ];
  return known.find((item) => message.includes(item)) ?? fallback;
}

function joinFailure(message: string): string {
  if (message.includes(JOIN_LIMIT_MESSAGE)) return JOIN_LIMIT_MESSAGE;
  if (/schema cache|does not exist|could not find the function/i.test(message)) {
    return "Joining a class needs a database update. Run the latest SQL migration, then try again.";
  }
  return "That class code was not found.";
}

function missingColumn(error: { message?: string }, column: string): boolean {
  const message = error.message ?? "";
  return message.includes(column) || /schema cache|column/i.test(message);
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
