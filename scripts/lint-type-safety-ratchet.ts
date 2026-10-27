// SPDX-License-Identifier: AGPL-3.0-or-later

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");
const BASELINE_PATH = path.join(REPO_ROOT, "config", "type-safety-baseline.json");

export interface PackageTypeSafetyStats {
  explicitAny: number;
  tsComments: number;
}

export interface TypeSafetyBaseline {
  description: string;
  packages: Record<string, PackageTypeSafetyStats>;
}

const IGNORED_PATH_SEGMENTS = [
  "/src-gen/",
  "/as-gen/",
  "/vendor/",
  "/vscode-web/",
  "/node_modules/",
  "/dist/",
  "/build/",
  "/.cache/",
  "packages/dsl/src/codegen/runtime/",
  "packages/dsl/src/bindings/javascript/bindings.ts",
  "packages/runtime/src/wasm/",
  "packages/simulate/src/wasm/",
];

function shouldIgnoreFile(relPath: string): boolean {
  const norm = relPath.replace(/\\/g, "/");
  for (const seg of IGNORED_PATH_SEGMENTS) {
    if (norm.includes(seg)) return true;
  }
  return false;
}

function getWorkspaceDirs(): string[] {
  const rootPkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf-8"));
  const workspaces: string[] = rootPkg.workspaces || [];
  const dirs: string[] = [];

  for (const pattern of workspaces) {
    if (pattern.endsWith("/*")) {
      const parentRel = pattern.slice(0, -2);
      const parentDir = path.join(REPO_ROOT, parentRel);
      if (!fs.existsSync(parentDir)) continue;
      for (const entry of fs.readdirSync(parentDir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          const candidate = path.join(parentDir, entry.name, "package.json");
          if (fs.existsSync(candidate)) {
            dirs.push(`${parentRel}/${entry.name}`);
          }
        }
      }
    } else {
      const candidate = path.join(REPO_ROOT, pattern, "package.json");
      if (fs.existsSync(candidate)) {
        dirs.push(pattern.replace(/\\/g, "/"));
      }
    }
  }

  return dirs.sort();
}

function collectSourceFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const results: string[] = [];

  function walk(current: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.name.startsWith("scratch")) continue;
      const fullPath = path.join(current, entry.name);
      const relPath = path.relative(REPO_ROOT, fullPath).replace(/\\/g, "/");
      if (shouldIgnoreFile(relPath)) continue;

      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (
        entry.isFile() &&
        (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) &&
        !entry.name.endsWith(".d.ts")
      ) {
        results.push(fullPath);
      }
    }
  }

  walk(dir);
  return results;
}

const EXPLICIT_ANY_REGEX = /(?:[:=]\s*any\b|\bas\s+any\b|<\s*any\s*>|\bany\s*\[\]|,\s*any\s*>)/g;
const TS_COMMENT_REGEX = /@ts-(?:ignore|expect-error|nocheck)\b/g;

export function analyzeFileContent(content: string): PackageTypeSafetyStats {
  let explicitAny = 0;
  let tsComments = 0;

  const lines = content.split(/\r?\n/);
  let inBlockComment = false;

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();

    // Count @ts-ignore / @ts-expect-error / @ts-nocheck in comments
    const tsMatches = trimmed.match(TS_COMMENT_REGEX);
    if (tsMatches) {
      tsComments += tsMatches.length;
    }

    if (inBlockComment) {
      if (trimmed.includes("*/")) {
        inBlockComment = false;
      }
      continue;
    }

    if (trimmed.startsWith("/*")) {
      if (!trimmed.includes("*/")) {
        inBlockComment = true;
      }
      continue;
    }

    if (trimmed.startsWith("//")) {
      continue;
    }

    // Strip inline block comments and trailing single-line comments before matching type positions
    const codePart = rawLine.replace(/\/\*.*?\*\//g, "").replace(/\/\/.*$/, "");
    const anyMatches = codePart.match(EXPLICIT_ANY_REGEX);
    if (anyMatches) {
      explicitAny += anyMatches.length;
    }
  }

  return { explicitAny, tsComments };
}

