// The only place in this module that reaches git. The binary is spawned with an argument array and
// never through a shell, so no revision string can ever be interpreted as a command.

import type { ExecFileException, ExecFileOptionsWithStringEncoding } from "node:child_process";
import { execFile } from "node:child_process";
import type { RepoReaderOptions } from "./contract.js";

export interface GitResult {
  /** True when git exited 0. A non-zero exit is an answer ("no such revision"), not a failure. */
  ok: boolean;
  stdout: string;
  stderr: string;
}

/** 1 MB. Every command here prints a line or two; more than this means something is wrong. */
const MAX_OUTPUT_BYTES = 1024 * 1024;

/** Long enough for local repositories while still bounding a wedged filesystem or git process. */
const DEFAULT_GIT_TIMEOUT_MS = 10_000;

/**
 * Runs a read-only git command in `cwd`.
 *
 * Rejects only when git could not be run at all — a missing binary, a signal. An exit code is
 * reported in `ok`, because the callers of this module treat "not a repository", "no commits yet"
 * and "unknown revision" as facts to report rather than errors to raise.
 */
export function runGit(
  cwd: string,
  args: readonly string[],
  options: RepoReaderOptions = {},
): Promise<GitResult> {
  const processOptions = normalizeGitOptions(options);
  return new Promise((resolve, reject) => {
    const execOptions: ExecFileOptionsWithStringEncoding = {
      encoding: "utf8",
      env: gitEnv(),
      maxBuffer: MAX_OUTPUT_BYTES,
      timeout: processOptions.timeoutMs,
      windowsHide: true,
    };
    if (processOptions.signal !== undefined) execOptions.signal = processOptions.signal;

    execFile("git", ["-C", cwd, ...args], execOptions, (error, stdout, stderr) => {
      if (error === null) {
        resolve({ ok: true, stdout, stderr });
        return;
      }
      // execFile reports an exit code as a number and a genuine failure to run as a string code
      // (ENOENT, EACCES) or a signal.
      const exited = typeof error.code === "number" && !error.signal;
      if (exited) {
        resolve({ ok: false, stdout, stderr });
        return;
      }
      reject(processError(cwd, processOptions, error));
    });
  });
}

interface NormalizedOptions {
  timeoutMs: number;
  signal?: AbortSignal | undefined;
}

export function normalizeGitOptions(options: RepoReaderOptions): NormalizedOptions {
  const timeoutMs = options.timeoutMs ?? DEFAULT_GIT_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError("git timeoutMs must be a positive, finite integer");
  }
  return options.signal === undefined ? { timeoutMs } : { timeoutMs, signal: options.signal };
}

function processError(cwd: string, options: NormalizedOptions, cause: ExecFileException): Error {
  if (options.signal?.aborted === true || cause.name === "AbortError") {
    return new Error(`git command aborted while reading ${cwd}`, { cause });
  }
  if (cause.killed === true && cause.signal !== undefined) {
    return new Error(`git command timed out after ${options.timeoutMs} ms while reading ${cwd}`, {
      cause,
    });
  }
  return new Error(`git could not run while reading ${cwd}: ${cause.message}`, {
    cause,
  });
}

function gitEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  // Never take the index lock: a read must not be able to leave a lock file behind or rewrite the
  // index of a repository the user owns.
  env.GIT_OPTIONAL_LOCKS = "0";
  // These would override `-C` and point git at a repository other than the one being asked about,
  // for example when the tool runs inside a git hook.
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  delete env.GIT_INDEX_FILE;
  return env;
}
