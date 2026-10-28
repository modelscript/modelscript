// SPDX-License-Identifier: AGPL-3.0-or-later

import * as childProcess from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const REPO_ROOT = path.resolve(__dirname, "../..");

export const EXCLUDED_REPO_PATTERNS: readonly RegExp[] = [
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

export function shouldExcludeRepoPath(relPath: string): boolean {
  const norm = relPath.replace(/\\/g, "/");
  for (const pattern of EXCLUDED_REPO_PATTERNS) {
    if (pattern.test(norm)) return true;
  }
  return false;
}

export interface WorkspaceDiscoveryOptions {
  excludeExamples?: boolean;
  excludeIdeGithubFs?: boolean;
  rootDir?: string;
}

/**
 * Discovers all workspace `package.json` absolute paths declared in root `package.json#workspaces`.
 */
export function getWorkspacePackages(options: WorkspaceDiscoveryOptions = {}): string[] {
  const rootDir = options.rootDir ?? REPO_ROOT;
  const rootPkgPath = path.join(rootDir, "package.json");
  const rootPkg = JSON.parse(fs.readFileSync(rootPkgPath, "utf-8")) as { workspaces?: string[] };
  const workspaces: string[] = rootPkg.workspaces || [];
  const packagePaths: string[] = [];

  for (const pattern of workspaces) {
    if (options.excludeExamples && pattern.startsWith("packages/examples")) {
      continue;
    }
    if (options.excludeIdeGithubFs && pattern === "apps/ide/github-fs") {
      continue;
    }

    if (pattern.endsWith("/*")) {
      const parentDir = path.join(rootDir, pattern.slice(0, -2));
      if (!fs.existsSync(parentDir)) continue;
      const entries = fs.readdirSync(parentDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const candidate = path.join(parentDir, entry.name, "package.json");
          if (fs.existsSync(candidate)) {
            packagePaths.push(candidate);
          }
        }
      }
    } else {
      const candidate = path.join(rootDir, pattern, "package.json");
      if (fs.existsSync(candidate)) {
        packagePaths.push(candidate);
      }
    }
  }

  return packagePaths.sort();
}

/**
 * Discovers all workspace relative directory paths (POSIX-normalized, e.g. `packages/runtime`).
 */
export function getWorkspaceDirs(options: WorkspaceDiscoveryOptions = {}): string[] {
  const rootDir = options.rootDir ?? REPO_ROOT;
  return getWorkspacePackages(options)
    .map((pkgPath) => path.relative(rootDir, path.dirname(pkgPath)).replace(/\\/g, "/"))
    .sort();
}

let cachedTrackedFiles: string[] | null = null;

/**
 * Returns git tracked files relative to `REPO_ROOT`, cached per process.
 */
export function getTrackedFiles(forceRefresh = false): string[] {
  if (!cachedTrackedFiles || forceRefresh) {
    cachedTrackedFiles = childProcess
      .execSync("git ls-files", { cwd: REPO_ROOT, encoding: "utf-8" })
      .split(/\r?\n/)
      .filter(Boolean);
  }
  return cachedTrackedFiles;
}
