/**
 * The package entry point.
 *
 * There is one wiring in this system and it lives in `src/host/`, which Decision 3 makes the
 * composition root: the agent list is there because putting it in `src/adapters/` would cycle.
 * This file's whole job is to name the one path into that wiring, so the three ways in — a
 * program that imports the package, the command binary, and the Pi extension — are three doors
 * onto one composition rather than three compositions.
 *
 * That is why nothing here reaches `src/session/`, `src/adapters/`, `src/import/` or
 * `src/platform/`. A second import of any of them from here would be a second wiring path, and
 * the entry point would start deciding things the host already decides.
 */

import { createHost as buildHost, type Host, type HostDeps } from "./host/index.js";

export type {
  AgentId,
  AgentRuntime,
  HandoverInstruction,
  HomePath,
  HostWiring,
  ImportPipeline,
  ImportRequest,
  LandingResult,
  ResumeFrom,
  SelectionInput,
  SessionId,
  SessionRef,
  TargetProfile,
} from "./contract.js";
/**
 * The two entry points C-1 forces (Decision 4): a binary for the agents that cannot host a
 * picker, and an in-process activation for the one that can. Both are re-exported rather than
 * rebuilt — each already loads the host through `createHost` below.
 *
 * `activatePiExtension` is published here because the package's `./pi-extension` subpath resolves
 * to `src/host/pi-extension/`, which holds the command and the picker but not the activation that
 * builds a host for them. A Pi host that reached only for the subpath would have to wire the
 * system itself.
 */
export { activatePiExtension, type PiActivation, runCommandBinary } from "./host/index.js";
export type { Host, HostDeps };

/**
 * Loads configuration, builds the agent list, and returns the host wiring.
 *
 * `createHost()` with no argument is the contract's call and the one every entry point makes:
 * every dependency defaults to the shipped implementation. The optional argument is the seam the
 * host already publishes — it is what lets a test replace one generic service of `src/platform/`
 * and see the rest of the system run unchanged (T-ROO-22).
 */
export function createHost(deps: HostDeps = {}): Promise<Host> {
  return buildHost(deps);
}
