import {
  createResumeFromCommand,
  RESUME_FROM_COMMAND_NAME,
  type ResumeFromDeps,
} from "./command.js";
import type { ImportPipeline, PiCommandContext } from "./contract.js";

/**
 * What Pi is given when the extension loads.
 *
 * `module.md` makes registration a responsibility of this module but names no
 * API for it — Pi's extension surface is an internal of a moving application,
 * measured once at 0.83.0 (C-10). The dependency is therefore structural: Pi
 * passes anything that can register a command, and only this file knows the
 * shape. When Pi's API changes, this file changes and nothing else does.
 */
export interface PiCommandDefinition {
  name: string;
  description: string;
  /** Pi calls this when the user types the command. It is the only call site (C-10). */
  run(ctx: PiCommandContext, args: string[]): Promise<void>;
}

export interface PiCommandRegistrar {
  registerCommand(definition: PiCommandDefinition): void;
}

export interface RegisterDeps extends ResumeFromDeps {
  pipeline: ImportPipeline;
}

const DESCRIPTION =
  "Continue another session here. Use /resume-from --help for accepted arguments.";

/** Registers /resume-from with Pi. */
export function registerResumeFrom(registrar: PiCommandRegistrar, deps: RegisterDeps): void {
  const command = createResumeFromCommand(deps);
  registrar.registerCommand({
    name: RESUME_FROM_COMMAND_NAME,
    description: DESCRIPTION,
    run: (ctx, args) => command.run(ctx, args, deps.pipeline),
  });
}
