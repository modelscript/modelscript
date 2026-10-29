// SPDX-License-Identifier: AGPL-3.0-or-later

import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { simpleGit, type SimpleGit } from "simple-git";
import type {
  GitCommitItem,
  GitIssueItem,
  GitJobItem,
  GitMergeRequestItem,
  GitPipelineItem,
  GitTreeItem,
  IGitProvider,
} from "../interfaces/git-provider.js";
import { assertSafePublicUrlAsync } from "./ssrf.js";

const CACHE_DIR = process.env["GIT_CACHE_DIR"] || path.join(os.tmpdir(), "modelscript-git-cache");

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

export class LocalGitProvider implements IGitProvider {
  private async getRepoPath(url: string): Promise<string> {
    if (!url || typeof url !== "string" || url.startsWith("-") || hasControlChar(url)) {
      throw new Error("Invalid git repository URL");
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

  async getProject(idOrUrl: string): Promise<unknown> {
    return {
      id: idOrUrl,
      name: idOrUrl.split("/").pop()?.replace(".git", "") || idOrUrl,
      description: "Local Git Repository",
      web_url: idOrUrl,
    };
  }

  async getRepositoryTree(idOrUrl: string, ref = "HEAD", treePath = ""): Promise<GitTreeItem[]> {
    const safeRef = sanitizeGitRef(ref);
    const safeTreePath = sanitizeGitSubpath(treePath);
    const repoPath = await this.getRepoPath(idOrUrl);
    const git = simpleGit(repoPath);

    // Use ls-tree
    const targetPath = safeTreePath ? `${safeRef}:${safeTreePath}` : safeRef;
    const output = await git.raw(["ls-tree", targetPath]);

    const items: GitTreeItem[] = [];
    if (!output.trim()) return items;

    for (const line of output.trim().split("\n")) {
      const match = line.match(/^(\d+)\s+(\w+)\s+([a-f0-9]+)\t(.*)$/);
      if (match) {
        const [, mode, type, id, name] = match;
        if (id && name) {
          items.push({
            id,
            name,
            type: type as "tree" | "blob" | "commit",
            path: safeTreePath ? `${safeTreePath}/${name}` : name,
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
      message: c.body,
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

  async getMergeRequests(_idOrUrl: string): Promise<GitMergeRequestItem[]> {
    return [];
  }
}
