/**
 * The Pi adapter's only export (FR-57). Everything Pi-specific stays inside this folder:
 * the file layout, the `usage` requirement of C-11, and Pi's command context.
 */

import { createPiAdapter } from "./adapter.js";
import type { AgentAdapter, PiAdapterFactory } from "./contract.js";

export type {
  PiAdapterFactory,
  PiSwitchContext,
  PiSwitchOptions,
  PiSwitchResult,
} from "./contract.js";

export const piAdapterFactory: PiAdapterFactory = {
  create(): AgentAdapter {
    return createPiAdapter();
  },
};
