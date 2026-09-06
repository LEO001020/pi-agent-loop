import { createJiti } from "jiti";
import { resolve } from "node:path";
if (!process.argv[2]) throw new Error("Usage: node scripts/run-ts.mjs FILE.ts");
const jiti = createJiti(import.meta.url, { interopDefault: false });
await jiti.import(resolve(process.argv[2]));
