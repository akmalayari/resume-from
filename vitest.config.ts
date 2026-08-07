import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

const root = import.meta.dirname;

export default defineConfig({
  resolve: {
    alias: [
      {
        find: "resume-from/pi-extension",
        replacement: resolve(root, "src/host/pi-extension/index.ts"),
      },
      { find: "resume-from", replacement: resolve(root, "src/index.ts") },
    ],
  },
  test: {
    // Tests live beside the code they test, inside their module's folder.
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    // Live tests need an installed agent and a throwaway home. They are opt-in:
    // RESUME_FROM_LIVE=1 pnpm vitest run src/adapters/pi
    exclude: ["**/node_modules/**", "**/dist/**"],
    environment: "node",
    // A module's tests are run scoped: pnpm vitest run src/<module-path>
    passWithNoTests: false,
  },
});
