import type { ConfigError } from "./contract.js";

/**
 * What `ConfigLoader.load` rejects with (FR-56). An `Error` as well as a `ConfigError`,
 * so a rejection that reaches a host still carries a stack.
 */
export class ConfigLoadError extends Error implements ConfigError {
  readonly field: string;

  constructor(field: string, message: string) {
    super(message);
    this.name = "ConfigLoadError";
    this.field = field;
  }
}
