# Token Estimation

**Path**: src/platform/tokens/ — the module's code is everything in this folder and its transparent subfolders
**Parent**: `src/platform/`
**Submodules**: none (leaf)

## Purpose

This module answers one question: how many tokens does this text cost in the target's model family.
The budget rules of requirement section E depend on that number, and the preview shows it to the user
(FR-18).

Without it, `src/import/transfer/` would embed a tokenizer, and swapping the tokenizer — a realistic
change, because each target family counts differently — would mean editing the core rules.

## Functional Responsibilities

- Estimate the token cost of a piece of text for a named model family.
- Choose an estimator for a target agent's family, with a family that always works as the fallback.
- Be deterministic: the same text and the same family always give the same number.

## Subdomain Classification

**Generic.** Tokenization is a solved problem with off-the-shelf implementations. Functional
volatility is **low**: the question never changes. Implementation volatility is **moderate** — a
better tokenizer, a new model family, or a switch from an approximation to an exact encoder are all
realistic, and each target agent counts differently.

That moderate implementation volatility is exactly why the estimator is a contract and not a
function call into a library from inside the rules.

## Encapsulated Knowledge

- **How a family is counted.** Whether an exact encoder, a byte-per-token ratio, or a word heuristic
  is used, and which library provides it.
- **The accuracy claim.** That an estimate may be wrong, in which direction it errs, and by how much.
  The rules treat the number as authoritative; only this module knows it is an estimate.
- **The family mapping.** Which model family a given target agent belongs to.

Nothing here knows what a turn is, what a session is, or what a budget is. The input is a string.

## Public Contract

```ts
/** Which counting rule to use. One value per model family the targets use. */
type EstimatorFamily = "claude" | "gpt" | "generic";
```

```ts
/** Estimates how many tokens a piece of text costs. */
interface TokenEstimator {
  /** Deterministic: the same text always returns the same count. Never negative. */
  estimate(text: string): number;
}
```

```ts
/** Chooses an estimator. */
interface EstimatorFactory {
  /** Returns the estimator for a family. Falls back to "generic" for an unknown family. */
  forFamily(family: EstimatorFamily): TokenEstimator;
}
```

## Integrations

**None.** This module depends on no other module. `src/import/transfer/` calls it; it calls nobody.

Keeping it ignorant of the session model is what makes it replaceable. If it took a `CanonicalTurn`
instead of a string, swapping the tokenizer would become a change against the core vocabulary.

## Change Vectors

Changes that require **only this module** to change:

- The estimator for a family is replaced with a more accurate one.
- A new model family is added.
- The estimator becomes asynchronous because the encoder loads lazily. (This would change the
  contract's return type and is therefore the one change that is not free — it is listed here as the
  known cost.)
- The fallback behaviour for an unknown family changes.

## Constraints and Invariants

- **`estimate` is pure and synchronous.** The rules call it many times per import and must stay
  reproducible: the preview and the commit of the same request must produce the same numbers.
- **`estimate` never throws.** Any text, including empty text and invalid UTF-8 sequences, returns a
  number. A GPT tokenizer failure falls back to the conservative UTF-8 byte count.
- **The count is monotone in length.** Appending text never lowers the estimate. The budget rules of
  FR-31 drop turns until the total fits and would not terminate otherwise.
- **The estimate is a whole number and is never negative.** Empty text returns 0.
- **No input or output.** No file access, no network, no clock.
- **The estimator is allowed to be wrong.** FR-29 gives the import a share of the window, not the
  whole of it, so the design already tolerates a margin of error. No caller may treat the number as
  exact.
