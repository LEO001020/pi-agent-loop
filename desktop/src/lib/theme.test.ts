import { describe, expect, it } from "vitest";
import {
  DEFAULT_THEME,
  loadTheme,
  parseTheme,
  saveTheme,
  switchTheme,
  THEME_STORAGE_KEY,
  toggleTheme,
  type ThemeStorage,
} from "./theme";

function memoryStorage(initial: Record<string, string> = {}): ThemeStorage & {
  data: Record<string, string>;
} {
  const data = { ...initial };
  return {
    data,
    getItem(key) {
      return key in data ? data[key]! : null;
    },
    setItem(key, value) {
      data[key] = value;
    },
  };
}

describe("theme store (shipped helpers)", () => {
  it("defaults to dark", () => {
    expect(DEFAULT_THEME).toBe("dark");
    expect(parseTheme(null)).toBe("dark");
    expect(parseTheme("nope")).toBe("dark");
  });

  it("toggles dark ↔ light", () => {
    expect(toggleTheme("dark")).toBe("light");
    expect(toggleTheme("light")).toBe("dark");
  });

  it("persists and reloads after simulated relaunch", () => {
    const storage = memoryStorage();
    expect(loadTheme(storage)).toBe("dark");

    const after = switchTheme("dark", storage);
    expect(after).toBe("light");
    expect(storage.data[THEME_STORAGE_KEY]).toBe("light");

    // Simulated relaunch: new load from same durable store
    const reloaded = loadTheme(storage);
    expect(reloaded).toBe("light");

    const back = switchTheme(reloaded, storage);
    expect(back).toBe("dark");
    expect(loadTheme(storage)).toBe("dark");
  });

  it("saveTheme writes the storage key used by the UI", () => {
    const storage = memoryStorage();
    saveTheme(storage, "light");
    expect(storage.getItem(THEME_STORAGE_KEY)).toBe("light");
  });
});
