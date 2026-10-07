import "server-only";
import Groq from "groq-sdk";

// Server-side only. The "server-only" import above makes the build fail if
// this file is ever imported from a client component, so the API key can
// never be bundled into browser code.

// NOTE: the originally requested "llama-3.1-70b-versatile" was decommissioned by
// Groq (the API returns `model_decommissioned`), and no Llama chat models are
// available on this account. "openai/gpt-oss-120b" is the default instead.
// Set the optional GROQ_MODEL env var to use a different model.
export const GROQ_MODEL = process.env.GROQ_MODEL?.trim() || "openai/gpt-oss-120b";

export class MissingApiKeyError extends Error {
  constructor() {
    super("GROQ_API_KEY is not configured");
    this.name = "MissingApiKeyError";
  }
}

let client: Groq | null = null;

export function getGroqClient(): Groq {
  const apiKey = process.env.GROQ_API_KEY?.trim();

  if (!apiKey) {
    throw new MissingApiKeyError();
  }

  if (!client) {
    client = new Groq({ apiKey });
  }

  return client;
}
