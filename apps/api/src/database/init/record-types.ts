// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ComputeProfile } from "../../services/hpc/hpc-types.js";
import type { AccountWarningRow, ContentFilterRow } from "../types.js";

export interface ClassRow {
  id: number;
  library_name: string;
  library_version: string;
  class_name: string;
  class_kind: string;
  description: string | null;
  documentation: string | null;
  icon_hash?: string | null | undefined;
  diagram_hash?: string | null | undefined;
}

export interface ExtendsRow {
  id: number;
  class_id: number;
  base_class: string;
}

export interface ComponentRow {
  id: number;
  class_id: number;
  component_name: string;
  type_name: string;
  description: string | null;
  causality: string | null;
  variability: string | null;
}

export interface ModifierRow {
  id: number;
  component_id: number;
  modifier_name: string;
  modifier_value: string | null;
}

export interface ClassMetadata {
  className: string;
  classKind: string;
  description: string | null;
  documentation: string | null;
  baseClasses: string[];
  components: ComponentMetadata[];
  iconHash?: string | null | undefined;
  diagramHash?: string | null | undefined;
}

export interface ComponentMetadata {
  name: string;
  typeName: string;
  description: string | null;
  causality: string | null;
  variability: string | null;
  modifiers: { name: string; value: string | null }[];
}

export interface RegistryCatalogItem {
  fqn: string;
  name: string;
  kind: string;
  domain: string;
  subpackage: string | null;
  packageName: string;
  packageVersion: string;
  description: string | null;
  language: string;
  hasIcon: boolean;
  hasDiagram: boolean;
}

export interface RegistryCatalogQueryOptions {
  mode: "components" | "models";
  q?: string | undefined;
  domain?: string | undefined;
  packageName?: string | undefined;
  subpackage?: string | undefined;
  kind?: string | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}

export interface RegistryCatalogQueryResult {
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
  items: RegistryCatalogItem[];
  availablePackages: { name: string; version: string; count: number }[];
  availableSubpackages: { id: string; label: string; count: number }[];
  packageDependencies: Record<string, Record<string, string>>;
}

export interface TrendingTopicRow {
  id: number;
  concept: string;
  location?: string | null | undefined;
  display_name: string;
  current_score: number;
  last_updated_at: string;
  post_count?: number | undefined;
}

export interface JobRow {
  id: number;
  name: string;
  status: string;
  type: string;
  repository_id: number | null;
  trigger_source: string | null;
  metadata: string | null;
  started_at: string;
  completed_at: string | null;
  compute_profile?: string | null | undefined;
  cpu_seconds?: number | null | undefined;
  peak_memory_mb?: number | null | undefined;
  gpu_seconds?: number | null | undefined;
  cost_credits?: number | null | undefined;
  user_id?: number | null | undefined;
}

export interface CreditTransactionRow {
  id: number;
  user_id: number;
  job_id: number | null;
  amount: number;
  balance_after: number;
  type: string;
  transaction_type?: string | undefined;
  description: string;
  metadata?: string | null | undefined;
  created_at: string;
}

export interface TwinRow {
  id: number;
  instance_id: number;
  name: string;
  modelica_class: string;
  status: string; // 'active' | 'degraded' | 'calibrating' | 'archived'
  health_score: number;
  config: string;
  current_parameters: string;
  current_weights: string | null;
  created_at: string;
  last_telemetry_at: string | null;
  last_adapted_at: string | null;
}

export interface TwinAdaptationRow {
  id: number;
  twin_id: number;
  trigger_reason: string;
  prior_parameters: string;
  updated_parameters: string;
  residual_before: number;
  residual_after: number;
  iterations: number;
  created_at: string;
}

export interface TwinProposalRow {
  id: number;
  twin_id: number;
  post_id: string | null;
  adaptation_id: number;
  status: string; // 'open' | 'approved' | 'rejected'
  reviewer_id: number | null;
  review_notes: string | null;
  reviewed_at: string | null;
  created_at: string;
}

export interface UserBillingSummary {
  userId: number;
  creditBalance: number;
  totalSpent: number;
  totalJobs: number;
  totalCpuSeconds: number;
  totalGpuSeconds: number;
  profileUsage: Record<string, { jobsCount: number; costCredits: number; cpuSeconds: number }>;
  recentTransactions: CreditTransactionRow[];
  wallet: {
    balance: number;
    total_spent: number;
    total_jobs_dispatched: number;
    total_cpu_core_hours: number;
    total_gpu_hours: number;
  };
  recent_transactions: CreditTransactionRow[];
  profiles: ComputeProfile[];
}

