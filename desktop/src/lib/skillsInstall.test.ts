import { describe, expect, it } from "vitest";
import { parseSkillSource } from "./skillsInstall";

describe("parseSkillSource", () => {
  it("accepts npm sources, scoped and versioned", () => {
    expect(parseSkillSource("npm:pi-cache-optimizer")).toEqual({
      kind: "npm",
      source: "npm:pi-cache-optimizer",
    });
    expect(parseSkillSource("npm:@scope/name@1.2.3")?.kind).toBe("npm");
  });

  it("promotes a bare package name to npm, since that is what people paste", () => {
    expect(parseSkillSource("@mcowger/pi-better-messages-cache")).toEqual({
      kind: "npm",
      source: "npm:@mcowger/pi-better-messages-cache",
    });
    expect(parseSkillSource("pi-web-access")?.source).toBe("npm:pi-web-access");
  });

  it("accepts git and local-path shapes", () => {
    expect(parseSkillSource("https://github.com/o/r")?.kind).toBe("git");
    expect(parseSkillSource("github:o/r")?.kind).toBe("git");
    expect(parseSkillSource("./skills/my-skill")?.kind).toBe("path");
    expect(parseSkillSource("~/skills/x")?.kind).toBe("path");
  });

  /** The value becomes a subprocess argument; these mirror the host refusals. */
  it("refuses shapes that could be read as flags or smuggle characters", () => {
    for (const bad of [
      "",
      "   ",
      "-rf",
      "--registry=evil",
      "npm:",
      "name with spaces",
      "a".repeat(513),
      "npm:pkg\nextra",
      "npm:pkg\textra",
    ]) {
      expect(parseSkillSource(bad)).toBeNull();
    }
  });
});
