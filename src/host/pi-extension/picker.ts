import type { Listing, PickResult, SessionDescriptor, SessionPicker } from "./contract.js";
import { safeText } from "./presentation.js";
import type { PiUi } from "./ui.js";

/** The keys the picker understands (FR-9). */
export type PickerKey = "up" | "down" | "enter" | "escape";

/** Where the picker takes its keys from. Resolving with null ends the picker. */
export interface KeySource {
  next(): Promise<PickerKey | null>;
}

export interface KeyPickerDeps {
  keys: KeySource;
  ui: PiUi;
}

const HEADER = "Select a session — up/down to move, Enter to select, Escape to cancel:";

/** One row of the picker: agent, home, time, title and turn count (FR-11). */
export function formatRow(row: SessionDescriptor): string {
  return `${safeText(row.ref.agent)}  ${safeText(row.updatedAt)}  ${safeText(row.title)}  (${row.turnCount} turns)  ${safeText(row.ref.home)}`;
}

function render(listing: Listing, cursor: number): string[] {
  return [
    HEADER,
    ...listing.rows.map((row, index) => `${index === cursor ? ">" : " "} ${formatRow(row)}`),
  ];
}

const CANCELLED: PickResult = { choice: "cancelled", selected: null };

/** A picker driven by keys: arrow keys move, Enter selects, Escape cancels (FR-9). */
export function createKeyPicker(deps: KeyPickerDeps): SessionPicker {
  return {
    async pick(listing) {
      let cursor = 0;
      for (;;) {
        deps.ui.show(render(listing, cursor));
        const key = await deps.keys.next();
        if (key === null || key === "escape") return CANCELLED;
        if (key === "up") cursor = Math.max(0, cursor - 1);
        else if (key === "down") cursor = Math.min(listing.rows.length - 1, cursor + 1);
        else if (key === "enter") {
          const selected = listing.rows[cursor];
          return selected === undefined ? CANCELLED : { choice: "selected", selected };
        }
      }
    },
  };
}
