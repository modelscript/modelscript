// SPDX-License-Identifier: AGPL-3.0-or-later

export type PostVisibility = "public" | "unlisted" | "followers" | "direct";

export interface ProfileField {
  name: string;
  value: string;
  verified_at?: string | null | undefined;
}

export interface UserFederationInfo {
  id: number;
  actor_url?: string | null | undefined;
  inbox_url?: string | null | undefined;
  outbox_url?: string | null | undefined;
  remote_domain?: string | null | undefined;
  rsa_public_key?: string | null | undefined;
  rsa_private_key?: string | null | undefined;
  ed25519_public_key?: string | null | undefined;
  ed25519_private_key?: string | null | undefined;
  discoverable?: number | boolean | undefined;
  indexable?: number | boolean | undefined;
  locked?: number | boolean | undefined;
  also_known_as?: string | null | undefined;
  moved_to_actor_url?: string | null | undefined;
  profile_fields?: string | null | undefined;
  default_post_visibility?: string | undefined;
}

export interface UserRow {
  id: number;
  username: string;
  email: string;
  password_hash?: string | null | undefined;
  account_type?: string | undefined;
  avatar_url?: string | null | undefined;
  banner_url?: string | null | undefined;
  display_name?: string | null | undefined;
  bio?: string | null | undefined;
  location?: string | null | undefined;
  website?: string | null | undefined;
  email_verified?: number | undefined;
  status?: string | undefined;
  credit_balance?: number | undefined;
  token_version?: number | undefined;
  totp_enabled?: number | undefined;
  totp_secret?: string | null | undefined;
  backup_codes?: string | undefined;
  actor_url?: string | null | undefined;
  inbox_url?: string | null | undefined;
  outbox_url?: string | null | undefined;
  remote_domain?: string | null | undefined;
  rsa_public_key?: string | null | undefined;
  rsa_private_key?: string | null | undefined;
  ed25519_public_key?: string | null | undefined;
  ed25519_private_key?: string | null | undefined;
  owner_id?: number | null | undefined;
  owner_username?: string | null | undefined;
  follower_count?: number | undefined;
  following_count?: number | undefined;
  post_count?: number | undefined;
  is_following?: number | boolean | undefined;
  follow_request_pending?: number | boolean | undefined;
  created_at?: string | undefined;
  github_token?: string | null | undefined;
  gitlab_token?: string | null | undefined;
  onboarding_completed?: number | boolean | undefined;
  engineering_persona?: string | null | undefined;
  invites_remaining?: number | undefined;
  discoverable?: number | boolean | undefined;
  indexable?: number | boolean | undefined;
  locked?: number | boolean | undefined;
  also_known_as?: string | null | undefined;
  moved_to_actor_url?: string | null | undefined;
  profile_fields?: string | null | undefined;
  default_post_visibility?: string | undefined;
}

export interface UserReferralRow {
  id: number;
  referrer_id: number;
  referee_id: number;
  invite_id?: number | null | undefined;
  reward_granted: number | boolean;
  reward_amount: number;
  created_at?: string | undefined;
  referrer_username?: string | undefined;
  referee_username?: string | undefined;
}

export interface WaitlistSubmissionRow {
  id: number;
  email: string;
  full_name?: string | null | undefined;
  organization?: string | null | undefined;
  discipline?: string | null | undefined;
  portfolio_url?: string | null | undefined;
  statement?: string | null | undefined;
  status: "pending" | "approved" | "rejected";
  approved_by?: number | null | undefined;
  invite_code_id?: number | null | undefined;
  ip_address?: string | null | undefined;
  rejection_reason?: string | null | undefined;
  created_at?: string | undefined;
  reviewed_at?: string | null | undefined;
}

export interface ArtifactViewRow {
  id: number;
  creator_id?: number | undefined;
  author_id?: number | undefined;
  view_type: string;
  source_type?: string | undefined;
  source_ref?: string | null | undefined;
  title?: string | null | undefined;
  view_config: string;
  thumbnail_url?: string | null | undefined;
  remote_origin_url?: string | null | undefined;
  created_at?: string | undefined;
}

export interface PostNotebookCell {
  id?: string | undefined;
  type?: string | undefined;
  content?: string | undefined;
  artifactId?: number | string | undefined;
  title?: string | undefined;
  caption?: string | undefined;
}