export interface HpcJobArtifactSummary {
  id: number;
  name: string;
  status: string;
  solver: string;
  computeProfile: string;
  cpuSeconds: number;
  gpuSeconds: number;
  costCredits: number;
  startedAt: string;
  completedAt: string | null;
  hasVtu: boolean;
  hasScalars: boolean;
  scalars?: Record<string, unknown> | undefined;
  resultDir?: string | undefined;
}

export interface JobStepRow {
  id: number;
  job_id: number;
  name: string;
  status: string;
  started_at: string;
  completed_at: string | null;
}

export interface ScriptTemplateRow {
  id: number;
  name: string;
  slug: string;
  description: string;
  category: string;
  icon: string;
  config: string;
  created_at: string;
  updated_at: string;
}

export interface OrganizationRecord {
  id: number;
  slug: string;
  name: string;
  display_name?: string | null | undefined;
  description: string | null;
  website?: string | null | undefined;
  billing_email?: string | null | undefined;
  avatar_url: string | null;
  banner_url?: string | null | undefined;
  location?: string | null | undefined;
  industry_preset?: string | null | undefined;
  is_verified?: number | undefined;
  created_by: number;
  created_at: string;
}

export type OrgRole = "owner" | "maintainer" | "contributor";

export interface OrganizationMemberRecord {
  org_id: number;
  user_id: number;
  username?: string | undefined;
  display_name?: string | null | undefined;
  avatar_url?: string | null | undefined;
  role: OrgRole;
  created_at: string;
}

export type SpaceOwnerType = "user" | "organization";
export type SpaceVisibility = "public" | "unlisted" | "internal" | "private";
export type SpaceRole = "owner" | "lead_engineer" | "approver" | "contributor" | "reviewer" | "viewer";

export interface SpaceRecord {
  id: string;
  slug: string;
  name: string;
  tagline: string | null;
  description: string | null;
  owner_type: SpaceOwnerType;
  user_id: number | null;
  organization_id: number | null;
  owner_namespace: string;
  owner_display_name: string | null;
  owner_avatar_url: string | null;
  domain_preset: string;
  visibility: SpaceVisibility;
  avatar_url: string | null;
  banner_url: string | null;
  default_branch: string;
  git_repo_path: string | null;
  enabled_tabs: string[];
  settings: Record<string, unknown>;
  follower_count: number;
  member_count: number;
  created_at: string;
  updated_at: string;
}

export interface SpaceMemberRecord {
  space_id: string;
  user_id: number;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  role: SpaceRole;
  created_at: string;
}

export interface SpacePageRecord {
  id: string;
  space_id: string;
  slug: string;
  title: string;
  summary: string | null;
  content_markdown: string;
  path_in_git: string;
  parent_id: string | null;
  order_index: number;
  last_commit_sha: string | null;
  author_user_id: number | null;
  author_username?: string | null | undefined;
  is_published: boolean;
  embedded_artifacts: unknown[];
  created_at: string;
  updated_at: string;
}

export type SpaceChannelKind = "text" | "announcement" | "bot_feed" | "telemetry" | "ecr_review";

export interface SpaceChannelRecord {
  id: string;
  space_id: string;
  slug: string;
  name: string;
  topic: string | null;
  kind: SpaceChannelKind;
  position: number;
  is_private: boolean;
  unread_count?: number | undefined;
  unread_mentions_count?: number | undefined;
  created_at: string;
}

export interface SpaceMessageRecord {
  id: string;
  channel_id: string;
  space_id: string;
  author_id: number | null;
  author_username: string | null;
  author_display_name: string | null;
  author_avatar_url: string | null;
  sender_type: "user" | "bot" | "telemetry_hook" | "ci_runner";
  sender_name: string | null;
  content: string;
  reply_to_id: string | null;
  thread_reply_count: number;
  attachments: unknown[];
  embedded_artifacts: unknown[];
  reactions: Record<string, string[]>;
  promoted_target_type: string | null;
  promoted_target_id: string | null;
  created_at: string;
  edited_at: string | null;
}

export interface SpaceEcoProposalRecord {
  id: string;
  space_id: string;
  eco_number: number;
  title: string;
  description: string;
  status: "draft" | "open" | "in_review" | "approved" | "merged" | "rejected";
  severity: "minor" | "standard" | "major" | "safety_critical";
  source_branch: string;
  target_branch: string;
  author_id: number | null;
  author_username: string | null;
  impacted_models: string[];
  simulation_gate_status: "pending" | "running" | "passed" | "failed";
  simulation_summary: Record<string, unknown>;
  promoted_from_msg_id: string | null;
  approvals: SpaceEcoApprovalRecord[];
  created_at: string;
  updated_at: string;
}

