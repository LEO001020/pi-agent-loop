/**
 * Map file names / extensions → highlight.js language ids.
 * Keep in sync with languages registered in CodePreview.
 */

const EXT_LANG: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  mts: "typescript",
  cts: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  json: "json",
  jsonc: "json",
  md: "markdown",
  mdx: "markdown",
  rs: "rust",
  py: "python",
  go: "go",
  java: "java",
  kt: "kotlin",
  kts: "kotlin",
  c: "c",
  h: "c",
  cpp: "cpp",
  cc: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  cs: "csharp",
  rb: "ruby",
  php: "php",
  swift: "swift",
  sql: "sql",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  fish: "bash",
  yml: "yaml",
  yaml: "yaml",
  toml: "ini",
  ini: "ini",
  conf: "ini",
  css: "css",
  scss: "scss",
  less: "css",
  html: "xml",
  htm: "xml",
  xml: "xml",
  svg: "xml",
  vue: "xml",
  svelte: "xml",
  dockerfile: "dockerfile",
  makefile: "makefile",
  mk: "makefile",
  r: "r",
  diff: "diff",
  patch: "diff",
  graphql: "graphql",
  gql: "graphql",
  proto: "protobuf",
  lua: "lua",
  zig: "plaintext",
  txt: "plaintext",
  log: "plaintext",
  env: "bash",
};

/** Special whole-filename mappings (case-insensitive). */
const NAME_LANG: Record<string, string> = {
  dockerfile: "dockerfile",
  makefile: "makefile",
  gemfile: "ruby",
  rakefile: "ruby",
  "cargo.toml": "ini",
  "package.json": "json",
  "tsconfig.json": "json",
  "composer.json": "json",
  ".gitignore": "plaintext",
  ".env": "bash",
  ".env.local": "bash",
  ".env.example": "bash",
};

export function languageFromFileName(name: string): string {
  const base = name.replace(/\\/g, "/").split("/").pop() || name;
  const lower = base.toLowerCase();
  if (NAME_LANG[lower]) return NAME_LANG[lower];
  const ext = lower.includes(".") ? lower.split(".").pop() || "" : "";
  if (ext && EXT_LANG[ext]) return EXT_LANG[ext];
  return "plaintext";
}
