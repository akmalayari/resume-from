import type { SelectionError } from "./contract.js";

/**
 * What `resolve` rejects with. It is an `Error` so a stack survives, and a `SelectionError`
 * so the host can print what the user gave and what to do next (FR-56).
 */
export class SessionSelectionError extends Error implements SelectionError {
  readonly input: string;

  constructor(input: string, message: string) {
    super(message);
    this.name = "SessionSelectionError";
    this.input = input;
  }
}
