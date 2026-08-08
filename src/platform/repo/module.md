# Repository Reader

**Path**: src/platform/repo/ — the module's code is everything in this folder and its transparent subfolders
**Parent**: `src/platform/`
**Submodules**: none (leaf)

## Purpose

This module reads the state of the git repository the command is running in: where its root is, what
HEAD points at, and how far HEAD has moved from the commit a source session ran at.

Two requirements depend on it. FR-13 keeps the listing to sessions of the current repository, which
needs the repository root. FR-37 and FR-38 warn the user that the tree has moved since the source
session, which needs the commit distance.

## Functional Responsibilities

- Identify the repository containing a directory: root path, HEAD commit, current branch (FR-13).
- Report how far HEAD is from a given commit, in commits ahead and behind (FR-37, FR-38).
- Report "not known" rather than guessing when the working directory is not a repository, when the
  repository has no commits, or when the source commit is absent from this repository.

## Subdomain Classification

**Generic.** Reading git state is a solved problem. Functional volatility is **low**: the questions
never change. Implementation volatility is **low to moderate** — running the `git` binary could be
replaced by a library, but the switch is unlikely and the contract is small enough to make it cheap
either way.

## Encapsulated Knowledge

- **How git is reached.** Whether the `git` binary is spawned or a library is linked, which
  subcommands are used, and how their output is parsed.
- **Failure translation.** That "not a git repository", "no commits yet", and "unknown revision" are
  three different git failures and all three become a null or a `known: false`, never an exception
  the caller must interpret.
- **Worktree and submodule details.** Which directory counts as the root when the command runs inside
  a worktree or a submodule.

Nothing here knows what a session is, what an agent is, or what a warning looks like. It reports
facts; `src/import/preview/` decides what to say about them.

## Public Contract

```ts
/** The repository the command runs in (FR-13). */
interface RepoIdentity {
  /** Absolute path of the repository root, or null when the directory is not in a repository. */
  root: string | null;
  /** Current HEAD commit, or null when the repository has no commit yet. */
  head: string | null;
  branch: string | null;
}
```

```ts
/** How far the tree moved since the source session ran (FR-38). */
interface CommitDistance {
  /** False when the source commit is unknown, or absent from this repository. */
  known: boolean;
  /** Commits on HEAD that the source commit does not have. */
  ahead: number;
  /** Commits the source commit has that HEAD does not. */
  behind: number;
}
```

```ts
/** Process controls applied to every git command issued by one reader. */
interface RepoReaderOptions {
  /** Maximum duration of one git command. Defaults to a finite module-owned limit. */
  timeoutMs?: number;
  /** Cancels the current command and every later command issued by this reader. */
  signal?: AbortSignal;
}
```

```ts
/** Reads git state. It never writes to the repository. */
interface RepoReader {
  identify(cwd: string): Promise<RepoIdentity>;
  /** Compares HEAD with a commit of a source session (FR-37). */
  distanceFrom(sourceCommit: string): Promise<CommitDistance>;
}
```

## Integrations

**None.** This module depends on no other module. `src/import/discovery/` and
`src/import/preview/` call it; it calls nobody.

## Change Vectors

Changes that require **only this module** to change:

- The `git` binary is replaced by a library, or the other way round.
- Worktree or submodule handling is refined.
- A new fact is reported, for example whether the working tree is currently dirty.
- The distance calculation changes, for example to use the merge base explicitly.

## Constraints and Invariants

- **This module never writes to the repository.** No commit, no checkout, no stash, no index change,
  no configuration write. It is read-only against the user's work (AC-4 in spirit: the tool touches
  nothing the user owns).
- **No method throws for an expected absence.** Not a repository, no commits, unknown revision: all
  three are reported in the return value. Only a genuine failure to run git rejects.
- **`RepoIdentity.root` is absolute and fully resolved**, including symlinks, so that FR-13's filter
  compares paths and not spellings.
- **`distanceFrom` is safe with any string.** A malformed or attacker-supplied revision returns
  `known: false`; it is never interpolated into a shell.
- **Results are read at the moment of the call.** No caching across calls, because the preview and
  the commit of one import may straddle a change in the tree, and the second call must see it.
- **Every git subprocess has a finite timeout and supports cancellation.** A timeout or abort rejects
  with a message that distinguishes it from an expected non-zero git exit.
