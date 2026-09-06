import { describe, expect, it } from "vitest";
import {
  AGENTS_MD_TEMPLATE_PATH,
  agentsMdTemplateBody,
  classifyProjectRulePath,
  hasRootAgentsMd,
  isPiRulesPath,
  isNestedAgentsPath,
  normalizeRuleRelativePath,
  preferredAgentsMdPath,
  selectExistingProjectRules,
} from "./projectRules";

describe("normalizeRuleRelativePath", () => {
  it("strips ./ and backslashes", () => {
    expect(normalizeRuleRelativePath("./AGENTS.md")).toBe("AGENTS.md");
    expect(normalizeRuleRelativePath(".\\CLAUDE.md")).toBe("CLAUDE.md");
    expect(normalizeRuleRelativePath("/.pi/rules/foo.md")).toBe(
      ".pi/rules/foo.md",
    );
    expect(normalizeRuleRelativePath("  a/b/  ")).toBe("a/b");
  });
});

describe("classifyProjectRulePath", () => {
  it("classifies root AGENTS / AGENT variants", () => {
    expect(classifyProjectRulePath("AGENTS.md")?.kind).toBe("agents_md");
    expect(classifyProjectRulePath("Agents.md")?.kind).toBe("agents_md");
    expect(classifyProjectRulePath("agents.md")?.kind).toBe("agents_md");
    expect(classifyProjectRulePath("AGENT.md")?.kind).toBe("agents_md");
  });

  it("classifies root CLAUDE.md", () => {
    expect(classifyProjectRulePath("CLAUDE.md")?.kind).toBe("claude_md");
    expect(classifyProjectRulePath("claude.md")?.kind).toBe("claude_md");
  });

  it("classifies .pi/rules* paths", () => {
    expect(classifyProjectRulePath(".pi/rules")?.kind).toBe("pi_rules");
    expect(classifyProjectRulePath(".pi/rules.md")?.kind).toBe("pi_rules");
    expect(classifyProjectRulePath(".pi/rules.txt")?.kind).toBe("pi_rules");
    expect(classifyProjectRulePath(".pi/rules/base.md")?.kind).toBe(
      "pi_rules",
    );
    expect(classifyProjectRulePath(".pi/rules/team/coding.md")?.kind).toBe(
      "pi_rules",
    );
  });

  it("classifies nested AGENTS.md under .pi", () => {
    expect(classifyProjectRulePath(".pi/AGENTS.md")?.kind).toBe(
      "nested_agents",
    );
    expect(classifyProjectRulePath(".pi/subdir/AGENTS.md")?.kind).toBe(
      "nested_agents",
    );
    expect(classifyProjectRulePath(".pi/a/b/Agents.md")?.kind).toBe(
      "nested_agents",
    );
  });

  it("rejects unrelated paths", () => {
    expect(classifyProjectRulePath("README.md")).toBeNull();
    expect(classifyProjectRulePath("docs/AGENTS.md")).toBeNull();
    expect(classifyProjectRulePath("src/lib/foo.ts")).toBeNull();
    expect(classifyProjectRulePath(".pi/config.toml")).toBeNull();
    expect(classifyProjectRulePath(".pi/hooks/x.json")).toBeNull();
    expect(classifyProjectRulePath("")).toBeNull();
  });
});

describe("isPiRulesPath / isNestedAgentsPath", () => {
  it("does not treat nested agents as pi_rules", () => {
    expect(isPiRulesPath(".pi/AGENTS.md")).toBe(false);
    expect(isNestedAgentsPath(".pi/AGENTS.md")).toBe(true);
    expect(isNestedAgentsPath(".pi/rules/AGENTS.md")).toBe(false);
    expect(isPiRulesPath(".pi/rules/AGENTS.md")).toBe(true);
  });
});

describe("selectExistingProjectRules", () => {
  it("filters, dedupes, and orders by kind then path", () => {
    const list = selectExistingProjectRules([
      "README.md",
      ".pi/rules/z.md",
      "CLAUDE.md",
      "AGENTS.md",
      "./AGENTS.md",
      ".pi/rules/a.md",
      ".pi/nested/AGENTS.md",
      "src/x.ts",
    ]);
    expect(list.map((r) => r.relativePath)).toEqual([
      "AGENTS.md",
      "CLAUDE.md",
      ".pi/rules/a.md",
      ".pi/rules/z.md",
      ".pi/nested/AGENTS.md",
    ]);
    expect(list.map((r) => r.kind)).toEqual([
      "agents_md",
      "claude_md",
      "pi_rules",
      "pi_rules",
      "nested_agents",
    ]);
  });

  it("returns empty for no matches", () => {
    expect(selectExistingProjectRules(["a.ts", "b.md"])).toEqual([]);
  });
});

describe("hasRootAgentsMd / preferredAgentsMdPath", () => {
  it("detects root agents presence", () => {
    expect(hasRootAgentsMd(["CLAUDE.md"])).toBe(false);
    expect(hasRootAgentsMd(["Agents.md"])).toBe(true);
  });

  it("prefers existing agents path else template path", () => {
    expect(preferredAgentsMdPath(["CLAUDE.md"])).toBe(AGENTS_MD_TEMPLATE_PATH);
    expect(preferredAgentsMdPath(["Agents.md"])).toBe("Agents.md");
    expect(preferredAgentsMdPath(["AGENTS.md", "Agents.md"])).toBe("AGENTS.md");
  });
});

describe("agentsMdTemplateBody", () => {
  it("is a short non-empty markdown stub with useful headings", () => {
    const body = agentsMdTemplateBody();
    expect(body.startsWith("# Project rules")).toBe(true);
    expect(body).toContain("## Commands");
    expect(body).toContain("## Conventions");
    expect(body.length).toBeLessThan(800);
    // No marketing fluff
    expect(body.toLowerCase()).not.toContain("leverage");
    expect(body.toLowerCase()).not.toContain("robust");
  });
});
