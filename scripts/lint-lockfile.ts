// SPDX-License-Identifier: AGPL-3.0-or-later

import * as childProcess from "node:child_process";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { REPO_ROOT } from "./lib/workspaces.js";

const __filename = fileURLToPath(import.meta.url);

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

export function checkGitStaging(): string[] {
  const errors: string[] = [];
  const stagedFiles = getStagedFiles();
  if (stagedFiles.length === 0) return errors;

  const isAnyPackageJsonStaged = stagedFiles.some((f) => f === "package.json" || f.endsWith("/package.json"));
  const isLockfileStaged = stagedFiles.includes("package-lock.json");

  let rawStatus = "";
  try {
    rawStatus = childProcess.execSync("git status --porcelain package-lock.json", {
      cwd: REPO_ROOT,
      encoding: "utf-8",
    });
  } catch {
    return errors;
  }

  // Parse git porcelain line (preserve column 0 and column 1)
  const line = rawStatus.split(/\r?\n/)[0] || "";
  if (!line) return errors;

  const worktreeStatus = line[1] || " ";
  const isUntracked = line.startsWith("??");

  const worktreeModified = worktreeStatus === "M" || isUntracked;

  if (isAnyPackageJsonStaged && worktreeModified) {
    errors.push(
      "Staging error: package.json is staged for commit, but package-lock.json has unstaged changes. Run 'git add package-lock.json' before committing.",
    );
  }

  if (isLockfileStaged && worktreeStatus === "M") {
    errors.push(
      "Staging error: package-lock.json is only partially staged. Run 'git add package-lock.json' to stage all lockfile changes before committing.",
    );
  }

  return errors;
}

export function checkLockfileSync(): string[] {
  const errors: string[] = [];
  const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
  const res = childProcess.spawnSync(npmCmd, ["ci", "--dry-run", "--ignore-scripts"], {
    cwd: REPO_ROOT,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (res.status !== 0) {
    const output = (res.stderr || res.stdout || "").trim();
    const errorLines = output
      .split("\n")
      .filter((line) => line.includes("npm error") || line.includes("Missing:"))
      .slice(0, 10);
    const detail = errorLines.length > 0 ? errorLines.join("\n") : output.slice(0, 500);
    errors.push(
      `Lockfile out of sync: package.json and package-lock.json do not match. Run 'npm install' to synchronize package-lock.json.\n${detail}`,
    );
  }

  return errors;
}

export function checkLockfile(): string[] {
  return [...checkGitStaging(), ...checkLockfileSync()];
}

export function checkLockfileSyncAsync(): Promise<string[]> {
  return new Promise((resolve) => {
    const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
    const child = childProcess.spawn(npmCmd, ["ci", "--dry-run", "--ignore-scripts"], {
      cwd: REPO_ROOT,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf-8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf-8");
    });
    child.on("close", (code) => {
      const errors: string[] = [];
      if (code !== 0) {
        const output = (stderr || stdout || "").trim();
        const errorLines = output
          .split("\n")
          .filter((line) => line.includes("npm error") || line.includes("Missing:"))
          .slice(0, 10);
        const detail = errorLines.length > 0 ? errorLines.join("\n") : output.slice(0, 500);
        errors.push(
          `Lockfile out of sync: package.json and package-lock.json do not match. Run 'npm install' to synchronize package-lock.json.\n${detail}`,
        );
      }
      resolve(errors);
    });
    child.on("error", (err) => {
      resolve([`Failed to run npm ci --dry-run: ${err.message}`]);
    });
  });
}

export async function checkLockfileAsync(): Promise<string[]> {
  const stagingErrors = checkGitStaging();
  const syncErrors = await checkLockfileSyncAsync();
  return [...stagingErrors, ...syncErrors];
}

function run(): void {
  const errors = checkLockfile();
  if (errors.length > 0) {
    for (const err of errors) {
      console.error(`\n❌ ${err}\n`);
    }
    process.exit(1);
  }
  console.log("✓ package-lock.json is in sync with package.json.");
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  run();
}
