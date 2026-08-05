import { defineConfig } from "vitest/config";

export default defineConfig({
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
