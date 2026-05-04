// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Utility client for integrating with a GitLab CE instance.
 */

const GITLAB_URL = process.env.GITLAB_URL || "https://gitlab.com";
const GITLAB_TOKEN = process.env.GITLAB_TOKEN || "";

/**
 * Make an authenticated request to the GitLab API.
 */
export async function gitlabRequest<T = unknown>(path: string, options?: RequestInit): Promise<T> {
  const url = `${GITLAB_URL}/api/v4${path}`;
  const headers = new Headers(options?.headers);
  if (GITLAB_TOKEN) {
    headers.set("Authorization", `Bearer ${GITLAB_TOKEN}`);
  }
  headers.set("Content-Type", "application/json");

  const response = await fetch(url, { ...options, headers });

  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    throw new Error(`GitLab API error: ${response.status} ${response.statusText} - ${errText}`);
  }

  return (await response.json()) as T;
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
export async function getRepositoryFileRaw(projectIdOrPath: string, filePath: string, ref = "main"): Promise<string> {
  const encodedId = encodeURIComponent(projectIdOrPath);
  const encodedFile = encodeURIComponent(filePath);
  const url = `${GITLAB_URL}/api/v4/projects/${encodedId}/repository/files/${encodedFile}/raw?ref=${ref}`;

  const headers = new Headers();
  if (GITLAB_TOKEN) {
    headers.set("Authorization", `Bearer ${GITLAB_TOKEN}`);
  }

  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(`Failed to fetch raw file: ${response.status}`);
  }
  return response.text();
}

/**
 * List commits for a project.
 */
export async function getCommits(projectIdOrPath: string, refName = "main") {
  const encodedId = encodeURIComponent(projectIdOrPath);
  const params = new URLSearchParams({ ref_name: refName });
  return gitlabRequest(`/projects/${encodedId}/repository/commits?${params.toString()}`);
}
