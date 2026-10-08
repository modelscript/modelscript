// SPDX-License-Identifier: AGPL-3.0-or-later

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

  // 1. Ensure coverage output directory exists
  fs.mkdirSync(path.join(cwd, "coverage"), { recursive: true });

  // 2. Parse custom flags or supply standardized defaults
  const customArgs = [];
  const testFiles = [];
  let timeout = "60000";
  let concurrency = "2";
  let hasImport = false;
  let hasTsConfig = false;
  let lcovDest = "coverage/lcov.info";

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--test-timeout=") || arg.startsWith("--timeout=")) {
      timeout = arg.split("=")[1];
    } else if (arg === "--timeout" || arg === "--test-timeout") {
      timeout = argv[++i];
    } else if (arg.startsWith("--test-concurrency=") || arg.startsWith("--concurrency=")) {
      concurrency = arg.split("=")[1];
    } else if (arg === "--concurrency" || arg === "--test-concurrency") {
      concurrency = argv[++i];
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

  // 3. Auto-detect test setup file and tsconfig if not explicitly passed
  if (!hasImport && fs.existsSync(path.join(cwd, "tests", "test-setup.ts"))) {
    customArgs.push("--import", "./tests/test-setup.ts");
  }
  if (!hasTsConfig && fs.existsSync(path.join(cwd, "tests", "tsconfig.json"))) {
    process.env.TSX_TSCONFIG_PATH = path.join(cwd, "tests", "tsconfig.json");
  } else if (!hasTsConfig && fs.existsSync(path.join(cwd, "validation", "tsconfig.json"))) {
    process.env.TSX_TSCONFIG_PATH = path.join(cwd, "validation", "tsconfig.json");
  }

  // 4. Default test discovery pattern if no files specified
  if (testFiles.length === 0) {
    if (fs.existsSync(path.join(cwd, "tests"))) {
      testFiles.push("tests/**/*.test.ts");
    } else if (fs.existsSync(path.join(cwd, "validation"))) {
      testFiles.push("validation/**/*.test.ts");
    }
  }

  const tsxPath = path.resolve(repoRoot, "node_modules", ".bin", "tsx");
  const execArgs = [
    "--test",
    "--experimental-test-coverage",
    "--test-coverage-exclude=**/dist/**",
    "--test-coverage-exclude=**/node_modules/**",
    "--test-coverage-exclude=**/tests/**",
    "--test-coverage-exclude=**/validation/**",
    "--test-coverage-exclude=**/as-gen/**",
    "--test-coverage-exclude=**/src-gen/**",
    "--test-coverage-exclude=**/build/**",
    `--test-concurrency=${concurrency}`,
    `--test-timeout=${timeout}`,
    "--test-reporter=spec",
    "--test-reporter-destination=stdout",
    "--test-reporter=lcov",
    `--test-reporter-destination=${lcovDest}`,
    `--test-reporter=${ctrfReporter}`,
    "--test-reporter-destination=stdout",
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
