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
  signing_verified?: boolean | number | undefined;
}

export interface PostItem {
  id: number | string;
  id_str?: string | undefined;
  author_id: number;
  username: string;
  display_name?: string | undefined;
  avatar_url?: string | undefined;
  account_type?: string | undefined;
  signing_verified?: boolean | number | undefined;
  content: string;
  artifact_id?: number | string | null | undefined;
  reply_to_id?: number | string | null | undefined;
  repost_of_id?: number | string | null | undefined;
  created_at: string;
  updated_at?: string | undefined;
  like_count: number;
  reply_count: number;
  repost_count: number;
  liked?: boolean | undefined;
  reposted?: boolean | undefined;
  bookmarked?: boolean | undefined;
  title?: string | undefined;
  artifact_view_id?: number | string | null | undefined;
  metadata?: { notebook?: unknown; [key: string]: unknown } | undefined;
}

export interface ArtifactViewDTO {
  id: number | string;
  view_type: string;
  config: Record<string, unknown> | string;
  view_config?: Record<string, unknown> | string | undefined;
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
  star_count?: number | undefined;
  stars_count?: number | undefined;
  stargazers_count?: number | undefined;
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

export interface AccountSigningKeyInfo {
  id: number;
  user_id: number;
  fingerprint_sha256: string;
  public_key_openssh: string;
  public_key_multibase: string;
  algo: string;
  label?: string | null | undefined;
  trust_level: string;
  created_at: string;
  activated_at?: string | undefined;
  revoked_at?: string | null | undefined;
  revocation_reason?: string | null | undefined;
  prev_key_id?: number | null | undefined;
  rotation_proof?: string | null | undefined;
}

export interface UserSigningKeysResponse {
  signing_verified: boolean;
  signing_policy_strict: boolean;
  keys: AccountSigningKeyInfo[];
}

export interface SigningKeyLogItem {
  seq: number;
  user_id: number;
  event: string;
  payload_json: string;
  prev_hash: string;
  entry_hash: string;
  created_at: string;
}
