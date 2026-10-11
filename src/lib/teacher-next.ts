export type TeacherNextClass = {
  id: string;
  name: string;
  pendingCount: number;
  hardCardCount: number;
  notStartedCount: number;
};

/** Students waiting, then hard cards, then students who have not started. */
export function pickTeacherNext<T extends TeacherNextClass>(classes: T[]): T | null {
  return (
    classes.find((klass) => klass.pendingCount > 0) ??
    classes.find((klass) => klass.hardCardCount > 0) ??
    classes.find((klass) => klass.notStartedCount > 0) ??
    null
  );
}

export function teacherNextDetail(klass: TeacherNextClass): string {
  if (klass.pendingCount > 0) {
    return klass.pendingCount === 1
      ? "1 student is waiting for approval."
      : `${klass.pendingCount} students are waiting for approval.`;
  }
  if (klass.hardCardCount > 0) {
    return klass.hardCardCount === 1
      ? "1 card is hard for most students who studied it."
      : `${klass.hardCardCount} cards are hard for most students who studied them.`;
  }
  if (klass.notStartedCount > 0) {
    return klass.notStartedCount === 1
      ? "1 student has not started."
      : `${klass.notStartedCount} students have not started.`;
  }
  return "Open this class.";
}
