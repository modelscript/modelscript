import eslint from "@eslint/js";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";

export default defineConfig([
  { ignores: ["**/.react-router/**", "packages/language/src/codegen/runtime/**"] },
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
            "languages/csv/grammar.js",
            "languages/csv/bindings/node/index.d.ts",
            "scripts/generate-ast.ts",
            "scripts/compare-trajectories.ts",
            "scripts/generate-benchmark.ts",
            "scripts/benchmark-incremental.ts",
            "apps/docs/docs/.vitepress/config.ts",
            "apps/docs/docs/.vitepress/theme/index.ts",
            "languages/example/src/language.ts",
            "apps/api/scripts/check_db.ts",
            "apps/api/scripts/seed-social-db.ts",
            "packages/examples/drone-chassis/cad/drone.mcad.ts",
            "packages/compiler/incremental-bench.ts",
            "packages/compiler/bench-50k.ts",
            "packages/compiler/bench_direct.ts",
            "packages/compiler/bench_stages.ts",
            "packages/examples/drone-chassis/evaluate-manufacturing.ts",
            "packages/language/src/codegen/runtime/engine.ts",
            "packages/language/src/codegen/runtime/arena.ts",
            "packages/language/src/codegen/runtime/array.ts",
            "packages/language/src/codegen/runtime/cursor.ts",
          ],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ["scripts/**/*.ts", "packages/compiler/bench*.ts"],
    rules: {
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/consistent-generic-constructors": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": "off",
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
  {
    files: ["packages/language/src/**/*.ts", "packages/compiler/src/**/*.ts"],
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
    },
  },
]);
