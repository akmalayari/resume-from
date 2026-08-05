import type { UserChoice } from "./contract.js";

/**
 * The user-facing channel of the Pi extension.
 *
 * There is deliberately no model-facing method here. FR-47 and FR-48 require the
 * provenance marker to reach the user and never the model context, and FR-46
 * requires the prompt to stay empty after landing. An interface with no way to
 * send anything makes both structural instead of a convention, the same way the
 * command handler being the only call site makes C-10 structural.
 *
 * Pi supplies the implementation. `module.md` names showing and confirming as
 * responsibilities of this module but gives no API for either, so the shape is
 * declared here and injected, not taken from the command context.
 */
export interface PiUi {
  /** Show one block of lines to the user, in the order given. */
  show(lines: readonly string[]): void;
  /** Ask the user to confirm. "selected" means confirmed, "cancelled" means not. */
  confirm(question: string): Promise<UserChoice>;
}