- **The margin is stated, and it is what T-TOK-7 asserts.** Measured against a reference count
  produced by an exact encoder over the whole text:
  - `gpt` — never below the reference, and at most **10%** above it. The counter is a monotone
    envelope of the encoder, so it errs high and never low.
  - `claude` and `generic` — within **25%** for predominantly ASCII text, which is what a coding
    session carries: English prose, code, tool outcome lines, JSON. Within a **factor of two** for
    emoji-dense or non-Latin text. There is no public JavaScript tokenizer for the Claude family,
    so both families count with the same character-ratio heuristic.
  - Estimating a text in pieces and estimating the whole of it at once differ by at most **one
    token per piece** (T-TOK-12). That is what lets a caller add up the cost of the parts instead
    of re-estimating the whole on every drop.
  - Past the first **256 kB** of a single string the exact counter gives way to one token per UTF-8
    byte. The `gpt` margin is a claim about text below that size; longer input is deliberately
    over-counted so a budget cannot admit text the model window may reject.

## Test Specification

### Unit Tests

**T-TOK-1 — empty text costs nothing**
- Scenario: `estimate("")`, parameterized over every `EstimatorFamily`.
- Expected behavior: 0.

**T-TOK-2 — the estimate is a non-negative whole number**
- Scenario: a table of texts — a word, a paragraph, a code block, a line of emoji, 100 kB of prose —
  across every family.
- Expected behavior: every result is an integer and at least 0.

**T-TOK-3 — the estimate is deterministic**
- Scenario: the same text estimated 100 times, and across two separately built estimators.
- Expected behavior: every result is identical.

**T-TOK-4 — the estimate is monotone in length**
- Scenario: a text, and the same text with more appended, in 20 steps.
- Expected behavior: each estimate is greater than or equal to the previous one. This is what makes
  the drop loop of `src/import/transfer/` terminate.

**T-TOK-5 — the factory returns a working estimator for every family**
- Scenario: `forFamily` for each value of `EstimatorFamily`.
- Expected behavior: each returns an estimator that satisfies T-TOK-1 to T-TOK-4.

**T-TOK-6 — an unknown family falls back**
- Scenario: `forFamily` called with a value outside the enum, as an untyped caller would.
- Expected behavior: it returns the generic estimator rather than throwing.

### Integration Contract Tests

**T-TOK-7 — the estimate is within a stated margin of a reference count**
- Scenario: a fixture corpus with reference token counts per family.
- Expected behavior: each estimate is within the margin the module documents. The test asserts the
  documented margin, not exactness — FR-29 budgets a share of the window precisely so a margin is
  affordable.

**T-TOK-8 — the interface hides the implementation**
- Scenario: a static check of what this module exports.
- Expected behavior: only `TokenEstimator`, `EstimatorFactory` and `EstimatorFamily` are exported. No
  tokenizer library type escapes, so the library can be replaced without touching a consumer.

### Boundary Tests

**T-TOK-9 — invalid input never throws**
- Scenario: a lone surrogate, invalid UTF-8, a 10 MB string, a string of null bytes.
- Expected behavior: each returns a number. No exception reaches the caller.

**T-TOK-10 — a tokenizer failure falls back to a conservative count**
- Scenario: the underlying encoder is stubbed to throw.
- Expected behavior: `estimate` returns the UTF-8 byte count and does not propagate the failure.

**T-TOK-11 — the module knows nothing about sessions**
- Scenario: a static check of this module's imports and signatures.
- Expected behavior: no import from `src/session/`, `src/adapters/`, `src/import/` or `src/host/`,
  and no signature mentioning a turn or a session. This is the `src/platform/` boundary rule.

### Behavior Tests

**T-TOK-12 — a budget computed from these estimates is usable**
- Scenario: the reference session fixture is estimated turn by turn and the totals are summed.
- Expected behavior: the total is within the documented margin of estimating the whole rendered
  session at once, so the rules can add turn costs instead of re-estimating the whole plan on every
  drop.

_T-TOK-13 was moved to `src/import/` as T-IMP-26. It runs the transfer rules with two different
estimators, and the rules compose above this module — a module cannot own a test of a collaborator
that does not exist when it is implemented. The switching-risk claim of the generic classification is
still tested; it is tested where both halves exist._
