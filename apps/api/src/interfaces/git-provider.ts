// SPDX-License-Identifier: AGPL-3.0-or-later

export interface GitTreeItem {
  id: string;
  name: string;
  type: "tree" | "blob" | "commit";
  path: string;
  mode?: string;
}

export interface GitCommitItem {
  id: string;
  short_id: string;
  title: string;
  created_at: string;
  author_name: string;
  author_email?: string;
  message: string;
}

export interface GitPipelineItem {
  id: number;
  iid: number;
  project_id: number;
  sha: string;
  ref: string;
  status: string;
  source: string;
  created_at: string;
  updated_at: string;
  web_url: string;
}

export interface GitJobItem {
  id: number;
  status: string;
  stage: string;
  name: string;
  ref: string;
  tag: boolean;
  coverage: null | string;
  allow_failure: boolean;
  created_at: string;
  started_at: string;
  finished_at: string;
  duration: number;
}

export interface GitIssueItem {
  id: number;
  iid: number;
  project_id: number;
  title: string;
  description: string;
  state: string;
  created_at: string;
  updated_at: string;
  author: {
    name: string;
    avatar_url: string | null;
  };
}

export interface GitMergeRequestItem {
  id: number;
  iid: number;
  project_id: number;
  title: string;
  description: string;
  state: string;
  created_at: string;
  updated_at: string;
  source_branch: string;
  target_branch: string;
  author: {
    name: string;
    avatar_url: string | null;
  };
}

export interface IGitProvider {
  getProject(idOrUrl: string): Promise<unknown>;
  getRepositoryTree(idOrUrl: string, ref: string, path: string): Promise<GitTreeItem[]>;
  getRepositoryFileRaw(idOrUrl: string, filePath: string, ref: string): Promise<string>;
  getCommits(idOrUrl: string, refName: string): Promise<GitCommitItem[]>;
  getPipelines(idOrUrl: string, refName: string): Promise<GitPipelineItem[]>;
  getPipelineJobs(idOrUrl: string, pipelineId: string): Promise<GitJobItem[]>;
  getIssues(idOrUrl: string): Promise<GitIssueItem[]>;
  createIssue(idOrUrl: string, body: unknown): Promise<GitIssueItem>;
  getMergeRequests(idOrUrl: string): Promise<GitMergeRequestItem[]>;
}
