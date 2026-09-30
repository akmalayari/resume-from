# Git worktree session discovery

Status: ready for execution; reviewed and approved by Codex and Claude Code.

Execution boundary: prepare this plan only. Do not start ralphex or implement its
tasks until the user requests execution. A later ralphex run may create its own
worktree and task commits; publishing, merging, and changing installed plugins are
outside this plan.

## Problem

Session discovery currently compares the canonical recorded directory with the
invocation directory. Git gives each linked worktree its own checkout root, so
sessions from the main checkout or another worktree are rejected by both the list
and explicit selectors. Changing the source profile with `--home` does not change
this comparison.

The CLI passes its current directory directly to discovery, so starting inside a
checkout subdirectory can also fail the comparison. The Claude reader keeps only
the first recorded `cwd` from the active session path. A session can record both
the original checkout and a worktree directory.

Evidence: `src/import/discovery/finder.ts`, `src/host/cli/runner.ts`,
`src/platform/repo/reader.ts`, `src/adapters/claude-code/reader.ts`.

## Proposed behavior

- Treat checkouts sharing the same canonical Git common directory as one repository.
  Worktree placement must not affect membership: nested, sibling, and arbitrary
  external directories all use the same rule.
- Apply the same rule to listing, row selection, session IDs, and file paths across
  the CLI and Pi extension, including alternate source profiles.
- Preserve the destination checkout for imports and commit-distance checks. Repository
  membership must not silently change the checkout used by the resumed session.
- Use recorded active-conversation directories when a session changes directories,
  subject to the evidence and ambiguity rules below.
- Continue rejecting unrelated repositories, submodules, nested independent
  repositories, and independent clones, including clones sharing Git objects.
- Show the destination checkout in the preview. Explain when source and destination
  checkouts differ: conversation import does not transfer uncommitted work, switch
  branches, or recreate removed worktrees.

## Repository identity and destination directory

Keep three distinct facts: the invocation directory used by the destination agent,
the checkout root, and the shared repository identity. Do not replace the existing
checkout `root` with a Git metadata path: preview, writers, and native resume
commands still need a working directory.

Canonicalize the existing input directory, then resolve membership with
`git -C <directory> rev-parse --git-common-dir`. Resolve relative output against
that exact directory and apply filesystem `realpath` to the result. This handles
both absolute and relative Git output without requiring `--path-format` support.
Resolve the checkout root separately with `--show-toplevel`.
Use argument arrays, the existing timeout/cancellation controls, and an environment
that does not let inherited `GIT_DIR`, `GIT_WORK_TREE`, or `GIT_COMMON_DIR` override
the directory being inspected. Verify the command against the supported Git baseline.

Do not compare path prefixes, strip `.worktrees` or branch names, inspect `.git`
as if it were always a directory, compare remote URLs, or use the object database
as identity. Symlinks resolve before comparison. Let Git select the nearest actual
repository, so a nested independent repository or submodule stays separate.

Preserve existing exact-directory matching. A successful Git lookup supplies a
canonical common-directory identity; a completed nonzero Git exit supplies no
identity. Describe the latter as unresolved, not necessarily non-Git: do not parse
localized stderr to distinguish failure causes. `runGit` already rejects for
timeouts, spawn failures, and cancellation. Filesystem ENOENT is missing evidence;
permission and other I/O failures are operational errors.

Inject the repository reader through existing module boundaries. Cache promises
per canonical directory within one listing, including failed lookups. Keep existing
sequential descriptor processing and home-level concurrency; do not add a scheduler
or global cache. A source candidate operational error skips that session with a
diagnostic, not every home through `buildListing`'s `Promise.all`. A destination
operational error stops the request with a diagnostic. Cancellation always stops
the operation. Neither preview nor confirmation reuses a previous listing's cache.

## Sessions with changing or unavailable directories

- Add `SessionDescriptor.repoPaths`, a required array of distinct absolute recorded
  paths ordered by first appearance; keep `repoPath = repoPaths[0] ?? null` as the
  primary recorded path, including when that first path no longer exists.
  Claude collects them from the active main conversation, excluding sidechains before
  metadata extraction. Discarded ancestry and paths in prose/tool arguments do not
  contribute. Codex and Pi supply a singleton from their header, or an empty array
  when no valid absolute path is known. Update fixture adapters and normative contracts.
- Resolve the destination and all source candidates once per listing. A session matches
  when `(matchingGitIdentity || sameDirectory) && !conflictingGitIdentity`: at least
  one candidate has the destination's non-null common-directory identity or equals
  its canonical directory, and no resolved candidate has a different identity.
  Evaluate the conflict rule before accepting, even when the first candidate matches.
