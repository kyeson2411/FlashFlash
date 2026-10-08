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
};

export type ClassRosterRow = {
  studentId: string;
  name: string;
  known: number;
  stillToLearn: number;
};

export type ClassDetail = {
  id: string;
  name: string;
  code: string;
  decks: ClassDeck[];
  roster: ClassRosterRow[];
  cardTotal: number;
};

export async function listTeacherClasses(): Promise<ClassSummary[]> {
  const teacher = await needStudent();
  if (teacher.role !== "teacher") return [];
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("classes")
    .select("id, name, code, created_at")
    .eq("teacher_id", teacher.id)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[classes] list:", error.message);
    throw new Error("Could not load your classes.");
  }

  return (data ?? []).map((row) => ({
    id: String(row.id),
    name: String(row.name),
    code: String(row.code),
    createdAt: String(row.created_at),
  }));
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
      return { id: String(data.id), name: String(data.name ?? clean), code: String(data.code), createdAt: "" };
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
    ? await supabase.from("flashcards").select("id, deck_id").in("deck_id", deckIds)
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
  if (cardIds.length && studentIds.length) {
    const { data: progress, error: progressError } = await supabase
      .from("student_card_progress")
      .select("student_id, state")
      .eq("state", "known")
      .in("card_id", cardIds)
      .in("student_id", studentIds);

    if (progressError) {
      console.error("[classes] progress:", progressError.message);
      throw new Error("Could not load this class.");
    }
    for (const row of progress ?? []) {
      const studentId = String(row.student_id);
      knownByStudent.set(studentId, (knownByStudent.get(studentId) ?? 0) + 1);
    }
  }

  const roster = studentIds
    .map((studentId) => {
      const known = knownByStudent.get(studentId) ?? 0;
      return {
        studentId,
        name: names.get(studentId) ?? "Student",
        known,
        stillToLearn: Math.max(0, cardIds.length - known),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));

  return {
    id: String(klass.id),
    name: String(klass.name),
    code: String(klass.code),
    cardTotal: cardIds.length,
    decks: (decks ?? []).map((deck) => ({
      id: String(deck.id),
      title: String(deck.title),
      cardCount: counts.get(String(deck.id)) ?? 0,
    })),
    roster,
  };
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