export function computeMonorepoTypeSafety(): Record<string, PackageTypeSafetyStats> {
  const workspaceDirs = getWorkspaceDirs();
  const result: Record<string, PackageTypeSafetyStats> = {};

  for (const relWorkspace of workspaceDirs) {
    const srcDir = path.join(REPO_ROOT, relWorkspace, "src");
    const files = collectSourceFiles(srcDir);
    let explicitAny = 0;
    let tsComments = 0;

    for (const file of files) {
      const content = fs.readFileSync(file, "utf-8");
      const stats = analyzeFileContent(content);
      explicitAny += stats.explicitAny;
      tsComments += stats.tsComments;
    }

    result[relWorkspace] = { explicitAny, tsComments };
  }

  return result;
}

function run(): void {
  const updateMode = process.argv.includes("--update");
  const current = computeMonorepoTypeSafety();

  if (updateMode || !fs.existsSync(BASELINE_PATH)) {
    fs.mkdirSync(path.dirname(BASELINE_PATH), { recursive: true });
    const payload: TypeSafetyBaseline = {
      description:
        "Per-package type-safety ratchet ceilings for explicit 'any' and '@ts-expect-error'/'@ts-ignore' in src/. Counts may decrease but must never increase.",
      packages: current,
    };
    fs.writeFileSync(BASELINE_PATH, JSON.stringify(payload, null, 2) + "\n", "utf-8");
    console.log(
      `✓ Updated type-safety ratchet baseline at config/type-safety-baseline.json (${Object.keys(current).length} workspaces).`,
    );
    return;
  }

  const baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, "utf-8")) as TypeSafetyBaseline;
  const regressions: string[] = [];
  const improvements: string[] = [];

  for (const [pkg, stats] of Object.entries(current)) {
    const base = baseline.packages[pkg];
    if (!base) {
      if (stats.explicitAny > 0 || stats.tsComments > 0) {
        regressions.push(
          `${pkg}: new workspace not in baseline has explicitAny=${stats.explicitAny}, tsComments=${stats.tsComments} (expected 0).`,
        );
      }
      continue;
    }

    if (stats.explicitAny > base.explicitAny) {
      regressions.push(`${pkg}: explicit 'any' count increased from ${base.explicitAny} to ${stats.explicitAny}.`);
    } else if (stats.explicitAny < base.explicitAny) {
      improvements.push(`${pkg}: explicit 'any' count improved (${base.explicitAny} -> ${stats.explicitAny}).`);
    }

    if (stats.tsComments > base.tsComments) {
      regressions.push(
        `${pkg}: @ts-expect-error/@ts-ignore count increased from ${base.tsComments} to ${stats.tsComments}.`,
      );
    } else if (stats.tsComments < base.tsComments) {
      improvements.push(
        `${pkg}: @ts-expect-error/@ts-ignore count improved (${base.tsComments} -> ${stats.tsComments}).`,
      );
    }
  }

  if (regressions.length > 0) {
    console.error(`\n❌ Found ${regressions.length} type-safety ratchet regression(s):\n`);
    for (const r of regressions) {
      console.error(`  - ${r}`);
    }
    console.error(`\nPlease replace 'any' with concrete types or 'unknown' to stay within the baseline ceiling.\n`);
    process.exit(1);
  }

  const zeroAnyCount = Object.values(current).filter((s) => s.explicitAny === 0).length;
  console.log(
    `✓ All ${Object.keys(current).length} workspaces passed type-safety ratchet verification (${zeroAnyCount} workspaces at 0 explicit 'any').`,
  );
  if (improvements.length > 0) {
    console.log(
      `  💡 ${improvements.length} workspace(s) improved below baseline ceiling. Run 'npx tsx scripts/lint-type-safety-ratchet.ts --update' to lock in lower ceilings.`,
    );
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  run();
}
