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
      "packages/dsl/src/bindings/javascript/bindings.ts",
      "packages/runtime/tests/wasm/**",
      "packages/exchange/validation/fmi/exported_fmus/**",
      "packages/exchange/validation/fmi/reference_fmus/**",
      "packages/exchange/validation/fmi/reference_fmus_repo/**",
      "packages/exchange/src/fmu/pe-emulator/wasm-engine/*.cjs",
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
      "modelscript-headers": licenseHeaderPlugin as unknown as Record<string, unknown>,
      "react-hooks": reactHooks as unknown as Record<string, unknown>,
      "react-refresh": reactRefresh as unknown as Record<string, unknown>,
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
      "@typescript-eslint/ban-ts-comment": [
        "error",
        {
          "ts-expect-error": "allow-with-description",
          "ts-ignore": true,
          "ts-nocheck": true,
          minimumDescriptionLength: 10,
        },
      ],
      "@typescript-eslint/no-extraneous-class": "off",
      "@typescript-eslint/no-empty-object-type": "off",
      "@typescript-eslint/array-type": "off",
      "@typescript-eslint/consistent-type-definitions": "off",
      "@typescript-eslint/consistent-generic-constructors": "off",
      "@typescript-eslint/prefer-for-of": "off",
      "@typescript-eslint/prefer-function-type": "off",
    },
    linterOptions: {
      reportUnusedDisableDirectives: "error",
    },
  },
  {
    files: [
      "eslint.config.ts",
      "scripts/**/*.{ts,js,cjs,mjs}",
      "apps/api/src/**/*.{ts,tsx}",
      "apps/cli/src/**/*.{ts,tsx}",
      "apps/ide/src/**/*.{ts,tsx}",
      "apps/ide/github-fs/src/**/*.{ts,tsx}",
      "apps/desktop/src/**/*.{ts,tsx}",
      "apps/docs/src/**/*.{ts,tsx}",
      "packages/cad/src/**/*.{ts,tsx}",
      "packages/diagram/src/**/*.{ts,tsx}",
      "packages/embed/src/**/*.{ts,tsx}",
      "packages/exchange/src/**/*.{ts,tsx}",
      "packages/ide/src/**/*.{ts,tsx}",
      "packages/mcp/src/**/*.{ts,tsx}",
      "packages/react/src/**/*.{ts,tsx}",
      "packages/simulate/src/**/*.{ts,tsx}",
      "languages/adams/src/**/*.ts",
      "languages/aspen/src/**/*.ts",
      "languages/autosar/src/**/*.ts",
      "languages/c/src/**/*.ts",
      "languages/ccsds/src/**/*.ts",
      "languages/cfd/src/**/*.ts",
      "languages/csv/src/**/*.ts",
      "languages/easy5/src/**/*.ts",
      "languages/eclipse/src/**/*.ts",
      "languages/energyplus/src/**/*.ts",
      "languages/epanet/src/**/*.ts",
      "languages/fea/src/**/*.ts",
      "languages/fortran/src/**/*.ts",
      "languages/gensys/src/**/*.ts",
      "languages/gtsuite/src/**/*.ts",
      "languages/ibis/src/**/*.ts",
      "languages/jsbsim/src/**/*.ts",
      "languages/lps/src/**/*.ts",
      "languages/modelscript/src/**/*.ts",
      "languages/olga/src/**/*.ts",
      "languages/opendrive/src/**/*.ts",
      "languages/opendss/src/**/*.ts",
      "languages/openscenario/src/**/*.ts",
      "languages/owl2/src/**/*.ts",
      "languages/plcopen/src/**/*.ts",
      "languages/pscad/src/**/*.ts",
      "languages/psse/src/**/*.ts",
      "languages/relap5/src/**/*.ts",
      "languages/reqif/src/**/*.ts",
      "languages/rocets/src/**/*.ts",
      "languages/sbml/src/**/*.ts",
      "languages/scad/src/**/*.ts",
      "languages/sima/src/**/*.ts",
      "languages/simpack/src/**/*.ts",
      "languages/simulink/src/**/*.ts",
      "languages/spice/src/**/*.ts",
      "languages/ssp/src/**/*.ts",
      "languages/step/src/**/*.ts",
      "languages/swmm/src/**/*.ts",
      "languages/sysml2/src/**/*.ts",
      "languages/touchstone/src/**/*.ts",
      "languages/urdf/src/**/*.ts",
      "languages/verilog-a/src/**/*.ts",
    ],
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
    },
  },
  {
    files: [
      "apps/ide/src/**/*.{ts,tsx}",
      "apps/ide/github-fs/src/**/*.{ts,tsx}",
      "apps/desktop/src/**/*.{ts,tsx}",
      "apps/docs/src/**/*.{ts,tsx}",
      "packages/embed/src/**/*.{ts,tsx}",
      "packages/mcp/src/**/*.{ts,tsx}",
      "packages/react/src/**/*.{ts,tsx}",
      "languages/adams/src/**/*.ts",
      "languages/autosar/src/**/*.ts",
      "languages/csv/src/**/*.ts",
      "languages/eclipse/src/**/*.ts",
      "languages/energyplus/src/**/*.ts",
      "languages/lps/src/**/*.ts",
      "languages/opendrive/src/**/*.ts",
      "languages/opendss/src/**/*.ts",
      "languages/openscenario/src/**/*.ts",
      "languages/plcopen/src/**/*.ts",
      "languages/relap5/src/**/*.ts",
      "languages/reqif/src/**/*.ts",
      "languages/rocets/src/**/*.ts",
      "languages/sbml/src/**/*.ts",
      "languages/spice/src/**/*.ts",
      "languages/verilog-a/src/**/*.ts",
    ],
    rules: {
      "@typescript-eslint/no-non-null-assertion": "error",
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
      "packages/**/build*.{js,cjs,mjs}",
      "languages/**/build*.{js,cjs,mjs}",
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
    files: [
      "apps/**/scripts/**/*.{ts,js,cjs,mjs}",
      "packages/**/scripts/**/*.{ts,js,cjs,mjs}",
      "languages/**/scripts/**/*.{ts,js,cjs,mjs}",
      "packages/**/build*.{js,cjs,mjs}",
      "languages/**/build*.{js,cjs,mjs}",
      "packages/exchange/validation/**/*.{ts,js,cjs,mjs}",
      "apps/**/tests/**/*.{ts,js,cjs,mjs}",
      "packages/**/tests/**/*.{ts,js,cjs,mjs}",
      "languages/**/tests/**/*.{ts,js,cjs,mjs}",
      "packages/examples/**/*.{ts,js,cjs,mjs}",
    ],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
]);
