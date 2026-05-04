// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Utility client for integrating with a GitLab CE instance.
 */

import http from "node:http";
import https from "node:https";

const GITLAB_URL = process.env.GITLAB_URL || "https://gitlab.com";
const GITLAB_TOKEN = process.env.GITLAB_TOKEN || "";

export class GitlabError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "GitlabError";
  }
}

/**
 * Make an authenticated request to the GitLab API.
 */
export function gitlabRequest<T = unknown>(path: string, options?: RequestInit): Promise<T> {
  return new Promise((resolve, reject) => {
    const url = new URL(`${GITLAB_URL}/api/v4${path}`);
    const client = url.protocol === "http:" ? http : https;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(GITLAB_TOKEN ? { Authorization: `Bearer ${GITLAB_TOKEN}` } : {}),
    };
    if (options?.headers) {
      Object.assign(headers, options.headers);
    }

    const req = client.request(
      url,
      {
        method: options?.method || "GET",
        headers,
        family: 4, // Force IPv4 to bypass dual-stack fetch bugs in restricted networks
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          if (!res.statusCode || res.statusCode >= 400) {
            reject(new GitlabError(res.statusCode || 500, `GitLab API error: ${res.statusCode} - ${data}`));
          } else {
            try {
              resolve(JSON.parse(data) as T);
            } catch (e) {
              reject(e);
            }
          }
        });
      },
    );

    req.on("error", reject);
    if (options?.body) req.write(options.body as string);
    req.end();
  });
}

/**
 * Get a single project by ID or URL-encoded path.
 */
export async function getProject(projectIdOrPath: string) {
  const encodedPath = encodeURIComponent(projectIdOrPath);
  return gitlabRequest(`/projects/${encodedPath}`);
}

/**
 * Get repository tree for a project.
 */
export async function getRepositoryTree(projectIdOrPath: string, ref = "main", path = "") {
  const encodedId = encodeURIComponent(projectIdOrPath);
  const params = new URLSearchParams({ ref, path });
  return gitlabRequest(`/projects/${encodedId}/repository/tree?${params.toString()}`);
}

/**
 * Get raw file content from the repository.
 */
export function getRepositoryFileRaw(projectIdOrPath: string, filePath: string, ref = "main"): Promise<string> {
  return new Promise((resolve, reject) => {
    const encodedId = encodeURIComponent(projectIdOrPath);
    const encodedFile = encodeURIComponent(filePath);
    const url = new URL(`${GITLAB_URL}/api/v4/projects/${encodedId}/repository/files/${encodedFile}/raw?ref=${ref}`);
    const client = url.protocol === "http:" ? http : https;

    const headers: Record<string, string> = {};
    if (GITLAB_TOKEN) {
      headers["Authorization"] = `Bearer ${GITLAB_TOKEN}`;
    }

    const req = client.request(
      url,
      {
        method: "GET",
        headers,
        family: 4, // Force IPv4
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          if (!res.statusCode || res.statusCode >= 400) {
            reject(new Error(`Failed to fetch raw file: ${res.statusCode}`));
          } else {
            resolve(data);
          }
        });
      },
    );

    req.on("error", reject);
    req.end();
  });
}

/**
 * List commits for a project.
 */
export async function getCommits(projectIdOrPath: string, refName = "main") {
  const encodedId = encodeURIComponent(projectIdOrPath);
  const params = new URLSearchParams({ ref_name: refName });
  return gitlabRequest(`/projects/${encodedId}/repository/commits?${params.toString()}`);
}