export interface SpaceEcoApprovalRecord {
  eco_id: string;
  user_id: number;
  username: string;
  display_name: string | null;
  role: string;
  decision: "approved" | "changes_requested" | "rejected";
  comment: string | null;
  signature_hex: string | null;
  created_at: string;
}

export interface SpaceWorkflowRunRecord {
  id: string;
  space_id: string;
  eco_id: string | null;
  provider: "github" | "gitlab" | "ansatz";
  workflow_file: string;
  workflow_name: string;
  trigger_event: string;
  commit_sha: string | null;
  ref: string | null;
  status: "pending" | "running" | "passed" | "failed" | "cancelled";
  conclusion: string | null;
  started_at: string;
  completed_at: string | null;
  duration_ms: number;
  jobs: unknown[];
  artifacts: unknown[];
  summary: Record<string, unknown>;
  logs: string;
}

export interface SpaceIssueRecord {
  id: string;
  space_id: string;
  issue_number: number;
  title: string;
  description: string;
  status: "open" | "closed";
  severity: "minor" | "standard" | "major" | "safety_critical";
  author_id: number | null;
  author_username: string | null;
  impacted_models: string[];
  labels: string[];
  linked_pr_number: number | null;
  closed_at: string | null;
  external_source?: "jira" | "github" | "gitlab" | "polarion" | null | undefined;
  external_key?: string | null | undefined;
  external_url?: string | null | undefined;
  external_updated_at?: string | null | undefined;
  sync_status?: "synced" | "pending_push" | "conflict" | undefined;
  comments?: SpaceIssueCommentRecord[];
  created_at: string;
  updated_at: string;
}

export interface SpaceIssueCommentRecord {
  id: string;
  issue_id: string;
  user_id: number;
  username: string;
  display_name: string | null;
  content: string;
  created_at: string;
}

export type CollaboratorPermission = "admin" | "write" | "read";

export interface PackageCollaboratorRecord {
  library_name: string;
  user_id: number;
  username?: string | undefined;
  permission: CollaboratorPermission;
  created_at: string;
}

export interface RepoWebhookRecord {
  id: number;
  repo_id: number;
  provider: "github" | "gitlab" | "local" | "custom";
  secret: string;
  events: string;
  auto_publish: number;
  tag_pattern: string;
  is_active: number;
  created_at: string;
}

export interface WebhookDeliveryRecord {
  id: number;
  webhook_id: number;
  event_type: string;
  payload: string;
  response_status: number | null;
  error_message: string | null;
  delivered_at: string;
}

export interface RawAccountWarningRow {
  id: number;
  target_user_id: number;
  actor_id: number | null;
  action: AccountWarningRow["action"];
  text: string;
  report_id: number | null;
  rule_ids: string | number[];
  post_ids: string | number[];
  acknowledged_at: string | null;
  created_at: string;
  actor_username?: string | null;
  target_username?: string | null;
}

export interface RawContentFilterRow {
  id: number;
  user_id: number | null;
  title: string;
  context: string | ContentFilterRow["context"];
  filter_action: ContentFilterRow["filter_action"];
  keywords_json: string;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ApiTokenRecord {
  id: number;
  user_id: number;
  name: string;
  token_prefix: string;
  token_hash: string;
  scopes: string[];
  package_pattern: string;
  ip_allowlist?: string | null | undefined;
  expires_at: string | null;
  last_used_at: string | null;
  last_used_ip: string | null;
  created_at: string;
}

export interface ThreadConflictRecord {
  conflictId: string;
  workspaceId: string;
  slot: number;
  sourceDomain: string;
  sourceValue: number;
  sourceUnit: string;
  targetDomain: string;
  targetValue: number;
  targetUnit: string;
  min: number;
  max: number;
  status: "conflicted" | "resolved";
  resolvedValue: number | null;
  updatedAt: string;
}

export interface ThreadProposal {
  id: number;
  thread_id: string;
  title: string;
  description: string | null;
  status: "open" | "approved" | "rejected" | "applied";
  proposed_by: string;
  diff_summary: string;
  created_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
  review_comment: string | null;
}

export interface ThreadAuditLogEntry {
  id: number;
  thread_id: string;
  proposal_id: number | null;
  action: string;
  actor: string;
  safety_standard: string | null;
  checksum: string;
  metadata: string | null;
  created_at: string;
}
