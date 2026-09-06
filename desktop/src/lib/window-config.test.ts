/**
 * Window chrome: mac Overlay traffic lights; Windows frameless + self-drawn controls.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const TAURI_DIR = resolve(__dirname, "../../src-tauri");
const CONF_PATH = resolve(TAURI_DIR, "tauri.conf.json");
const MAC_PATH = resolve(TAURI_DIR, "tauri.macos.conf.json");
const WIN_PATH = resolve(TAURI_DIR, "tauri.windows.conf.json");

describe("window chrome", () => {
  it("ships platform-specific window configs", () => {
    expect(existsSync(CONF_PATH)).toBe(true);
    expect(existsSync(MAC_PATH)).toBe(true);
    expect(existsSync(WIN_PATH)).toBe(true);
  });

  it("mac uses Overlay traffic lights without system title text", () => {
    const conf = JSON.parse(readFileSync(MAC_PATH, "utf8")) as {
      app: {
        macOSPrivateApi?: boolean;
        windows: Array<{
          decorations?: boolean;
          titleBarStyle?: string;
          hiddenTitle?: boolean;
          trafficLightPosition?: { x: number; y: number };
          transparent?: boolean;
        }>;
      };
    };
    const main = conf.app.windows[0]!;
    expect(main.titleBarStyle).toBe("Overlay");
    expect(main.hiddenTitle).toBe(true);
    expect(main.trafficLightPosition).toBeTruthy();
    expect(main.transparent).toBe(true);
    expect(main.decorations).toBe(true);
    expect(conf.app.macOSPrivateApi).toBe(true);
  });

  it("windows is frameless for self-drawn controls", () => {
    const conf = JSON.parse(readFileSync(WIN_PATH, "utf8")) as {
      app: {
        windows: Array<{
          decorations?: boolean;
          transparent?: boolean;
        }>;
      };
    };
    const main = conf.app.windows[0]!;
    expect(main.decorations).toBe(false);
    expect(main.transparent).toBe(false);
  });

  it("base product identity is Pi", () => {
    const conf = JSON.parse(readFileSync(CONF_PATH, "utf8")) as {
      productName?: string;
      app: { windows: Array<{ title?: string }> };
    };
    expect(conf.productName).toBe("Pi");
    expect(conf.app.windows[0]!.title).toBe("Pi");
  });

  it("uses window-vibrancy for native frosted glass on macOS", () => {
    const cargo = readFileSync(resolve(TAURI_DIR, "Cargo.toml"), "utf8");
    expect(cargo).toMatch(/window-vibrancy/);
  });
});
