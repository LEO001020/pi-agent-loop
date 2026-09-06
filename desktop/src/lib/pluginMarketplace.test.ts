import { describe, expect, it } from "vitest";
import {
  availablePluginMetaLine,
  filterAvailablePlugins,
  filterPluginsByQuery,
  marketplaceQualifiedInstallSource,
  marketplaceRemoveTarget,
  marketplaceSourceLabel,
  normalizeMarketplaceAddSource,
  normalizeMarketplaceInstallSource,
  normalizeMarketplaceUpdateName,
  parseMarketplaceListJson,
  parsePluginListAvailableJson,
  resolveMarketplaceRemoveArg,
  sortMarketplaceSourcesByName,
  takePluginsPage,
} from "./pluginMarketplace";

const SAMPLE_LIST = `[
  {
    "name": "xAI Official",
    "kind": "git",
    "source": {
      "url": "https://github.com/xai-org/plugin-marketplace.git",
      "branch": null
    }
  },
  {
    "name": "claude-plugins-official",
    "kind": "git",
    "source": {
      "url": "https://github.com/anthropics/claude-plugins-official.git",
      "branch": null
    }
  }
]`;

describe("parseMarketplaceListJson", () => {
  it("parses CLI array of sources without nested plugins", () => {
    const sources = parseMarketplaceListJson(SAMPLE_LIST);
    expect(sources).toHaveLength(2);
    expect(sources[0]).toMatchObject({
      name: "xAI Official",
      kind: "git",
      url: "https://github.com/xai-org/plugin-marketplace.git",
    });
    expect(sources[1].name).toBe("claude-plugins-official");
    expect(marketplaceSourceLabel(sources[0])).toContain("xai-org/plugin-marketplace");
  });

  it("accepts wrapped { sources: [...] } and local path sources", () => {
    const raw = JSON.stringify({
      sources: [
        {
          name: "local-cat",
          kind: "local",
          source: { path: "/tmp/my-marketplace" },
        },
      ],
    });
    const sources = parseMarketplaceListJson(raw);
    expect(sources).toHaveLength(1);
    expect(sources[0].path).toBe("/tmp/my-marketplace");
    expect(marketplaceRemoveTarget(sources[0])).toBe("/tmp/my-marketplace");
  });

  it("keeps nested plugins when CLI includes them", () => {
    const raw = JSON.stringify([
      {
        name: "demo",
        kind: "git",
        source: { url: "https://example.com/m.git" },
        plugins: [
          { name: "alpha", description: "A" },
          { name: "  " },
        ],
      },
    ]);
    const sources = parseMarketplaceListJson(raw);
    expect(sources[0].plugins).toHaveLength(1);
    expect(sources[0].plugins?.[0].name).toBe("alpha");
  });

  it("returns empty for blank; throws on invalid JSON / shape", () => {
    expect(parseMarketplaceListJson("")).toEqual([]);
    expect(parseMarketplaceListJson("   ")).toEqual([]);
    expect(() => parseMarketplaceListJson("{")).toThrow(/parse marketplace list/i);
    expect(() => parseMarketplaceListJson('{"nope":1}')).toThrow(/not an array/i);
  });

  it("skips entries without a name", () => {
    const raw = JSON.stringify([
      { kind: "git", source: { url: "https://x.test/a.git" } },
      { name: "ok", kind: "git", source: { url: "https://x.test/b.git" } },
    ]);
    expect(parseMarketplaceListJson(raw).map((s) => s.name)).toEqual(["ok"]);
  });
});

describe("normalizeMarketplaceAddSource / update / install", () => {
  it("trims add source and rejects empty", () => {
    expect(normalizeMarketplaceAddSource("  owner/repo  ")).toBe("owner/repo");
    expect(() => normalizeMarketplaceAddSource("")).toThrow(/required/i);
    expect(() => normalizeMarketplaceAddSource("   ")).toThrow(/required/i);
  });

  it("update name: empty means all", () => {
    expect(normalizeMarketplaceUpdateName(undefined)).toBeNull();
    expect(normalizeMarketplaceUpdateName(null)).toBeNull();
    expect(normalizeMarketplaceUpdateName("  ")).toBeNull();
    expect(normalizeMarketplaceUpdateName("xAI Official")).toBe("xAI Official");
  });

  it("install source trim + qualify with marketplace", () => {
    expect(normalizeMarketplaceInstallSource(" vercel ")).toBe("vercel");
    expect(() => normalizeMarketplaceInstallSource("")).toThrow(/required/i);
    expect(marketplaceQualifiedInstallSource("vercel", "xAI Official")).toBe(
      "vercel@xAI Official",
    );
    expect(marketplaceQualifiedInstallSource("vercel@other", "xAI Official")).toBe(
      "vercel@other",
    );
    expect(marketplaceQualifiedInstallSource("vercel", null)).toBe("vercel");
  });
});