- If the destination has no Git identity, exact-directory fallback is allowed only
  when no candidate has a resolved Git identity. Missing paths and completed nonzero
  Git lookups are neutral evidence, not positive matches. Operational errors follow
  the session-isolation rule above; they are not neutral.
- Conflicting resolved identities produce a diagnostic and exclude the session from
  listing and every selector, including explicit ID/path selection. Sorting and
  duplicate-session-ID handling remain unchanged.
- If no recorded directory supplies usable evidence, report why the session was
  skipped. A removed worktree is recoverable here only when another recorded path
  still identifies the repository. Do not walk up from a missing path and infer
  membership from the nearest existing parent.
- A worktree moved using Git works when a recorded path resolves at its new location.
  Historical paths alone cannot prove the identity of a deleted or moved checkout.
  Registry-based recovery and explicit path remapping are outside this change.

This remains a local, current-filesystem check: existing transcripts cannot prove
historical ownership when an old pathname has been reused by another repository.

## Preview and confirmation

The current code has three destination sources: requests supply `repoRoot`, the
repository reader binds commit-distance checks to the host's creation cwd, and
adapters capture or read process cwd. The confirmation token hashes descriptor,
plan, and preview content without explicitly binding the destination directory.
Evidence: `src/host/wiring.ts`, `src/platform/repo/reader.ts`, the three adapter
factories, `src/import/confirmation.ts`, and `src/import/pipeline.ts`.

Replace `repoRoot` in `ListRequest` and `ImportRequest` with `destinationCwd`; do
not keep two independently supplied destination fields. Derive the internal search
scope from this field. CLI supplies invocation cwd; Pi supplies command-context cwd.
Preserve the host-supplied absolute path, including subdirectories, for native session
storage. Do not replace it with the checkout root or realpath when writing.

Make commit distance take its directory explicitly. Thread the request destination
through preview, landing, and a required adapter serialize context `{ cwd: string }`.
Remove ambient/factory-captured cwd as an import serialization input in all adapters.
Do not put destination data into source provenance.

Bind confirmation to canonical destination cwd and common-directory identity in
addition to existing inputs. Display the canonical destination in the preview so
symlink aliases identify the same location, while writers retain the native path.
A token from worktree A must fail in B even at identical HEAD/branch. Commit already
reruns `compute()`: use that existing recomputation for fresh membership and destination
checks, then pass its destination context to landing. No second recomputation phase
or persistent identity cache is needed. Keep source-content and target-profile checks.

## Implementation Tasks

Run tasks in order, one writer at a time. Within each task reproduce its defect or
missing behavior with a failing test, implement, and finish with green checks.
Keep normative `module.md` contracts and corresponding TypeScript declarations in
sync in the task that changes them. Do not commit a task with failing tests.

### Task 1: Expose canonical Git repository identity

Scope: `src/platform/repo/` and consumers of its contract.

- [x] Extend `RepoIdentity` with a nullable canonical common-directory identity while preserving checkout root, HEAD, and branch semantics. Resolve relative Git output against the actual command directory; do not depend on a commit or branch existing.
- [x] Explicitly delete inherited `GIT_COMMON_DIR` in `gitEnv`, alongside the existing `GIT_DIR`, `GIT_WORK_TREE`, and `GIT_INDEX_FILE` exclusions. Keep array-based execution and timeout/abort controls.
- [x] Specify completed nonzero Git results as unresolved identities; retain thrown operational failures. Handle missing paths without walking up to existing parents. Recognize bare repositories so their linked worktrees work but the bare directory itself cannot be an import destination.
- [x] Add real Git tests for nested, sibling, and external worktrees; source/destination subdirectories; symlinks; spaces; detached/unborn HEAD; separate Git directories; bare-hosted worktrees; nested independent repositories/submodules; same-remote and shared-object clones. Add relative-output and inherited-environment regressions.
- [x] Update repo contracts, stubs, and fixtures. Run `pnpm exec vitest run src/platform/repo`, then the per-task gates below.

### Task 2: Use one explicit destination throughout imports

Depends on Task 1. Scope: host requests, import pipeline/preview/landing, repo
distance checks, all target adapters, and their normative contracts.

Contract sources to check for changed declarations and embedded copies:
`src/module.md`, `src/import/module.md`, `src/host/module.md`,
`src/host/cli/module.md`, `src/host/pi-extension/module.md`,
`src/import/discovery/module.md`, `src/import/preview/module.md`,
`src/import/landing/module.md`, `src/platform/repo/module.md`,
`src/adapters/module.md`, `src/adapters/claude-code/module.md`,
`src/adapters/codex/module.md`, and `src/adapters/pi/module.md`.

