import type { Config } from "./config.ts";
import type { NodeKind } from "./state.ts";

export interface ChildContract {
  version: 1;
  taskId: string;
  taskRevision: number;
  generation: number;
  nodeId: string;
  nodeVersion: number;
  attemptId: string;
  kind: NodeKind;
  baseRoot: string;
  baseCommit: string;
  scope: string[];
  inputsDir: string;
  runtimeDir: string;
  attestationPath: string;
  repl: boolean;
  cfg: Config;
}
