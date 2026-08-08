# Platform Services

**Path**: src/platform/ — the module's code is everything in this folder and its transparent subfolders, excluding the submodule folders `config/`, `repo/`, `tokens/`, `store/`
**Parent**: `src/` (root)
**Submodules**: `config/`, `repo/`, `tokens/`, `store/`

## Purpose

This module groups the four generic services the tool needs and holds the one rule that binds them:
**no service in `src/platform/` may know what a session, an agent, or a transfer rule is.** Each
service answers a question in its own vocabulary — bytes, text, paths, commits, settings — and knows
nothing about the product.

Without that rule, generic work would drift into the core. A tokenizer that took a `CanonicalTurn`,
or a file writer that understood session formats, would make replacing either of them a change
against the product's own vocabulary. C-3 makes the stakes concrete for the writer: it is the only
module allowed to create a file, so it must be the module least likely to change.

## Functional Responsibilities

This module implements no behaviour of its own. It carries three things:

- The boundary rule stated above, which every submodule restates in its own Constraints section.
- The record of which submodule owns which generic question, so a reader knows where to look.
- The reason each of the four is isolated behind a contract rather than called directly.

## Subdomain Classification

**Generic.** All four submodules are solved problems with off-the-shelf implementations. Functional
volatility is **low**: the questions they answer do not change. Implementation volatility is
**moderate** for `tokens/` (a better encoder, a new model family) and `store/` (durability and
platform rename semantics), and **low** for `repo/` and `config/`.

Following the guidance on generic subdomains: where the probability of switching an implementation is
real, the integration contract must be strong. That is why each service is an interface with a
narrow, vocabulary-free signature, and why the switching risk was assessed per submodule rather than
for the group.

## Encapsulated Knowledge

- **The boundary rule.** That the product's vocabulary stops at this folder. A submodule that needed
  a session type would no longer belong here.
- **The division of generic questions.** Which of the four owns settings, git, tokens, and file
  creation — and that no two of them overlap.

Everything else is knowledge of a submodule, not of this module. This module holds no algorithm, no
default value, and no format.

## Public Contract

**This module publishes no types of its own.** Each submodule's Public Contract is its own normative
home and is the integration surface for consumers:

| Submodule              | Publishes                                                                               | Used by                                                                 |
| ---------------------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `src/platform/config/` | `ConfigLoader`, `ImportConfig`, `HomeEntry`, `WindowOverride`, `ConfigError`            | `src/host/`, `src/import/discovery/`, `src/import/transfer/`            |
| `src/platform/repo/`   | `RepoReader`, `RepoIdentity`, `CommitDistance`                                          | `src/import/discovery/`, `src/import/preview/`                          |
| `src/platform/tokens/` | `EstimatorFactory`, `TokenEstimator`, `EstimatorFamily`                                 | `src/import/transfer/`                                                  |
| `src/platform/store/`  | `FileCommitter`, `PendingFile`, `Bytes`, `CommitHandle`, `CommitError`, `CommitRefusal` | `src/import/landing/`, and `PendingFile` is restated by `src/adapters/` |

A consumer integrates with the submodule that owns the service it calls, and restates that
submodule's contract in its own document. This module deliberately adds no façade over them: a façade
would restate four contracts without hiding anything, because none of the four holds a secret from
the rest of the tree — only from each other's replacements. The parent exists to group and to
constrain, not to encapsulate.

## Integrations

- **Counterpart**: `src/platform/config/`, `src/platform/repo/`, `src/platform/tokens/`,
  `src/platform/store/`
- **Direction**: this module contains them; it does not call them
- **Strength**: contract
- **LCA / Rank / Distance**: LCA `src/platform/`, rank 1, distance 1 for each
- **Volatility**: low, except `tokens/` and `store/` where implementation volatility is moderate
- **Balanced?**: yes — contract coupling tolerates any distance, and this is the shortest there is
- **Shared knowledge**: only the boundary rule, which each submodule restates in its own Constraints
  and Invariants section. This module holds none of their types.

This module integrates with nothing outside `src/platform/`. The one dependency that crosses the
folder boundary is `src/platform/config/` on `src/session/`, and it is documented there.

## Internal Design

### How the four compose

They do not. The four submodules are independent of each other: none calls another, and none shares
a type with another. They are grouped because they share a property, not a flow.

| Submodule | Question it answers                                | Vocabulary it speaks     |
| --------- | -------------------------------------------------- | ------------------------ |
| `config/` | What did the user set, and what is the default?    | settings, paths, numbers |
| `repo/`   | Where is the repository, and how far has it moved? | paths, commits           |
| `tokens/` | How much does this text cost?                      | text, counts             |
| `store/`  | Can these files be created, all or nothing?        | paths, bytes             |

### Where they are used in the flows

- **Listing** uses `repo/` for the repository root (FR-13) and `config/` for the extra homes (FR-5).
- **Transfer** uses `tokens/` for the budget (FR-29) and `config/` for the share and the pinned-turn
  count (FR-30, FR-32).
