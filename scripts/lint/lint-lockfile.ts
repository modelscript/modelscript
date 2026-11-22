// SPDX-License-Identifier: AGPL-3.0-or-later

import * as childProcess from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { REPO_ROOT } from "../lib/workspaces.js";

const __filename = fileURLToPath(import.meta.url);

function getLockfileName(): "pnpm-lock.yaml" | "package-lock.json" {
  return fs.existsSync(path.join(REPO_ROOT, "pnpm-lock.yaml")) ? "pnpm-lock.yaml" : "package-lock.json";
}

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

  const lockfile = getLockfileName();
  const isAnyPackageJsonStaged = stagedFiles.some(
    (f) => f === "package.json" || f.endsWith("/package.json") || f === "pnpm-workspace.yaml",
  );
  const isLockfileStaged = stagedFiles.includes(lockfile);

  let rawStatus = "";
  try {
    rawStatus = childProcess.execSync(`git status --porcelain ${lockfile}`, {
      cwd: REPO_ROOT,
      encoding: "utf-8",
    });
  } catch {
    return errors;
  }

  const line = rawStatus.split(/\r?\n/)[0] || "";
  if (!line) return errors;

  const worktreeStatus = line[1] || " ";
  const isUntracked = line.startsWith("??");
  const worktreeModified = worktreeStatus === "M" || isUntracked;

  if (isAnyPackageJsonStaged && worktreeModified) {
    errors.push(
      `Staging error: package.json is staged for commit, but ${lockfile} has unstaged changes. Run 'git add ${lockfile}' before committing.`,
    );
  }

  if (isLockfileStaged && worktreeStatus === "M") {
    errors.push(
      `Staging error: ${lockfile} is only partially staged. Run 'git add ${lockfile}' to stage all lockfile changes before committing.`,
    );
  }

  return errors;
}

function getCheckCommand(): { cmd: string; args: string[]; lockfile: string; fixHint: string } {
  const isWin = process.platform === "win32";
  const lockfile = getLockfileName();
  if (lockfile === "pnpm-lock.yaml") {
    return {
      cmd: isWin ? "pnpm.cmd" : "pnpm",
      args: ["install", "--frozen-lockfile", "--ignore-scripts", "--lockfile-only"],
      lockfile,
      fixHint: "pnpm install",
    };
  }
  return {
    cmd: isWin ? "npm.cmd" : "npm",
    args: ["ci", "--dry-run", "--ignore-scripts"],
    lockfile,
    fixHint: "npm install",
  };
}

export function checkLockfileSync(): string[] {
  const errors: string[] = [];
  const { cmd, args, lockfile, fixHint } = getCheckCommand();
  const res = childProcess.spawnSync(cmd, args, {
    cwd: REPO_ROOT,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (res.status !== 0) {
    const output = (res.stderr || res.stdout || "").trim();
    const errorLines = output
      .split("\n")
      .filter((line) => line.includes("ERR_PNPM") || line.includes("npm error") || line.includes("Missing:"))
      .slice(0, 10);
    const detail = errorLines.length > 0 ? errorLines.join("\n") : output.slice(0, 500);
    errors.push(
      `Lockfile out of sync: package.json and ${lockfile} do not match. Run '${fixHint}' to synchronize ${lockfile}.\n${detail}`,
    );
  }

  return errors;
}

export function checkLockfile(): string[] {
  return [...checkGitStaging(), ...checkLockfileSync()];
}

export function checkLockfileSyncAsync(): Promise<string[]> {
  return new Promise((resolve) => {
    const { cmd, args, lockfile, fixHint } = getCheckCommand();
    const child = childProcess.spawn(cmd, args, {
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
          .filter((line) => line.includes("ERR_PNPM") || line.includes("npm error") || line.includes("Missing:"))
          .slice(0, 10);
        const detail = errorLines.length > 0 ? errorLines.join("\n") : output.slice(0, 500);
        errors.push(
          `Lockfile out of sync: package.json and ${lockfile} do not match. Run '${fixHint}' to synchronize ${lockfile}.\n${detail}`,
        );
      }
      resolve(errors);
    });
    child.on("error", (err) => {
      resolve([`Failed to run ${cmd} ${args.join(" ")}: ${err.message}`]);
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
  console.log(`✓ ${getLockfileName()} is in sync with workspace manifests.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  run();
}
