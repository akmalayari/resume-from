// src/platform/config/ — loads the user's settings and fills every missing one with its
// default. Types are declared in ./contract.js; this file is the module's behaviour.

export type {
  ConfigError,
  ConfigLoader,
  HomeEntry,
  ImportConfig,
  WindowOverride,
} from "./contract.js";
export { DEFAULT_BUDGET_SHARE, DEFAULT_PINNED_RECENT_TURNS, defaultConfig } from "./defaults.js";
export { ConfigLoadError } from "./errors.js";
export { type ConfigLoaderOptions, createConfigLoader } from "./loader.js";
export { defaultConfigPath } from "./paths.js";
