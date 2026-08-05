// One invocation of the command binary: parse, call the pipeline, print.
// Every decision this file appears to make is a decision the pipeline made (FR-60).

import { parseArgs, USAGE } from "./args.js";
import type {
  CliInvocation,
  CliOutcome,
  CliRunner,
  ImportPipeline,
  ImportRequest,
  ListRequest,
  TargetProfile,
} from "./contract.js";
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
 * The agent and the home the shim stated always win (FR-3, T-CLI-18).
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

  const { selection, onlyAgent, onlyHome, confirm } = parsed.args;
  const target: TargetProfile = {
    // The shim states the agent. The binary never guesses it.
    agent: invocation.targetAgent,
    home: invocation.targetHome ?? fallback?.home ?? HOME_NOT_STATED,
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
      return { stdout: renderListing(listing, invocation.cwd), stderr: [], exitCode: 0 };
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
      stdout: report.lines,
      stderr: [`The import cannot run: ${report.blockedReason ?? "the preview did not say why."}`],
      exitCode: 1,
    };
  }

  if (!confirm) {
    return {
      stdout: [...report.lines, "", `Run "${echo(invocation.argv, "--confirm")}" to import it.`],
      stderr: [],
      exitCode: 0,
    };
  }

  try {
    // Neither Codex nor Claude Code can move the user, so there is no runtime (C-2).
    const result = await pipeline.commit(request, null);
    return { stdout: renderLanding(result), stderr: [], exitCode: 0 };
  } catch (error) {
    return failure(
      `The import failed: ${messageOf(error)}`,
      `Run "${echo(invocation.argv.filter((arg) => arg !== "--confirm"))}" to see the preview again.`,
    );
  }
}

function failure(what: string, nextStep: string): CliOutcome {
  return { stdout: [], stderr: [what, nextStep], exitCode: 2 };
}

function echo(argv: string[], extra?: string): string {
  const parts = extra === undefined ? argv : [...argv, extra];
  return ["/resume-from", ...parts].join(" ");
}

function messageOf(error: unknown): string {
  if (typeof error === "string") return error;
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = (error as { message: unknown }).message;
    if (typeof message === "string") return message;
  }
  return String(error);
}
