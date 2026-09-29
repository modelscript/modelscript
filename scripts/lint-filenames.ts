// SPDX-License-Identifier: AGPL-3.0-or-later

import * as childProcess from "node:child_process";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");

const EXCLUDED_PATTERNS = [
  /^languages\/modelica\/testsuite\//,
  /\/src-gen\//,
  /\/as-gen\//,
  /\/dist\//,
  /\/build\//,
  /\/node_modules\//,
  /\/vendor\//,
  /\.d\.ts$/,
  /\/scratch/,
  /^\.agents\//,
  /^\.gemini\//,
  /\.react-router\//,
];

// Known backward-compatibility shims
const ALLOWED_SHIMS = new Set([
  "packages/ide/src/browserClientMain.ts",
  "packages/lsp/src/LspContext.ts",
  "packages/lsp/src/services/DiagramService.ts",
  "packages/lsp/src/services/DocumentManager.ts",
  "packages/lsp/src/services/HierarchyService.ts",
  "packages/lsp/src/services/ParserService.ts",
  "packages/lsp/src/services/ReasonerService.ts",
  "packages/lsp/src/services/ValidationService.ts",
  "packages/lsp/src/services/WorkspaceManager.ts",
  "packages/lsp/src/services/WritebackService.ts",
  "packages/lsp/src/utils/arenaUtils.ts",
  "packages/lsp/src/utils/astUtils.ts",
  "packages/lsp/src/utils/hierarchyUtils.ts",
  "packages/lsp/src/utils/lspUtils.ts",
]);

interface Violation {
  file: string;
  rule: string;
  message: string;
}

function shouldExclude(relPath: string): boolean {
  for (const pattern of EXCLUDED_PATTERNS) {
    if (pattern.test(relPath)) return true;
  }
  return false;
}

function isPascalCase(str: string): boolean {
  return /^[A-Z][a-zA-Z0-9]*$/.test(str);
}

function isKebabCase(str: string): boolean {
  return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(str);
}

function isSnakeCase(str: string): boolean {
  return /^[a-z0-9]+(_[a-z0-9]+)*$/.test(str);
}

export function checkFile(relPath: string): Violation[] {
  if (shouldExclude(relPath)) return [];
  if (ALLOWED_SHIMS.has(relPath)) return [];

  const violations: Violation[] = [];
  const basename = path.basename(relPath);
  const ext = path.extname(relPath);
  const nameWithoutExt = path.basename(relPath, ext);

  // 1. Double prefix test anti-pattern: test-*.test.ts
  if (basename.endsWith(".test.ts") || basename.endsWith(".test.tsx") || basename.endsWith(".test.js")) {
    if (basename.startsWith("test-")) {
      violations.push({
        file: relPath,
        rule: "no-redundant-test-prefix",
        message: `Redundant 'test-' prefix in '${basename}'. Use '${basename.replace(/^test-/, "")}' instead.`,
      });
    }
  }

  // 2. React UI Components must be PascalCase.tsx
  const isWebComponent = relPath.startsWith("apps/web/src/components/") && ext === ".tsx";
  const isMorselComponent = relPath.startsWith("apps/morsel/app/components/") && ext === ".tsx";
  if (isWebComponent || isMorselComponent) {
    if (!isPascalCase(nameWithoutExt)) {
      violations.push({
        file: relPath,
        rule: "pascal-case-components",
        message: `React component '${basename}' must be PascalCase.tsx.`,
      });
    }
  }

  // 3. Normalization of packages/ide/src
  if (relPath.startsWith("packages/ide/src/") && (ext === ".ts" || ext === ".tsx" || ext === ".css")) {
    // Exclude sub-sub components like step-viewer if any
    const pureName = ext === ".css" ? nameWithoutExt : nameWithoutExt.replace(/\.test$/, "");
    if (!isKebabCase(pureName) && !isPascalCase(pureName)) {
      violations.push({
        file: relPath,
        rule: "kebab-case-ide-files",
        message: `IDE file '${basename}' should be kebab-case.`,
      });
    }
  }

  // 4. Normalization of packages/lsp/src/services and utils
  const isLspService = relPath.startsWith("packages/lsp/src/services/") && ext === ".ts";
  const isLspUtil = relPath.startsWith("packages/lsp/src/utils/") && ext === ".ts";
  if ((isLspService || isLspUtil) && !basename.endsWith(".test.ts")) {
    if (!isKebabCase(nameWithoutExt)) {
      violations.push({
        file: relPath,
        rule: "kebab-case-lsp-services-utils",
        message: `LSP service/util '${basename}' must be kebab-case.ts.`,
      });
    }
  }

  return violations;
}

export function run(fileList?: string[]): { checked: number; violations: Violation[] } {
  let files = fileList;
  if (!files || files.length === 0) {
    files = childProcess.execSync("git ls-files", { cwd: REPO_ROOT, encoding: "utf-8" }).split(/\r?\n/).filter(Boolean);
  }

  const allViolations: Violation[] = [];
  let checked = 0;

  for (const file of files) {
    const rel = path.isAbsolute(file) ? path.relative(REPO_ROOT, file) : file;
    checked++;
    const v = checkFile(rel);
    if (v.length > 0) {
      allViolations.push(...v);
    }
  }

  return { checked, violations: allViolations };
}

// CLI Execution
const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const { checked, violations } = run(args.length > 0 ? args : undefined);

if (violations.length > 0) {
  console.error(`\n❌ Found ${violations.length} filename violation(s) across ${checked} checked file(s):\n`);
  for (const v of violations) {
    console.error(`  - [${v.rule}] ${v.file}: ${v.message}`);
  }
  process.exit(1);
} else {
  console.log(`✓ All ${checked} checked filename(s) conform to repository naming standards.`);
  process.exit(0);
}
