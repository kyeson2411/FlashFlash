import { describe, expect, it } from "vitest";
import { STUDY_MATERIAL_MARKER } from "./flashcards";
import { filterGeneratedDeck, prepareGeneratedCards, withoutExistingCards } from "./quality";

const notes = [
  "Chlorophyll is the green pigment that captures light in plant leaves during photosynthesis today",
].join(" ");

const source = `Topic: Plants${STUDY_MATERIAL_MARKER}${notes}`;

describe("filterGeneratedDeck", () => {
  it("drops long answers, duplicates, and facts the notes do not support", () => {
    const result = filterGeneratedDeck(
      {
        title: "Plants",
        cards: [
          { question: "What pigment makes leaves green?", answer: "Chlorophyll" },
          { question: "What pigment makes leaves green?", answer: "Chlorophyll" },
          { question: "Where does photosynthesis happen?", answer: "This happens inside the leaf cells of the plant" },
          { question: "Which organelle makes ATP?", answer: "Mitochondria" },
        ],
      },
      source,
    );

    expect(result.cards).toEqual([{ question: "What pigment makes leaves green?", answer: "Chlorophyll" }]);
    expect(result.reasons.join(" ")).toMatch(/duplicate/);
    expect(result.reasons.join(" ")).toMatch(/1 to 3 words/);
    expect(result.reasons.join(" ")).toMatch(/not supported/);
  });
});

describe("prepareGeneratedCards", () => {
  it("keeps a short edited answer and skips duplicates and long answers", () => {
    const result = prepareGeneratedCards(
      [
        { question: "What pigment makes leaves green?", answer: "Chlorophyll" },
        { question: "What gas do plants release?", answer: "Oxygen" },
        { question: "What gas do plants release?", answer: "Oxygen gas from leaves" },
        { question: "What is already saved?", answer: "Leaf" },
      ],
      ["What is already saved?"],
    );

    expect(result.cards).toEqual([
      { question: "What pigment makes leaves green?", answer: "Chlorophyll" },
      { question: "What gas do plants release?", answer: "Oxygen" },
    ]);
    expect(result.skipped).toBe(2);
  });
});

describe("withoutExistingCards", () => {
  it("drops a question that repeats one already in the deck", () => {
    expect(
      withoutExistingCards([{ question: "What pigment makes leaves green?", answer: "Chlorophyll" }], [
        "What pigment makes leaves green",
      ]),
    ).toEqual([]);
  });
});
