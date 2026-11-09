// SPDX-License-Identifier: AGPL-3.0-or-later

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { simpleGit, type SimpleGit } from "simple-git";
import type {
  CreateGitMergeRequestInput,
  GitBranchItem,
  GitCommitItem,
  GitIssueItem,
  GitJobItem,
  GitMergeRequestItem,
  GitPipelineItem,
  GitTreeItem,
  IGitProvider,
} from "../interfaces/git-provider.js";
import { assertSafePublicUrlAsync } from "./ssrf.js";

export const DEFAULT_GIT_CACHE_DIR = process.env["GIT_CACHE_DIR"] || path.resolve(process.cwd(), "data", "git-cache");
const CACHE_DIR = DEFAULT_GIT_CACHE_DIR;

function hasControlChar(str: string): boolean {
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    if ((code >= 0 && code <= 31) || code === 127) {
      return true;
    }
  }
  return false;
}

function sanitizeGitRef(ref: string): string {
  const clean = (ref || "HEAD").trim();
  if (!clean || clean.startsWith("-") || clean.includes("..") || hasControlChar(clean) || /[~^:?*[\\]/.test(clean)) {
    throw new Error("Invalid git reference");
  }
  return clean;
}

function sanitizeGitSubpath(subpath: string): string {
  const clean = (subpath || "").trim().replace(/^\/+/, "");
  if (clean.startsWith("-") || clean.includes("..") || hasControlChar(clean)) {
    throw new Error("Invalid repository file path");
  }
  return clean;
}

function trimSlashes(str: string): string {
  let start = 0;
  while (start < str.length && str.charCodeAt(start) === 47 /* '/' */) {
    start++;
  }
  let end = str.length;
  while (end > start && str.charCodeAt(end - 1) === 47 /* '/' */) {
    end--;
  }
  return str.slice(start, end);
}

export class LocalGitProvider implements IGitProvider {
  private readonly mergeRequestsByProject = new Map<string, GitMergeRequestItem[]>();

  private async resolveHostedBareRepoPath(idOrUrl: string): Promise<string | null> {
    const candidateDirs: string[] = [];
    if (process.env["GIT_REPOS_DIR"]) {
      candidateDirs.push(path.resolve(process.env["GIT_REPOS_DIR"]));
    }
    candidateDirs.push(path.resolve(process.cwd(), "data", "git-repos"));
    candidateDirs.push(path.resolve(import.meta.dirname, "../../../../data/git-repos"));
    candidateDirs.push(path.resolve(import.meta.dirname, "../../data/git-repos"));

    if (path.isAbsolute(idOrUrl)) {
      const resolved = path.resolve(idOrUrl);
      for (const reposDir of candidateDirs) {
        const allowedPrefix = reposDir + path.sep;
        if (!resolved.startsWith(allowedPrefix)) {
          continue;
        }
        try {
          await fs.access(resolved);
          return resolved;
        } catch {
          // Try next candidate directory
        }
      }
      return null;
    }

    const trimmed = trimSlashes(idOrUrl.trim());
    const parts = trimmed.split("/");
    if (parts.length === 2 && parts[0] && parts[1] && !parts[0].includes("..") && !parts[1].includes("..")) {
      const cleanNs = parts[0].replace(/[^a-zA-Z0-9_.-]/g, "");
      const cleanProj = parts[1].replace(/\.git$/i, "").replace(/[^a-zA-Z0-9_.-]/g, "");
      if (cleanNs && cleanProj) {
        for (const reposDir of candidateDirs) {
          const candidate = path.resolve(reposDir, cleanNs, `${cleanProj}.git`);
          if (!candidate.startsWith(reposDir + path.sep)) continue;
          try {
            await fs.access(candidate);
            return candidate;
          } catch {
            // Try next candidate directory
          }
        }
      }
    }
    return null;
  }

  private async getRepoPath(url: string): Promise<string> {
    if (!url || typeof url !== "string" || url.startsWith("-") || hasControlChar(url)) {
      throw new Error("Invalid git repository URL");
    }

    const hostedBarePath = await this.resolveHostedBareRepoPath(url);
    if (hostedBarePath) {
      return hostedBarePath;
    }

    const isHttpUrl = /^https?:\/\//i.test(url);
    if (process.env["NODE_ENV"] === "production") {
      if (!isHttpUrl) {
        throw new Error("Only http:// and https:// git repository URLs are permitted in production");
      }
      await assertSafePublicUrlAsync(url);
    } else if (isHttpUrl) {
      // In non-test environments, still block private/loopback URLs unless allowlisted
      if (process.env["NODE_ENV"] !== "test") {
        await assertSafePublicUrlAsync(url);
      }
    } else if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(url)) {
      throw new Error("Unsupported git protocol: only http:// and https:// are permitted");
    }

    await fs.mkdir(CACHE_DIR, { recursive: true });

    // Use SHA-256 hash of the full URL to prevent cache directory collisions across distinct repositories
    const urlHash = crypto.createHash("sha256").update(url).digest("hex").slice(0, 24);
    const basePart = path.basename(url.replace(/[^a-zA-Z0-9_-]/g, "_")).slice(0, 48) || "repo";
    const safeName = `${basePart}-${urlHash}`;
    const repoPath = path.resolve(CACHE_DIR, safeName);
    if (!repoPath.startsWith(path.resolve(CACHE_DIR) + path.sep)) {
      throw new Error("Invalid git repository cache path");
    }

    const git: SimpleGit = simpleGit({ timeout: { block: 30_000 } });
    const gitProtocolArgs = isHttpUrl
      ? [
          "-c",
          "protocol.allow=never",
          "-c",
          "protocol.https.allow=always",
          "-c",
          "protocol.http.allow=always",
          "-c",
          "http.followRedirects=false",
        ]
      : [];

    try {
      await fs.access(repoPath);
      // If it exists, fetch latest
      const localGit = simpleGit(repoPath, { timeout: { block: 30_000 } });
      await localGit.raw([...gitProtocolArgs, "fetch", "--all"]);
    } catch {
      // If not, clone bare repo
      await git.raw([...gitProtocolArgs, "clone", "--bare", "--", url, repoPath]);
    }

    return repoPath;
  }

  private getMergeRequestsStoreFilePath(idOrUrl: string): string {
    const projectHash = crypto.createHash("sha256").update(idOrUrl).digest("hex").slice(0, 24);
    return path.resolve(CACHE_DIR, `merge-requests-${projectHash}.json`);
  }

  private async loadStoredMergeRequests(idOrUrl: string): Promise<GitMergeRequestItem[]> {
    const filePath = this.getMergeRequestsStoreFilePath(idOrUrl);
    try {
      const raw = await fs.readFile(filePath, "utf8");
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        const items = parsed as GitMergeRequestItem[];
        this.mergeRequestsByProject.set(idOrUrl, items);
        return items;
      }
    } catch {
      // File may not exist yet
    }
    return this.mergeRequestsByProject.get(idOrUrl) ?? [];
  }

  private async saveStoredMergeRequests(idOrUrl: string, items: GitMergeRequestItem[]): Promise<void> {
    this.mergeRequestsByProject.set(idOrUrl, items);
    try {
      await fs.mkdir(CACHE_DIR, { recursive: true });
      const filePath = this.getMergeRequestsStoreFilePath(idOrUrl);
      await fs.writeFile(filePath, JSON.stringify(items, null, 2), "utf8");
    } catch {
      // In-memory store remains authoritative if disk cache is read-only
    }
  }

  private async inspectBranchCommitMetadata(
    idOrUrl: string,
    sourceBranch: string,
    targetBranch: string,
  ): Promise<{
    sha?: string | undefined;
    target_sha?: string | undefined;
    commits_ahead?: number | undefined;
    author_name?: string | undefined;
  }> {
    try {
      const safeSource = sanitizeGitRef(sourceBranch);
      const safeTarget = sanitizeGitRef(targetBranch);
      const repoPath = await this.getRepoPath(idOrUrl);
      const git = simpleGit(repoPath);

      const sourceSha = (await git.revparse([safeSource]).catch(() => "")).trim() || undefined;
      const targetSha = (await git.revparse([safeTarget]).catch(() => "")).trim() || undefined;

      let commitsAhead: number | undefined;
      let latestAuthor: string | undefined;
      if (sourceSha) {
        const latestLog = await git.log(["-n", "1", safeSource, "--"]).catch(() => null);
        if (latestLog?.latest?.author_name) {
          latestAuthor = latestLog.latest.author_name;
        }
      }
      if (sourceSha && targetSha) {
        const aheadRaw = await git.raw(["rev-list", "--count", `${safeTarget}..${safeSource}`]).catch(() => "");
        const parsedCount = Number.parseInt(aheadRaw.trim(), 10);
        if (Number.isFinite(parsedCount)) {
          commitsAhead = parsedCount;
        }
      }

      return {
        sha: sourceSha,
        target_sha: targetSha,
        commits_ahead: commitsAhead,
        author_name: latestAuthor,
      };
    } catch {
      return {};
    }
  }

  async getProject(idOrUrl: string): Promise<unknown> {
    return {
      id: idOrUrl,
      name: idOrUrl.split("/").pop()?.replace(".git", "") || idOrUrl,
      description: "Local Git Repository",
      web_url: idOrUrl,
    };
  }

  async getRepositoryTree(idOrUrl: string, ref = "HEAD", treePath = "", recursive = false): Promise<GitTreeItem[]> {
    const safeRef = sanitizeGitRef(ref);
    const safeTreePath = sanitizeGitSubpath(treePath);
    const repoPath = await this.getRepoPath(idOrUrl);
    const git = simpleGit(repoPath);

    // Use ls-tree
    const targetPath = safeTreePath ? `${safeRef}:${safeTreePath}` : safeRef;
    const args = ["ls-tree"];
    if (recursive) {
      args.push("-r");
    }
    args.push(targetPath);
    const output = await git.raw(args);

    const items: GitTreeItem[] = [];
    if (!output.trim()) return items;

    for (const line of output.trim().split("\n")) {
      const match = line.match(/^(\d+)\s+(\w+)\s+([a-f0-9]+)\t(.*)$/);
      if (match) {
        const [, mode, type, id, name] = match;
        if (id && name) {
          items.push({
            id,
            name: recursive ? name.split("/").pop() || name : name,
            type: type as "tree" | "blob" | "commit",
            path: recursive
              ? safeTreePath
                ? `${safeTreePath}/${name}`
                : name
              : safeTreePath
                ? `${safeTreePath}/${name}`
                : name,
            mode: mode as string,
          });
        }
      }
    }

    return items;
  }

  async getRepositoryFileRaw(idOrUrl: string, filePath: string, ref = "HEAD"): Promise<string> {
    const safeRef = sanitizeGitRef(ref);
    const safeFilePath = sanitizeGitSubpath(filePath);
    const repoPath = await this.getRepoPath(idOrUrl);
    const git = simpleGit(repoPath);
    return git.show([`${safeRef}:${safeFilePath}`]);
  }

  async getCommits(idOrUrl: string, refName = "HEAD"): Promise<GitCommitItem[]> {
    const safeRefName = sanitizeGitRef(refName);
    const repoPath = await this.getRepoPath(idOrUrl);
    const git = simpleGit(repoPath);

    const log = await git.log(["-n", "100", safeRefName, "--"]);

    return log.all.map((c) => ({
      id: c.hash,
      short_id: c.hash.substring(0, 8),
      title: c.message,
      created_at: new Date(c.date).toISOString(),
      author_name: c.author_name,
      author_email: c.author_email,
      message: c.body ? `${c.message}\n\n${c.body}` : c.message,
    }));
  }

  // Not supported in plain git, return empty array

  async getPipelines(_idOrUrl: string, _refName: string): Promise<GitPipelineItem[]> {
    return [];
  }

  async getPipelineJobs(_idOrUrl: string, _pipelineId: string): Promise<GitJobItem[]> {
    return [];
  }

  async getIssues(_idOrUrl: string): Promise<GitIssueItem[]> {
    return [];
  }

  async createIssue(_idOrUrl: string, _body: unknown): Promise<GitIssueItem> {
    throw new Error("Issues are not supported by local git provider");
  }

  async getBranches(idOrUrl: string): Promise<GitBranchItem[]> {
    try {
      const repoPath = await this.getRepoPath(idOrUrl);
      const git = simpleGit(repoPath);
      const branchSummary = await git.branchLocal().catch(() => null);
      if (!branchSummary || Object.keys(branchSummary.branches).length === 0) {
        return [{ name: "main", default: true }];
      }
      return Object.values(branchSummary.branches).map((b) => ({
        name: b.name,
        default: b.current,
        commit: { id: b.commit },
      }));
    } catch {
      return [{ name: "main", default: true }];
    }
  }

  async getMergeRequests(idOrUrl: string): Promise<GitMergeRequestItem[]> {
    const existing = await this.loadStoredMergeRequests(idOrUrl);
    return [...existing];
  }

  async createMergeRequest(idOrUrl: string, body: CreateGitMergeRequestInput): Promise<GitMergeRequestItem> {
    const existing = await this.loadStoredMergeRequests(idOrUrl);
    const nextIid = existing.reduce((maxIid, mr) => Math.max(maxIid, mr.iid), 0) + 1;
    const nowIso = new Date().toISOString();
    const branchMeta = await this.inspectBranchCommitMetadata(idOrUrl, body.source_branch, body.target_branch);

    const created: GitMergeRequestItem = {
      id: Date.now() * 1000 + nextIid,
      iid: nextIid,
      project_id: idOrUrl,
      title: body.title,
      description: body.description || "",
      state: "opened",
      created_at: nowIso,
      updated_at: nowIso,
      source_branch: body.source_branch,
      target_branch: body.target_branch,
      web_url: `${idOrUrl}/-/merge_requests/${nextIid}`,
      ...(branchMeta.sha ? { sha: branchMeta.sha } : {}),
      ...(branchMeta.target_sha ? { target_sha: branchMeta.target_sha } : {}),
      ...(branchMeta.commits_ahead !== undefined ? { commits_ahead: branchMeta.commits_ahead } : {}),
      author: {
        name: body.author_name || branchMeta.author_name || "Anonymous",
        avatar_url: null,
      },
    };

    const updated = [created, ...existing];
    await this.saveStoredMergeRequests(idOrUrl, updated);
    return created;
  }
}
