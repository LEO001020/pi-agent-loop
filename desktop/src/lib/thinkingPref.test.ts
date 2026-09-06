import { describe, expect, it } from "vitest";
import {
  loadThinkingExpandPref,
  saveThinkingExpandPref,
  thinkingDefaultOpenWhenDone,
} from "./thinkingPref";

function memoryStorage(seed: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(seed));
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k) => map.get(k) ?? null,
    key: (i) => [...map.keys()][i] ?? null,
    removeItem: (k) => {
      map.delete(k);
    },
    setItem: (k, v) => {
      map.set(k, v);
    },
  };
}

describe("thinkingPref", () => {
  it("defaults to auto-collapse", () => {
    expect(loadThinkingExpandPref(memoryStorage())).toBe("auto-collapse");
    expect(thinkingDefaultOpenWhenDone("auto-collapse")).toBe(false);
    expect(thinkingDefaultOpenWhenDone("keep-open")).toBe(true);
  });

  it("round-trips preference", () => {
    const s = memoryStorage();
    saveThinkingExpandPref("keep-open", s);
    expect(loadThinkingExpandPref(s)).toBe("keep-open");
    saveThinkingExpandPref("auto-collapse", s);
    expect(loadThinkingExpandPref(s)).toBe("auto-collapse");
  });
});
