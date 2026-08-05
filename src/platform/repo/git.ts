// The only place in this module that reaches git. The binary is spawned with an argument array and
// never through a shell, so no revision string can ever be interpreted as a command.

import { execFile } from "node:child_process";

export interface GitResult {
  /** True when git exited 0. A non-zero exit is an answer ("no such revision"), not a failure. */
  ok: boolean;
  stdout: string;
  stderr: string;
}

/** 1 MB. Every command here prints a line or two; more than this means something is wrong. */
const MAX_OUTPUT_BYTES = 1024 * 1024;

/**
 * Runs a read-only git command in `cwd`.
 *
 * Rejects only when git could not be run at all — a missing binary, a signal. An exit code is
 * reported in `ok`, because the callers of this module treat "not a repository", "no commits yet"
 * and "unknown revision" as facts to report rather than errors to raise.
 */
export function runGit(cwd: string, args: readonly string[]): Promise<GitResult> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      ["-C", cwd, ...args],
      { env: gitEnv(), maxBuffer: MAX_OUTPUT_BYTES, windowsHide: true },
      (error, stdout, stderr) => {
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
        reject(error);
      },
    );
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
