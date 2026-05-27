// SPDX-License-Identifier: AGPL-3.0-or-later

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

const CACHE_DIR = process.env.GIT_CACHE_DIR || path.join(os.tmpdir(), "modelscript-git-cache");

export class LocalGitProvider implements IGitProvider {
  private async getRepoPath(url: string): Promise<string> {
    await fs.mkdir(CACHE_DIR, { recursive: true });

    // Hash the URL or use a safe folder name
    const safeName = url.replace(/[^a-zA-Z0-9]/g, "_");
    const repoPath = path.join(CACHE_DIR, safeName);

    const git: SimpleGit = simpleGit();

    try {
      await fs.access(repoPath);
      // If it exists, fetch latest
      const localGit = simpleGit(repoPath);
      await localGit.fetch(["--all"]);
    } catch {
      // If not, clone bare repo
      await git.clone(url, repoPath, ["--bare"]);
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
    const repoPath = await this.getRepoPath(idOrUrl);
    const git = simpleGit(repoPath);

    // Use ls-tree
    const targetPath = treePath ? `${ref}:${treePath}` : ref;
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
            path: treePath ? `${treePath}/${name}` : name,
            mode: mode as string,
          });
        }
      }
    }

    return items;
  }

  async getRepositoryFileRaw(idOrUrl: string, filePath: string, ref = "HEAD"): Promise<string> {
    const repoPath = await this.getRepoPath(idOrUrl);
    const git = simpleGit(repoPath);
    return git.show([`${ref}:${filePath}`]);
  }

  async getCommits(idOrUrl: string, refName = "HEAD"): Promise<GitCommitItem[]> {
    const repoPath = await this.getRepoPath(idOrUrl);
    const git = simpleGit(repoPath);

    const log = await git.log([refName]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return log.all.map((c: any) => ({
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
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async getPipelines(_idOrUrl: string, _refName: string): Promise<GitPipelineItem[]> {
    return [];
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async getPipelineJobs(_idOrUrl: string, _pipelineId: string): Promise<GitJobItem[]> {
    return [];
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async getIssues(_idOrUrl: string): Promise<GitIssueItem[]> {
    return [];
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async createIssue(_idOrUrl: string, _body: unknown): Promise<GitIssueItem> {
    throw new Error("Issues are not supported by local git provider");
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async getMergeRequests(_idOrUrl: string): Promise<GitMergeRequestItem[]> {
    return [];
  }
}