- **Preview** uses `repo/` for the commit distance warning (FR-37, FR-38).
- **Landing** uses `store/` for the only write in the system (FR-49, FR-53).

### The one rule, and why it is enforced here

Each submodule restates the boundary rule in its Constraints section, so an implementer working in
one folder sees it without opening this file. This document is where the rule is _decided_; the
restatements are where it is _obeyed_.

The rule has a mechanical test: if a submodule of `src/platform/` ever needs a restatement marker
citing `src/session/`, `src/adapters/` or `src/import/`, the rule has been broken. The single
permitted exception is `src/platform/config/`, which restates `AgentId` and `HomePath` because
settings are keyed by agent. That exception is documented in its own Integrations section and is
balanced at distance 2.

## Change Vectors

Changes that require **only this module** to change:

- A fifth generic service is added, for example a clock or a lock file, and the boundary rule extends
  to it.
- The boundary rule is refined, for example to allow a service to know `AgentId` explicitly rather
  than as a documented exception.
- The division of generic questions is redrawn, for example splitting `store/` into a writer and a
  publication journal.

## Constraints and Invariants

- **No submodule of `src/platform/` may import from `src/session/`, `src/adapters/`, `src/import/` or
  `src/host/`**, with the single documented exception of `src/platform/config/` restating `AgentId`
  and `HomePath`.
- **No submodule may know the product's rules.** A service may not decide what crosses over, what is
  pinned, or what a warning says. It answers a question and returns a fact.
- **Every submodule is replaceable behind its interface.** A consumer receives the interface, never a
  concrete implementation and never a library type.
- **No submodule holds shared mutable state.** Two imports running in the same process must not
  interfere.
- **`src/platform/store/` is the only module in the whole tree that creates a file.** Any other write
  path is a design defect, whichever module contains it (FR-49, FR-53, C-3).

## Test Specification

This module has no behaviour of its own. Its tests check the property that makes it a module: the
boundary rule. They run as static checks over the four submodule folders.

### Unit Tests

**T-PLA-1 — no platform service imports the product's vocabulary**
- Scenario: the imports of every file under `src/platform/repo/`, `src/platform/tokens/` and
  `src/platform/store/` are collected.
- Expected behavior: none imports from `src/session/`, `src/adapters/`, `src/import/` or `src/host/`.

**T-PLA-2 — the config exception is exactly one type pair**
- Scenario: the imports of `src/platform/config/`.
- Expected behavior: the only import from outside `src/platform/` is `AgentId` and `HomePath` from
  `src/session/`. Any other imported symbol fails.

**T-PLA-3 — no restatement marker points at the product**
- Scenario: every restatement marker in the four submodule documents.
- Expected behavior: each cites a module inside `src/platform/`, except the single documented marker
  in `src/platform/config/module.md` citing `src/session/module.md` for `AgentId` and `HomePath`.
  This is the mechanical form of the boundary rule.

**T-PLA-4 — no service signature mentions a session**
- Scenario: the exported signatures of the four submodules.
- Expected behavior: no parameter or return type is a turn, a session, a descriptor, a plan or a
  capability. The vocabulary of each is bytes, text, paths, commits or settings.

### Integration Contract Tests

**T-PLA-5 — the four services are independent**
- Scenario: the import graph among `config/`, `repo/`, `tokens/` and `store/`.
- Expected behavior: no edges. They are grouped by a shared property, not by a flow, and a dependency
  between two of them is a design change that must be documented here first.

**T-PLA-6 — each service is reachable only through its interface**
- Scenario: what each submodule exports.
- Expected behavior: an interface and a factory, never a concrete class and never a library type. A
  consumer that could name a concrete implementation could not swap it.

### Boundary Tests

**T-PLA-7 — `src/platform/store/` is the only writer in the tree**
- Scenario: every call to a file-creating primitive across all of `src/`.
- Expected behavior: every one is inside `src/platform/store/`. A write anywhere else fails the test,
  whichever module contains it (FR-49, FR-53, C-3).

**T-PLA-8 — no service holds shared mutable state**
- Scenario: two imports are run concurrently in one process, using the same service instances.
- Expected behavior: both produce correct results, and neither observes the other's data.

### Behavior Tests

**T-PLA-9 — every service is reachable through its interface alone**
- Scenario: parameterized over the four services. Each is replaced by a stub with different
  behaviour: a fixed token count, a repository reader that reports nothing known, a committer that
  records calls instead of writing, a loader returning non-default settings.
- Expected behavior: each stub satisfies its interface and is accepted wherever the real service is,
  with no file outside `src/platform/` edited to make it work.

_The end-to-end half of this test — that the whole pipeline still runs with each service stubbed —
moved to the root as T-ROO-22. It needs `src/import/` and `src/host/`, which are siblings of this
module in wave 1 and therefore may not exist when this task runs._
