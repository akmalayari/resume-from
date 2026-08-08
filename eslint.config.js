import js from "@eslint/js";
import globals from "globals";

export default [
  {
    ignores: [
      "**/*.ts",
      "build/",
      "coverage/",
      "dist/",
      "node_modules/",
      "*.tgz",
    ],
  },
  js.configs.recommended,
  {
    files: ["**/*.js", "**/*.mjs"],
    languageOptions: {
      ecmaVersion: "latest",
      globals: globals.node,
      sourceType: "module",
    },
  },
];
