// One invocation of the command binary: parse, call the pipeline, print.
// Every decision this file appears to make is a decision the pipeline made (FR-60).

import { CONFIRM_FLAG, isConfirmFlag, parseArgs, USAGE } from "./args.js";
import type {
  CliInvocation,
  CliOutcome,
  CliRunner,
  ImportPipeline,
  ImportRequest,
  ListRequest,
  TargetProfile,
} from "./contract.js";
import { safeLines, safeText } from "./presentation.js";
import { renderLanding, renderListing } from "./render.js";

/**
 * The shim may state the target home; it never states the window size.
 * These stand for "not stated": the pipeline was built for this target and
 * applies the adapter default (FR-3).
 */
const HOME_NOT_STATED = "";
const WINDOW_NOT_STATED = 0;

/**
 * @param target the profile the pipeline was built for, when the caller knows it.
 * The shim-stated home wins, but only through the profile builder, which resolves "~/x" and
 * relative paths to absolute form (FR-3, T-CLI-18). The resolved profile is the fallback;
 * preferring it over the raw string ensures the pipeline never sees an unresolved path.
 */
export function createCliRunner(target?: TargetProfile): CliRunner {
  return {
    run: (invocation, pipeline) => run(invocation, pipeline, target),
  };
}

async function run(
  invocation: CliInvocation,
  pipeline: ImportPipeline,
  fallback: TargetProfile | undefined,
): Promise<CliOutcome> {
  const parsed = parseArgs(invocation.argv, invocation.cwd);
  if (!parsed.ok) {
    return { stdout: [], stderr: [parsed.problem, USAGE], exitCode: 2 };
  }

  const { selection, onlyAgent, onlyHome, confirmationToken } = parsed.args;
  const target: TargetProfile = {
    // The shim states the agent. The binary never guesses it.
    agent: invocation.targetAgent,
    home: fallback?.home ?? invocation.targetHome ?? HOME_NOT_STATED,
    windowTokens: fallback?.windowTokens ?? WINDOW_NOT_STATED,
  };

  if (selection === null) {
    const request: ListRequest = {
      repoRoot: invocation.cwd,
      target,
      onlyAgent,
      onlyHome,
    };
    try {
      const listing = await pipeline.list(request);
      return {
        stdout: renderListing(listing, invocation.cwd),
        stderr: [],
        exitCode: 0,
      };
    } catch (error) {
      return failure(
        `The listing failed: ${messageOf(error)}`,
        "Fix that, then run /resume-from again.",
      );
    }
  }

  const request: ImportRequest = {
    repoRoot: invocation.cwd,
    target,
    selection,
    onlyAgent,
    onlyHome,
  };

  // Confirming still previews first: a blocked import must not be committed (FR-33).
  const preview = await pipeline.preview(request).then(
    (report) => ({ ok: true as const, report }),
    (error: unknown) => ({ ok: false as const, error }),
  );
  if (!preview.ok) {
    return failure(
      `Could not open the preview: ${messageOf(preview.error)}`,
      'Run "/resume-from" to see the numbered list again.',
    );
  }

  const report = preview.report;
  if (report.blocked) {
    return {
      stdout: safeLines(report.lines),
      stderr: [
        `The import cannot run: ${safeText(report.blockedReason ?? "the preview did not say why.")}`,
      ],
      exitCode: 1,
    };
  }

  if (confirmationToken === null) {
    return {
      stdout: [
        ...safeLines(report.lines),
        "",
        `Run ${renderCommand([...invocation.argv, "--confirm", report.confirmationToken])} to import it.`,
      ],
      stderr: [],
      exitCode: 0,
    };
  }

  try {
    // Neither Codex nor Claude Code can move the user, so there is no runtime (C-2).
    const result = await pipeline.commit(request, null, confirmationToken);
    return { stdout: renderLanding(result), stderr: [], exitCode: 0 };
  } catch (error) {
    return failure(
      `The import failed: ${messageOf(error)}`,
      `Run ${renderCommand(withoutConfirmation(invocation.argv))} to see the preview again.`,
    );
  }
}

function failure(what: string, nextStep: string): CliOutcome {
  return { stdout: [], stderr: [what, nextStep], exitCode: 2 };
}

function withoutConfirmation(argv: string[]): string[] {
  const index = argv.findIndex(isConfirmFlag);
  if (index < 0) return argv;
  // "--confirm <token>" consumes two slots; "--confirm=<token>" consumes one.
  const consumed = argv[index] === CONFIRM_FLAG ? 2 : 1;
  return [...argv.slice(0, index), ...argv.slice(index + consumed)];
}

function renderCommand(argv: string[]): string {
  return ["/resume-from", ...argv].map(quoteArgument).join(" ");
}

function quoteArgument(argument: string): string {
  if (/^[A-Za-z0-9_./:=+-]+$/.test(argument)) return argument;
  return `'${argument.replaceAll("'", `'"'"'`)}'`;
}

function messageOf(error: unknown): string {
  if (typeof error === "string") return safeText(error);
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = (error as { message: unknown }).message;
    if (typeof message === "string") return safeText(message);
  }
  return safeText(String(error));
}
