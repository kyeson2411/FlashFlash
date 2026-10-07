/** A name, term, or short phrase. Longer explanations are flipped instead of typed. */
export const TYPEABLE_MAX_WORDS = 3;
export const TYPEABLE_MAX_CHARS = 40;

export function isTypeableAnswer(answer: string): boolean {
  const text = answer.trim();
  if (!text) return false;
  const words = text.split(/\s+/);
  return words.length <= TYPEABLE_MAX_WORDS && text.length <= TYPEABLE_MAX_CHARS;
}
