// SPDX-License-Identifier: AGPL-3.0-or-later

import * as childProcess from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");

const SKIP_DIRS = new Set([".git", "node_modules", ".nx", ".cache", "vscode-web", "vendor", ".gemini"]);

function getTrackedPaths(): { files: Set<string>; dirs: Set<string> } {
  const files = new Set<string>();
  const dirs = new Set<string>();
  try {
    const out = childProcess.execSync("git ls-files", { cwd: REPO_ROOT, encoding: "utf-8" });
    for (const raw of out.split(/\r?\n/)) {
      const normalized = raw.trim().replace(/\\/g, "/");
      if (!normalized) continue;
      files.add(normalized);
      let dir = path.posix.dirname(normalized);
      while (dir && dir !== ".") {
        dirs.add(dir);
        dir = path.posix.dirname(dir);
      }
    }
  } catch {
    // Fallback if git is unavailable
  }
  return { files, dirs };
}

function isScratchTarget(name: string): boolean {
  return /^scratch($|[_.-])/i.test(name) || name === "blink.log" || name === "asc_error.log";
}

export function findScratchTargets(rootDir: string = REPO_ROOT): string[] {
  const { files: trackedFiles, dirs: trackedDirs } = getTrackedPaths();
  const targets: string[] = [];

  function walk(currentDir: string, depth: number): void {
    if (depth > 6) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (SKIP_DIRS.has(entry.name)) continue;
      const fullPath = path.join(currentDir, entry.name);
      const relPath = path.relative(rootDir, fullPath).replace(/\\/g, "/");

      if (isScratchTarget(entry.name)) {
        if (entry.isDirectory()) {
          if (!trackedDirs.has(relPath)) {
            targets.push(relPath);
          }
        } else if (!trackedFiles.has(relPath)) {
          targets.push(relPath);
        }
        continue;
      }

      if (entry.isDirectory()) {
        walk(fullPath, depth + 1);
      }
    }
  }

  walk(rootDir, 0);
  return targets.sort();
}

export function cleanScratch(options: { dryRun?: boolean; rootDir?: string } = {}): {
  removed: string[];
  dryRun: boolean;
} {
  const rootDir = options.rootDir ?? REPO_ROOT;
  const dryRun = options.dryRun ?? false;
  const targets = findScratchTargets(rootDir);

  if (!dryRun) {
    for (const rel of targets) {
      const fullPath = path.join(rootDir, rel);
      fs.rmSync(fullPath, { recursive: true, force: true });
    }
  }

  return { removed: targets, dryRun };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  const dryRun = process.argv.includes("--dry-run");
  const { removed } = cleanScratch({ dryRun });

  if (removed.length === 0) {
    console.log("✓ Workspace is clean (no untracked scratch files or ephemeral logs found).");
  } else if (dryRun) {
    console.log(`[dry-run] Would remove ${removed.length} untracked scratch path(s):`);
    for (const item of removed) {
      console.log(`  - ${item}`);
    }
  } else {
    console.log(`✓ Removed ${removed.length} untracked scratch path(s):`);
    for (const item of removed) {
      console.log(`  - ${item}`);
    }
  }
}
