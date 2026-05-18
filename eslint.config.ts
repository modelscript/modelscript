import eslint from "@eslint/js";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";

export default defineConfig([
  { ignores: ["**/.react-router/**"] },
  eslint.configs.recommended,
  tseslint.configs.strict,
  tseslint.configs.stylistic,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: [
            "eslint.config.ts",
            "languages/modelica/grammar.js",
            "languages/modelica/bindings/node/index.d.ts",
            "languages/step/grammar.js",
            "languages/step/bindings/node/index.d.ts",
            "scripts/generate-ast.ts",
            "scripts/compare-trajectories.ts",
            "scripts/generate-benchmark.ts",
            "apps/docs/docs/.vitepress/config.ts",
            "apps/docs/docs/.vitepress/theme/index.ts",
            "languages/example/src/language.ts",
            "packages/language/tests/combinators.test.ts",
            "packages/language/tests/ast.test.ts",
            "packages/language/tests/indexer.test.ts",
            "packages/language/tests/resolver.test.ts",
            "packages/language/tests/semantic-diff.test.ts",
            "packages/language/tests/semantic-node.test.ts",
          ],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ["scripts/**/*.ts"],
    rules: {
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/consistent-generic-constructors": "off",
    },
  },
  {
    files: ["packages/core/tests/debug-*.ts", "packages/core/tests/redeclare_test.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": "off",
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
]);
