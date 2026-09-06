import { describe, expect, it } from "vitest";
import {
  agentNameFromFileName,
  agentNamesFromFileList,
  agentSpawnCliArgs,
  BUILTIN_AGENT_NAMES,
  mergeAgentCatalog,
  normalizePreferredAgent,
  resolveAgentCatalogDirs,
} from "./agentsCatalog";

describe("normalizePreferredAgent", () => {
  it("treats empty and sentinels as CLI default", () => {
    expect(normalizePreferredAgent(null)).toBeNull();
    expect(normalizePreferredAgent(undefined)).toBeNull();
    expect(normalizePreferredAgent("")).toBeNull();
    expect(normalizePreferredAgent("   ")).toBeNull();
    expect(normalizePreferredAgent("default")).toBeNull();
    expect(normalizePreferredAgent("NONE")).toBeNull();
    expect(normalizePreferredAgent("pi-build")).toBeNull();
    expect(normalizePreferredAgent("cli-default")).toBeNull();
  });

  it("keeps real agent names trimmed", () => {
    expect(normalizePreferredAgent("  explore  ")).toBe("explore");
    expect(normalizePreferredAgent("general-purpose")).toBe("general-purpose");
    expect(normalizePreferredAgent("/path/to/agent.md")).toBe(
      "/path/to/agent.md",
    );
  });

  it("rejects control characters", () => {
    expect(normalizePreferredAgent("ex\nplore")).toBeNull();
    expect(normalizePreferredAgent("a\0b")).toBeNull();
  });
});

describe("agentSpawnCliArgs", () => {
  it("omits flag when unset", () => {
    expect(agentSpawnCliArgs("")).toBeNull();
    expect(agentSpawnCliArgs("default")).toBeNull();
    expect(agentSpawnCliArgs(null)).toBeNull();
  });

  it("builds top-level --agent NAME", () => {
    expect(agentSpawnCliArgs("explore")).toEqual(["--agent", "explore"]);
    expect(agentSpawnCliArgs("  plan  ")).toEqual(["--agent", "plan"]);
  });
});

describe("agent file discovery", () => {
  it("parses markdown stems and skips noise", () => {
    expect(agentNameFromFileName("explore.md")).toBe("explore");
    expect(agentNameFromFileName("my-agent.markdown")).toBe("my-agent");
    expect(agentNameFromFileName("notes.txt")).toBeNull();
    expect(agentNameFromFileName(".hidden.md")).toBeNull();
    expect(agentNameFromFileName("README.md")).toBeNull();
    expect(agentNameFromFileName("/tmp/agents/plan.md")).toBe("plan");
  });

  it("lists unique sorted names from a dir listing", () => {
    expect(
      agentNamesFromFileList([
        "plan.md",
        "Explore.md",
        "readme.md",
        "foo.txt",
        "plan.md",
      ]),
    ).toEqual(["Explore", "plan"]);
  });
});

describe("mergeAgentCatalog", () => {
  it("includes built-ins by default", () => {
    const cat = mergeAgentCatalog({});
    expect(cat.map((e) => e.name).sort()).toEqual(
      [...BUILTIN_AGENT_NAMES].sort(),
    );
    expect(cat.every((e) => e.source === "builtin")).toBe(true);
  });

  it("prefers project over user over builtin for the same name", () => {
    const cat = mergeAgentCatalog({
      userFiles: ["explore.md", "custom.md"],
      projectFiles: ["explore.md", "proj-only.md"],
      userDir: "/home/u/.pi/agents",
      projectDir: "/repo/.pi/agents",
    });
    const byName = Object.fromEntries(cat.map((e) => [e.name, e]));
    expect(byName.explore.source).toBe("project");
    expect(byName.explore.path).toBe("/repo/.pi/agents/explore.md");
    expect(byName.custom.source).toBe("user");
    expect(byName.custom.path).toBe("/home/u/.pi/agents/custom.md");
    expect(byName["proj-only"].source).toBe("project");
    expect(byName.plan.source).toBe("builtin");
    expect(byName["general-purpose"].source).toBe("builtin");
  });
});

describe("resolveAgentCatalogDirs", () => {
  it("builds user/project/bundled paths", () => {
    expect(resolveAgentCatalogDirs("/home/u", "/work/app")).toEqual({
      user: "/home/u/.pi/agents",
      project: "/work/app/.pi/agents",
      bundled: "/home/u/.pi/bundled/agents",
    });
    expect(resolveAgentCatalogDirs("/home/u", null).project).toBeNull();
  });
});
