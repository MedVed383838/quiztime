import js from "@eslint/js";
import globals from "globals";

export default [
  { ignores: ["dist/**", ".vite/**", "node_modules/**"] },
  js.configs.recommended,
  {
    files: ["**/*.js", "**/*.jsx"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser, ...globals.es2021 },
    },
    rules: { "no-unused-vars": "off" },
  },
];
