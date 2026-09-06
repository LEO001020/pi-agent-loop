import { describe, expect, it } from "vitest";
import {
  DEFAULT_WORKSPACE,
  WORKSPACES,
  WORKSPACE_IDS,
  WORKSPACE_STORAGE_KEY,
  isComingSoon,
  isWorkspaceId,
  loadWorkspace,
  nextWorkspace,
  saveWorkspace,
  workspaceMeta,
  DEFAULT_WORKSPACE_SKINS,
  WORKSPACE_SKINS_STORAGE_KEY,
  loadWorkspaceSkins,
  saveWorkspaceSkins,
  setWorkspaceSkin,
  workspaceSkin,
  PR_REPOS_STORAGE_KEY,
  loadPrRepos,
  savePrRepos,
  addPrRepo,
  removePrRepo,
  type WorkspaceStorage,
} from "./workspace";

function memoryStorage(
  initial: Record<string, string> = {},
): WorkspaceStorage & { map: Record<string, string> } {
  const map = { ...initial };
  return {
    map,
    getItem: (k) => (k in map ? map[k]! : null),
    setItem: (k, v) => {
      map[k] = v;
    },
  };
}

function throwingStorage(): WorkspaceStorage {
  return {
    getItem() {
      throw new Error("denied");
    },
    setItem() {
      throw new Error("quota");
    },
  };
}

describe("workspace ids", () => {
  it("accepts only known ids", () => {
    expect(isWorkspaceId("code")).toBe(true);
    expect(isWorkspaceId("pr")).toBe(true);
    // Removed workspace: an id that used to be valid must not still be.
    expect(isWorkspaceId("design")).toBe(false);
    expect(isWorkspaceId("nope")).toBe(false);
    expect(isWorkspaceId("")).toBe(false);
    expect(isWorkspaceId(null)).toBe(false);
    expect(isWorkspaceId(3)).toBe(false);
  });

  it("defaults to code so an upgrade lands where the user was", () => {
    expect(DEFAULT_WORKSPACE).toBe("code");
    expect(WORKSPACES[0]!.id).toBe("code");
  });

  it("describes every declared id exactly once", () => {
    expect(WORKSPACES.map((w) => w.id)).toEqual([...WORKSPACE_IDS]);
    expect(new Set(WORKSPACES.map((w) => w.labelKey)).size).toBe(
      WORKSPACES.length,
    );
  });

  it("marks all declared workspaces as available", () => {
    expect(isComingSoon("code")).toBe(false);
    expect(isComingSoon("pr")).toBe(false);
  });

  it("falls back to code metadata for an unknown id", () => {
    expect(workspaceMeta("bogus" as never).id).toBe("code");
  });
});

describe("persistence", () => {
  it("round-trips a saved workspace", () => {
    const s = memoryStorage();
    saveWorkspace(s, "pr");
    expect(s.map[WORKSPACE_STORAGE_KEY]).toBe("pr");
    expect(loadWorkspace(s)).toBe("pr");
  });

  it("returns the default when nothing is stored", () => {
    expect(loadWorkspace(memoryStorage())).toBe("code");
  });

  it("ignores a stored value it cannot render", () => {
    const s = memoryStorage({
      [WORKSPACE_STORAGE_KEY]: "from-a-newer-build",
    });
    expect(loadWorkspace(s)).toBe("code");
  });

  /**
   * Anyone sitting in the Design workspace when it was removed has `design`
   * persisted. Without this they would reopen the app into a workspace the
   * shell can no longer render.
   */
  it("migrates a user out of the removed design workspace", () => {
    const s = memoryStorage({ [WORKSPACE_STORAGE_KEY]: "design" });
    expect(loadWorkspace(s)).toBe("code");
  });

  it("survives storage throwing", () => {
    const s = throwingStorage();
    expect(loadWorkspace(s)).toBe("code");
    expect(() => saveWorkspace(s, "pr")).not.toThrow();
  });
});

describe("nextWorkspace", () => {
  it("switches to the clicked workspace", () => {
    expect(nextWorkspace("code", "pr")).toBe("pr");
  });

  it("clicking the active one is a no-op rather than a toggle-off", () => {
    expect(nextWorkspace("pr", "pr")).toBe("pr");
  });

  it("allows selecting another workspace", () => {
    expect(nextWorkspace("code", "pr")).toBe("pr");
  });
});

