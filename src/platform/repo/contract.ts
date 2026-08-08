// GENERATED from src/platform/repo/module.md — the Public Contract section is the normative home.
// Declarations only: no behaviour, no defaults. If this file and module.md disagree,
// the document wins and this file is corrected.

/** The repository the command runs in (FR-13). */
export interface RepoIdentity {
  /** Absolute path of the repository root, or null when the directory is not in a repository. */
  root: string | null;
  /** Current HEAD commit, or null when the repository has no commit yet. */
  head: string | null;
  branch: string | null;
}

/** How far the tree moved since the source session ran (FR-38). */
export interface CommitDistance {
  /** False when the source commit is unknown, or absent from this repository. */
  known: boolean;
  /** Commits on HEAD that the source commit does not have. */
  ahead: number;
  /** Commits the source commit has that HEAD does not. */
  behind: number;
}

/** Process controls applied to every git command issued by one reader. */
export interface RepoReaderOptions {
  /** Maximum duration of one git command. Defaults to a finite module-owned limit. */
  timeoutMs?: number | undefined;
  /** Cancels the current command and every later command issued by this reader. */
  signal?: AbortSignal | undefined;
}

/** Reads git state. It never writes to the repository. */
export interface RepoReader {
  identify(cwd: string): Promise<RepoIdentity>;
  /** Compares HEAD with a commit of a source session (FR-37). */
  distanceFrom(sourceCommit: string): Promise<CommitDistance>;
}
