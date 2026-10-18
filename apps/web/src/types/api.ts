// SPDX-License-Identifier: AGPL-3.0-or-later

export interface UserProfile {
  id: number;
  username: string;
  display_name?: string | undefined;
  email?: string | undefined;
  avatar_url?: string | undefined;
  banner_url?: string | undefined;
  bio?: string | undefined;
  account_type?: "human" | "bot" | "organization" | string | undefined;
  is_admin?: boolean | undefined;
  follower_count?: number | undefined;
  following_count?: number | undefined;
  created_at: string;
}

export interface PostAuthor {
  id: number;
  username: string;
  display_name?: string | undefined;
  avatar_url?: string | undefined;
  account_type?: string | undefined;
}

export interface PostItem {
  id: number;
  author_id: number;
  username: string;
  display_name?: string | undefined;
  avatar_url?: string | undefined;
  content: string;
  artifact_id?: number | null | undefined;
  reply_to_id?: number | null | undefined;
  repost_of_id?: number | null | undefined;
  created_at: string;
  updated_at?: string | undefined;
  like_count: number;
  reply_count: number;
  repost_count: number;
  liked?: boolean | undefined;
  reposted?: boolean | undefined;
  bookmarked?: boolean | undefined;
}

export interface ArtifactViewDTO {
  id: number;
  view_type: string;
  config: Record<string, unknown> | string;
  title?: string | undefined;
  description?: string | undefined;
  author_id?: number | undefined;
  created_at: string;
  updated_at?: string | undefined;
}

export interface SimulationJobDTO {
  id: string | number;
  jobId?: string | undefined;
  name: string;
  domain: "modelica" | "sysml2" | "cfd" | "fea" | string;
  profile: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled" | string;
  progress?: number | undefined;
  costCredits?: number | undefined;
  elapsedSeconds?: number | undefined;
  startedAt?: string | number | undefined;
  hasVtu?: boolean | undefined;
  hasCsv?: boolean | undefined;
}

export interface RepositoryDTO {
  id: string | number;
  provider: "local" | "github" | "gitlab" | string;
  namespace: string;
  project: string;
  name?: string | undefined;
  description?: string | undefined;
  avatar_url?: string | undefined;
  default_branch?: string | undefined;
  is_private?: boolean | undefined;
  created_at?: string | undefined;
  updated_at?: string | undefined;
}

export interface ScriptTemplateDTO {
  id: number;
  name: string;
  slug: string;
  description: string;
  category: string;
  icon: string;
  config: string;
  estimatedDuration?: string | undefined;
  steps?: unknown[] | undefined;
}