- [x] Rename request `repoRoot` to `destinationCwd` in `ListRequest` and `ImportRequest`; update CLI/Pi callers and the affected contract sources listed above. Derive search scope from this one value; do not add a competing destination field.
- [x] Reject a bare-repository destination with an actionable diagnostic before preview/commit can create an import. Continue accepting its linked working trees. Add regression tests for the refusal and successful linked-worktree destination.
- [x] Make commit-distance lookup use the request destination, including when a long-lived host was created in another directory. Remove host-creation cwd as the effective input for this check.
- [x] Add a required serialization context and pass request cwd through pipeline and landing to Claude, Codex, and Pi writers. Preserve native absolute cwd/subdirectory spelling and remove implicit process/factory cwd fallbacks for import writes.
- [x] Display canonical destination cwd in preview and include it plus common-directory identity in the confirmation token. Reuse commit's existing `compute()` and pass its computed context to landing; keep existing source and target-profile freshness checks.
- [x] Add tests with process cwd, host-creation cwd, and request cwd deliberately different. Verify each writer's file location and stored cwd, request-based commit distance, no files after a destination-token mismatch, identical-HEAD worktrees, symlink aliases, and identity changes between preview and confirmation.
- [x] Update affected contracts, fixture adapters, and test helpers together. Run focused host, pipeline, preview, landing, adapter, and repo tests, then the per-task gates below. Cross-directory discovery remains disabled until Task 4.

### Task 3: Preserve active session directory candidates

Depends on Task 2. Scope: `src/session/contract.ts`, `src/session/module.md`,
`src/session/contract-shape.test.ts`, and all source adapters.

- [x] Add the required `repoPaths` array with the ordering and absolute-path rules above; preserve the primary `repoPath`. Update every adapter and fixture adapter to emit the field.
- [x] Collect Claude cwd values only after active-ancestry selection and sidechain exclusion. Use Codex/Pi header cwd as singleton candidates; do not mine tool arguments, text, or encoded project directory names.
- [x] Test root-to-worktree and worktree-to-root sequences, duplicate paths, missing/relative metadata, sidechain-first metadata, discarded ancestry, and sessions recording unrelated repositories. These are extraction tests; repository acceptance belongs to Task 4.
- [x] Update `src/session/contract.ts` and `src/session/module.md` together, add `repoPaths` to the exact `SessionDescriptor` key assertion in `src/session/contract-shape.test.ts`, and update adapter contracts and dependent fixtures. Run focused source-adapter and contract tests, then the per-task gates below.

### Task 4: Match repository membership consistently in discovery

Depends on Tasks 1–3. Scope: `src/import/discovery/`, import wiring, and selection
error presentation where needed.

- [ ] Inject repository lookup and implement the exact matching/conflict rule above in the shared listing path used by list, row, ID, and file-path selection. Require positive common-directory evidence for every new cross-directory match.
- [ ] Cache lookups with a per-listing `Map<directory, Promise>` and retain existing processing concurrency. Catch candidate timeout/spawn/I/O errors at the session boundary and report them through existing diagnostics; preserve other sessions/homes. Propagate cancellation; fail the request on destination operational failure.
- [ ] Explain skipped missing-only or ambiguous sessions. Preserve exact-directory fallback, ordering, source-home filtering, and duplicate-ID handling. Do not use worktree-name, path-prefix, remote, object-store, ancestor, or registry heuristics.
- [ ] Add real-worktree discovery tests for each placement and direction, all selectors, alternate homes, missing-first/surviving-later candidates, neutral unresolved candidates, conflicting identities after a matching candidate, exact fallback with conflicting evidence, all-missing paths, and per-session failure isolation. Assert repeated lookups are shared and a later listing refreshes them.
- [ ] Update discovery contracts. Run `pnpm exec vitest run src/import/discovery`, then the per-task gates below.

### Task 5: Verify complete host and native-session flows

Depends on Task 4. Scope: host/CLI/Pi integration tests and fixture support.

- [ ] Exercise CLI list, preview, and token-confirmed import using disposable Claude source and target profile homes, real transcripts, and main-to-worktree, worktree-to-main, and sibling-worktree paths. Cover nested, sibling, and arbitrary external placement across focused tests rather than a full Cartesian product.
- [ ] Read back native imports to verify destination cwd and target profile placement; assert the source transcript and repository files are unchanged. Include a destination subdirectory and process/host cwd differing from request cwd.
- [ ] Exercise Pi command-context cwd through the common discovery/pipeline path and native writer, with request context differing from process cwd; mock only the UI/runtime switch boundary. Verify Codex writer destination behavior is covered by Task 2 or add it here.
- [ ] Test source/destination identity changes and confirmation in a different worktree at the same HEAD, asserting no import files are written on rejection. Confirm a missing worktree with surviving recorded metadata can reach preview and import.
- [ ] Run `pnpm exec vitest run src/host src/import test/fixtures`, then the per-task gates below. Record any environment-gated live tests that remain skipped; fixture readback is required.

