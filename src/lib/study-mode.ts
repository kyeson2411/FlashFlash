// How the student practices a card. This is not a score and not a grade scale.
export const STUDY_MODES = ["flip", "choice", "typing"] as const;
export type StudyMode = (typeof STUDY_MODES)[number];

export function isStudyMode(value: unknown): value is StudyMode {
  return typeof value === "string" && (STUDY_MODES as readonly string[]).includes(value);
}
