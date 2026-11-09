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

export function generateStarterFilesForSpace(
  spaceName: string,
  namespace: string,
  slug: string,
  presetId?: string,
): Record<string, string> {
  const preset = getSpaceDomainPreset(presetId);
  const rawPkg =
    (spaceName || slug)
      .replace(/[^a-zA-Z0-9_]/g, "_")
      .replace(/^_+/, "")
      .replace(/_+$/, "") || "ModelWorkspace";
  const cleanPkgName = /^[a-zA-Z]/.test(rawPkg) ? rawPkg : `Pkg_${rawPkg}`;

  const files: Record<string, string> = {
    "README.md": `# ${spaceName}\n\nDigital twin workspace hosted on Ansatz Spaces.\n\n## Overview\n- **Namespace:** @${namespace}\n- **Slug:** ${slug}\n- **Domain Blueprint:** ${preset.name} (${preset.shortLabel})\n\n## Supported Formats\n${preset.languages.map((l) => `- \`${l}\``).join("\n")}\n\n## Getting Started\nLaunch the integrated Web Studio IDE to model, flatten, or simulate directly in the browser:\n\`\`\`bash\nmsx flatten package.mo\n\`\`\`\n`,
    "package.mo": `package ${cleanPkgName} "${spaceName}"\n  constant String version = "0.1.0";\n  annotation(Documentation(info="<html><p>Engineering models and digital twin architectures for ${spaceName}.</p></html>"));\nend ${cleanPkgName};\n`,
  };

  if (preset.sampleCodeSnippet?.code) {
    const lang = preset.sampleCodeSnippet.language.toLowerCase();
    const ext =
      lang === "modelica"
        ? "mo"
        : lang === "sysml2"
          ? "sysml"
          : lang === "scad"
            ? "scad"
            : lang === "spice"
              ? "sp"
              : lang === "csv"
                ? "csv"
                : "mo";
    files[`models/StarterModel.${ext}`] = preset.sampleCodeSnippet.code.trim() + "\n";
  }

  return files;
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

      try {
        const starterFiles = generateStarterFilesForSpace(opts.name, opts.namespace, opts.slug, opts.domainPreset);
        commitFilesToBareGitVault({
          repoPath,
          branch: defaultBranch,
          message: "feat: initialize Space Git Vault with starter domain models and README",
          files: starterFiles,
        });
      } catch {}
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

export interface SpaceGitCommitOptions {
  repoPath: string;
  files: Record<string, string>;
  message: string;
  authorName?: string | undefined;
  authorEmail?: string | undefined;
  branch?: string | undefined;
  timestamp?: string | number | undefined;
}

/**
 * Commits a set of files directly into a bare Git Vault repository without requiring a working tree.
 * Uses atomic git-hash-object, git-update-index, and git-commit-tree plumbing.
 */
export function commitFilesToBareGitVault(opts: SpaceGitCommitOptions): string | null {
  if (!opts.repoPath || !fs.existsSync(opts.repoPath)) return null;
  const branch = opts.branch || "main";
  const authorName = opts.authorName || "Ansatz Space Engineer";
  const authorEmail = opts.authorEmail || "engineer@modelscript.org";
  const dateStr = opts.timestamp ? new Date(opts.timestamp).toISOString() : new Date().toISOString();

  const env: NodeJS.ProcessEnv = {
    ...gitSubprocessEnv(),
    GIT_AUTHOR_NAME: authorName,
    GIT_AUTHOR_EMAIL: authorEmail,
    GIT_AUTHOR_DATE: dateStr,
    GIT_COMMITTER_NAME: authorName,
    GIT_COMMITTER_EMAIL: authorEmail,
    GIT_COMMITTER_DATE: dateStr,
  };

  const tempIdx = path.join(opts.repoPath, `temp_idx_${crypto.randomBytes(4).toString("hex")}`);
  const envWithIndex: NodeJS.ProcessEnv = { ...env, GIT_INDEX_FILE: tempIdx };

  try {
    let parentSha: string | null = null;
    try {
      const parentOut = execFileSync("git", ["-C", opts.repoPath, "rev-parse", `refs/heads/${branch}`], {
        env,
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
      if (/^[a-f0-9]{40}$/.test(parentOut)) {
        parentSha = parentOut;
      }
    } catch {
      // Target branch doesn't exist yet; if default branch (or HEAD) exists, branch off from it!
      try {
        const baseOut = execFileSync("git", ["-C", opts.repoPath, "rev-parse", "HEAD"], {
          env,
          encoding: "utf-8",
          stdio: ["ignore", "pipe", "ignore"],
        }).trim();
        if (/^[a-f0-9]{40}$/.test(baseOut)) {
          parentSha = baseOut;
        }
      } catch {}
    }

    if (parentSha) {
      try {
        execFileSync("git", ["-C", opts.repoPath, "read-tree", parentSha], {
          env: envWithIndex,
          stdio: "ignore",
        });
      } catch {}
    }

    for (const [filePath, content] of Object.entries(opts.files)) {
      const cleanPath = filePath.replace(/^\/+/, "");
      if (!cleanPath) continue;
      const blobSha = execFileSync("git", ["-C", opts.repoPath, "hash-object", "-w", "--stdin"], {
        input: content,
        env,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "ignore"],
      }).trim();

      execFileSync(
        "git",
        ["-C", opts.repoPath, "update-index", "--add", "--cacheinfo", `100644,${blobSha},${cleanPath}`],
        {
          env: envWithIndex,
          stdio: "ignore",
        },
      );
    }

    const treeSha = execFileSync("git", ["-C", opts.repoPath, "write-tree"], {
      env: envWithIndex,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();

    const commitArgs = ["-C", opts.repoPath, "commit-tree", treeSha, "-m", opts.message];
    if (parentSha) {
      commitArgs.push("-p", parentSha);
    }

    const commitSha = execFileSync("git", commitArgs, {
      env,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();

    execFileSync("git", ["-C", opts.repoPath, "update-ref", `refs/heads/${branch}`, commitSha], {
      env,
      stdio: "ignore",
    });

    // Only update symbolic-ref HEAD if committing to main/master or HEAD is unborn
    if (branch === "main" || branch === "master") {
      try {
        execFileSync("git", ["-C", opts.repoPath, "symbolic-ref", "HEAD", `refs/heads/${branch}`], {
          env,
          stdio: "ignore",
        });
      } catch {}
    } else {
      try {
        execFileSync("git", ["-C", opts.repoPath, "rev-parse", "HEAD"], {
          env,
          stdio: "ignore",
        });
      } catch {
        // If HEAD was unborn, set it
        try {
          execFileSync("git", ["-C", opts.repoPath, "symbolic-ref", "HEAD", `refs/heads/${branch}`], {
            env,
            stdio: "ignore",
          });
        } catch {}
      }
    }

    return commitSha;
  } catch {
    return null;
  } finally {
    try {
      if (fs.existsSync(tempIdx)) {
        fs.unlinkSync(tempIdx);
      }
    } catch {}
  }
}