describe("per-workspace skins", () => {
  it("gives each workspace a distinct default", () => {
    const values = Object.values(DEFAULT_WORKSPACE_SKINS);
    expect(new Set(values).size).toBe(values.length);
    expect(DEFAULT_WORKSPACE_SKINS.code).toBe("default");
  });

  it("round-trips a full map", () => {
    const s = memoryStorage();
    const next = setWorkspaceSkin(DEFAULT_WORKSPACE_SKINS, "pr", "ember");
    saveWorkspaceSkins(s, next);
    expect(loadWorkspaceSkins(s).pr).toBe("ember");
  });

  it("changing one workspace leaves the others alone", () => {
    const next = setWorkspaceSkin(DEFAULT_WORKSPACE_SKINS, "pr", "mist");
    expect(next.pr).toBe("mist");
    expect(next.code).toBe(DEFAULT_WORKSPACE_SKINS.code);
  });

  it("fills gaps from defaults rather than returning undefined", () => {
    const s = memoryStorage({
      [WORKSPACE_SKINS_STORAGE_KEY]: JSON.stringify({ pr: "gothic" }),
    });
    const skins = loadWorkspaceSkins(s);
    expect(skins.pr).toBe("gothic");
    expect(skins.code).toBe(DEFAULT_WORKSPACE_SKINS.code);
  });

  it("rejects entries the skin system would not recognise", () => {
    const s = memoryStorage({
      [WORKSPACE_SKINS_STORAGE_KEY]: JSON.stringify({
        pr: "from-a-newer-build",
        code: 42,
      }),
    });
    const known = (v: unknown) => v === "ocean" || v === "rose";
    const skins = loadWorkspaceSkins(s, known);
    expect(skins.pr).toBe(DEFAULT_WORKSPACE_SKINS.pr);
    expect(skins.code).toBe(DEFAULT_WORKSPACE_SKINS.code);
  });

  it("survives malformed or absent JSON", () => {
    expect(loadWorkspaceSkins(memoryStorage())).toEqual(
      DEFAULT_WORKSPACE_SKINS,
    );
    const bad = memoryStorage({ [WORKSPACE_SKINS_STORAGE_KEY]: "{oops" });
    expect(loadWorkspaceSkins(bad)).toEqual(DEFAULT_WORKSPACE_SKINS);
  });

  it("reads a single workspace with a default fallback", () => {
    expect(workspaceSkin(DEFAULT_WORKSPACE_SKINS, "pr")).toBe("ocean");
    expect(workspaceSkin({} as never, "code")).toBe("default");
  });
});

describe("PR workspace repositories", () => {
  it("round-trips a selection", () => {
    const s = memoryStorage();
    savePrRepos(s, ["AJSubrizi/Pi-App", "o/r"]);
    expect(loadPrRepos(s)).toEqual(["AJSubrizi/Pi-App", "o/r"]);
  });

  it("returns empty for absent or malformed storage", () => {
    expect(loadPrRepos(memoryStorage())).toEqual([]);
    expect(
      loadPrRepos(memoryStorage({ [PR_REPOS_STORAGE_KEY]: "{oops" })),
    ).toEqual([]);
    expect(
      loadPrRepos(memoryStorage({ [PR_REPOS_STORAGE_KEY]: '"a string"' })),
    ).toEqual([]);
  });

  it("drops entries that are not owner/name", () => {
    const s = memoryStorage({
      [PR_REPOS_STORAGE_KEY]: JSON.stringify([
        "good/repo",
        "noslash",
        "--repo=evil",
        "o/r/extra",
        42,
        "",
      ]),
    });
    expect(loadPrRepos(s)).toEqual(["good/repo"]);
  });

  it("de-duplicates case-insensitively while keeping the first spelling", () => {
    const s = memoryStorage({
      [PR_REPOS_STORAGE_KEY]: JSON.stringify(["O/R", "o/r"]),
    });
    expect(loadPrRepos(s)).toEqual(["O/R"]);
  });

  it("adds without duplicating and preserves order", () => {
    let repos: string[] = [];
    repos = addPrRepo(repos, "a/one");
    repos = addPrRepo(repos, "b/two");
    repos = addPrRepo(repos, "A/ONE");
    expect(repos).toEqual(["a/one", "b/two"]);
    expect(addPrRepo(repos, "   ")).toBe(repos);
  });

  it("removes case-insensitively", () => {
    expect(removePrRepo(["a/one", "b/two"], "A/ONE")).toEqual(["b/two"]);
    expect(removePrRepo(["a/one"], "nope/x")).toEqual(["a/one"]);
  });
});
