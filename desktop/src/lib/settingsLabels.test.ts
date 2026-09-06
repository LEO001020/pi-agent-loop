import { describe, expect, it } from "vitest";
import { createT } from "@/i18n";
import { buildSettingsLabels, SETTINGS_LABEL_KEYS } from "./settingsLabels";

describe("settings labels", () => {
  it("translates the complete Settings inventory without UI-local copy", () => {
    const labels = buildSettingsLabels(createT("en"));

    expect(Object.keys(labels)).toHaveLength(new Set(SETTINGS_LABEL_KEYS).size);
    expect(labels["settings.backToApp"]).toBe("Back to app");
    expect(labels["account.importChatBtn"]).toBeTruthy();
    expect(Object.values(labels).every((value) => value.trim().length > 0)).toBe(true);
  });
});
