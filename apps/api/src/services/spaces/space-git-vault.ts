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
    .createHash("sha256")
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
  files: Record<string, string> | { path: string; content: string }[];
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

    const fileEntries: [string, string][] = Array.isArray(opts.files)
      ? opts.files.map((f: { path: string; content: string }) => [f.path, f.content])
      : Object.entries(opts.files);

    for (const [filePath, content] of fileEntries) {
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

export function inferLanguageFromFilename(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".mo")) return "modelica";
  if (lower.endsWith(".md")) return "markdown";
  if (lower.endsWith(".sysml")) return "sysml2";
  if (lower.endsWith(".sp") || lower.endsWith(".cir")) return "spice";
  if (lower.endsWith(".scad")) return "scad";
  if (lower.endsWith(".json")) return "json";
  if (lower.endsWith(".xml")) return "xml";
  if (lower.endsWith(".csv")) return "csv";
  if (lower.endsWith(".c") || lower.endsWith(".h")) return "c";
  if (lower.endsWith(".rs")) return "rust";
  return "text";
}

export interface SpaceGitDiffFile {
  filename: string;
  language: string;
  oldContent: string;
  newContent: string;
  ancestorContent?: string | undefined;
  additions: number;
  deletions: number;
  status: "added" | "modified" | "deleted";
}

export interface SpaceGitDiffResult {
  sourceBranch: string;
  targetBranch: string;
  mergeBaseSha?: string | undefined;
  files: SpaceGitDiffFile[];
  totalAdditions: number;
  totalDeletions: number;
}

/**
 * Creates a new branch in a Space's bare Git vault off a base ref (defaults to HEAD).
 */
