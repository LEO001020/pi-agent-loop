import { describe, expect, it } from "vitest";
import {
  PI_FOUNDATION_PACKAGES,
  PI_PACKAGE_CATALOG,
  installedPiPackageIds,
  isPinnedPiPackageSource,
  piPackageIdentity,
} from "./piPackageCatalog";

describe("Pi package catalog", () => {
  it("pins every curated npm source to the displayed version", () => {
    for (const entry of PI_PACKAGE_CATALOG) {
      expect(entry.source).toBe(`npm:${entry.packageName}@${entry.version}`);
      expect(isPinnedPiPackageSource(entry.source)).toBe(true);
    }
  });

  it("normalizes scoped and unscoped npm versions", () => {
    expect(piPackageIdentity("npm:@scope/name@1.2.3")).toBe(
      "npm:@scope/name",
    );
    expect(piPackageIdentity("npm:@scope/name")).toBe("npm:@scope/name");
    expect(piPackageIdentity("npm:plain-name@4.5.6")).toBe("npm:plain-name");
  });

  it("recognizes catalog entries from versionless Pi list output", () => {
    const installed = installedPiPackageIds([
      "npm:@narumitw/pi-goal",
      "npm:pi-web-access@0.14.0",
    ]);
    expect(installed.has("goal")).toBe(true);
    expect(installed.has("web-access")).toBe(true);
    expect(installed.has("browser")).toBe(false);
  });

  it("keeps network and browser packages out of implicit installation", () => {
    expect(PI_FOUNDATION_PACKAGES.some((entry) =>
      entry.access.includes("browser"),
    )).toBe(false);
    expect(PI_PACKAGE_CATALOG.some((entry) =>
      entry.access.includes("browser"),
    )).toBe(true);
  });

  it("flags moving npm and git sources", () => {
    expect(isPinnedPiPackageSource("npm:pi-web-access")).toBe(false);
    expect(
      isPinnedPiPackageSource("git:https://github.com/example/package"),
    ).toBe(false);
    expect(
      isPinnedPiPackageSource(
        "git:https://github.com/example/package#7d4f0d3a",
      ),
    ).toBe(true);
    expect(isPinnedPiPackageSource("/work/local-package")).toBe(true);
  });
});
