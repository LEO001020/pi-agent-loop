// Thin OS-isolated filesystem transport for Pi's existing tool implementations.
// The parent never evaluates code from the request. Landlock constrains every
// file operation here, including symlink traversal after a parent preflight.
import { access, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { constants } from "node:fs";

try {
  const input = JSON.parse(await readFile(process.argv[2], "utf8"));
  switch (input.op) {
    case "read":
      if ((await stat(input.path)).size > 32 * 1024 * 1024) throw new Error("File exceeds 32 MiB tool-read bound; use a bounded shell read");
      process.stdout.write(await readFile(input.path));
      break;
    case "access": await access(input.path, input.write ? constants.R_OK | constants.W_OK : constants.R_OK); break;
    case "mkdir": await mkdir(input.path, { recursive: true }); break;
    case "write": await writeFile(input.path, input.content, "utf8"); break;
    case "stat": process.stdout.write(JSON.stringify({ directory: (await stat(input.path)).isDirectory() })); break;
    case "list": process.stdout.write(JSON.stringify(await readdir(input.path))); break;
    case "native-find":
    case "native-grep": {
      const sdk = await import("@earendil-works/pi-coding-agent");
      const tool = input.op === "native-find" ? sdk.createFindToolDefinition(input.cwd) : sdk.createGrepToolDefinition(input.cwd);
      const result = await tool.execute("isolated-native-tool", input.args, undefined, undefined, { cwd: input.cwd });
      process.stdout.write(JSON.stringify(result));
      break;
    }
    default: throw new Error("Unknown isolated filesystem operation");
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
