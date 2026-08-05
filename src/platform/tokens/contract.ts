// GENERATED from src/platform/tokens/module.md — the Public Contract section is the normative home.
// Declarations only: no behaviour, no defaults. If this file and module.md disagree,
// the document wins and this file is corrected.

/** Which counting rule to use. One value per model family the targets use. */
export type EstimatorFamily = "claude" | "gpt" | "generic";

/** Estimates how many tokens a piece of text costs. */
export interface TokenEstimator {
  /** Deterministic: the same text always returns the same count. Never negative. */
  estimate(text: string): number;
}

/** Chooses an estimator. */
export interface EstimatorFactory {
  /** Returns the estimator for a family. Falls back to "generic" for an unknown family. */
  forFamily(family: EstimatorFamily): TokenEstimator;
}
