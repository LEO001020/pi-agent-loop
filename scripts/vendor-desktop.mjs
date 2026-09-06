import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const commit = "a3dc3cfbdec6db82fb9cc21fbd2605ff83499f1d";
const source = resolve(process.env.PI_LOOP_DESKTOP_SOURCE ?? join(root, "..", "pi-loop-workspace", "pi-app"));
const target = join(root, "desktop");
if (existsSync(join(target, "package.json"))) throw new Error("Desktop is already adopted; refusing to overwrite local integration changes");
const args = ["-c", `safe.directory=${source}`, "-C", source];
const actual = execFileSync("git", [...args, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
if (actual !== commit) throw new Error("Desktop source is not the audited commit");
if (execFileSync("git", [...args, "status", "--porcelain", "--untracked-files=no"], { encoding: "utf8" }).trim()) throw new Error("Audited desktop source has tracked modifications");
mkdirSync(target, { recursive: true });
const archive = execFileSync("git", [...args, "archive", "--format=tar", commit], { maxBuffer: 200 * 1024 * 1024 });
const extracted = spawnSync("tar", ["-xf", "-", "-C", target], { input: archive, stdio: ["pipe", "inherit", "inherit"] });
if (extracted.status !== 0) throw new Error("Desktop adoption failed");
writeFileSync(join(target, "PI_LOOP_UPSTREAM.json"), JSON.stringify({ repository: "https://github.com/AJSubrizi/Pi-App", commit,
  license: "MIT", packageVersion: JSON.parse(readFileSync(join(target, "package.json"))).version,
  status: "Audited upstream adopted; local integration changes are recorded separately and require runtime tests." }, null, 2) + "\n");
console.log(JSON.stringify({ target, commit, archiveBytes: archive.length }));
