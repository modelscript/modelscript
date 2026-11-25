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
          missingEeHeader:
            "Enterprise Edition file under ee/ must begin with '// SPDX-License-Identifier: LicenseRef-ModelScript-Enterprise'.",
        },
      },
      create(context: {
        filename?: string;
        getFilename?(): string;
        sourceCode: { getText(): string };
        report(descriptor: { loc: { line: number; column: number }; messageId: string }): void;
      }) {
        return {
          Program() {
            const rawFilename =
              (typeof context.filename === "string" && context.filename) ||
              (typeof context.getFilename === "function" ? context.getFilename() : "");
            const normFilename = rawFilename.replace(/\\/g, "/");
            const rootDir = import.meta.dirname.replace(/\\/g, "/");
            const relPath = normFilename.startsWith(rootDir + "/")
              ? normFilename.slice(rootDir.length + 1)
              : normFilename;
            const isEnterpriseFile = relPath === "ee" || relPath.startsWith("ee/");
            const expectedHeader = isEnterpriseFile
              ? "SPDX-License-Identifier: LicenseRef-ModelScript-Enterprise"
              : "SPDX-License-Identifier: AGPL-3.0-or-later";

            const text = context.sourceCode.getText();
            const lines = text.split(/\r?\n/);
            const firstLine = lines[0] ?? "";
            const hasShebang = firstLine.startsWith("#!");
            const targetLine = hasShebang ? (lines[1] ?? "") : firstLine;
            if (!targetLine.includes(expectedHeader)) {
              context.report({
                loc: { line: hasShebang ? 2 : 1, column: 0 },
                messageId: isEnterpriseFile ? "missingEeHeader" : "missingHeader",
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
      "**/.vitepress/.temp/**",
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
      "languages/*/assets/**",
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
  // Enforce no-explicit-any across all 197 production src/ workspaces and scripts
  // (zero legacy allowlist remaining; tracked by config/type-safety-baseline.json).
  {
    files: [
      "eslint.config.ts",
      "scripts/**/*.{ts,js,cjs,mjs}",
      "ee/src/**/*.{ts,tsx}",
      "apps/*/src/**/*.{ts,tsx}",
      "apps/ide/github-fs/src/**/*.{ts,tsx}",
      "packages/*/src/**/*.{ts,tsx}",
      "languages/*/src/**/*.{ts,tsx}",
    ],
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
    },
  },
  {
    files: [
      "ee/src/**/*.{ts,tsx}",
      "apps/ide/src/**/*.{ts,tsx}",
      "apps/ide/github-fs/src/**/*.{ts,tsx}",
      "apps/desktop/src/**/*.{ts,tsx}",
      "apps/docs/src/**/*.{ts,tsx}",
      "packages/embed/src/**/*.{ts,tsx}",
      "packages/mcp/src/**/*.{ts,tsx}",
      "packages/react/src/**/*.{ts,tsx}",
      "languages/adams/src/**/*.ts",
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
    files: [
      "ee/src/**/*.{ts,tsx}",
      "apps/api/src/**/*.{ts,tsx}",
      "apps/desktop/src/**/*.{ts,tsx}",
      "packages/cad/src/**/*.{ts,tsx}",
      "packages/canvas/src/**/*.{ts,tsx}",
      "packages/dsl/src/**/*.{ts,tsx}",
      "packages/embed/src/**/*.{ts,tsx}",
      "packages/exchange/src/**/*.{ts,tsx}",
      "packages/ide/src/**/*.{ts,tsx}",
      "packages/lsp/src/**/*.{ts,tsx}",
      "packages/react/src/**/*.{ts,tsx}",
      "packages/runtime/src/**/*.{ts,tsx}",
      "packages/simulate/src/**/*.{ts,tsx}",
    ],
    rules: {
      "no-empty": "error",
    },
  },
  {
    files: ["packages/**/*.{ts,tsx}", "languages/**/*.{ts,tsx}", "apps/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@modelscript/ee", "@modelscript/ee/*", "**/ee/**"],
              message: "AGPL-3.0 core packages, languages, and apps must never import from Enterprise Edition (ee/).",
            },
          ],
        },
      ],
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
    files: [
      "apps/web/src/**/*Context.tsx",
      "apps/web/src/components/ClassTree.tsx",
      "apps/web/src/components/MaintenanceExperienceHost.tsx",
      "apps/web/src/components/ProductTourOverlay.tsx",
      "apps/web/src/components/ScrollToTop.tsx",
      "apps/web/src/components/artifacts/AutoThumbnailCapture.tsx",
      "apps/web/src/components/artifacts/ModelicaDiagramViewer.tsx",
      "apps/web/src/components/artifacts/card/ViewerDispatcher.tsx",
      "apps/web/src/pages/RepositoryListPage.tsx",
      "apps/web/src/pages/SettingsPage.tsx",
      "apps/web/src/pages/legal/LegalLayout.tsx",
      "apps/web/src/pages/settings/tabs/PrivacyTab.tsx",
    ],
    rules: {
      "react-refresh/only-export-components": "off",
    },
  },
  {
    // Design-token guard: the GitHub-dark palette hexes below do not follow the
    // light/dark theme. Use the shared `--ms-*` tokens (packages/design-tokens).
    files: ["apps/web/src/**/*.{ts,tsx}"],
    ignores: [
      "apps/web/src/components/artifacts/{VegaViewer,MermaidViewer,SimulationPlotViewer,CadDiffViewer,DigitalTwinDashboardViewer,ModelicaDiagramViewer}.tsx",
      "apps/web/src/components/terminal/AnsiRenderer.tsx",
      "apps/web/src/components/artifacts/{MultibodyViewport3D,AudioViewer}.tsx",
      "apps/web/src/pages/libraries/constants.ts",
      "apps/web/src/pages/package/hooks/usePackageData.ts",
    ],
    rules: {
      "no-restricted-syntax": [
        "warn",
        {
          selector:
            "Literal[value=/#(30363d|8b949e|0d1117|010409|161b22|21262d|e6edf3|f0f6fc|c9d1d9|3fb950|f85149)/i]:not([value=/var\\(--[a-z-]+, ?#/])",
          message:
            "Use a theme token (e.g. var(--ms-border), var(--ms-text-3)) instead of a hard-coded dark-theme colour.",
        },
        {
          selector:
            "TemplateElement[value.raw=/#(30363d|8b949e|0d1117|010409|161b22|21262d|e6edf3|f0f6fc|c9d1d9|3fb950|f85149)/i]:not([value.raw=/var\\(--[a-z-]+, ?#/])",
          message:
            "Use a theme token (e.g. var(--ms-border), var(--ms-text-3)) instead of a hard-coded dark-theme colour.",
        },
      ],
    },
  },
  {
    files: ["packages/editor/src/workbench/**/*.{ts,tsx}", "packages/editor/src/internal/**/*.{ts,tsx}"],
    rules: {
      "react-hooks/refs": "off",
      "react-hooks/exhaustive-deps": "off",
      "react-hooks/immutability": "off",
    },
  },
  {
    files: [
      "eslint.config.ts",
      "scripts/**/*.{ts,js,cjs,mjs}",
      "ee/**/scripts/**/*.{ts,js,cjs,mjs}",
      "apps/**/scripts/**/*.{ts,js,cjs,mjs}",
      "packages/**/scripts/**/*.{ts,js,cjs,mjs}",
      "languages/**/scripts/**/*.{ts,js,cjs,mjs}",
      "packages/**/build*.{js,cjs,mjs}",
      "languages/**/build*.{js,cjs,mjs}",
      "packages/exchange/validation/**/*.{ts,js,cjs,mjs}",
      "ee/**/tests/**/*.{ts,js,cjs,mjs}",
      "apps/**/tests/**/*.{ts,js,cjs,mjs}",
      "packages/**/tests/**/*.{ts,js,cjs,mjs}",
      "languages/**/tests/**/*.{ts,js,cjs,mjs}",
      "packages/examples/**/*.{ts,js,cjs,mjs}",
      "packages/editor/src/workbench/**/*.{ts,tsx}",
      "packages/editor/src/internal/**/*.{ts,tsx}",
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
      "ee/**/scripts/**/*.{ts,js,cjs,mjs}",
      "apps/**/scripts/**/*.{ts,js,cjs,mjs}",
      "packages/**/scripts/**/*.{ts,js,cjs,mjs}",
      "languages/**/scripts/**/*.{ts,js,cjs,mjs}",
      "packages/**/build*.{js,cjs,mjs}",
      "languages/**/build*.{js,cjs,mjs}",
      "packages/exchange/validation/**/*.{ts,js,cjs,mjs}",
      "ee/**/tests/**/*.{ts,js,cjs,mjs}",
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
  // Phase 5 UI DSL Guardrails: keep language.ts & index.ts pure (no React/VS Code/UI imports)
  {
    files: ["languages/*/src/language.ts", "languages/*/src/index.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            { name: "react", message: "Core language modules must stay React-free; place UI code in src/ui/." },
            { name: "react-dom", message: "Core language modules must stay DOM-free; place UI code in src/ui/." },
            { name: "vscode", message: "Core language modules must stay host-agnostic; do not import vscode." },
            { name: "@primer/react", message: "Core language modules must not import host UI libraries." },
            { name: "styled-components", message: "Core language modules must not import CSS-in-JS runtimes." },
          ],
          patterns: [
            {
              group: ["./ui/*", "./ui/**"],
              message:
                "Do not re-export or import src/ui/* from language.ts or index.ts; expose panels via package.json#exports['./ui'].",
            },
          ],
        },
      ],
    },
  },
  // Phase 5 UI DSL Guardrails: keep languages/*/src/ui/** host-agnostic
  {
    files: ["languages/*/src/ui/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@primer/react",
              message: "Language UI panels must use @modelscript/react/panel and --ms-* tokens, not @primer/react.",
            },
            {
              name: "styled-components",
              message: "Language UI panels must use CSS variables (--ms-*), not styled-components.",
            },
            {
              name: "react-router-dom",
              message:
                "Language UI panels must be host-agnostic; use LanguagePanelHost callbacks instead of react-router-dom.",
            },
          ],
          patterns: [
            {
              group: ["**/apps/web/**", "**/packages/ide/**"],
              message: "Language UI panels must not depend on apps/web or packages/ide host internals.",
            },
          ],
        },
      ],
    },
  },
  // @modelscript/lsp/core isolation guardrail: never statically import @modelscript/<lang> packages
  {
    files: ["packages/lsp/src/core/**/*.ts", "packages/lsp/src/registry/LanguageRegistry.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "@modelscript/*",
                "!@modelscript/dsl",
                "!@modelscript/dsl/*",
                "!@modelscript/runtime",
                "!@modelscript/runtime/*",
              ],
              message:
                "@modelscript/lsp/core must remain language-agnostic; load language plugins dynamically instead.",
            },
          ],
        },
      ],
    },
  },
]);