export interface PostMetadata {
  clientSignature?: string | undefined;
  client_signature?: string | undefined;
  keyIdString?: string | undefined;
  key_id_string?: string | undefined;
  contentWarning?: string | undefined;
  isNotebook?: boolean | undefined;
  notebook?:
    | {
        isNotebook?: boolean | undefined;
        title?: string | undefined;
        summary?: string | undefined;
        difficulty?: string | undefined;
        series?: string | undefined;
        seriesPart?: number | undefined;
        dialect?: string | undefined;
        companionRepo?: string | undefined;
        estimatedReadMinutes?: number | undefined;
        artifactIds?: (number | string)[] | undefined;
        cells?: PostNotebookCell[] | undefined;
      }
    | undefined;
  [key: string]: unknown;
}

export interface PostPollOption {
  title: string;
  votes_count: number;
}

export interface PostPollView {
  id: number;
  post_id: number;
  options: PostPollOption[];
  expires_at?: string | null | undefined;
  multiple: boolean;
  voters_count: number;
  votes_count: number;
  expired: boolean;
  voted?: boolean | undefined;
  own_votes?: number[] | undefined;
}

export interface ContentFilterMatch {
  filter_id: number;
  title: string;
  filter_action: "warn" | "hide" | "drop";
  keyword_matches: string[];
  filter?: {
    id: number;
    title: string;
    context: ("home" | "public" | "notifications" | "thread" | "account")[];
    filter_action: "warn" | "hide" | "drop";
  };
}

export interface PostRow {
  id: number;
  author_id: number;
  content: string | null;
  artifact_view_id?: number | null | undefined;
  reply_to_id?: number | null | undefined;
  quote_post_id?: number | null | undefined;
  repost_of_id?: number | null | undefined;
  view_count?: number | undefined;
  ap_id?: string | null | undefined;
  url?: string | null | undefined;
  metadata?: PostMetadata | null | undefined;
  visibility?: PostVisibility | string | undefined;
  reply_visibility?: string | undefined;
  is_silenced?: number | undefined;
  is_sensitive?: number | boolean | undefined;
  content_warning?: string | null | undefined;
  created_at: string;
  updated_at?: string | undefined;
  username?: string | undefined;
  display_name?: string | null | undefined;
  avatar_url?: string | null | undefined;
  account_type?: string | undefined;
  like_count?: number | undefined;
  reply_count?: number | undefined;
  repost_count?: number | undefined;
  liked?: number | boolean | undefined;
  reposted?: number | boolean | undefined;
  bookmarked?: number | boolean | undefined;
  total_score?: number | undefined;
  diversity_score?: number | undefined;
  engagement_score?: number | undefined;
  client_signature?: string | undefined;
  key_id_string?: string | undefined;
  artifact_view?: ArtifactViewRow | null | undefined;
  artifact_views?: Record<number, ArtifactViewRow> | undefined;
  repost_post?: PostRow | null | undefined;
  quote_post?: PostRow | null | undefined;
  title?: string | null | undefined;
  thumbnail_url?: string | null | undefined;
  poll?: PostPollView | null | undefined;
  filtered?: ContentFilterMatch[] | undefined;
}

export interface RemoteActorProfile {
  preferredUsername?: string | undefined;
  name?: string | undefined;
  summary?: string | undefined;
  inbox?: string | undefined;
  outbox?: string | undefined;
  sharedInbox?: string | undefined;
  icon?: { url?: string | undefined } | undefined;
  endpoints?:
    | {
        sharedInbox?: string | undefined;
        shared_inbox?: string | undefined;
      }
    | undefined;
  [key: string]: unknown;
}

export interface NotificationRow {
  id: number;
  user_id: number;
  actor_id: number;
  type: string;
  post_id: number | null;
  metadata: Record<string, unknown> | string | null;
  read: number;
  created_at: string;
  actor_username?: string | undefined;
  actor_display_name?: string | null | undefined;
  actor_avatar_url?: string | null | undefined;
  post_content?: string | null | undefined;
  post_artifact_config?: string | null | undefined;
  post_artifact_type?: string | null | undefined;
}

export interface ContentReportRow {
  id: number;
  reporter_id: number;
  post_id: number | null;
  target_user_id: number | null;
  target_type?: "post" | "user" | "package" | "repo" | "appeal" | string | undefined;
  target_resource_id?: string | null | undefined;
  reason: string;
  details: string | null;
  status: string;
  resolution_notes: string | null;
  action_taken?: string | null | undefined;
  content_snapshot?: string | null | undefined;
  rule_ids?: number[] | string | undefined;
  category?: string | undefined;
  created_at: string;
  resolved_at: string | null;
  reporter_username?: string | null | undefined;
  post_content?: string | null | undefined;
  post_author_id?: number | null | undefined;
  author_username?: string | null | undefined;
  target_username?: string | null | undefined;
  author_domain?: string | null | undefined;
  target_report_count?: number | undefined;
  author_prior_violations?: number | undefined;
}

