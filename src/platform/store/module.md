# Guarded File Store

**Path**: src/platform/store/ — the module's code is everything in this folder and its transparent subfolders
**Parent**: `src/platform/`
**Submodules**: none (leaf)

## Purpose

This module is the only place in the system that creates files. It adds files to a target home and
never touches a file that already exists, and it either creates all of them or none of them.

Without it, FR-49 ("in the target home, the tool only adds") and FR-53 ("if the write fails at any
point, nothing remains") would be a rule every adapter had to remember. C-3 states that a bad write
can damage the real sessions of the user, so the guarantee has to be structural: adapters produce
bytes, this module decides whether they ever reach the disk.

## Functional Responsibilities

- Refuse the whole commit if any target path already exists (FR-49).
- Create all files, or leave the filesystem exactly as it was (FR-53).
- Create missing parent directories, because a new home may not have the session folder yet.
- Return a handle that can undo the commit, so a later check can roll it back (FR-52 reconciliation).
- Report a refusal with a reason a caller can turn into an actionable message (FR-56).

## Subdomain Classification

**Generic.** Atomic, add-only file creation is a solved problem: write to a temporary name in the
same directory, then place it without replacing anything. Functional volatility is **low** — the guarantee never changes.
Implementation volatility is **moderate**: the temporary-file strategy, the durability level (whether
directories are synced), and the platform-specific rename semantics may all change.

The generic classification is why the implementation sits behind `FileCommitter` rather than being
called directly: the switching risk is real, and the contract keeps it local.

## Encapsulated Knowledge

- **The write strategy.** Every file is written under a temporary name in its own destination
  directory, and only once all of them are staged is each one placed. Placement is a hard link
  followed by the removal of the temporary name — not a rename: a rename silently overwrites a file
  that appeared after the existence check, and a hard link fails instead, which is what the race
  invariant below requires. Nothing outside this module knows that a temporary file ever existed.
- **The rollback bookkeeping.** Which paths this commit created, and in which order to remove them.
- **The existence check.** That the check happens before any byte is written, and that a race between
  the check and the rename is resolved by failing the commit, never by overwriting.
- **Platform details.** Rename atomicity, directory permissions, and how a partially created
  directory tree is cleaned up.

Nothing here knows what a session is, what an agent is, or what a rule is. The contents of a file are
opaque bytes.

## Public Contract

```ts
/** Raw file content. */
type Bytes = Buffer;

/** A file to create. Its path must not already exist (FR-49). */
interface PendingFile {
  absolutePath: string;
  bytes: Bytes;
}
```

```ts
/** Why a commit refused to run, or failed (FR-56). */
type CommitRefusal = "path-exists" | "not-writable" | "write-failed";

/** A commit that succeeded and can still be undone (FR-52, FR-53). */
interface CommitHandle {
  createdPaths: string[];
  /** Removes exactly the files and directories this commit created. Touches nothing else. */
  rollback(): Promise<void>;
}

/** Raised when a commit refuses to run or fails. Carries an actionable message (FR-56). */
interface CommitError {
  refusal: CommitRefusal;
  /** The path that caused the refusal, when there is one. */
  path: string | null;
  /** What failed, and what the user can do next (FR-56). */
  message: string;
}

/** Adds files to a home. It only adds (FR-49), and it is all or nothing (FR-53). */
interface FileCommitter {
  /**
   * Creates every file, or none. Rejects with a CommitError.
   * Rejects before writing any byte when a path already exists.
   */
  commit(files: PendingFile[]): Promise<CommitHandle>;
}
```

## Integrations

**None.** This module depends on no other module. It is called by `src/import/landing/` and its
`PendingFile` type is restated by `src/adapters/`, but it holds no knowledge of either.

That direction matters: this is a low-volatility generic service and the adapters are the most
volatile part of the tree (C-7 to C-11 pin exact upstream versions). A dependency from here to there
would import that volatility into the one module that must never change.

## Change Vectors

Changes that require **only this module** to change:

- The durability level rises — for example the destination directory is synced after the rename.
- The temporary-file naming or location strategy changes.
- Rollback becomes best-effort with a report instead of all-or-nothing.
- A new refusal reason is added for a platform-specific failure.

## Constraints and Invariants

- **A file that exists is never opened for writing, truncated, or removed** (FR-49, AC-4). The only
  paths this module may remove are paths the same commit created, through `rollback`.
- **The existence check runs before the first byte is written.** A refusal must leave the filesystem
  untouched, including temporary files.
- **A failed commit removes every file it created before failing** (FR-53). There is no partial
  session, ever.
- **`rollback` is idempotent.** Calling it twice, or calling it after a manual deletion, succeeds.
- **`commit` never inspects the bytes.** No parsing, no validation, no re-encoding. Structural
  validation of a session is `src/adapters/`' job and it happens before this module is called
  (FR-50).
- **Directories created by a commit are removed by its rollback**, but only when they are empty and
  only when this commit created them.
- **Paths are absolute.** A relative path is a programming error and is refused, not resolved against
  the current directory.

## Test Specification

Every test runs against a temporary directory. No test touches a real agent home.

### Unit Tests

**T-STO-1 — a commit creates every file**
- Scenario: `commit` with three files in a fresh directory.
- Expected behavior: all three exist with the exact bytes given, and `CommitHandle.createdPaths`
  lists all three.

**T-STO-2 — missing parent directories are created**
- Scenario: a file whose parent directory does not exist.
- Expected behavior: the directory tree is created and the file is written.

**T-STO-3 — an existing path refuses the whole commit**
- Scenario: three files, the second of which already exists.
- Expected behavior: rejects with `refusal` `"path-exists"` and the offending path. The first and
  third files are **not** created (FR-49).

**T-STO-4 — a refusal writes nothing at all**
- Scenario: the directory is checksummed before the refused commit of T-STO-3, and after it.
- Expected behavior: the checksums are identical, including the absence of any temporary file.

**T-STO-5 — a failure part-way through removes what was created**
- Scenario: three files; the write of the third fails (the destination is made unwritable).
- Expected behavior: rejects with `"write-failed"`, and the first two files do not exist afterwards
  (FR-53).

**T-STO-6 — rollback removes exactly what the commit created**
- Scenario: a directory holding one pre-existing file; a commit adds two more; `rollback` runs.
- Expected behavior: the two new files are gone, the pre-existing file is untouched, and directories
  the commit created are removed while directories that existed before are not.

**T-STO-7 — rollback is idempotent**
- Scenario: `rollback` is called twice; and once after a created file was deleted by hand.
- Expected behavior: both calls resolve without error.

### Integration Contract Tests

**T-STO-8 — a commit handle is returned only on full success**
- Scenario: parameterized over success, `"path-exists"` and `"write-failed"`.
- Expected behavior: a handle is returned only in the success case; the other two reject with a
  `CommitError` carrying `refusal`, `path` and a message that names the next step (FR-56).

**T-STO-9 — bytes are written unchanged**
- Scenario: files containing invalid UTF-8, a lone carriage return, and a trailing null byte.
- Expected behavior: the bytes on disk are byte-identical to the input. No re-encoding, no newline
  normalization.

**T-STO-10 — an empty commit succeeds and does nothing**
- Scenario: `commit` with an empty list.
- Expected behavior: resolves with an empty `createdPaths`; `rollback` on it is a no-op.

### Boundary Tests

**T-STO-11 — a relative path is refused**
- Scenario: a `PendingFile` with a relative `absolutePath`.
- Expected behavior: rejects before writing. The path is never resolved against the current
  directory.

**T-STO-12 — two files with the same path in one commit are refused**
- Scenario: a commit listing the same absolute path twice.
- Expected behavior: rejects. Otherwise the second write would overwrite the first, which is the one
  thing this module must never do.

**T-STO-13 — a path that appears between the check and the rename**
- Scenario: the destination file is created by another process after the existence check and before
  the rename.
- Expected behavior: the commit fails and rolls back. It never overwrites the file that appeared.

**T-STO-14 — a destination directory that is not writable**
- Scenario: the parent directory has no write permission.
- Expected behavior: rejects with `"not-writable"` and a message naming the directory.

**T-STO-15 — the module knows nothing about sessions**
- Scenario: a static check of this module's imports.
- Expected behavior: it imports nothing from `src/session/`, `src/adapters/`, `src/import/` or
  `src/host/`. This is the mechanical test of the `src/platform/` boundary rule.

### Behavior Tests

**T-STO-16 — a target home is never damaged**
- Scenario: a directory populated with 50 files is checksummed; a commit adds two files; the
  directory is checksummed again.
- Expected behavior: every pre-existing file is byte-identical, and exactly two paths are new
  (FR-49, the AC-4 guarantee applied to the target).

**T-STO-17 — an interrupted commit leaves no partial session**
- Scenario: the process is killed between the write of the first file and the second.
- Expected behavior: no destination file exists. Only temporary files may remain, and they carry a
  name no agent will read.
