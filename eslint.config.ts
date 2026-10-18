// SPDX-License-Identifier: AGPL-3.0-or-later

import eslint from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import { defineConfig } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";

const licenseHeaderPlugin = {
  meta: {
    name: "modelscript-headers",
  },
  rules: {
    "header-presence": {
      meta: {
        type: "layout" as const,
        docs: {
          description: "Enforce standard SPDX License Identifier header",
        },
        schema: [],
        messages: {
          missingHeader: "File must begin with '// SPDX-License-Identifier: AGPL-3.0-or-later'.",
        },
      },
      create(context: {
        sourceCode: { getText(): string };
        report(descriptor: { loc: { line: number; column: number }; messageId: string }): void;
      }) {
        return {
          Program() {
            const text = context.sourceCode.getText();
            const lines = text.split(/\r?\n/);
            const firstLine = lines[0] ?? "";
            const hasShebang = firstLine.startsWith("#!");
            const targetLine = hasShebang ? (lines[1] ?? "") : firstLine;
            if (!targetLine.includes("SPDX-License-Identifier: AGPL-3.0-or-later")) {
              context.report({
                loc: { line: hasShebang ? 2 : 1, column: 0 },
                messageId: "missingHeader",
              });
            }
          },
        };
      },
    },
  },
};

export default defineConfig([
  {
    ignores: [
      "**/.cache/**",
      "**/.vitepress/cache/**",
      "**/.vitepress/dist/**",
      "**/dist/**",
      "**/build/**",
      "**/coverage/**",
      "**/ctrf/**",
      "**/data/**",
      "**/vendor/**",
      "**/as-pect.config.js",
      "packages/dsl/bin/**",
      "packages/dsl/scripts/**",
      "packages/simulate/scripts/**",
      "packages/runtime/assembly/**",
      "**/assembly/**",
      "packages/runtime/src/wasm/**",
      "packages/runtime/build/**",
      "packages/dsl/src/codegen/runtime/**",
      "packages/runtime/tests/wasm/**",
      "packages/exchange/validation/fmi/exported_fmus/**",
      "packages/exchange/validation/fmi/reference_fmus/**",
      "packages/exchange/validation/fmi/reference_fmus_repo/**",
      "**/scratch*",
      "**/scratch*/**",
      "packages/simulate/src/wasm/**",
      "languages/**/src-gen/**",
      "**/src-gen/**",
      "**/as-gen/**",
      "languages/**/bindings/**",
      "**/grammar.js",
      "apps/ide/vscode-web/**",
      "apps/ide/models/**",
      "apps/web/public/**",
    ],
  },
  {
    plugins: {
      "modelscript-headers": licenseHeaderPlugin as any,
      "react-hooks": reactHooks as any,
      "react-refresh": reactRefresh as any,
    },
    rules: {
      "modelscript-headers/header-presence": "error",
    },
  },
  eslint.configs.recommended,
  tseslint.configs.strict,
  tseslint.configs.stylistic,
  {
    languageOptions: {
      globals: {
        ...globals.node,
      },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/await-thenable": "error",
      "@typescript-eslint/no-for-in-array": "error",
      "@typescript-eslint/no-implied-eval": "error",
      "@typescript-eslint/only-throw-error": "error",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^[_$]",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      "prefer-const": "off",
      "@typescript-eslint/no-empty-function": "off",
      "no-empty": "off",
      "@typescript-eslint/no-inferrable-types": "off",
      "no-useless-assignment": "off",
      "@typescript-eslint/ban-ts-comment": "off",
      "@typescript-eslint/no-extraneous-class": "off",
      "@typescript-eslint/consistent-generic-constructors": "off",
      "@typescript-eslint/prefer-for-of": "off",
    },
    linterOptions: {
      reportUnusedDisableDirectives: "off",
    },
  },
  {
    files: ["apps/web/**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    rules: {
      ...reactHooks.configs.flat.recommended.rules,
      "react-hooks/set-state-in-effect": "off",
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
    },
  },
  {
    files: ["apps/web/src/**/*Context.tsx"],
    rules: {
      "react-refresh/only-export-components": "off",
    },
  },
  {
    files: ["apps/web/src/components/morsel/**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "no-useless-assignment": "off",
      "react-hooks/refs": "off",
      "react-hooks/exhaustive-deps": "off",
      "react-hooks/immutability": "off",
    },
  },
  {
    files: [
      "eslint.config.ts",
      "scripts/**/*.{ts,js,cjs,mjs}",
      "apps/**/scripts/**/*.{ts,js,cjs,mjs}",
      "packages/**/scripts/**/*.{ts,js,cjs,mjs}",
      "languages/**/scripts/**/*.{ts,js,cjs,mjs}",
      "packages/exchange/validation/**/*.{ts,js,cjs,mjs}",
      "apps/**/tests/**/*.{ts,js,cjs,mjs}",
      "packages/**/tests/**/*.{ts,js,cjs,mjs}",
      "languages/**/tests/**/*.{ts,js,cjs,mjs}",
      "packages/examples/**/*.{ts,js,cjs,mjs}",
    ],
    languageOptions: {
      parserOptions: {
        projectService: false,
      },
    },
    rules: {
      "@typescript-eslint/await-thenable": "off",
      "@typescript-eslint/no-for-in-array": "off",
      "@typescript-eslint/only-throw-error": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/consistent-generic-constructors": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/no-empty-function": "off",
      "@typescript-eslint/no-empty-object-type": "off",
      "@typescript-eslint/no-implied-eval": "off",
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/prefer-for-of": "off",
      "no-useless-escape": "off",
      "no-useless-assignment": "off",
      "preserve-caught-error": "off",
      "require-yield": "off",
      "prefer-const": "off",
      "no-empty": "off",
    },
  },
  {
    files: ["apps/cli/src/commands/**/*.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-empty-object-type": "off",
      "@typescript-eslint/no-empty-function": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "prefer-const": "off",
      "no-empty": "off",
    },
  },
]);
