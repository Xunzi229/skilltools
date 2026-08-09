import { describe, expect, it } from "vitest";
import {
  DEFAULT_TRANSLATE_SETTINGS,
  isTranslateConfigured,
  normalizeTranslateSettings,
} from "./translateSettings";

describe("translateSettings", () => {
  it("normalizes missing fields", () => {
    expect(normalizeTranslateSettings(undefined)).toEqual(DEFAULT_TRANSLATE_SETTINGS);
    expect(
      normalizeTranslateSettings({
        baseUrl: " https://api.openai.com/v1/ ",
        apiKey: " sk ",
        model: " gpt-4o-mini ",
        targetLang: " ",
      }),
    ).toEqual({
      baseUrl: "https://api.openai.com/v1/",
      apiKey: " sk ",
      model: "gpt-4o-mini",
      targetLang: "中文",
    });
  });

  it("detects complete configuration", () => {
    expect(isTranslateConfigured(DEFAULT_TRANSLATE_SETTINGS)).toBe(false);
    expect(
      isTranslateConfigured({
        translate: {
          baseUrl: "https://api.openai.com/v1",
          apiKey: "sk-test",
          model: "gpt-4o-mini",
          targetLang: "English",
        },
      }),
    ).toBe(true);
  });
});