describe("resolveMarketplaceRemoveArg", () => {
  const sources = parseMarketplaceListJson(SAMPLE_LIST);

  it("maps source name to git URL (CLI remove wants URL)", () => {
    expect(resolveMarketplaceRemoveArg("xAI Official", sources)).toBe(
      "https://github.com/xai-org/plugin-marketplace.git",
    );
    expect(resolveMarketplaceRemoveArg("claude-plugins-official", sources)).toBe(
      "https://github.com/anthropics/claude-plugins-official.git",
    );
  });

  it("passes URLs and paths through", () => {
    expect(
      resolveMarketplaceRemoveArg(
        "https://github.com/xai-org/plugin-marketplace.git",
        sources,
      ),
    ).toBe("https://github.com/xai-org/plugin-marketplace.git");
    expect(resolveMarketplaceRemoveArg("/tmp/mkt", sources)).toBe("/tmp/mkt");
  });

  it("rejects empty", () => {
    expect(() => resolveMarketplaceRemoveArg("  ", sources)).toThrow(/required/i);
  });
});

describe("parsePluginListAvailableJson / filter", () => {
  const raw = `[
    {"status":"installed","name":"cloudflare","marketplace":"xAI Official"},
    {
      "status":"available",
      "name":"vercel",
      "description":"Vercel deploy",
      "marketplace":"xAI Official",
      "skill_count":2,
      "has_hooks":false,
      "has_agents":true,
      "has_mcp":false
    },
    {
      "status":"available",
      "name":"sentry",
      "marketplace":"xAI Official",
      "description":"errors"
    }
  ]`;

  it("parses available + installed rows", () => {
    const all = parsePluginListAvailableJson(raw);
    expect(all).toHaveLength(3);
    const avail = filterAvailablePlugins(all);
    expect(avail.map((p) => p.name)).toEqual(["vercel", "sentry"]);
    expect(avail[0].skillCount).toBe(2);
    expect(avail[0].hasAgents).toBe(true);
  });

  it("filters by query and meta line", () => {
    const avail = filterAvailablePlugins(parsePluginListAvailableJson(raw));
    expect(avail.map((p) => p.name)).toEqual(["vercel", "sentry"]);
    expect(filterPluginsByQuery(avail, "vercel").map((p) => p.name)).toEqual([
      "vercel",
    ]);
    expect(filterPluginsByQuery(avail, "deploy").map((p) => p.name)).toEqual([
      "vercel",
    ]);
    expect(filterPluginsByQuery(avail, "xai").length).toBe(2);
    expect(availablePluginMetaLine(avail[0])).toContain("xAI Official");
    expect(availablePluginMetaLine(avail[0])).toContain("2 skills");
    expect(availablePluginMetaLine(avail[0])).toContain("agents");
  });

  it("throws on bad shape; empty ok", () => {
    expect(parsePluginListAvailableJson("")).toEqual([]);
    expect(() => parsePluginListAvailableJson("null")).toThrow(/not an array/i);
  });
});

describe("sort / page helpers", () => {
  it("sorts sources by name", () => {
    const sorted = sortMarketplaceSourcesByName([
      { name: "z" },
      { name: "a" },
    ]);
    expect(sorted.map((s) => s.name)).toEqual(["a", "z"]);
  });

  it("pages large lists", () => {
    const items = Array.from({ length: 100 }, (_, i) => i);
    expect(takePluginsPage(items, 40)).toHaveLength(40);
    expect(takePluginsPage(items, 0)).toHaveLength(0);
    expect(takePluginsPage([1, 2], 40)).toEqual([1, 2]);
  });
});
