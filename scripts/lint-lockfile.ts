// SPDX-License-Identifier: AGPL-3.0-or-later

import * as childProcess from "node:child_process";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");

function getStagedFiles(): string[] {
  try {
    const output = childProcess.execSync("git diff --cached --name-only", { cwd: REPO_ROOT, encoding: "utf-8" }).trim();
    if (!output) return [];
    return output
      .split("\n")
      .map((f) => f.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function checkGitStaging(): void {
  const stagedFiles = getStagedFiles();
  if (stagedFiles.length === 0) return;

  const isAnyPackageJsonStaged = stagedFiles.some((f) => f === "package.json" || f.endsWith("/package.json"));
  const isLockfileStaged = stagedFiles.includes("package-lock.json");

  let rawStatus = "";
  try {
    rawStatus = childProcess.execSync("git status --porcelain package-lock.json", {
      cwd: REPO_ROOT,
      encoding: "utf-8",
    });
  } catch {
    return;
  }

  // Parse git porcelain line (preserve column 0 and column 1)
  const line = rawStatus.split(/\r?\n/)[0] || "";
  if (!line) return;

  const worktreeStatus = line[1] || " ";
  const isUntracked = line.startsWith("??");

  const worktreeModified = worktreeStatus === "M" || isUntracked;

  if (isAnyPackageJsonStaged && worktreeModified) {
    console.error("\n❌ Staging error: package.json is staged for commit, but package-lock.json has unstaged changes.");
    console.error("   Run 'git add package-lock.json' before committing.\n");
    process.exit(1);
  }

  if (isLockfileStaged && worktreeStatus === "M") {
    console.error("\n❌ Staging error: package-lock.json is only partially staged.");
    console.error("   Run 'git add package-lock.json' to stage all lockfile changes before committing.\n");
    process.exit(1);
  }
}

function checkLockfileSync(): void {
  const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
  const res = childProcess.spawnSync(npmCmd, ["ci", "--dry-run", "--ignore-scripts"], {
    cwd: REPO_ROOT,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (res.status !== 0) {
    console.error("\n❌ Lockfile out of sync: package.json and package-lock.json do not match.");
    console.error("   Run 'npm install' to synchronize package-lock.json, then stage it.\n");
    const output = (res.stderr || res.stdout || "").trim();
    const errorLines = output
      .split("\n")
      .filter((line) => line.includes("npm error") || line.includes("Missing:"))
      .slice(0, 10);
    if (errorLines.length > 0) {
      console.error(errorLines.join("\n"));
    } else if (output) {
      console.error(output.slice(0, 500));
    }
    process.exit(1);
  }
}

function run(): void {
  checkGitStaging();
  checkLockfileSync();
  console.log("✓ package-lock.json is in sync with package.json.");
}

if (process.argv[1] === __filename) {
  run();
}
