// GENERATED from src/platform/store/module.md — the Public Contract section is the normative home.
// Declarations only: no behaviour, no defaults. If this file and module.md disagree,
// the document wins and this file is corrected.

/** Raw file content. */
export type Bytes = Buffer;

/** A file to create. Its path must not already exist (FR-49). */
export interface PendingFile {
  absolutePath: string;
  bytes: Bytes;
}

/** Why a commit refused to run, or failed (FR-56). */
export type CommitRefusal = "path-exists" | "not-writable" | "write-failed";

/** A commit that succeeded and reports the paths it created (FR-52, FR-53). */
export interface CommitHandle {
  createdPaths: string[];
}

/** Raised when a commit refuses to run or fails. Carries an actionable message (FR-56). */
export interface CommitError {
  refusal: CommitRefusal;
  /** The path that caused the refusal, when there is one. */
  path: string | null;
  /** What failed, and what the user can do next (FR-56). */
  message: string;
  /** Paths retained for safety or not removed by cleanup, when manual inspection may be required. */
  remainingPaths?: string[];
}

/** Atomically adds zero or one file to a home (FR-49, FR-53). */
export interface FileCommitter {
  /**
   * Creates zero or one file. Rejects with a CommitError before filesystem access when more than one
   * file is supplied, or before writing bytes when the destination already exists.
   */
  commit(root: string, files: PendingFile[]): Promise<CommitHandle>;
}