export interface AdminUserSummaryRow {
  id: number;
  username: string;
  email: string;
  display_name: string | null;
  account_type: string;
  status: string;
  email_verified: number;
  totp_enabled: number;
  credit_balance: number;
  remote_domain: string | null;
  created_at: string;
  post_count: number;
  report_count: number;
  resolved_violation_count: number;
}

export interface DmcaNoticeRow {
  id: number;
  claimant_name: string;
  claimant_email: string;
  copyright_owner: string;
  work_description: string;
  infringing_url: string;
  resource_type: string;
  resource_id: string | null;
  status: string;
  action_taken: string | null;
  created_at: string;
  resolved_at: string | null;
}

export interface AuditLogRow {
  id: number;
  actor_id: number | null;
  action: string;
  resource_type: string;
  resource_id: string | null;
  ip_address: string | null;
  details: string | null;
  prev_hash?: string | null | undefined;
  entry_hash?: string | null | undefined;
  created_at: string;
  actor_username?: string | null | undefined;
}

export interface RssFeedRow {
  id: number;
  url: string;
  user_id: number;
  title: string | null;
  description: string | null;
  site_url: string | null;
  last_fetched_at: string | null;
  last_guid: string | null;
  created_at: string;
  etag?: string | null | undefined;
  last_modified?: string | null | undefined;
  poll_interval_mins?: number | undefined;
  last_polled_at?: string | null | undefined;
  username?: string | undefined;
  display_name?: string | null | undefined;
  avatar_url?: string | null | undefined;
}

export interface RemotePackageRow {
  id: number;
  name: string;
  version: string;
  actor_url: string;
  download_url: string;
  checksum: string;
  license: string | null;
  description: string | null;
  metadata: string | null;
  is_deleted: number;
  created_at: string;
  updated_at: string;
}

export interface LinkedRepoRow {
  id: number;
  user_id: number;
  provider: string;
  namespace: string;
  project: string;
  external_id: string | null;
  description: string | null;
  avatar_url: string | null;
  pinned: number;
  created_at: string;
  username?: string | undefined;
  display_name?: string | null | undefined;
}

export interface LibraryReleaseRow {
  id: number;
  library_name: string;
  library_version: string;
  content_hash: string;
  signature: string | null;
  published_by: number | null;
  published_at: string;
  is_deprecated?: number | null | undefined;
  deprecation_reason?: string | null | undefined;
  is_yanked?: number | null | undefined;
  yank_reason?: string | null | undefined;
  yanked_at?: string | null | undefined;
}

export interface PackageTransferRow {
  id: number;
  package_name: string;
  from_user_id: number;
  to_user_id: number;
  status: string;
  created_at: string;
  resolved_at: string | null;
  from_username: string;
  to_username: string;
}

export interface SolutionRow {
  id: number;
  user_id: number;
  repo_id: number | null;
  slug: string;
  name: string;
  description: string | null;
  category: string;
  icon: string;
  supported_formats: string[];
  is_public: number;
  created_at: string;
  updated_at: string;
  author_username?: string | undefined;
  author_display_name?: string | null | undefined;
  author_avatar_url?: string | null | undefined;
  latest_version?: string | null | undefined;
  bundle_url?: string | null | undefined;
  tauri_windows_url?: string | null | undefined;
  tauri_linux_url?: string | null | undefined;
  tauri_darwin_url?: string | null | undefined;
}

export interface SolutionReleaseRow {
  id: number;
  solution_id: number;
  version: string;
  changelog: string | null;
  bundle_url: string;
  tauri_windows_url: string | null;
  tauri_linux_url: string | null;
  tauri_darwin_url: string | null;
  manifest_json: string | null;
  manifest?: Record<string, unknown> | null | undefined;
  created_at: string;
}

export interface UserArchiveData {
  posts: {
    id: number;
    content: string;
    created_at: string;
    like_count?: number | undefined;
    reply_count?: number | undefined;
    repost_count?: number | undefined;
  }[];
  libraries: {
    name: string;
    version: string;
    created_at: string;
  }[];
  billingHistory: {
    id: number;
    amount: number;
    balance_after: number;
    type: string;
    description: string;
    created_at: string;
  }[];
  auditHistory: {
    action: string;
    resource_type: string;
    resource_id?: string | undefined;
    created_at: string;
  }[];
  bookmarks: {
    post_id: number;
    content?: string | undefined;
    created_at?: string | undefined;
  }[];
  following: string[];
  followers: string[];
}

