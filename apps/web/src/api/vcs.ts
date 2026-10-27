// SPDX-License-Identifier: AGPL-3.0-or-later

/* eslint-disable @typescript-eslint/no-explicit-any */
import axios from "axios";
import { api } from "./client";

export interface GitlabProject {
  id: number;
  description: string | null;
  name: string;
  name_with_namespace: string;
  path: string;
  path_with_namespace: string;
  default_branch: string;
  web_url: string;
  visibility?: string | undefined;
}

export interface GitlabTreeNode {
  id: string;
  name: string;
  type: "tree" | "blob";
  path: string;
  mode: string;
}

export interface GitlabCommit {
  id: string;
  short_id: string;
  title: string;
  message: string;
  author_name: string;
  author_email: string;
  created_at: string;
}

export interface GitlabPipeline {
  id: number;
  iid: number;
  project_id: number;
  status: "running" | "pending" | "success" | "failed" | "canceled" | "skipped";
  ref: string;
  sha: string;
  web_url: string;
  created_at: string;
  updated_at: string;
}

export interface GitlabJob {
  id: number;
  status: "running" | "pending" | "success" | "failed" | "canceled" | "skipped";
  stage: string;
  name: string;
  ref: string;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  duration: number | null;
  web_url: string;
  artifacts: { file_type: string; size: number; filename: string }[];
}

export interface GitlabIssue {
  id: number;
  iid: number;
  project_id: number;
  title: string;
  description: string;
  state: string;
  created_at: string;
  updated_at: string;
  author: {
    id?: number | undefined;
    name: string;
    avatar_url?: string | undefined;
    username: string;
  };
  labels: string[];
}

export interface GitlabMergeRequest {
  id: number;
  iid: number;
  project_id?: number | undefined;
  title: string;
  description: string;
  state: string;
  created_at: string;
  updated_at?: string | undefined;
  target_branch: string;
  source_branch: string;
  web_url?: string | undefined;
  author: {
    id?: number | undefined;
    name: string;
    avatar_url?: string | undefined;
    username: string;
  };
}

export const getGitlabProject = async (
  projectIdOrPath: string,
  provider: string = "gitlab",
): Promise<GitlabProject> => {
  if (provider === "github") {
    const { data } = await axios.get(`https://api.github.com/repos/${projectIdOrPath}`);
    return {
      id: data.id,
      description: data.description,
      name: data.name,
      name_with_namespace: data.full_name,
      path: data.name,
      path_with_namespace: data.full_name,
      default_branch: data.default_branch,
      web_url: data.html_url,
    };
  }
  const { data } = await api.get<GitlabProject>(`/gitlab/projects/${encodeURIComponent(projectIdOrPath)}`);
  return data;
};

export const getGitlabTree = async (
  projectIdOrPath: string,
  ref = "main",
  path = "",
  provider: string = "gitlab",
): Promise<GitlabTreeNode[]> => {
  if (provider === "github") {
    const url = path
      ? `https://api.github.com/repos/${projectIdOrPath}/contents/${path}?ref=${ref}`
      : `https://api.github.com/repos/${projectIdOrPath}/contents?ref=${ref}`;
    const { data } = await axios.get(url);
    const items = Array.isArray(data) ? data : [data];
    return items.map((item: any) => ({
      id: item.sha,
      name: item.name,
      type: item.type === "dir" ? "tree" : "blob",
      path: item.path,
      mode: "100644",
    }));
  }
  const { data } = await api.get<GitlabTreeNode[]>(
    `/gitlab/projects/${encodeURIComponent(projectIdOrPath)}/repository/tree`,
    {
      params: { ref, path },
    },
  );
  return data;
};

export const getGitlabFileRaw = async (
  projectIdOrPath: string,
  filePath: string,
  ref = "main",
  provider: string = "gitlab",
): Promise<string> => {
  if (provider === "github") {
    const { data } = await axios.get(`https://raw.githubusercontent.com/${projectIdOrPath}/${ref}/${filePath}`);
    return typeof data === "string" ? data : JSON.stringify(data, null, 2);
  }
  const { data } = await api.get<string>(
    `/gitlab/projects/${encodeURIComponent(projectIdOrPath)}/repository/files/${encodeURIComponent(filePath)}/raw`,
    { params: { ref } },
  );
  return data;
};

export const getGitlabCommits = async (
  projectIdOrPath: string,
  refName = "main",
  provider: string = "gitlab",
): Promise<GitlabCommit[]> => {
  if (provider === "github") {
    const { data } = await axios.get(`https://api.github.com/repos/${projectIdOrPath}/commits?sha=${refName}`);
    return data.map((c: any) => ({
      id: c.sha,
      short_id: c.sha.substring(0, 8),
      title: c.commit.message.split("\n")[0],
      message: c.commit.message,
      author_name: c.commit.author.name,
      author_email: c.commit.author.email,
      created_at: c.commit.author.date,
    }));
  }
  const { data } = await api.get<GitlabCommit[]>(
    `/gitlab/projects/${encodeURIComponent(projectIdOrPath)}/repository/commits`,
    {
      params: { ref_name: refName },
    },
  );
  return data;
};

