// SPDX-License-Identifier: AGPL-3.0-or-later

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export interface LockfileDomainSummary {
  files: string[];
  hash?: string;
}

export interface LockfilePackageEntry {
  version: string;
  resolved: string;
  integrity: string; // sha256:...
  domains?: Record<string, LockfileDomainSummary>;
  dependencies?: Record<string, string>;
}

export interface ModelScriptLockfile {
  lockfileVersion: number;
  packages: Record<string, LockfilePackageEntry>;
}

export const LOCKFILE_NAME = "msx.lock";

/**
 * Computes sha256 integrity string for a binary buffer.
 */
export function computeBufferIntegrity(buffer: Buffer): string {
  return `sha256:${crypto.createHash("sha256").update(buffer).digest("hex")}`;
}

/**
 * Reads and parses `msx.lock` from the given directory.
 */
export function readLockfile(cwd: string): ModelScriptLockfile | null {
  const lockPath = path.join(cwd, LOCKFILE_NAME);
  if (!fs.existsSync(lockPath)) return null;

  try {
    const raw = fs.readFileSync(lockPath, "utf-8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.lockfileVersion === "number" && typeof parsed.packages === "object") {
      return parsed as ModelScriptLockfile;
    }
  } catch {
    // Malformed lockfile
  }
  return null;
}

/**
 * Writes `msx.lock` to the given directory deterministically with sorted package keys.
 */
export function writeLockfile(cwd: string, lockfile: ModelScriptLockfile): void {
  const lockPath = path.join(cwd, LOCKFILE_NAME);

  // Sort package keys for deterministic diffs
  const sortedPackages: Record<string, LockfilePackageEntry> = {};
  for (const key of Object.keys(lockfile.packages).sort()) {
    sortedPackages[key] = lockfile.packages[key]!;
  }

  const payload: ModelScriptLockfile = {
    lockfileVersion: lockfile.lockfileVersion || 1,
    packages: sortedPackages,
  };

  fs.writeFileSync(lockPath, JSON.stringify(payload, null, 2) + "\n", "utf-8");
}

/**
 * Adds or updates a package entry in the local workspace lockfile.
 */
export function updateLockfilePackage(
  cwd: string,
  packageName: string,
  entry: LockfilePackageEntry,
): ModelScriptLockfile {
  const lockfile = readLockfile(cwd) || {
    lockfileVersion: 1,
    packages: {},
  };

  lockfile.packages[packageName] = entry;
  writeLockfile(cwd, lockfile);
  return lockfile;
}

/**
 * Verifies that a downloaded or local buffer matches the expected integrity hash.
 */
export function verifyIntegrity(buffer: Buffer, expectedIntegrity: string): boolean {
  if (!expectedIntegrity) return true;
  const actual = computeBufferIntegrity(buffer);
  return actual.toLowerCase() === expectedIntegrity.toLowerCase();
}
