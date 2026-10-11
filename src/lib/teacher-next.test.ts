import { describe, expect, it } from "vitest";
import { pickTeacherNext, teacherNextDetail, type TeacherNextClass } from "@/lib/teacher-next";

function klass(partial: Partial<TeacherNextClass> & Pick<TeacherNextClass, "id">): TeacherNextClass {
  return {
    name: partial.id,
    pendingCount: 0,
    hardCardCount: 0,
    notStartedCount: 0,
    ...partial,
  };
}

describe("pickTeacherNext", () => {
  it("puts students waiting for approval first", () => {
    expect(pickTeacherNext([klass({ id: "hard", hardCardCount: 4 }), klass({ id: "wait", pendingCount: 2 })])?.id).toBe(
      "wait",
    );
  });

  it("puts hard cards before students who have not started", () => {
    expect(pickTeacherNext([klass({ id: "late", notStartedCount: 2 }), klass({ id: "hard", hardCardCount: 3 })])?.id).toBe(
      "hard",
    );
  });

  it("returns null when every class is quiet", () => {
    expect(pickTeacherNext([klass({ id: "empty" }), klass({ id: "ok" })])).toBeNull();
  });
});

describe("teacherNextDetail", () => {
  it("names the reason in plain language", () => {
    expect(teacherNextDetail(klass({ id: "a", pendingCount: 1 }))).toBe("1 student is waiting for approval.");
    expect(teacherNextDetail(klass({ id: "b", hardCardCount: 4 }))).toBe(
      "4 cards are hard for most students who studied them.",
    );
  });
});