export const getGitlabPipelines = async (
  projectIdOrPath: string,
  refName = "main",
  provider: string = "gitlab",
): Promise<GitlabPipeline[]> => {
  if (provider === "github") {
    return []; // Simplified for now
  }
  const { data } = await api.get<GitlabPipeline[]>(
    `/gitlab/projects/${encodeURIComponent(projectIdOrPath)}/pipelines`,
    {
      params: { ref: refName },
    },
  );
  return data;
};

export const getGitlabPipelineJobs = async (
  projectIdOrPath: string,
  pipelineId: number,
  provider: string = "gitlab",
): Promise<GitlabJob[]> => {
  if (provider === "github") return [];
  const { data } = await api.get<GitlabJob[]>(
    `/gitlab/projects/${encodeURIComponent(projectIdOrPath)}/pipelines/${pipelineId}/jobs`,
  );
  return data;
};

export const getGitlabIssues = async (projectIdOrPath: string, provider: string = "gitlab"): Promise<GitlabIssue[]> => {
  if (provider === "github") {
    const { data } = await axios.get(`https://api.github.com/repos/${projectIdOrPath}/issues?state=open`);
    return data
      .filter((i: any) => !i.pull_request)
      .map((i: any) => ({
        id: i.id,
        iid: i.number,
        project_id: 0,
        title: i.title,
        description: i.body || "",
        state: i.state,
        created_at: i.created_at,
        updated_at: i.updated_at,
        author: {
          name: i.user.login,
          avatar_url: i.user.avatar_url,
          username: i.user.login,
        },
        labels: i.labels.map((l: any) => l.name),
      }));
  }
  const { data } = await api.get<GitlabIssue[]>(`/gitlab/projects/${encodeURIComponent(projectIdOrPath)}/issues`);
  return data;
};

export const createGitlabIssue = async (
  projectIdOrPath: string,
  title: string,
  description: string,
  provider: string = "gitlab",
): Promise<GitlabIssue> => {
  if (provider === "github") throw new Error("Creating issues on GitHub is not supported yet.");
  const { data } = await api.post<GitlabIssue>(`/gitlab/projects/${encodeURIComponent(projectIdOrPath)}/issues`, {
    title,
    description,
  });
  return data;
};

export const getGitlabMergeRequests = async (
  projectIdOrPath: string,
  provider: string = "gitlab",
): Promise<GitlabMergeRequest[]> => {
  if (provider === "github") {
    const { data } = await axios.get(`https://api.github.com/repos/${projectIdOrPath}/pulls?state=open`);
    return data.map((pr: any) => ({
      id: pr.id,
      iid: pr.number,
      project_id: 0,
      title: pr.title,
      description: pr.body || "",
      state: pr.state,
      created_at: pr.created_at,
      updated_at: pr.updated_at,
      target_branch: pr.base.ref,
      source_branch: pr.head.ref,
      author: {
        name: pr.user.login,
        avatar_url: pr.user.avatar_url,
        username: pr.user.login,
      },
    }));
  }
  const { data } = await api.get<GitlabMergeRequest[]>(
    `/gitlab/projects/${encodeURIComponent(projectIdOrPath)}/merge_requests`,
  );
  return data;
};

export const createGitlabMergeRequest = async (
  projectIdOrPath: string,
  payload: {
    title: string;
    description?: string | undefined;
    source_branch: string;
    target_branch: string;
  },
  provider: string = "gitlab",
): Promise<GitlabMergeRequest> => {
  if (provider === "github") {
    const { data: pr } = await axios.post(`https://api.github.com/repos/${projectIdOrPath}/pulls`, {
      title: payload.title,
      body: payload.description || "",
      head: payload.source_branch,
      base: payload.target_branch,
    });
    return {
      id: pr.id,
      iid: pr.number,
      project_id: 0,
      title: pr.title,
      description: pr.body || "",
      state: pr.state,
      created_at: pr.created_at,
      updated_at: pr.updated_at,
      target_branch: pr.base.ref,
      source_branch: pr.head.ref,
      web_url: pr.html_url || "#",
      author: {
        id: pr.user?.id || 1,
        name: pr.user?.login || "current_user",
        avatar_url: pr.user?.avatar_url,
        username: pr.user?.login || "current_user",
      },
    };
  }
  const { data } = await api.post<GitlabMergeRequest>(
    `/gitlab/projects/${encodeURIComponent(projectIdOrPath)}/merge_requests`,
    payload,
  );
  return data;
};
