import { describe, expect, it } from "vitest";
import { sourceLine } from "./FlashcardGenerator";

describe("sourceLine", () => {
  it("asks for a topic or notes when both are empty", () => {
    expect(sourceLine("", "")).toBe("Add a topic or notes.");
  });

  it("names the topic when only a topic is given", () => {
    expect(sourceLine("Photosynthesis", "")).toBe("From the topic: Photosynthesis");
  });

  it("says the cards come from notes when only notes are given", () => {
    expect(sourceLine("", "Chlorophyll absorbs light.")).toBe("From your notes");
  });

  it("says notes are focused on the topic when both are given", () => {
    expect(sourceLine("Photosynthesis", "Chlorophyll absorbs light.")).toBe(
      "From your notes, focused on Photosynthesis",
    );
  });
});