export function createSpaceGitBranch(opts: { repoPath: string; branchName: string; fromRef?: string | undefined }): {
  success: boolean;
  sha?: string;
  error?: string;
} {
  if (!opts.repoPath || !fs.existsSync(opts.repoPath)) {
    return { success: false, error: "Repository does not exist on disk" };
  }
  const cleanBranch = opts.branchName.trim().replace(/^refs\/heads\//, "");
  if (!cleanBranch || cleanBranch.includes("..") || cleanBranch.startsWith("-") || /\s/.test(cleanBranch)) {
    return { success: false, error: `Invalid branch name '${opts.branchName}'` };
  }
  const fromRef = opts.fromRef?.trim() || "HEAD";
  const env = gitSubprocessEnv();

  try {
    const sha = execFileSync("git", ["-C", opts.repoPath, "rev-parse", fromRef], {
      env,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();

    if (!/^[a-f0-9]{40}$/.test(sha)) {
      return { success: false, error: `Base ref '${fromRef}' not found in repository` };
    }

    execFileSync("git", ["-C", opts.repoPath, "branch", cleanBranch, sha], {
      env,
      stdio: ["ignore", "ignore", "pipe"],
    });

    return { success: true, sha };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: msg };
  }
}

/**
 * Deletes a branch in a Space's bare Git vault.
 */
export function deleteSpaceGitBranch(opts: { repoPath: string; branchName: string }): boolean {
  if (!opts.repoPath || !fs.existsSync(opts.repoPath)) return false;
  const cleanBranch = opts.branchName.trim().replace(/^refs\/heads\//, "");
  if (!cleanBranch || cleanBranch === "main" || cleanBranch === "master") return false;
  try {
    execFileSync("git", ["-C", opts.repoPath, "branch", "-D", cleanBranch], {
      env: gitSubprocessEnv(),
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Reads a single file at a given git revision (commit/branch/tag) directly from the bare repository.
 */
export function readSpaceGitFileAtRef(opts: { repoPath: string; ref: string; filePath: string }): string | null {
  if (!opts.repoPath || !fs.existsSync(opts.repoPath)) return null;
  const cleanPath = opts.filePath.trim().replace(/^\/+/, "");
  try {
    return execFileSync("git", ["-C", opts.repoPath, "show", `${opts.ref}:${cleanPath}`], {
      env: gitSubprocessEnv(),
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 5 * 1024 * 1024,
    });
  } catch {
    return null;
  }
}

/**
 * Computes a structured diff between two branches or commit refs inside a bare Git vault.
 */
export function getSpaceGitDiff(opts: {
  repoPath: string;
  baseRef: string;
  targetRef: string;
}): SpaceGitDiffResult | null {
  if (!opts.repoPath || !fs.existsSync(opts.repoPath)) return null;
  const env = gitSubprocessEnv();

  try {
    const baseSha = execFileSync("git", ["-C", opts.repoPath, "rev-parse", opts.baseRef], {
      env,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const targetSha = execFileSync("git", ["-C", opts.repoPath, "rev-parse", opts.targetRef], {
      env,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();

    if (!/^[a-f0-9]{40}$/.test(baseSha) || !/^[a-f0-9]{40}$/.test(targetSha)) {
      return null;
    }

    let mergeBaseSha: string | undefined;
    try {
      const mbOut = execFileSync("git", ["-C", opts.repoPath, "merge-base", opts.baseRef, opts.targetRef], {
        env,
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
      if (/^[a-f0-9]{40}$/.test(mbOut)) {
        mergeBaseSha = mbOut;
      }
    } catch {
      // Merge base calculation fallback (e.g. initial roots or unrelated histories)
    }

    const diffStatOut = execFileSync(
      "git",
      ["-C", opts.repoPath, "diff", "--name-status", opts.baseRef, opts.targetRef],
      {
        env,
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "ignore"],
      },
    ).trim();

    const lines = diffStatOut ? diffStatOut.split("\n").filter(Boolean) : [];
    const files: SpaceGitDiffFile[] = [];

    let totalAdditions = 0;
    let totalDeletions = 0;

    for (const line of lines) {
      const parts = line.split(/\t+/);
      const statusCode = parts[0]?.trim() || "M";
      const filePath = parts[1]?.trim() || "";
      if (!filePath) continue;

      let status: "added" | "modified" | "deleted" = "modified";
      if (statusCode.startsWith("A")) status = "added";
      else if (statusCode.startsWith("D")) status = "deleted";

      const oldContent =
        status === "added"
          ? ""
          : (readSpaceGitFileAtRef({ repoPath: opts.repoPath, ref: opts.baseRef, filePath }) ?? "");
      const newContent =
        status === "deleted"
          ? ""
          : (readSpaceGitFileAtRef({ repoPath: opts.repoPath, ref: opts.targetRef, filePath }) ?? "");
      const ancestorContent =
        mergeBaseSha && status !== "added"
          ? (readSpaceGitFileAtRef({ repoPath: opts.repoPath, ref: mergeBaseSha, filePath }) ?? undefined)
          : undefined;

      const oldLines = oldContent ? oldContent.split("\n").length : 0;
      const newLines = newContent ? newContent.split("\n").length : 0;
      let additions = 0;
      let deletions = 0;
      if (status === "added") {
        additions = newLines;
      } else if (status === "deleted") {
        deletions = oldLines;
      } else {
        additions = Math.max(0, newLines - oldLines);
        deletions = Math.max(0, oldLines - newLines);
        if (additions === 0 && deletions === 0 && oldContent !== newContent) {
          additions = 1;
          deletions = 1;
        }
      }

      totalAdditions += additions;
      totalDeletions += deletions;

      files.push({
        filename: filePath,
        language: inferLanguageFromFilename(filePath),
        oldContent,
        newContent,
        ancestorContent,
        additions,
        deletions,
        status,
      });
    }

    return {
      sourceBranch: opts.targetRef,
      targetBranch: opts.baseRef,
      mergeBaseSha,
      files,
      totalAdditions,
      totalDeletions,
    };
  } catch {
    return null;
  }
}

/**
 * Executes an in-memory 3-way tree merge in the bare Git vault using modern git-merge-tree,
 * creates a merge commit with both parents, and updates the target branch atomically.
 */
export function mergeSpaceGitBranches(opts: {
  repoPath: string;
  sourceBranch: string;
  targetBranch: string;
  message: string;
  authorName?: string | undefined;
  authorEmail?: string | undefined;
}): { success: boolean; commitSha?: string; error?: string } {
  if (!opts.repoPath || !fs.existsSync(opts.repoPath)) {
    return { success: false, error: "Repository does not exist" };
  }
  const authorName = opts.authorName || "Ansatz Space Approver";
  const authorEmail = opts.authorEmail || "approver@modelscript.org";
  const dateStr = new Date().toISOString();
  const env: NodeJS.ProcessEnv = {
    ...gitSubprocessEnv(),
    GIT_AUTHOR_NAME: authorName,
    GIT_AUTHOR_EMAIL: authorEmail,
    GIT_AUTHOR_DATE: dateStr,
    GIT_COMMITTER_NAME: authorName,
    GIT_COMMITTER_EMAIL: authorEmail,
    GIT_COMMITTER_DATE: dateStr,
  };

  try {
    const targetSha = execFileSync("git", ["-C", opts.repoPath, "rev-parse", `refs/heads/${opts.targetBranch}`], {
      env,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const sourceSha = execFileSync("git", ["-C", opts.repoPath, "rev-parse", `refs/heads/${opts.sourceBranch}`], {
      env,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();

    if (!/^[a-f0-9]{40}$/.test(targetSha) || !/^[a-f0-9]{40}$/.test(sourceSha)) {
      return {
        success: false,
        error: `Invalid refs for merge: ${opts.targetBranch} (${targetSha}) or ${opts.sourceBranch} (${sourceSha})`,
      };
    }

    // Modern Git in-memory tree merge without working directory
    const mergeTreeOut = execFileSync(
      "git",
      ["-C", opts.repoPath, "merge-tree", "--write-tree", opts.targetBranch, opts.sourceBranch],
      {
        env,
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "pipe"],
      },
    ).trim();

    const mergedTreeSha = mergeTreeOut.split("\n")[0]?.trim();
    if (!mergedTreeSha || !/^[a-f0-9]{40}$/.test(mergedTreeSha)) {
      return { success: false, error: "Merge conflict detected during 3-way tree merge" };
    }

    // Create merge commit with 2 parents: targetSha (first parent) and sourceSha (second parent)
    const commitSha = execFileSync(
      "git",
      ["-C", opts.repoPath, "commit-tree", mergedTreeSha, "-p", targetSha, "-p", sourceSha, "-m", opts.message],
      {
        env,
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "ignore"],
      },
    ).trim();

    // Update target branch ref
    execFileSync("git", ["-C", opts.repoPath, "update-ref", `refs/heads/${opts.targetBranch}`, commitSha], {
      env,
      stdio: "ignore",
    });

    return { success: true, commitSha };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: msg };
  }
}

/**
 * Creates an annotated Git tag on a commit inside the bare vault.
 */
export function tagSpaceGitCommit(opts: {
  repoPath: string;
  tagName: string;
  targetRef: string;
  message: string;
  taggerName?: string | undefined;
  taggerEmail?: string | undefined;
}): { success: boolean; tagSha?: string; error?: string } {
  if (!opts.repoPath || !fs.existsSync(opts.repoPath)) {
    return { success: false, error: "Repository does not exist" };
  }
  const taggerName = opts.taggerName || "Ansatz Space Release Bot";
  const taggerEmail = opts.taggerEmail || "release@modelscript.org";
  const env: NodeJS.ProcessEnv = {
    ...gitSubprocessEnv(),
    GIT_COMMITTER_NAME: taggerName,
    GIT_COMMITTER_EMAIL: taggerEmail,
    GIT_COMMITTER_DATE: new Date().toISOString(),
  };

  try {
    const targetSha = execFileSync("git", ["-C", opts.repoPath, "rev-parse", opts.targetRef], {
      env,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();

    execFileSync("git", ["-C", opts.repoPath, "tag", "-a", opts.tagName, targetSha, "-m", opts.message], {
      env,
      stdio: ["ignore", "ignore", "pipe"],
    });

    return { success: true, tagSha: targetSha };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: msg };
  }
}
