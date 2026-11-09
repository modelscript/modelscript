// SPDX-License-Identifier: AGPL-3.0-or-later

import { api } from "./client";
import type { Organization, OrganizationMember, OrgRole } from "./organizations";
import type { GitlabBranch, GitlabCommit, GitlabTreeNode } from "./vcs";

export type SpaceOwnerType = "user" | "organization";
export type SpaceVisibility = "public" | "unlisted" | "internal" | "private";
export type SpaceRole = "owner" | "lead_engineer" | "approver" | "contributor" | "reviewer" | "viewer";
export type SpaceChannelKind = "text" | "announcement" | "bot_feed" | "telemetry" | "ecr_review";

export interface SpaceDomainPreset {
  id: string;
  name: string;
  shortLabel: string;
  icon: string;
  accentColor: string;
  description: string;
  replacesTools: string[];
  complianceStandards: string[];
  languages: string[];
  enabledTabs: string[];
  sampleCodeSnippet: {
    language: string;
    title: string;
    code: string;
  };
}

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
  author_username?: string | null;
  is_published: boolean;
  embedded_artifacts: unknown[];
  created_at: string;
  updated_at: string;
}

export interface SpaceChannelRecord {
  id: string;
  space_id: string;
  slug: string;
  name: string;
  topic: string | null;
  kind: SpaceChannelKind;
  position: number;
  is_private: boolean;
  unread_count?: number;
  unread_mentions_count?: number;
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

export interface SpaceChatSidebarItem extends SpaceRecord {
  member_role: SpaceRole;
  channels: SpaceChannelRecord[];
  total_unread: number;
  total_mentions: number;
}

export interface SpaceDetailResponse {
  space: SpaceRecord;
  preset: SpaceDomainPreset;
  channels: SpaceChannelRecord[];
  pages: SpacePageRecord[];
  members: SpaceMemberRecord[];
  ecos: SpaceEcoProposalRecord[];
  issues?: SpaceIssueRecord[];
  viewerState: {
    isFollowing: boolean;
    role: SpaceRole | null;
    canWrite: boolean;
    canAdmin: boolean;
  };
}

export type ResolvedNamespacePrincipal =
  | {
      kind: "organization";
      organization: Organization & {
        banner_url?: string | null;
        location?: string | null;
        industry_preset?: string | null;
        is_verified?: number;
      };
      spaces: SpaceRecord[];
      members: OrganizationMember[];
      viewerRole: OrgRole | null;
    }
  | {
      kind: "user";
      user: {
        id: number;
        username: string;
        display_name: string | null;
        bio: string | null;
        avatar_url: string | null;
        banner_url: string | null;
        location: string | null;
        website: string | null;
        created_at: string;
      };
      spaces: SpaceRecord[];
    };

export const getSpaceDomainPresets = async (): Promise<SpaceDomainPreset[]> => {
  const { data } = await api.get<{ presets: SpaceDomainPreset[] }>("/spaces/presets");
  return data.presets || [];
};

export const getMySpacesAndChatTree = async (): Promise<{
  spaces: SpaceChatSidebarItem[];
  organizations: Organization[];
}> => {
  const { data } = await api.get<{
    spaces: SpaceChatSidebarItem[];
    organizations: Organization[];
  }>("/spaces/my");
  return {
    spaces: data.spaces || [],
    organizations: data.organizations || [],
  };
};

export const resolveNamespacePrincipal = async (slug: string): Promise<ResolvedNamespacePrincipal> => {
  const clean = slug.replace(/^@/, "");
  const { data } = await api.get<ResolvedNamespacePrincipal>(`/spaces/resolve-namespace/${encodeURIComponent(clean)}`);
  return data;
};

export const listSpaces = async (params?: {
  ownerType?: SpaceOwnerType;
  namespace?: string;
  domainPreset?: string;
  search?: string;
  limit?: number;
}): Promise<SpaceRecord[]> => {
  const { data } = await api.get<{ spaces: SpaceRecord[] }>("/spaces", { params });
  return data.spaces || [];
};

export const createSpace = async (payload: {
  slug: string;
  name: string;
  tagline?: string;
  description?: string;
  ownerType: SpaceOwnerType;
  organizationId?: number;
  organizationSlug?: string;
  domainPreset?: string;
  visibility?: SpaceVisibility;
  avatarUrl?: string;
  bannerUrl?: string;
  defaultBranch?: string;
}): Promise<{
  space: SpaceRecord;
  channels: SpaceChannelRecord[];
  pages: SpacePageRecord[];
  ecos: SpaceEcoProposalRecord[];
}> => {
  const { data } = await api.post("/spaces", payload);
  return data;
};

export const getSpaceDetail = async (namespace: string, slug: string): Promise<SpaceDetailResponse> => {
  const cleanNs = namespace.replace(/^@/, "");
  const { data } = await api.get<SpaceDetailResponse>(
    `/spaces/${encodeURIComponent(cleanNs)}/${encodeURIComponent(slug)}`,
  );
  return data;
};

export const updateSpace = async (
  namespace: string,
  slug: string,
  payload: Partial<{
    name: string;
    tagline: string | null;
    description: string | null;
    domainPreset: string;
    visibility: SpaceVisibility;
    avatarUrl: string | null;
    bannerUrl: string | null;
    defaultBranch: string;
    enabledTabs: string[];
  }>,
): Promise<SpaceRecord> => {
  const cleanNs = namespace.replace(/^@/, "");
  const { data } = await api.patch<{ space: SpaceRecord }>(
    `/spaces/${encodeURIComponent(cleanNs)}/${encodeURIComponent(slug)}`,
    payload,
  );
  return data.space;
};

export const transferSpace = async (
  namespace: string,
  slug: string,
  payload: { targetOwnerType: SpaceOwnerType; targetSlug: string; newSlug?: string },
): Promise<SpaceRecord> => {
  const cleanNs = namespace.replace(/^@/, "");
  const { data } = await api.post<{ space: SpaceRecord }>(
    `/spaces/${encodeURIComponent(cleanNs)}/${encodeURIComponent(slug)}/transfer`,
    payload,
  );
  return data.space;
};

export const deleteSpace = async (namespace: string, slug: string): Promise<void> => {
  const cleanNs = namespace.replace(/^@/, "");
  await api.delete(`/spaces/${encodeURIComponent(cleanNs)}/${encodeURIComponent(slug)}`);
};

export const followSpace = async (
  namespace: string,
  slug: string,
): Promise<{ isFollowing: boolean; followerCount: number }> => {
  const cleanNs = namespace.replace(/^@/, "");
  const { data } = await api.post(`/spaces/${encodeURIComponent(cleanNs)}/${encodeURIComponent(slug)}/follow`);
  return data;
};

export const unfollowSpace = async (
  namespace: string,
  slug: string,
): Promise<{ isFollowing: boolean; followerCount: number }> => {
  const cleanNs = namespace.replace(/^@/, "");
  const { data } = await api.delete(`/spaces/${encodeURIComponent(cleanNs)}/${encodeURIComponent(slug)}/follow`);
  return data;
};

export const addSpaceMember = async (
  namespace: string,
  slug: string,
  username: string,
  role: SpaceRole = "contributor",
): Promise<SpaceMemberRecord[]> => {
  const cleanNs = namespace.replace(/^@/, "");
  const { data } = await api.post<{ members: SpaceMemberRecord[] }>(
    `/spaces/${encodeURIComponent(cleanNs)}/${encodeURIComponent(slug)}/members`,
    { username, role },
  );
  return data.members || [];
};

export const removeSpaceMember = async (
  namespace: string,
  slug: string,
  userId: number,
): Promise<SpaceMemberRecord[]> => {
  const cleanNs = namespace.replace(/^@/, "");
  const { data } = await api.delete<{ members: SpaceMemberRecord[] }>(
    `/spaces/${encodeURIComponent(cleanNs)}/${encodeURIComponent(slug)}/members/${userId}`,
  );
  return data.members || [];
};

export const upsertSpaceDoc = async (
  namespace: string,
  slug: string,
  payload: {
    slug: string;
    title: string;
    summary?: string;
    contentMarkdown: string;
    parentId?: string | null;
    orderIndex?: number;
  },
): Promise<{ page: SpacePageRecord; pages: SpacePageRecord[] }> => {
  const cleanNs = namespace.replace(/^@/, "");
  const { data } = await api.post(`/spaces/${encodeURIComponent(cleanNs)}/${encodeURIComponent(slug)}/docs`, payload);
  return data;
};

export const deleteSpaceDoc = async (namespace: string, slug: string, docSlug: string): Promise<SpacePageRecord[]> => {
  const cleanNs = namespace.replace(/^@/, "");
  const { data } = await api.delete<{ pages: SpacePageRecord[] }>(
    `/spaces/${encodeURIComponent(cleanNs)}/${encodeURIComponent(slug)}/docs/${encodeURIComponent(docSlug)}`,
  );
  return data.pages || [];
};

export const createSpaceChannel = async (
  namespace: string,
  slug: string,
  payload: { slug: string; name: string; topic?: string; kind?: SpaceChannelKind },
): Promise<{ channel: SpaceChannelRecord; channels: SpaceChannelRecord[] }> => {
  const cleanNs = namespace.replace(/^@/, "");
  const { data } = await api.post(
    `/spaces/${encodeURIComponent(cleanNs)}/${encodeURIComponent(slug)}/channels`,
    payload,
  );
  return data;
};

export const getSpaceChannelMessages = async (
  namespace: string,
  slug: string,
  channelSlug: string,
  parentMessageId?: string,
): Promise<{ channel: SpaceChannelRecord; messages: SpaceMessageRecord[] }> => {
  const cleanNs = namespace.replace(/^@/, "");
  const { data } = await api.get(
    `/spaces/${encodeURIComponent(cleanNs)}/${encodeURIComponent(slug)}/channels/${encodeURIComponent(channelSlug)}/messages`,
    { params: parentMessageId ? { parentMessageId } : undefined },
  );
  return data;
};

export const sendSpaceChannelMessage = async (
  namespace: string,
  slug: string,
  channelSlug: string,
  payload: { content: string; replyToId?: string | null },
): Promise<{ message: SpaceMessageRecord; botReply?: SpaceMessageRecord | null }> => {
  const cleanNs = namespace.replace(/^@/, "");
  const { data } = await api.post(
    `/spaces/${encodeURIComponent(cleanNs)}/${encodeURIComponent(slug)}/channels/${encodeURIComponent(channelSlug)}/messages`,
    payload,
  );
  return data;
};

export const toggleSpaceMessageReaction = async (
  namespace: string,
  slug: string,
  channelSlug: string,
  messageId: string,
  emoji: string,
): Promise<SpaceMessageRecord> => {
  const cleanNs = namespace.replace(/^@/, "");
  const { data } = await api.post<{ message: SpaceMessageRecord }>(
    `/spaces/${encodeURIComponent(cleanNs)}/${encodeURIComponent(slug)}/channels/${encodeURIComponent(channelSlug)}/messages/${encodeURIComponent(messageId)}/reactions`,
    { emoji },
  );
  return data.message;
};

export const promoteSpaceMessage = async (
  namespace: string,
  slug: string,
  channelSlug: string,
  messageId: string,
  targetType: "doc" | "eco",
  title?: string,
): Promise<{ message: SpaceMessageRecord; doc?: SpacePageRecord; eco?: SpaceEcoProposalRecord }> => {
  const cleanNs = namespace.replace(/^@/, "");
  const { data } = await api.post(
    `/spaces/${encodeURIComponent(cleanNs)}/${encodeURIComponent(slug)}/channels/${encodeURIComponent(channelSlug)}/messages/${encodeURIComponent(messageId)}/promote`,
    { targetType, title },
  );
  return data;
};

export const createSpaceEco = async (
  namespace: string,
  slug: string,
  payload: {
    title: string;
    description: string;
    severity?: "minor" | "standard" | "major" | "safety_critical";
    sourceBranch?: string;
    targetBranch?: string;
    impactedModels?: string[];
  },
): Promise<{ eco: SpaceEcoProposalRecord; ecos: SpaceEcoProposalRecord[] }> => {
  const cleanNs = namespace.replace(/^@/, "");
  const { data } = await api.post(`/spaces/${encodeURIComponent(cleanNs)}/${encodeURIComponent(slug)}/ecos`, payload);
  return data;
};

export interface SpaceEcoReviewPayload {
  decision: "approved" | "changes_requested" | "rejected";
  role?: string | undefined;
  intent?: string | undefined;
  password?: string | undefined;
  comment?: string | null | undefined;
  signatureHex?: string | undefined;
}

export const reviewSpaceEco = async (
  namespace: string,
  slug: string,
  ecoId: string,
  decisionOrPayload: "approved" | "changes_requested" | "rejected" | SpaceEcoReviewPayload,
  comment?: string,
): Promise<{ eco: SpaceEcoProposalRecord; ecos: SpaceEcoProposalRecord[] }> => {
  const cleanNs = namespace.replace(/^@/, "");
  const payload = typeof decisionOrPayload === "string" ? { decision: decisionOrPayload, comment } : decisionOrPayload;

  const { data } = await api.post(
    `/spaces/${encodeURIComponent(cleanNs)}/${encodeURIComponent(slug)}/ecos/${encodeURIComponent(ecoId)}/review`,
    payload,
  );
  return data;
};

export interface SpaceEcoDiffFile {
  filename: string;
  language: string;
  oldContent: string;
  newContent: string;
  additions: number;
  deletions: number;
  status: "modified" | "added" | "deleted";
}

export interface SpaceEcoDiffResult {
  sourceBranch: string;
  targetBranch: string;
  files: SpaceEcoDiffFile[];
  totalAdditions: number;
  totalDeletions: number;
}

export interface SpaceEcoTrajectoryPoint {
  time: number;
  baseline: number;
  branch: number;
  upperTolerance: number;
  lowerTolerance: number;
}

export interface SpaceEcoSimCheck {
  name: string;
  status: "passed" | "failed";
  value: string;
  limit: string;
  margin: string;
}

export interface SpaceEcoSimulationResult {
  gateStatus: SpaceEcoProposalRecord["simulation_gate_status"];
  checkedAt: string;
  solver: string;
  tolerance: number;
  maxRelError: number;
  variablesCount: number;
  equationsCount: number;
  trajectories: SpaceEcoTrajectoryPoint[];
  checks: SpaceEcoSimCheck[];
}

export interface SpaceEcoImpactResult {
  directModels: string[];
  downstreamDependencies: { model: string; dependencyType: string; path: string }[];
  allocatedRequirements: { reqId: string; title: string; standard: string; status: "satisfied" | "violated" }[];
  riskScore: "low" | "medium" | "high" | "safety_critical";
}

export const getSpaceEcoDiff = async (namespace: string, slug: string, ecoId: string): Promise<SpaceEcoDiffResult> => {
  const cleanNs = namespace.replace(/^@/, "");
  const { data } = await api.get<{ diff: SpaceEcoDiffResult }>(
    `/spaces/${encodeURIComponent(cleanNs)}/${encodeURIComponent(slug)}/ecos/${encodeURIComponent(ecoId)}/diff`,
  );
  return data.diff;
};

export const getSpaceEcoSimulation = async (
  namespace: string,
  slug: string,
  ecoId: string,
): Promise<SpaceEcoSimulationResult> => {
  const cleanNs = namespace.replace(/^@/, "");
  const { data } = await api.get<{ simulation: SpaceEcoSimulationResult }>(
    `/spaces/${encodeURIComponent(cleanNs)}/${encodeURIComponent(slug)}/ecos/${encodeURIComponent(ecoId)}/simulation`,
  );
  return data.simulation;
};

export const simulateSpaceEco = async (
  namespace: string,
  slug: string,
  ecoId: string,
): Promise<{ eco: SpaceEcoProposalRecord; simulation: SpaceEcoSimulationResult; ecos: SpaceEcoProposalRecord[] }> => {
  const cleanNs = namespace.replace(/^@/, "");
  const { data } = await api.post(
    `/spaces/${encodeURIComponent(cleanNs)}/${encodeURIComponent(slug)}/ecos/${encodeURIComponent(ecoId)}/simulate`,
  );
  return data;
};

export const getSpaceEcoImpact = async (
  namespace: string,
  slug: string,
  ecoId: string,
): Promise<SpaceEcoImpactResult> => {
  const cleanNs = namespace.replace(/^@/, "");
  const { data } = await api.get<{ impact: SpaceEcoImpactResult }>(
    `/spaces/${encodeURIComponent(cleanNs)}/${encodeURIComponent(slug)}/ecos/${encodeURIComponent(ecoId)}/impact`,
  );
  return data.impact;
};

export const getSpaceEcoBlastRadius = getSpaceEcoImpact;
export type SpaceEcoBlastRadiusResult = SpaceEcoImpactResult;

export interface SpaceEcoBomPart {
  partNumber: string;
  name: string;
  category: string;
  changeStatus: "added" | "removed" | "modified" | "unchanged";
  baselineQuantity: number;
  targetQuantity: number;
  unitCostUsd: number;
  massKg: number;
  packageDependency?: string | undefined;
  variantOverrides?: Record<string, unknown> | undefined;
}

export interface SpaceEcoBomResult {
  sourceBranch: string;
  targetBranch: string;
  summary: {
    totalPartsDelta: number;
    massDeltaKg: number;
    costDeltaUsd: number;
    carbonDeltaKgCo2: number;
  };
  parts: SpaceEcoBomPart[];
}

export const getSpaceEcoBom = async (namespace: string, slug: string, ecoId: string): Promise<SpaceEcoBomResult> => {
  const cleanNs = namespace.replace(/^@/, "");
  const { data } = await api.get<{ bom: SpaceEcoBomResult }>(
    `/spaces/${encodeURIComponent(cleanNs)}/${encodeURIComponent(slug)}/ecos/${encodeURIComponent(ecoId)}/bom`,
  );
  return data.bom;
};

export interface SpaceEcoMergeResult {
  eco: SpaceEcoProposalRecord;
  ecos: SpaceEcoProposalRecord[];
  releaseTag: string;
  commitSha: string;
  aasxPackage: {
    filename: string;
    assetId: string;
    version: string;
    submodels: string[];
  };
  ddpContainer: {
    filename: string;
    standard: string;
    manifestChecksum: string;
  };
}

export const mergeSpaceEco = async (namespace: string, slug: string, ecoId: string): Promise<SpaceEcoMergeResult> => {
  const cleanNs = namespace.replace(/^@/, "");
  const { data } = await api.post<SpaceEcoMergeResult>(
    `/spaces/${encodeURIComponent(cleanNs)}/${encodeURIComponent(slug)}/ecos/${encodeURIComponent(ecoId)}/merge`,
  );
  return data;
};

export const autocompleteSpaceEntities = async (
  namespace: string,
  slug: string,
  q: string,
): Promise<
  {
    kind: "doc" | "channel" | "eco" | "member";
    id: string;
    label: string;
    reference: string;
    subtitle: string;
  }[]
> => {
  const cleanNs = namespace.replace(/^@/, "");
  const { data } = await api.get(`/spaces/${encodeURIComponent(cleanNs)}/${encodeURIComponent(slug)}/autocomplete`, {
    params: { q },
  });
  return data.suggestions || [];
};

export const getSpaceTree = async (
  namespace: string,
  slug: string,
  ref = "main",
  path = "",
  recursive = false,
): Promise<GitlabTreeNode[]> => {
  const cleanNs = namespace.replace(/^@/, "");
  const { data } = await api.get<{ tree: GitlabTreeNode[] }>(
    `/spaces/${encodeURIComponent(cleanNs)}/${encodeURIComponent(slug)}/tree`,
    { params: { ref, path, recursive: recursive ? "true" : undefined } },
  );
  return data.tree || [];
};

export const getSpaceFileRaw = async (
  namespace: string,
  slug: string,
  filePath: string,
  ref = "main",
): Promise<string> => {
  const cleanNs = namespace.replace(/^@/, "");
  const { data } = await api.get<string>(
    `/spaces/${encodeURIComponent(cleanNs)}/${encodeURIComponent(slug)}/files/raw`,
    { params: { path: filePath, ref }, responseType: "text" },
  );
  return typeof data === "string" ? data : String(data ?? "");
};

export const getSpaceCommits = async (namespace: string, slug: string, ref = "main"): Promise<GitlabCommit[]> => {
  const cleanNs = namespace.replace(/^@/, "");
  const { data } = await api.get<{ commits: GitlabCommit[] }>(
    `/spaces/${encodeURIComponent(cleanNs)}/${encodeURIComponent(slug)}/commits`,
    { params: { ref } },
  );
  return data.commits || [];
};

export const getSpaceBranches = async (namespace: string, slug: string): Promise<GitlabBranch[]> => {
  const cleanNs = namespace.replace(/^@/, "");
  const { data } = await api.get<{ branches: GitlabBranch[] }>(
    `/spaces/${encodeURIComponent(cleanNs)}/${encodeURIComponent(slug)}/branches`,
  );
  return data.branches || [];
};

export const initSpaceTemplate = async (
  namespace: string,
  slug: string,
): Promise<{ ok: boolean; commitSha?: string; branch?: string }> => {
  const cleanNs = namespace.replace(/^@/, "");
  const { data } = await api.post<{ ok: boolean; commitSha?: string; branch?: string }>(
    `/spaces/${encodeURIComponent(cleanNs)}/${encodeURIComponent(slug)}/init-template`,
  );
  return data;
};

// ── Space Problem Reports & Engineering Issues (ECR) ────────────────────────

export const getSpaceIssues = async (namespace: string, slug: string): Promise<SpaceIssueRecord[]> => {
  const cleanNs = namespace.replace(/^@/, "");
  const { data } = await api.get<{ issues: SpaceIssueRecord[] }>(
    `/spaces/${encodeURIComponent(cleanNs)}/${encodeURIComponent(slug)}/issues`,
  );
  return data.issues || [];
};

export const getSpaceIssueDetail = async (
  namespace: string,
  slug: string,
  issueId: string,
): Promise<SpaceIssueRecord & { comments: SpaceIssueCommentRecord[] }> => {
  const cleanNs = namespace.replace(/^@/, "");
  const { data } = await api.get<{ issue: SpaceIssueRecord & { comments: SpaceIssueCommentRecord[] } }>(
    `/spaces/${encodeURIComponent(cleanNs)}/${encodeURIComponent(slug)}/issues/${encodeURIComponent(issueId)}`,
  );
  return data.issue;
};

export const createSpaceIssue = async (
  namespace: string,
  slug: string,
  payload: {
    title: string;
    description?: string;
    severity?: SpaceIssueRecord["severity"];
    impactedModels?: string[];
    labels?: string[];
    linkedPrNumber?: number | null;
  },
): Promise<{ issue: SpaceIssueRecord; issues: SpaceIssueRecord[] }> => {
  const cleanNs = namespace.replace(/^@/, "");
  const { data } = await api.post<{ issue: SpaceIssueRecord; issues: SpaceIssueRecord[] }>(
    `/spaces/${encodeURIComponent(cleanNs)}/${encodeURIComponent(slug)}/issues`,
    payload,
  );
  return data;
};

export const updateSpaceIssue = async (
  namespace: string,
  slug: string,
  issueId: string,
  payload: {
    status?: "open" | "closed";
    title?: string;
    description?: string;
    severity?: SpaceIssueRecord["severity"];
    linkedPrNumber?: number | null;
  },
): Promise<{ issue: SpaceIssueRecord; issues: SpaceIssueRecord[] }> => {
  const cleanNs = namespace.replace(/^@/, "");
  const { data } = await api.patch<{ issue: SpaceIssueRecord; issues: SpaceIssueRecord[] }>(
    `/spaces/${encodeURIComponent(cleanNs)}/${encodeURIComponent(slug)}/issues/${encodeURIComponent(issueId)}`,
    payload,
  );
  return data;
};

export const addSpaceIssueComment = async (
  namespace: string,
  slug: string,
  issueId: string,
  content: string,
): Promise<{ comment: SpaceIssueCommentRecord; issue: SpaceIssueRecord & { comments: SpaceIssueCommentRecord[] } }> => {
  const cleanNs = namespace.replace(/^@/, "");
  const { data } = await api.post<{
    comment: SpaceIssueCommentRecord;
    issue: SpaceIssueRecord & { comments: SpaceIssueCommentRecord[] };
  }>(
    `/spaces/${encodeURIComponent(cleanNs)}/${encodeURIComponent(slug)}/issues/${encodeURIComponent(issueId)}/comments`,
    { content },
  );
  return data;
};
