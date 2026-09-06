import type { MessageKey } from "@/i18n";

export type PiPackageAccess =
  | "conversation"
  | "workspace"
  | "system"
  | "provider"
  | "network"
  | "browser";

export type PiPackageCatalogEntry = {
  id: string;
  source: `npm:${string}@${string}`;
  packageName: string;
  version: string;
  titleKey: MessageKey;
  descriptionKey: MessageKey;
  access: PiPackageAccess[];
  group: "foundation" | "optional" | "cache";
};

/**
 * Curated sources are intentionally pinned. Pi packages execute in the local
 * agent process, so a moving `latest` tag is not appropriate for one-click
 * installation from the GUI.
 */
export const PI_PACKAGE_CATALOG: readonly PiPackageCatalogEntry[] = [
  {
    id: "goal",
    source: "npm:@narumitw/pi-goal@0.31.0",
    packageName: "@narumitw/pi-goal",
    version: "0.31.0",
    titleKey: "piExt.package.goal.title",
    descriptionKey: "piExt.package.goal.description",
    access: ["conversation", "workspace", "system"],
    group: "foundation",
  },
  {
    id: "subagents",
    source: "npm:@tintinweb/pi-subagents@0.14.3",
    packageName: "@tintinweb/pi-subagents",
    version: "0.14.3",
    titleKey: "piExt.package.subagents.title",
    descriptionKey: "piExt.package.subagents.description",
    access: ["conversation", "workspace", "system", "provider"],
    group: "foundation",
  },
  {
    id: "permissions",
    source: "npm:@gotgenes/pi-permission-system@23.0.2",
    packageName: "@gotgenes/pi-permission-system",
    version: "23.0.2",
    titleKey: "piExt.package.permissions.title",
    descriptionKey: "piExt.package.permissions.description",
    access: ["conversation", "workspace", "system"],
    group: "foundation",
  },
  {
    id: "codex-image",
    source: "npm:@capyup/pi-codex-image@0.2.2",
    packageName: "@capyup/pi-codex-image",
    version: "0.2.2",
    titleKey: "piExt.package.codexImage.title",
    descriptionKey: "piExt.package.codexImage.description",
    access: ["workspace", "provider", "network"],
    group: "foundation",
  },
  {
    id: "vcc",
    source: "npm:@sting8k/pi-vcc@0.4.0",
    packageName: "@sting8k/pi-vcc",
    version: "0.4.0",
    titleKey: "piExt.package.vcc.title",
    descriptionKey: "piExt.package.vcc.description",
    access: ["conversation"],
    group: "foundation",
  },
  {
    id: "web-access",
    source: "npm:pi-web-access@0.14.0",
    packageName: "pi-web-access",
    version: "0.14.0",
    titleKey: "piExt.package.web.title",
    descriptionKey: "piExt.package.web.description",
    access: ["workspace", "network", "provider"],
    group: "optional",
  },
  {
    id: "browser",
    source: "npm:pi-agent-browser-native@0.2.72",
    packageName: "pi-agent-browser-native",
    version: "0.2.72",
    titleKey: "piExt.package.browser.title",
    descriptionKey: "piExt.package.browser.description",
    access: ["workspace", "system", "network", "browser"],
    group: "optional",
  },
  {
    id: "local-rag",
    source: "npm:pi-local-rag@0.4.1",
    packageName: "pi-local-rag",
    version: "0.4.1",
    titleKey: "piExt.package.localRag.title",
    descriptionKey: "piExt.package.localRag.description",
    access: ["workspace", "system"],
    group: "optional",
  },
  {
    id: "hashline-edit",
    source: "npm:pi-hashline-edit@0.8.3",
    packageName: "pi-hashline-edit",
    version: "0.8.3",
    titleKey: "piExt.package.hashline.title",
    descriptionKey: "piExt.package.hashline.description",
    access: ["workspace"],
    group: "optional",
  },
  {
    id: "context7",
    source: "npm:@upstash/context7-pi@0.1.2",
    packageName: "@upstash/context7-pi",
    version: "0.1.2",
    titleKey: "piExt.package.context7.title",
    descriptionKey: "piExt.package.context7.description",
    access: ["network"],
    group: "optional",
  },
  {
    id: "plannotator",
    source: "npm:@plannotator/pi-extension@0.25.0",
    packageName: "@plannotator/pi-extension",
    version: "0.25.0",
    titleKey: "piExt.package.plannotator.title",
    descriptionKey: "piExt.package.plannotator.description",
    access: ["conversation", "workspace", "system", "browser"],
    group: "optional",
  },
  {
    id: "simplify",
    source: "npm:pi-simplify@0.2.3",
    packageName: "pi-simplify",
    version: "0.2.3",
    titleKey: "piExt.package.simplify.title",
    descriptionKey: "piExt.package.simplify.description",
    access: ["conversation", "workspace"],
    group: "optional",
  },
  {
    id: "voice",
    source: "npm:@senad-d/micme@0.3.7",
    packageName: "@senad-d/micme",
    version: "0.3.7",
    titleKey: "piExt.package.voice.title",
    descriptionKey: "piExt.package.voice.description",
    access: ["conversation", "system"],
    group: "optional",
  },
  // ── Cache performance ────────────────────────────────────────────────────
  // These raise the prompt-cache hit rate the composer chip measures. All are
  // provider-side behaviour tweaks; none touches the workspace.
  {
    id: "cache-optimizer",
    source: "npm:pi-cache-optimizer@2.6.25",
    packageName: "pi-cache-optimizer",
    version: "2.6.25",
    titleKey: "piExt.package.cacheOptimizer.title",
    descriptionKey: "piExt.package.cacheOptimizer.description",
    access: ["conversation", "provider"],
    group: "cache",
  },
  {
    id: "deepseek-cache",
    source: "npm:@rohaquinlop/pi-deepseek-cache@0.5.1",
    packageName: "@rohaquinlop/pi-deepseek-cache",
    version: "0.5.1",
    titleKey: "piExt.package.deepseekCache.title",
    descriptionKey: "piExt.package.deepseekCache.description",
    access: ["conversation", "provider"],
    group: "cache",
  },
  {
    id: "better-messages-cache",
    source: "npm:@mcowger/pi-better-messages-cache@1.5.0",
    packageName: "@mcowger/pi-better-messages-cache",
    version: "1.5.0",
    titleKey: "piExt.package.betterMessagesCache.title",
    descriptionKey: "piExt.package.betterMessagesCache.description",
    access: ["conversation", "provider"],
    group: "cache",
  },
  {
    id: "opencode-go-cache",
    source: "npm:pi-opencode-go-cache@0.3.1",
    packageName: "pi-opencode-go-cache",
    version: "0.3.1",
    titleKey: "piExt.package.opencodeGoCache.title",
    descriptionKey: "piExt.package.opencodeGoCache.description",
    access: ["conversation", "provider"],
    group: "cache",
  },
  {
    id: "provider-toolkit",
    source: "npm:@ersintarhan/pi-toolkit@0.7.2",
    packageName: "@ersintarhan/pi-toolkit",
    version: "0.7.2",
    titleKey: "piExt.package.providerToolkit.title",
    descriptionKey: "piExt.package.providerToolkit.description",
    access: ["conversation", "provider"],
    group: "cache",
  },
] as const;

