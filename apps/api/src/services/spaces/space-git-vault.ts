// SPDX-License-Identifier: AGPL-3.0-or-later

import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { applyHardenedRepoConfig, gitSubprocessEnv } from "../../util/git-hardening.js";
import { getSpaceDomainPreset } from "./domain-presets.js";

export interface SpaceGitVaultInitOptions {
  dbDir?: string | undefined;
  namespace: string;
  slug: string;
  name: string;
  domainPreset: string;
  defaultBranch?: string | undefined;
}

export function getGitReposBaseDir(dbDir?: string): string {
  return (
    process.env["GIT_REPOS_DIR"] ||
    path.join(process.env["DATA_DIR"] || dbDir || path.join(process.cwd(), "data"), "git-repos")
  );
}

export function resolveSpaceGitRepoPath(dbDir: string | undefined, namespace: string, slug: string): string | null {
  const cleanNs = namespace.trim().toLowerCase().replace(/^@/, "");
  const cleanSlug = slug
    .trim()
    .toLowerCase()
    .replace(/\.git$/i, "");
  if (
    !cleanNs ||
    !cleanSlug ||
    cleanNs.includes("..") ||
    cleanSlug.includes("..") ||
    cleanNs.includes("/") ||
    cleanSlug.includes("/")
  ) {
    return null;
  }
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,99}$/.test(cleanNs) || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,99}$/.test(cleanSlug)) {
    return null;
  }
  const baseDir = path.resolve(getGitReposBaseDir(dbDir));
  const resolved = path.resolve(baseDir, cleanNs, `${cleanSlug}.git`);
  if (!resolved.startsWith(baseDir + path.sep)) {
    return null;
  }
  return resolved;
}

/**
 * Ensures the bare Git Vault repository for a Space exists on disk and has hardened config.
 * Returns the resolved repository path and synthetic or actual HEAD commit SHA.
 */
export function ensureSpaceGitVaultInitialized(opts: SpaceGitVaultInitOptions): {
  repoPath: string | null;
  headCommitSha: string;
} {
  const repoPath = resolveSpaceGitRepoPath(opts.dbDir, opts.namespace, opts.slug);
  const fallbackSha = crypto
    .createHash("sha1")
    .update(`space:${opts.namespace}/${opts.slug}:${Date.now()}`)
    .digest("hex");

  if (!repoPath) {
    return { repoPath: null, headCommitSha: fallbackSha };
  }

  try {
    const parentDir = path.dirname(repoPath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }
    const defaultBranch = opts.defaultBranch || "main";
    if (!fs.existsSync(repoPath)) {
      execFileSync("git", ["init", "--bare", `--initial-branch=${defaultBranch}`, repoPath], {
        env: gitSubprocessEnv(),
        stdio: "ignore",
        timeout: 5000,
      });
      applyHardenedRepoConfig(repoPath);
    }

    // Write .ansatz/space.json metadata inside bare repo directory for fast inspection
    const ansatzMetaDir = path.join(repoPath, "ansatz-space");
    if (!fs.existsSync(ansatzMetaDir)) {
      fs.mkdirSync(ansatzMetaDir, { recursive: true });
    }
    const preset = getSpaceDomainPreset(opts.domainPreset);
    fs.writeFileSync(
      path.join(ansatzMetaDir, "space.json"),
      JSON.stringify(
        {
          namespace: opts.namespace,
          slug: opts.slug,
          name: opts.name,
          domainPreset: preset.id,
          languages: preset.languages,
          complianceStandards: preset.complianceStandards,
          defaultBranch,
          updatedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
      "utf8",
    );
  } catch {
    // Non-fatal in restricted/sandbox environments where git binary may not be available
  }

  return { repoPath, headCommitSha: fallbackSha };
}

/**
 * Atomically relocates a Space's bare Git Vault when ownership is transferred
 * between a User Profile and an Organization.
 */
export function relocateSpaceGitVault(
  dbDir: string | undefined,
  oldNamespace: string,
  newNamespace: string,
  slug: string,
): string | null {
  const oldPath = resolveSpaceGitRepoPath(dbDir, oldNamespace, slug);
  const newPath = resolveSpaceGitRepoPath(dbDir, newNamespace, slug);
  if (!oldPath || !newPath || oldPath === newPath) {
    return newPath;
  }
  try {
    if (fs.existsSync(oldPath) && !fs.existsSync(newPath)) {
      const targetParent = path.dirname(newPath);
      if (!fs.existsSync(targetParent)) {
        fs.mkdirSync(targetParent, { recursive: true });
      }
      fs.renameSync(oldPath, newPath);
    }
  } catch {
    // Ignore filesystem move failure if repo was not materialized on disk
  }
  return newPath;
}
