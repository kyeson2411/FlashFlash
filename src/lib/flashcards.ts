// Shared types for what the AI returns (GeneratedDeck / GeneratedCard), plus the prompt and validation.
// The student-facing Deck / Flashcard models (with ids and learning states) live in lib/deck.ts.
// No secrets and no Groq code here, so it is safe to import anywhere.

export const CARD_COUNT_OPTIONS = [5, 10, 15, 20] as const;
export type CardCount = (typeof CARD_COUNT_OPTIONS)[number];
export const MAX_INPUT_LENGTH = 6000;

export function isCardCount(value: unknown): value is CardCount {
  return typeof value === "number" && (CARD_COUNT_OPTIONS as readonly number[]).includes(value);
}

/** Separates a short topic from pasted notes inside the single string sent to the model. */
export const STUDY_MATERIAL_MARKER = "\n\nStudy material:\n";

export type GeneratedCard = {
  question: string;
  answer: string;
};

export type GeneratedDeck = {
  title: string;
  cards: GeneratedCard[];
};

export function buildSystemPrompt(count: CardCount): string {
  return `You are an expert teacher who writes high-quality study flashcards.

The user will give you either a short topic or a block of learning material.

Your task: create EXACTLY ${count} flashcards about it.

Rules for the flashcards:
- Focus strictly on the supplied topic or material.
- Produce exactly ${count} cards. Not fewer, not more.
- Every question must be clear and specific. Avoid vague questions such as "Tell me about X".
- Put the context in the question so the answer can be the thing to memorize.
- Every answer is 1 to 3 words: a name, term, number, or short phrase. Never a sentence.
- Do not repeat or rephrase the same card. Each card must cover a different idea.
- When learning material is supplied, only use facts that the material reasonably supports. Do not invent information.
- Write in the same language as the user's input.

Output rules (very important):
- Respond with a single JSON object and nothing else.
- Never wrap the JSON in Markdown code fences.
- Never add any text, comments, or explanations before or after the JSON.
- The JSON must have exactly this shape and no additional properties:

{
  "title": "A short title for the topic",
  "cards": [
    { "question": "Question text", "answer": "Answer text" }
  ]
}

The "cards" array must contain exactly ${count} objects. Each object has only "question" and "answer", both non-empty strings.`;
}

export function buildUserPrompt(input: string, count: CardCount, retry = false): string {
  const base = `Create ${count} flashcards from the following topic or material:\n\n"""\n${input}\n"""`;
  if (!retry) return base;
  return `${base}\n\nThe previous set was not saved because cards repeated each other, were not supported by the notes, or the answers were sentences. Write ${count} cards that each cover a different fact. Every answer must be 1 to 3 words, never a sentence.`;
}

/** Strict shape for Groq structured output. Count and wording are checked again in code. */
export const DECK_RESPONSE_FORMAT = {
  type: "json_schema" as const,
  json_schema: {
    name: "flashcard_deck",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["title", "cards"],
      properties: {
        title: { type: "string" },
        cards: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["question", "answer"],
            properties: {
              question: { type: "string" },
              answer: { type: "string" },
            },
          },
        },
      },
    },
  },
};

export type ValidationResult =
  | { ok: true; deck: GeneratedDeck }
  | { ok: false; reason: string };

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Parses and strictly validates the raw text returned by the model.
 * Never throws: returns { ok: false, reason } for anything malformed.
 * The `reason` is for server logs only, not for the client.
 */
export function parseAndValidateDeck(raw: string | null | undefined, count: CardCount): ValidationResult {
  if (!raw || !raw.trim()) {
    return { ok: false, reason: "Model returned an empty response" };
  }

  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { ok: false, reason: "Model response is not valid JSON" };
  }

  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return { ok: false, reason: "Model response is not a JSON object" };
  }

  const { title, cards } = data as Record<string, unknown>;

  if (!isNonEmptyString(title)) {
    return { ok: false, reason: "Missing or empty title" };
  }

  if (!Array.isArray(cards)) {
    return { ok: false, reason: "cards is not an array" };
  }

  if (cards.length !== count) {
    return {
      ok: false,
      reason: `Expected ${count} cards but received ${cards.length}`,
    };
  }

  const cleanCards: GeneratedCard[] = [];

  for (let i = 0; i < cards.length; i++) {
    const card: unknown = cards[i];

    if (typeof card !== "object" || card === null || Array.isArray(card)) {
      return { ok: false, reason: `Card ${i + 1} is not an object` };
    }

    const { question, answer } = card as Record<string, unknown>;

    if (!isNonEmptyString(question)) {
      return { ok: false, reason: `Card ${i + 1} is missing a question` };
    }

    if (!isNonEmptyString(answer)) {
      return { ok: false, reason: `Card ${i + 1} is missing an answer` };
    }

    // Copy only the allowed properties; any extras are dropped.
    cleanCards.push({ question: question.trim(), answer: answer.trim() });
  }

  return { ok: true, deck: { title: title.trim(), cards: cleanCards } };
}
