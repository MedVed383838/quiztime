import js from "@eslint/js";
import globals from "globals";

export default [
  { ignores: ["generated/**", "uploads/**", "prisma/migrations/**"] },
  js.configs.recommended,
  {
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: { ...globals.node, ...globals.vitest },
    },
    rules: {
      "no-console": "off",
      "no-unused-vars": ["error", { "argsIgnorePattern": "^_" }],
    },
  },
];
