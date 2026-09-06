import { describe, expect, it } from "vitest";
import {
  createT,
  messages,
  resolveLocale,
  t,
  type MessageKey,
} from "./index";

describe("i18n catalog", () => {
  it("exposes only the English catalog", () => {
    expect(Object.keys(messages)).toEqual(["en"]);
  });

  it("interpolates variables", () => {
    expect(t("en", "project.trustFirst", { name: "Demo" })).toContain("Demo");
  });

  it("createT binds the English locale", () => {
    const tr = createT("en");
    expect(tr("sidebar.settings")).toBe("Settings");
  });

  it("every value is a non-empty string", () => {
    for (const [k, v] of Object.entries(messages.en)) {
      expect(v.trim().length, `en.${k}`).toBeGreaterThan(0);
    }
  });

  it("type surface accepts known keys only", () => {
    const key: MessageKey = "composer.send";
    expect(t("en", key)).toBeTruthy();
  });
});

describe("resolveLocale", () => {
  it("always resolves to the single supported locale (English)", () => {
    expect(resolveLocale("en")).toBe("en");
    expect(resolveLocale("zh")).toBe("en");
    expect(resolveLocale("zh-TW")).toBe("en");
    expect(resolveLocale("fr")).toBe("en");
    expect(resolveLocale("")).toBe("en");
    expect(resolveLocale(undefined)).toBe("en");
    expect(resolveLocale(null)).toBe("en");
  });
});
