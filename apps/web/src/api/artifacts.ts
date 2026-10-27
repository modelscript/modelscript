// SPDX-License-Identifier: AGPL-3.0-or-later

import { encodePackagePath } from "../util/url";
import { api } from "./client";

export interface ArtifactViewDescriptor {
  viewer: string; // 'fmu-simulator' | 'dataset-table' | ...
  label: string;
  icon: string;
  config: Record<string, unknown>;
}

export interface ArtifactViewerInfo {
  id: number;
  type: string;
  path: string;
  displayName: string;
  metadata: Record<string, unknown>;
  viewer: ArtifactViewDescriptor | null;
}

/**
 * Fetch enriched artifact metadata for a package version.
 * Returns artifacts with viewer configurations (if a handler is registered).
 */
export const getArtifactViewers = async (name: string, version: string): Promise<ArtifactViewerInfo[]> => {
  try {
    const { data } = await api.get<{ artifacts: ArtifactViewerInfo[] }>(
      `/packages/${encodePackagePath(name)}/${encodeURIComponent(version)}/artifacts`,
    );
    return data?.artifacts || [];
  } catch {
    return [];
  }
};

export const createArtifactView = async (artifactData: Record<string, any>): Promise<any> => {
  const { data } = await api.post("/social/artifact-views", artifactData);
  return data;
};

export const getArtifactView = async (id: string | number): Promise<any> => {
  const { data } = await api.get(`/social/artifact-views/${encodeURIComponent(String(id))}`);
  return data;
};

export const uploadArtifactThumbnail = async (
  id: string | number,
  dataUrl: string,
): Promise<{ success: boolean; thumbnailUrl: string }> => {
  const { data } = await api.put(`/social/artifact-views/${encodeURIComponent(String(id))}/thumbnail`, { dataUrl });
  return data;
};

export const uploadStorageFile = async (formData: FormData): Promise<any> => {
  const { data } = await api.post("/storage/upload", formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return data;
};

// ── Solutions & Engineering Apps API ───────────────────────────────

export interface Solution {
  id: number;
  user_id: number;
  repo_id?: number | null;
  slug: string;
  name: string;
  description?: string | null;
  category?: string;
  icon?: string;
  supported_formats: string[];
  is_public: number;
  created_at: string;
  updated_at: string;
  author_username: string;
  author_display_name?: string | null;
  author_avatar_url?: string | null;
  latest_version?: string | null;
  bundle_url?: string | null;
  tauri_windows_url?: string | null;
  tauri_linux_url?: string | null;
  tauri_darwin_url?: string | null;
}

export interface SolutionRelease {
  id: number;
  solution_id: number;
  version: string;
  changelog?: string | null;
  bundle_url: string;
  tauri_windows_url?: string | null;
  tauri_linux_url?: string | null;
  tauri_darwin_url?: string | null;
  manifest?: Record<string, any> | null;
  created_at: string;
}

export const getUserSolutions = async (username: string): Promise<{ solutions: Solution[] }> => {
  const { data } = await api.get(`/users/${encodeURIComponent(username)}/solutions`);
  return data;
};

export const getSolution = async (
  author: string,
  slug: string,
): Promise<{ solution: Solution; release: SolutionRelease | null }> => {
  const { data } = await api.get(`/solutions/${encodeURIComponent(author)}/${encodeURIComponent(slug)}`);
  return data;
};

export const getPublicSolutions = async (): Promise<{ solutions: Solution[] }> => {
  const { data } = await api.get("/solutions");
  return data;
};
