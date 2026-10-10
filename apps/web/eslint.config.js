// SPDX-License-Identifier: AGPL-3.0-or-later

import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import { defineConfig, globalIgnores } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig([
  globalIgnores(["dist"]),
  {
    files: ["src/**/*.{ts,tsx}", "*.{ts,tsx,js}"],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        projectService: {
          allowDefaultProject: ["eslint.config.js"],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "react-hooks/set-state-in-effect": "off",
      "react-refresh/only-export-components": "warn",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^[_$]",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      "no-empty": "off",
      "no-useless-assignment": "off",
      "prefer-const": "off",
    },
    linterOptions: {
      reportUnusedDisableDirectives: "off",
    },
  },
  {
    files: ["src/components/morsel/**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "no-useless-assignment": "off",
      "react-hooks/refs": "off",
      "react-hooks/exhaustive-deps": "off",
      "react-hooks/immutability": "off",
    },
  },
]);
