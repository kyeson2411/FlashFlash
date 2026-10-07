import { NextResponse } from "next/server";
import Groq from "groq-sdk";
import { GROQ_MODEL, MissingApiKeyError, getGroqClient } from "@/lib/groq";
import {
  DECK_RESPONSE_FORMAT,
  MAX_INPUT_LENGTH,
  buildSystemPrompt,
  buildUserPrompt,
  isCardCount,
  parseAndValidateDeck,
  type CardCount,
  type GeneratedDeck,
} from "@/lib/flashcards";
import { MIN_CARDS_TO_SAVE, filterGeneratedDeck } from "@/lib/quality";
import { UnauthenticatedError, getStudent } from "@/lib/auth/session";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import {
  QuotaError,
  assertGenerationQuota,
  persistGeneratedDeck,
  recordGeneration,
} from "@/lib/data/decks";

function errorResponse(message: string, status: number) {
  return NextResponse.json({ success: false, error: message }, { status });
}

function logError(label: string, error: unknown) {
  if (error instanceof Groq.APIError) {
    console.error(`[generate] ${label}: Groq API error status=${error.status} message=${error.message}`);
  } else if (error instanceof Error) {
    console.error(`[generate] ${label}: ${error.name}: ${error.message}`);
  } else {
    console.error(`[generate] ${label}: unknown error`);
  }
}

export async function POST(request: Request) {
  if (!isSupabaseConfigured()) {
    return errorResponse("The server is not configured correctly. Please contact the site owner.", 500);
  }

  const student = await getStudent();
  if (!student) {
    return errorResponse("Please sign in to generate flashcards.", 401);
  }

  try {
    await assertGenerationQuota();
  } catch (error) {
    if (error instanceof QuotaError) return errorResponse(error.message, 429);
    if (error instanceof UnauthenticatedError) {
      return errorResponse("Please sign in to generate flashcards.", 401);
    }
    logError("quota check failed", error);
    return errorResponse("The server is not configured correctly. Please contact the site owner.", 500);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("Invalid request: the body must be valid JSON.", 400);
  }

  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return errorResponse('Invalid request: expected a JSON object like { "topic": "..." }.', 400);
  }

  const { topic, count, deckId } = body as { topic?: unknown; count?: unknown; deckId?: unknown };

  if (typeof topic !== "string" || topic.trim().length === 0) {
    return errorResponse("Please enter a topic or some learning material.", 400);
  }

  if (!isCardCount(count)) {
    return errorResponse("Choose 5, 10, 15, or 20 cards.", 400);
  }

  if (typeof deckId !== "string" || !UUID_RE.test(deckId)) {
    return errorResponse("Choose a deck to save these cards in.", 400);
  }
  const targetDeckId = deckId;

  const input = topic.trim();

  if (input.length > MAX_INPUT_LENGTH) {
    return errorResponse(
      `Your input is too long. Please keep it under ${MAX_INPUT_LENGTH} characters.`,
      400,
    );
  }

  let accepted: GeneratedDeck | null = null;
  try {
    accepted = await requestDeck(input, count, false);
    if (!accepted) accepted = await requestDeck(input, count, true);
  } catch (error) {
    logError("Groq request failed", error);

    if (error instanceof MissingApiKeyError) {
      return errorResponse("The server is not configured correctly. Please contact the site owner.", 500);
    }

    if (error instanceof Groq.APIError && error.status === 429) {
      return errorResponse("The AI service is busy right now. Please try again in a moment.", 429);
    }

    return errorResponse("The AI service could not generate flashcards. Please try again.", 500);
  }

  if (!accepted) {
    return errorResponse("The AI returned an unexpected response. Please try again.", 500);
  }

  try {
    const deck = await persistGeneratedDeck(accepted, input, targetDeckId);
    await recordGeneration();
    return NextResponse.json({
      success: true,
      data: { title: accepted.title, cards: accepted.cards, deckId: deck.id },
    });
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      return errorResponse("Please sign in to generate flashcards.", 401);
    }
    logError("persist failed", error);
    const message = error instanceof Error ? error.message : "";
    if (message.includes("200 cards")) {
      return errorResponse("This deck already has as many cards as it can hold. Choose another deck or start a new one.", 400);
    }
    if (message.includes("no longer available")) {
      return errorResponse("That deck is no longer available. Choose another one.", 400);
    }
    return errorResponse("Your flashcards were generated but could not be saved. Please try again.", 500);
  }
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function requestDeck(input: string, count: CardCount, retry: boolean): Promise<GeneratedDeck | null> {
  const groq = getGroqClient();
  const completion = await groq.chat.completions.create({
    model: GROQ_MODEL,
    temperature: retry ? 0.4 : 0.3,
    response_format: DECK_RESPONSE_FORMAT,
    messages: [
      { role: "system", content: buildSystemPrompt(count) },
      { role: "user", content: buildUserPrompt(input, count, retry) },
    ],
  });

  const parsed = parseAndValidateDeck(completion.choices[0]?.message?.content, count);
  if (!parsed.ok) {
    console.error(`[generate] Invalid AI response: ${parsed.reason}`);
    return null;
  }

  const filtered = filterGeneratedDeck(parsed.deck, input);
  if (filtered.reasons.length > 0) {
    console.error(`[generate] filtered cards: ${filtered.reasons.join("; ")}`);
  }
  if (filtered.cards.length < MIN_CARDS_TO_SAVE) return null;

  return { title: parsed.deck.title, cards: filtered.cards };
}
