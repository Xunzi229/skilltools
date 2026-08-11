import {
  DEFAULT_TRANSLATE_SETTINGS,
  isModelServiceConfigured,
  isTranslateConfigured,
  normalizeTranslateSettings,
} from "./translateSettings";
import { describe, expect, it } from "vitest";

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
    expect(isModelServiceConfigured(DEFAULT_TRANSLATE_SETTINGS)).toBe(false);
    expect(
      isModelServiceConfigured({
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
