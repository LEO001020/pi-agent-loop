#!/usr/bin/env node
import { createJiti } from "jiti";

const version = process.versions.node.split(".").map(Number);
if (version[0] < 22 || (version[0] === 22 && version[1] < 19)) {
  process.stderr.write("Pi Agent Loop requires Node.js >=22.19.0.\n");
  process.exitCode = 2;
} else {
  const jiti = createJiti(import.meta.url, { interopDefault: false });
  try {
    const { main } = await jiti.import("../src/cli.ts");
    await main(process.argv.slice(2));
  } catch (error) {
    const { redact } = await jiti.import("../src/config.ts");
    process.stderr.write(`${redact(error instanceof Error ? error.message : String(error))}\n`);
    process.exitCode = 1;
  }
}