export interface IDatabase {
  isOpen(): boolean;
  getUserById(id: number): UserRow | undefined;
  getUserByUsername(username: string): UserRow | undefined;
  getUserByEmail(email: string): UserRow | undefined;
  getUserFederationInfo(userId: number): UserFederationInfo | undefined;
  getRemoteFollowersInboxes(authorId: number): { inbox_url: string }[];
  getTotalUsersCount(): number;
  getTotalPostsCount(): number;
  setUserCreditBalance(userId: number, balance: number): void;
  linkOAuthAccount(
    userId: number,
    provider: string,
    providerUserId: string,
    accessToken?: string | null | undefined,
    refreshToken?: string | null | undefined,
    expiresAt?: string | null | undefined,
  ): void;
  getUserArchiveData(userId: number): UserArchiveData | null;
  getAllArtifactViews(): ArtifactViewRow[];
  updateArtifactViewConfig(id: number, viewConfig: string): void;
}

export interface FederationRelayRow {
  id: number;
  inbox_url: string;
  actor_url: string;
  domain?: string | undefined;
  state: "pending" | "accepted" | "rejected" | "paused";
  follow_activity_id?: string | null | undefined;
  last_received_at?: string | null | undefined;
  last_error?: string | null | undefined;
  forwarded_count: number;
  received_count: number;
  created_at: string;
  updated_at: string;
}

export interface InstanceRuleRow {
  id: number;
  text: string;
  hint: string | null;
  category: string;
  sort_order: number;
  priority?: number | undefined;
  enabled?: number | boolean | undefined;
  is_active?: number | boolean | undefined;
  created_at: string;
  updated_at: string;
}

export interface AccountWarningRow {
  id: number;
  target_user_id: number;
  actor_id?: number | null | undefined;
  moderator_id?: number | null | undefined;
  action: "none" | "disable" | "mark_statuses_sensitive" | "delete_statuses" | "silence" | "suspend" | "warn";
  text: string;
  rule_ids: number[];
  post_ids?: number[] | undefined;
  report_id?: number | null | undefined;
  acknowledged_at?: string | null | undefined;
  created_at: string;
  actor_username?: string | null | undefined;
  moderator_username?: string | null | undefined;
  target_username?: string | null | undefined;
}

export interface StaffNoteRow {
  id: number;
  target_type: "user" | "domain" | "report";
  target_id: string;
  author_id: number;
  content: string;
  created_at: string;
  author_username?: string | null | undefined;
}

export interface IpBlockRow {
  id: number;
  cidr: string;
  ip_cidr?: string | undefined;
  severity: "sign_up_requires_approval" | "sign_up_block" | "no_access" | "no_sign_up";
  comment: string | null;
  created_by?: number | null | undefined;
  expires_at?: string | null | undefined;
  created_at: string;
  updated_at?: string | undefined;
}

export interface CanonicalEmailBlockRow {
  id: number;
  canonical_email_hash: string;
  email_hint: string;
  reason: string;
  created_by?: number | null | undefined;
  created_at: string;
}

export interface ContentFilterKeyword {
  keyword: string;
  whole_word?: boolean | undefined;
}

export interface ContentFilterRow {
  id: number;
  user_id?: number | null | undefined;
  title: string;
  context: ("home" | "notifications" | "public" | "thread" | "account")[];
  contexts?: ("home" | "notifications" | "public" | "thread" | "account")[];
  filter_action: "warn" | "hide" | "drop";
  keywords: ContentFilterKeyword[];
  expires_at?: string | null | undefined;
  created_at: string;
  updated_at: string;
}

export interface RemoteArtifactCacheRow {
  id: number;
  source_url?: string | undefined;
  remote_url?: string | undefined;
  remote_domain: string;
  media_type?: string | undefined;
  content_type?: string | undefined;
  byte_size?: number | undefined;
  size_bytes?: number | undefined;
  sha256: string;
  data_blob?: Buffer | null | undefined;
  local_data?: Buffer | null | undefined;
  local_path?: string | null | undefined;
  last_accessed_at: string;
  expires_at?: string | null | undefined;
  created_at: string;
}

export interface PushSubscriptionRow {
  id: number;
  user_id: number;
  endpoint: string;
  p256dh: string;
  auth: string;
  alerts: Record<string, boolean>;
  policy: "all" | "followed" | "follower" | "none";
  created_at: string;
  updated_at: string;
}
