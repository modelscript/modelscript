// SPDX-License-Identifier: AGPL-3.0-or-later

import eslint from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import { defineConfig } from "eslint/config";
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
      "**/.react-router/**",
      "**/.vitepress/cache/**",
      "**/.vitepress/dist/**",
      "**/dist/**",
      "**/build/**",
      "**/coverage/**",
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
      "**/scratch*/**",
      "packages/simulate/src/wasm/**",
      "languages/**/src-gen/**",
      "**/src-gen/**",
      "languages/**/bindings/**",
      "**/grammar.js",
    ],
  },
  {
    plugins: {
      "modelscript-headers": licenseHeaderPlugin,
      "react-hooks": reactHooks,
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
      parserOptions: {
        projectService: {
          maximumDefaultProjectFileMatchCount_THIS_WILL_SLOW_DOWN_LINTING: 500,
          allowDefaultProject: [
            "eslint.config.ts",
            "scripts/*.ts",
            "languages/modelica/tests/*.ts",
            "scripts/compare-trajectories.ts",
            "scripts/generate-benchmark.ts",
            "scripts/generate-drone-step.ts",
            "scripts/fetch-reference-fmus.ts",
            "packages/exchange/validation/fmi/scripts/compare-csv.ts",
            "packages/exchange/validation/fmi/scripts/fetch-fmusim.ts",
            "packages/exchange/validation/fmi/scripts/fmusim-verify.ts",
            "packages/exchange/validation/fmi/scripts/omc-verify.ts",
            "packages/exchange/validation/fmi/scripts/validate.ts",
            "apps/api/scripts/*.ts",
            "apps/ide/scripts/*.ts",
            "languages/sysml2/scripts/*.ts",
            "packages/lsp/scripts/*.ts",
            "packages/examples/drone-chassis/cad/drone.mcad.ts",
            "packages/examples/drone-chassis/evaluate-manufacturing.ts",
            "packages/dsl/src/codegen/runtime/engine.ts",
            "packages/dsl/src/codegen/runtime/array.ts",
            "packages/dsl/src/codegen/runtime/cursor.ts",
            "packages/dsl/src/codegen/runtime/fmi2_wasm.ts",
            "packages/dsl/src/codegen/runtime/fmi3_wasm.ts",
            "apps/cli/tests/*.ts",
            "packages/exchange/validation/*.ts",
            "apps/cli/jest.config.ts",
            "languages/ssp/tests/*.ts",
            "languages/step/tests/*.ts",
            "languages/sysml2/tests/*.ts",
            "languages/cfd/tests/*.ts",
            "languages/fea/tests/*.ts",
            "languages/csv/tests/*.ts",
            "packages/mcp/tests/*.ts",
            "apps/api/tests/*.ts",
          ],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ["eslint.config.ts", "scripts/**/*.ts", "packages/exchange/validation/**/*.ts", "apps/cli/tests/**/*.ts"],
    rules: {
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/consistent-generic-constructors": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/prefer-for-of": "off",
      "no-useless-escape": "off",
      "no-useless-assignment": "off",
      "preserve-caught-error": "off",
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
  {
    files: ["languages/**/tests/**/*.ts", "packages/**/tests/**/*.ts", "apps/**/tests/**/*.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/no-empty-function": "off",
      "@typescript-eslint/no-empty-object-type": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
      "no-empty": "off",
      "prefer-const": "off",
    },
  },
  {
    files: ["apps/morsel/**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/no-empty-function": "off",
      "@typescript-eslint/class-literal-property-style": "off",
      "@typescript-eslint/no-dynamic-delete": "off",
      "no-useless-assignment": "off",
      "prefer-const": "off",
    },
  },
  {
    files: [
      "packages/*/src/**/*.{ts,tsx}",
      "languages/**/src/**/*.{ts,tsx}",
      "languages/**/transformers/**/*.ts",
      "apps/*/src/**/*.{ts,tsx}",
    ],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-unused-vars": "off",
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
]);