export const PI_FOUNDATION_PACKAGES = PI_PACKAGE_CATALOG.filter(
  (entry) => entry.group === "foundation",
);

/**
 * Return a stable identity for comparison with `pi list`, which may omit a
 * version even when the original install source was pinned.
 */
export function piPackageIdentity(source: string): string {
  const value = source.trim();
  if (!value.startsWith("npm:")) return value.replace(/#.*$/, "");

  const spec = value.slice(4);
  const versionAt = spec.lastIndexOf("@");
  if (versionAt <= 0) return `npm:${spec}`;

  // A scoped package begins with @. Its version separator is the final @ after
  // the slash; an unscoped package uses the only @ as the separator.
  const slashAt = spec.indexOf("/");
  const hasVersion =
    spec.startsWith("@") ? versionAt > slashAt : versionAt > 0;
  return `npm:${hasVersion ? spec.slice(0, versionAt) : spec}`;
}

export function isPinnedPiPackageSource(source: string): boolean {
  const value = source.trim();
  if (value.startsWith("npm:")) {
    return piPackageIdentity(value) !== value;
  }
  if (value.startsWith("git:") || value.startsWith("http")) {
    return /#[a-f0-9]{7,40}$/i.test(value);
  }
  // Local paths are already exact locations selected by the user.
  return (
    value.startsWith("./") ||
    value.startsWith("../") ||
    value.startsWith("/") ||
    /^[A-Za-z]:[\\/]/.test(value)
  );
}

export function installedPiPackageIds(
  installedSources: readonly string[],
): Set<string> {
  const installed = new Set(installedSources.map(piPackageIdentity));
  return new Set(
    PI_PACKAGE_CATALOG.filter((entry) =>
      installed.has(piPackageIdentity(entry.source)),
    ).map((entry) => entry.id),
  );
}