- **`known: false` implies `ahead` and `behind` are 0.** Callers must not read them as real numbers.

## Test Specification

Tests build real, disposable git repositories in a temporary directory. Nothing runs against the
user's repository.

### Unit Tests

**T-REP-1 — a repository is identified**
- Scenario: a repository with one commit on branch `main`; `identify` is called with the root.
- Expected behavior: `root` is the resolved absolute root, `head` is the commit, `branch` is `main`.

**T-REP-2 — identification works from a subdirectory**
- Scenario: `identify` called with a nested directory of the same repository.
- Expected behavior: `root` is the repository root, not the directory passed in.

**T-REP-3 — a directory outside a repository**
- Scenario: `identify` on a plain temporary directory.
- Expected behavior: `root`, `head` and `branch` are all null. It does not throw.

**T-REP-4 — a repository with no commits**
- Scenario: `git init` and nothing else.
- Expected behavior: `root` is set, `head` is null, and it does not throw.

**T-REP-5 — commit distance ahead**
- Scenario: a repository where HEAD is 14 commits after the source commit.
- Expected behavior: `known` true, `ahead` 14, `behind` 0. These are the numbers FR-38's warning
  prints.

**T-REP-6 — commit distance behind and diverged**
- Scenario: parameterized — HEAD behind by 3; HEAD and source diverged by 2 and 5.
- Expected behavior: `known` true with the exact ahead and behind counts in each case.

**T-REP-7 — the same commit**
- Scenario: the source commit equals HEAD.
- Expected behavior: `known` true, `ahead` 0, `behind` 0 — which the preview renders as no warning
  (FR-38 fires only on a difference).

### Integration Contract Tests

**T-REP-8 — an unknown revision is reported, not thrown**
- Scenario: `distanceFrom` with a commit that does not exist in this repository.
- Expected behavior: `known` false, `ahead` 0, `behind` 0. No exception.

**T-REP-9 — `known: false` implies zero counts**
- Scenario: every case that yields `known` false.
- Expected behavior: `ahead` and `behind` are both 0, so a caller cannot print a fabricated distance.

**T-REP-10 — the root is fully resolved**
- Scenario: the repository is reached through a symlinked path.
- Expected behavior: `root` is the real path. This is what makes the FR-13 filter compare locations
  rather than spellings.

### Boundary Tests

**T-REP-11 — a hostile revision string is safe**
- Scenario: `distanceFrom` with `"; rm -rf /"`, `"--upload-pack=touch pwned"`, a 10 kB string, and an
  empty string.
- Expected behavior: each returns `known` false. No file is created, no shell is invoked, no error
  escapes.

**T-REP-12 — the repository is never modified**
- Scenario: the repository directory is checksummed before and after every method of this module.
- Expected behavior: identical, including `.git`. No index write, no config write, no lock file left
  behind.

**T-REP-13 — no caching between calls**
- Scenario: `identify` is called, a commit is made, `identify` is called again.
- Expected behavior: the second call reports the new HEAD. The preview and the commit of one import
  may straddle a change, and the second must see it.

**T-REP-14 — the module knows nothing about sessions**
- Scenario: a static check of this module's imports.
- Expected behavior: no import from `src/session/`, `src/adapters/`, `src/import/` or `src/host/`.

### Behavior Tests

**T-REP-15 — the FR-38 scenario end to end**
- Scenario: a session ran at commit `3f2a1bc`; the tree is now at `9d81e04`, 14 commits later.
- Expected behavior: `distanceFrom("3f2a1bc")` gives `known` true, `ahead` 14, `behind` 0 — exactly
  the facts the requirement's example warning states.

**T-REP-16 — a session from another repository**
- Scenario: a source session recorded a commit from an unrelated repository.
- Expected behavior: `known` false. The preview then says the source commit is not known here, rather
  than warning about a distance that has no meaning.

**T-REP-17 — git execution is bounded**
- Scenario: a git subprocess that waits for standard input, with a short `timeoutMs`.
- Expected behavior: it is stopped and rejects with the configured duration in the message. The
  factory rejects non-positive or non-finite timeout values.

**T-REP-18 — git execution is cancellable**
- Scenario: a reader created with an aborted `AbortSignal` attempts to identify a repository.
- Expected behavior: it rejects with an abort message before returning repository facts.
