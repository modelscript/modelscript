// SPDX-License-Identifier: AGPL-3.0-or-later

export interface UserProfile {
  id: number;
  username: string;
  display_name?: string;
  email?: string;
  avatar_url?: string;
  banner_url?: string;
  bio?: string;
  account_type?: "human" | "bot" | "organization" | string;
  is_admin?: boolean;
  follower_count?: number;
  following_count?: number;
  created_at: string;
}

export interface PostAuthor {
  id: number;
  username: string;
  display_name?: string;
  avatar_url?: string;
  account_type?: string;
}

export interface PostItem {
  id: number;
  author_id: number;
  username: string;
  display_name?: string;
  avatar_url?: string;
  content: string;
  artifact_id?: number | null;
  reply_to_id?: number | null;
  repost_of_id?: number | null;
  created_at: string;
  updated_at?: string;
  like_count: number;
  reply_count: number;
  repost_count: number;
  liked?: boolean;
  reposted?: boolean;
  bookmarked?: boolean;
}

export interface ArtifactViewDTO {
  id: number;
  view_type: string;
  config: Record<string, unknown> | string;
  title?: string;
  description?: string;
  author_id?: number;
  created_at: string;
  updated_at?: string;
}

export interface SimulationJobDTO {
  id: string | number;
  jobId?: string;
  name: string;
  domain: "modelica" | "sysml2" | "cfd" | "fea" | string;
  profile: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled" | string;
  progress?: number;
  costCredits?: number;
  elapsedSeconds?: number;
  startedAt?: string | number;
  hasVtu?: boolean;
  hasCsv?: boolean;
}

export interface RepositoryDTO {
  id: string | number;
  provider: "local" | "github" | "gitlab" | string;
  namespace: string;
  project: string;
  name?: string;
  description?: string;
  avatar_url?: string;
  default_branch?: string;
  is_private?: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface ScriptTemplateDTO {
  id: number;
  name: string;
  slug: string;
  description: string;
  category: string;
  icon: string;
  config: string;
  estimatedDuration?: string;
  steps?: unknown[];
}
