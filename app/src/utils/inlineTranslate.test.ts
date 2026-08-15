import {
  findFlexibleRange,
  pairSentences,
  segmentWithTranslations,
  splitSentences,
} from "./inlineTranslate";

describe("splitSentences", () => {
  it("splits Chinese and English sentences", () => {
    expect(splitSentences("你好。世界！")).toEqual(["你好。", "世界！"]);
    expect(splitSentences("Hello. World!")).toEqual(["Hello.", "World!"]);
  });

  it("does not split decimals", () => {
    expect(splitSentences("Use 3.14 as pi.")).toEqual(["Use 3.14 as pi."]);
  });

  it("falls back to lines when there is no punctuation", () => {
    expect(splitSentences("alpha\nbeta")).toEqual(["alpha", "beta"]);
  });
});

describe("pairSentences", () => {
  it("zips when sentence counts match", () => {
    expect(pairSentences("A。B。", "甲。乙。")).toEqual([
      { original: "A。", translation: "甲。" },
      { original: "B。", translation: "乙。" },
    ]);
  });

  it("falls back to one block when counts differ", () => {
    expect(pairSentences("A。B。", "整段译文")).toEqual([
      { original: "A。B。", translation: "整段译文" },
    ]);
  });
});

describe("findFlexibleRange", () => {
  it("matches ignoring extra whitespace", () => {
    expect(findFlexibleRange("Hello   world.", "Hello world.")).toEqual({
      start: 0,
      end: 14,
    });
  });
});

describe("segmentWithTranslations", () => {
  it("injects after each matching sentence and keeps the rest", () => {
    const segments = segmentWithTranslations("Hello. World. Extra.", [
      { original: "Hello.", translation: "你好。" },
      { original: "World.", translation: "世界。" },
    ]);
    expect(segments).toEqual([
      {
        type: "sentence",
        original: "Hello.",
        translation: "你好。",
        pending: false,
        error: null,
      },
      { type: "text", text: " " },
      {
        type: "sentence",
        original: "World.",
        translation: "世界。",
        pending: false,
        error: null,
      },
      { type: "text", text: " Extra." },
    ]);
  });

  it("returns null when nothing matches", () => {
    expect(
      segmentWithTranslations("Unrelated.", [{ original: "Hello.", translation: "你好。" }]),
    ).toBeNull();
  });
});