### Task 6: Update packaged instructions and complete validation

Depends on Task 5. Scope: command/prompt instruction sources, user docs, package
checks, and final verification of this change.

- [ ] Update `shims/claude-code/commands/resume-from.md`, `shims/codex/prompts/resume-from.md`, and relevant README/workflow/troubleshooting docs. This checkout has no standalone `SKILL.md`; update these actual packaged instruction sources rather than inventing a new skill entrypoint.
- [ ] Explain alternate-profile imports and all worktree placements. Tell users to start the destination agent in the directory whose files they intend to edit; describe missing-worktree limitations and that imports do not move uncommitted changes or switch branches. Preserve the existing preview/confirmation flow.
- [ ] Ensure preview/selection diagnostics are exposed consistently by CLI and Pi; add or update instruction/package assertions where existing checks cover these outputs.
- [ ] Run all final validation commands below and verify staged Claude/Codex packages contain the changed instruction sources and runtime. Do not publish, merge, install plugins, or modify real profile data.
- [ ] Perform the fixture CLI preview/confirmed-import verification, review the final diff against the acceptance matrix, and record passed checks plus any explicit skips. Mark tasks complete only after their required checks pass.

## Acceptance tests

Use real temporary Git fixtures for identity tests; mocks alone cannot validate
Git path resolution. Initialize fixtures with local identity/configuration and no
network access. Exercise nested, sibling, and external worktree locations.

| Scenario                                                                                | Expected result                                                                                                  |
| --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Main checkout to linked worktree; reverse; sibling worktrees                            | Same repository; all selectors agree                                                                             |
| Invocation or recorded `cwd` in a checkout subdirectory                                 | Same repository                                                                                                  |
| Symlink aliases and directory names containing spaces                                   | Canonical identity matches without shell parsing                                                                 |
| Detached HEAD, unborn repository, separate Git directory, worktree of a bare repository | Identity does not depend on branch, commit, or `.git` layout; bare directory itself is not an import destination |
| Nested independent repository, submodule, same-remote clone, shared-object clone        | Excluded from parent/original repository                                                                         |
| Main-to-worktree and worktree-to-main `cwd` sequences                                   | Same membership regardless of entry counts or order                                                              |
| Missing initial worktree plus surviving recorded main checkout                          | Discoverable from the surviving metadata                                                                         |
| Only missing paths, including a removed worktree nested inside the main checkout        | Excluded with explanation; no parent-directory guess                                                             |
| Active conversation records two unrelated repository identities                         | Excluded with ambiguity explanation                                                                              |
| Sidechain or discarded branch records an unrelated repository                           | Does not change main-conversation membership                                                                     |
| `--home` selects another Claude profile; list, row, ID, file-path selectors             | Same membership, stable ordering, existing duplicate-ID handling                                                 |
| Preview in A, confirm in B at identical HEAD/branch                                     | Rejected before writing                                                                                          |
| Preview/confirm in one destination with a symlink alias                                 | Same canonical destination; import remains in that checkout                                                      |
| Destination or source identity changes between preview and confirmation                 | Fresh preview required; no import written                                                                        |
| Import from another checkout                                                            | Native session metadata/files use destination cwd; source transcript unchanged                                   |
| Per-directory Git failure/timeout or unreadable home                                    | Explicit diagnostic; no silent match or loss of unaffected sessions/homes                                        |
| Cancellation                                                                            | Stop the operation without writing an import                                                                     |
| Many sessions record the same directories                                               | Repository lookups shared within a listing; refreshed next invocation                                            |

## Validation Commands

There is no Makefile. Use these equivalent configured commands from the repository
root after every task, in order. Fix only in-scope failures; report unrelated baseline
failures rather than silently expanding this plan.

```bash
pnpm exec biome format --write .
pnpm test
pnpm lint
pnpm typecheck
pnpm build
git diff --check
```

Final packaging gate, after the commands above:

```bash
pnpm packages:check
```

Review formatting changes and keep unrelated files unchanged. Final manual/E2E
verification uses only disposable fixture profiles and repositories as specified in
Task 5. Do not modify the user's source transcripts or installed plugins.

## Review Record

Claude Code peer review agreed on common-directory identity, explicit destination
plumbing, mixed-cwd candidates with conflict rejection, per-session failure isolation,
and a per-listing cache without a new scheduler. Claude Code read the executable
draft and approved it subject to naming the session contract/key-assertion files
and explicitly enforcing bare-destination refusal. Both corrections are included.
No design disagreements remain. Ralphex has not been started.

Review evidence: a local Git fixture check passed for nested, sibling, external,
and symlinked worktrees; nested independent repositories and shared-object clones
had different common directories. This validates the proposed identity mechanism,
not the application implementation, which has not yet changed.
