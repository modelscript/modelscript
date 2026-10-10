// SPDX-License-Identifier: AGPL-3.0-or-later

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { computeOptimalAllocation } from "./test-coordinator.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function getDefaultConcurrency() {
  if (process.env.TEST_CONCURRENCY) return process.env.TEST_CONCURRENCY;
  if (process.env.CONCURRENCY) return process.env.CONCURRENCY;
  const alloc = computeOptimalAllocation({ targetCount: 1 });
  return String(alloc.workers);
}

/**
 * Universal ModelScript Test Runner wrapper.
 * Replaces duplicated 350-character npm test scripts across package manifests.
 *
 * Standard flags applied automatically:
 *  - mkdir -p coverage
 *  - --experimental-test-coverage
 *  - standard coverage excludes (dist, node_modules, tests, validation, as-gen, src-gen)
 *  - spec & lcov reporters
 *  - CTRF reporter
 *  - auto-detection of ./tests/test-setup.ts
 *  - auto-detection of tests/**\/*.test.ts or validation/**\/*.test.ts
 *
 * Usage:
 *  - node ../../scripts/test-runner.js
 *  - node ../../scripts/test-runner.js --timeout=120000 --concurrency=1
 *  - node ../../scripts/test-runner.js tests/specific-file.test.ts
 */
export function runTests(argv = process.argv.slice(2)) {
  const cwd = process.cwd();
  const repoRoot = path.resolve(__dirname, "..");
  const ctrfReporter = path.resolve(repoRoot, "scripts", "node-test-ctrf-reporter.cjs");

  // 1. Detect coverage requirements (opt-in locally, default in CI)
  let enableCoverage =
    Boolean(process.env.CI) || process.env.COVERAGE === "true" || process.env.TEST_COVERAGE === "true";

  // 2. Parse custom flags or supply standardized defaults
  const customArgs = [];
  const testFiles = [];
  let timeout = "60000";
  let concurrency = getDefaultConcurrency();
  let hasImport = false;
  let hasTsConfig = false;
  let lcovDest = "coverage/lcov.info";

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--coverage" || arg === "--experimental-test-coverage") {
      enableCoverage = true;
    } else if (arg === "--no-coverage") {
      enableCoverage = false;
    } else if (arg.startsWith("--test-timeout=") || arg.startsWith("--timeout=")) {
      timeout = arg.split("=")[1];
    } else if (arg === "--timeout" || arg === "--test-timeout") {
      timeout = argv[++i];
    } else if (arg.startsWith("--test-concurrency=") || arg.startsWith("--concurrency=")) {
      // If coordinator explicitly assigned TEST_CONCURRENCY, keep coordinator's allocation
      if (!process.env.TEST_CONCURRENCY) {
        concurrency = arg.split("=")[1];
      }
    } else if (arg === "--concurrency" || arg === "--test-concurrency") {
      const val = argv[++i];
      if (!process.env.TEST_CONCURRENCY) {
        concurrency = val;
      }
    } else if (arg.startsWith("--import=")) {
      customArgs.push(arg);
      hasImport = true;
    } else if (arg === "--import") {
      customArgs.push("--import", argv[++i]);
      hasImport = true;
    } else if (arg.startsWith("--tsconfig=")) {
      process.env.TSX_TSCONFIG_PATH = path.resolve(cwd, arg.split("=")[1]);
      hasTsConfig = true;
    } else if (arg === "--tsconfig") {
      process.env.TSX_TSCONFIG_PATH = path.resolve(cwd, argv[++i]);
      hasTsConfig = true;
    } else if (arg.startsWith("--lcov=")) {
      lcovDest = arg.split("=")[1];
    } else if (arg === "--lcov") {
      lcovDest = argv[++i];
    } else if (arg.startsWith("-")) {
      customArgs.push(arg);
    } else {
      testFiles.push(arg);
    }
  }

  if (enableCoverage) {
    fs.mkdirSync(path.join(cwd, "coverage"), { recursive: true });
  }

  process.env.TEST_TIMEOUT = timeout;

  // 3. Transparent AssemblyScript compiler caching across all tests
  const ascCachePath = path.resolve(repoRoot, "scripts", "asc-cache.js");
  if (fs.existsSync(ascCachePath)) {
    customArgs.push("--import", ascCachePath);
  }

  // 4. Auto-detect test setup file and tsconfig if not explicitly passed
  if (!hasImport && fs.existsSync(path.join(cwd, "tests", "test-setup.ts"))) {
    customArgs.push("--import", "./tests/test-setup.ts");
  }
  if (!hasTsConfig && fs.existsSync(path.join(cwd, "tests", "tsconfig.json"))) {
    process.env.TSX_TSCONFIG_PATH = path.join(cwd, "tests", "tsconfig.json");
  } else if (!hasTsConfig && fs.existsSync(path.join(cwd, "validation", "tsconfig.json"))) {
    process.env.TSX_TSCONFIG_PATH = path.join(cwd, "validation", "tsconfig.json");
  }

  // 5. Default test discovery pattern if no files specified
  if (testFiles.length === 0) {
    if (fs.existsSync(path.join(cwd, "tests"))) {
      testFiles.push("tests/**/*.test.ts");
    } else if (fs.existsSync(path.join(cwd, "validation"))) {
      testFiles.push("validation/**/*.test.ts");
    }
  }

  const coverageArgs = enableCoverage
    ? [
        "--experimental-test-coverage",
        "--test-coverage-exclude=**/dist/**",
        "--test-coverage-exclude=**/node_modules/**",
        "--test-coverage-exclude=**/tests/**",
        "--test-coverage-exclude=**/validation/**",
        "--test-coverage-exclude=**/as-gen/**",
        "--test-coverage-exclude=**/src-gen/**",
        "--test-coverage-exclude=**/build/**",
        "--test-reporter=lcov",
        `--test-reporter-destination=${lcovDest}`,
      ]
    : [];

  const tsxPath = path.resolve(repoRoot, "node_modules", ".bin", "tsx");
  const execArgs = [
    "--test",
    `--test-concurrency=${concurrency}`,
    `--test-timeout=${timeout}`,
    "--test-reporter=spec",
    "--test-reporter-destination=stdout",
    `--test-reporter=${ctrfReporter}`,
    "--test-reporter-destination=stdout",
    ...coverageArgs,
    ...customArgs,
    ...testFiles,
  ];

  try {
    execFileSync(tsxPath, execArgs, { stdio: "inherit", cwd });
  } catch (err) {
    process.exit(err.status ?? 1);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  runTests();
}
