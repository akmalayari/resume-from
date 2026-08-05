import type { ImportConfig } from "./contract.js";

/**
 * Share of the target window one import may use (FR-30, Q-1).
 * This is the single home of the number: answering Q-1 is editing this line (T-CFG-8, T-CFG-14).
 */
export const DEFAULT_BUDGET_SHARE = 0.3;

/**
 * Recent turns kept word for word (FR-32, Q-2).
 * Single home of the number, for the same reason as the budget share.
 */
export const DEFAULT_PINNED_RECENT_TURNS = 5;

/**
 * A complete configuration with nothing set by the user.
 * Fresh arrays every call: a caller that mutates its copy must not affect the next load.
 */
export function defaultConfig(): ImportConfig {
  return {
    extraHomes: [],
    budgetShare: DEFAULT_BUDGET_SHARE,
    pinnedRecentTurns: DEFAULT_PINNED_RECENT_TURNS,
    windowOverrides: [],
  };
}
