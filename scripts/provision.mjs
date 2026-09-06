import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const runtime = join(root, "runtime");
for (const file of ["launch.sh", "bin/pi-agent-loop.mjs"]) if (existsSync(join(root, file))) chmodSync(join(root, file), 0o755);
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const run = (program, args, opts = {}) => execFileSync(program, args, { cwd: root, stdio: "inherit", ...opts });
const text = (program, args, opts = {}) => execFileSync(program, args, { cwd: root, encoding: "utf8", ...opts }).trim();
if (Number(process.versions.node.split(".")[0]) < 22) throw new Error("Node.js >=22.19.0 is required");
if (process.platform !== "linux") throw new Error("This tested backend requires Linux/WSL2. Desktop source supports other hosts; run the backend in Linux.");
mkdirSync(join(runtime, "bin"), { recursive: true });
mkdirSync(join(root, "licenses"), { recursive: true });
const landrunCommit = "811cfff51ceaf3d9843708aa6d22e9b84ccac8b4";
const binary = join(runtime, "bin", "landrun");
const receiptPath = join(runtime, "landrun-build.json");
const prior = existsSync(receiptPath) ? JSON.parse(readFileSync(receiptPath, "utf8")) : null;
if (!(existsSync(binary) && prior?.commit === landrunCommit && prior.arch === process.arch && prior.sha256 === sha(readFileSync(binary)))) {
  const provided = process.env.PI_LOOP_LANDRUN_SOURCE;
  const source = provided ? resolve(provided) : join(root, ".build", "landrun");
  if (!existsSync(source)) {
    mkdirSync(dirname(source), { recursive: true });
    run("git", ["clone", "https://github.com/zouuup/landrun.git", source]);
    run("git", ["-C", source, "checkout", "--detach", landrunCommit]);
  }
  const gitArgs = ["-c", `safe.directory=${source}`, "-C", source];
  if (text("git", [...gitArgs, "rev-parse", "HEAD"]) !== landrunCommit) throw new Error("Landrun source commit is not the audited commit");
  if (text("git", [...gitArgs, "status", "--porcelain", "--untracked-files=no"])) throw new Error("Landrun tracked source has local modifications");
  run("go", ["build", "-trimpath", "-buildvcs=false", "-o", binary, "./cmd/landrun"], { cwd: source });
  copyFileSync(join(source, "LICENSE"), join(root, "licenses", "landrun-MIT.txt"));
  writeFileSync(receiptPath, JSON.stringify({ commit: landrunCommit, arch: process.arch, platform: process.platform,
    compiler: text("go", ["version"]), version: text(binary, ["--version"]), sha256: sha(readFileSync(binary)),
    modules: text("go", ["version", "-m", binary]) }, null, 2) + "\n");
}

const venv = join(runtime, "python");
const python = join(venv, "bin", "python3");
if (!existsSync(python)) run("python3", ["-m", "venv", venv]);
const requirements = existsSync(join(root, "requirements.lock")) ? "requirements.lock" : "requirements.in";
run(python, ["-m", "pip", "install", "--disable-pip-version-check", "--report", join(runtime, "python-install.json"), "-r", requirements]);
const frozen = text(python, ["-m", "pip", "freeze"]);
writeFileSync(join(runtime, "python-resolved.txt"), frozen + "\n");
// Lock is build output on first resolution, subsequently installation input.
if (!existsSync(join(root, "requirements.lock"))) writeFileSync(join(root, "requirements.lock"), frozen + "\n");
run(python, ["-c", "import ipykernel,jupyter_client,cloudpickle; print('PYTHON_ACCELERATOR',ipykernel.__version__,jupyter_client.__version__,cloudpickle.__version__)"]);
run(process.execPath, [join(root, "scripts", "patch-repl.mjs")]);
run(process.execPath, [join(root, "scripts", "patch-native.mjs")]);
for (const name of ["pi-repl-py", "pi-subagents", "@earendil-works/pi-coding-agent"]) {
  const packageRoot = join(root, "node_modules", name);
  for (const candidate of ["LICENSE", "LICENSE.md", "LICENSE.txt"]) if (existsSync(join(packageRoot, candidate))) {
    copyFileSync(join(packageRoot, candidate), join(root, "licenses", name.replaceAll("/", "-") + ".txt")); break;
  }
}
const lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8"));
const packages = Object.entries(lock.packages).filter(([path]) => path).map(([path, entry]) => ({ path, version: entry.version, resolved: entry.resolved, integrity: entry.integrity }));
writeFileSync(join(runtime, "npm-artifacts.json"), JSON.stringify({ lockSha256: sha(readFileSync(join(root, "package-lock.json"))), packages }, null, 2) + "\n");
console.log("PROVISIONED", JSON.stringify({ node: process.version, python, landrun: binary, packages: packages.length }));
