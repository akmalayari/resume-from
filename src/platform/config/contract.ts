// GENERATED from src/platform/config/module.md — the Public Contract section is the normative home.
// Declarations only: no behaviour, no defaults. If this file and module.md disagree,
// the document wins and this file is corrected.

import type { AgentId, HomePath } from "../../session/contract.js";

export type { AgentId, HomePath };

/** One extra home the user added to the search list (FR-5). */
export interface HomeEntry {
  agent: AgentId;
  home: HomePath;
}

/** A context window the user set for one agent, overriding the adapter default (FR-18). */
export interface WindowOverride {
  agent: AgentId;
  windowTokens: number;
}

/** User configuration. Every field has a default (FR-5, FR-30, FR-32). */
export interface ImportConfig {
  /** Homes searched in addition to every adapter's default home. Default empty (FR-5). */
  extraHomes: HomeEntry[];
  /** Share of the target window one import may use. Default 0.30 (FR-30, Q-1). */
  budgetShare: number;
  /** Recent turns kept word for word. Default 5 (FR-32, Q-2). */
  pinnedRecentTurns: number;
  /** Context windows the user set explicitly. Default empty. */
  windowOverrides: WindowOverride[];
}

/** Why a configuration was rejected (FR-56). */
export interface ConfigError {
  /** The setting at fault, for example "budgetShare". */
  field: string;
  /** What is wrong, and what the user can do next. */
  message: string;
}

/** Loads configuration and fills every missing field with its default. */
export interface ConfigLoader {
  /** Rejects for invalid values or unreadable paths. A genuinely missing file is not an error. */
  load(): Promise<ImportConfig>;
}
