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

/** A commit that succeeded and can still be undone (FR-52, FR-53). */
export interface CommitHandle {
  createdPaths: string[];
  /** Removes exactly the files and directories this commit created. Touches nothing else. */
  rollback(): Promise<void>;
}

/** Raised when a commit refuses to run or fails. Carries an actionable message (FR-56). */
export interface CommitError {
  refusal: CommitRefusal;
  /** The path that caused the refusal, when there is one. */
  path: string | null;
  /** What failed, and what the user can do next (FR-56). */
  message: string;
}

/** Adds files to a home. It only adds (FR-49), and it is all or nothing (FR-53). */
export interface FileCommitter {
  /**
   * Creates every file, or none. Rejects with a CommitError.
   * Rejects before writing any byte when a path already exists.
   */
  commit(files: PendingFile[]): Promise<CommitHandle>;
}
