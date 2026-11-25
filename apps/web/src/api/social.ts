// SPDX-License-Identifier: AGPL-3.0-or-later

import { api } from "./client";

export interface UserAboutData {
  username: string;
  displayName: string;
  avatarUrl?: string | null;
  accountType: string;
  createdAt: string;
  joinedAt: string;
  basedIn: {
    countryCode: string | null;
    countryName: string | null;
    regionCode?: string | null;
    lastUpdated?: string | null;
  } | null;
  usernameChanges: {
    count: number;
    lastChangedAt: string | null;
    history: {
      oldUsername: string;
      newUsername: string;
      changedAt: string;
    }[];
  };
  isVerified?: boolean;
  signing_verified?: boolean;
  isBlocked?: boolean;
  isBlockedBy?: boolean;
}

export const getUserAbout = async (username: string): Promise<UserAboutData> => {
  const { data } = await api.get(`/users/${encodeURIComponent(username)}/about`);
  return data;
};

export interface SocialMutationResponse {
  success?: boolean | undefined;
  message?: string | undefined;
  following?: boolean | undefined;
  blocked?: boolean | undefined;
  muted?: boolean | undefined;
  follower_count?: number | undefined;
  following_count?: number | undefined;
  [key: string]: unknown;
}

export interface SocialUserRecord {
  id: number | string;
  username: string;
  display_name?: string | null | undefined;
  bio?: string | null | undefined;
  email?: string | null | undefined;
  avatar_url?: string | null | undefined;
  banner_url?: string | null | undefined;
  account_type?: string | undefined;
  location?: string | null | undefined;
  website?: string | null | undefined;
  affiliation?: string | null | undefined;
  orcid?: string | null | undefined;
  is_verified?: boolean | number | undefined;
  signing_verified?: boolean | number | undefined;
  is_following?: boolean | undefined;
  is_followed_by?: boolean | undefined;
  is_blocked?: boolean | undefined;
  is_muted?: boolean | undefined;
  follower_count?: number | undefined;
  followers_count?: number | undefined;
  following_count?: number | undefined;
  post_count?: number | undefined;
  posts_count?: number | undefined;
  created_at?: string | undefined;
  [key: string]: unknown;
}

export interface SocialPostRecord {
  id: number | string;
  id_str?: string | undefined;
  author_id?: number | undefined;
  user_id?: number | undefined;
  username: string;
  display_name?: string | null | undefined;
  avatar_url?: string | null | undefined;
  account_type?: string | undefined;
  signing_verified?: boolean | number | undefined;
  content: string;
  title?: string | null | undefined;
  artifact_id?: number | string | null | undefined;
  artifact_view_id?: number | string | null | undefined;
  reply_to_id?: number | string | null | undefined;
  repost_of_id?: number | string | null | undefined;
  quote_of_id?: number | string | null | undefined;
  created_at: string;
  updated_at?: string | undefined;
  like_count?: number | undefined;
  likes_count?: number | undefined;
  reply_count?: number | undefined;
  replies_count?: number | undefined;
  repost_count?: number | undefined;
  reposts_count?: number | undefined;
  quote_count?: number | undefined;
  view_count?: number | undefined;
  liked?: boolean | undefined;
  is_liked?: boolean | undefined;
  reposted?: boolean | undefined;
  is_reposted?: boolean | undefined;
  bookmarked?: boolean | undefined;
  is_bookmarked?: boolean | undefined;
  metadata?: Record<string, unknown> | null | undefined;
  [key: string]: unknown;
}

export interface SocialPostRevisionRecord {
  id?: number | string | undefined;
  rev?: number | undefined;
  revision?: number | undefined;
  content: string;
  title?: string | null | undefined;
  edit_reason?: string | null | undefined;
  created_at: string;
  [key: string]: unknown;
}

export interface SocialNotificationRecord {
  id: number | string;
  type: string;
  category?: string | undefined;
  read?: boolean | number | undefined;
  is_read?: boolean | number | undefined;
  archived?: boolean | number | undefined;
  starred?: boolean | number | undefined;
  actor_username?: string | undefined;
  actor_display_name?: string | undefined;
  actor_avatar_url?: string | null | undefined;
  post_id?: number | string | null | undefined;
  message?: string | undefined;
  created_at: string;
  metadata?: Record<string, unknown> | string | null | undefined;
  [key: string]: unknown;
}

export interface SocialFeedRecord {
  id: number | string;
  name?: string | undefined;
  title?: string | undefined;
  url: string;
  description?: string | null | undefined;
  subscribed?: boolean | undefined;
  subscriber_count?: number | undefined;
  [key: string]: unknown;
}

export interface SocialTopicRecord {
  tag?: string | undefined;
  topic?: string | undefined;
  name?: string | undefined;
  count?: number | undefined;
  post_count?: number | undefined;
  posts_count?: number | undefined;
  [key: string]: unknown;
}

export interface SocialRepoRecord {
  id: number | string;
  name: string;
  namespace?: string | undefined;
  project?: string | undefined;
  provider?: string | undefined;
  description?: string | null | undefined;
  avatar_url?: string | null | undefined;
  default_branch?: string | undefined;
  is_private?: boolean | number | undefined;
  star_count?: number | undefined;
  stars_count?: number | undefined;
  stargazers_count?: number | undefined;
  fork_count?: number | undefined;
  created_at?: string | undefined;
  updated_at?: string | undefined;
  [key: string]: unknown;
}

export interface RepoWebhookRecord {
  id: number;
  url: string;
  events?: string[] | string | undefined;
  active?: boolean | number | undefined;
  secret?: string | undefined;
  created_at?: string | undefined;
  [key: string]: unknown;
}

export interface SearchCompletionItem {
  id?: string | number | undefined;
  type?: string | undefined;
  label?: string | undefined;
  value?: string | undefined;
  username?: string | undefined;
  display_name?: string | undefined;
  name?: string | undefined;
  tag?: string | undefined;
  [key: string]: unknown;
}

export const getUserProfile = async (
  username: string,
): Promise<SocialUserRecord & { user?: SocialUserRecord | undefined }> => {
  const { data } = await api.get(`/users/${encodeURIComponent(username)}`);
  return data;
};

export const followUser = async (username: string): Promise<SocialMutationResponse> => {
  const { data } = await api.post(`/users/${encodeURIComponent(username)}/follow`);
  return data;
};

export const unfollowUser = async (username: string): Promise<SocialMutationResponse> => {
  const { data } = await api.delete(`/users/${encodeURIComponent(username)}/follow`);
  return data;
};

export const blockUser = async (username: string): Promise<SocialMutationResponse> => {
  const { data } = await api.post(`/users/${encodeURIComponent(username)}/block`);
  return data;
};

export const unblockUser = async (username: string): Promise<SocialMutationResponse> => {
  const { data } = await api.delete(`/users/${encodeURIComponent(username)}/block`);
  return data;
};

export const muteUser = async (username: string): Promise<SocialMutationResponse> => {
  const { data } = await api.post(`/users/${encodeURIComponent(username)}/mute`);
  return data;
};

export const unmuteUser = async (username: string): Promise<SocialMutationResponse> => {
  const { data } = await api.delete(`/users/${encodeURIComponent(username)}/mute`);
  return data;
};

const notifyAdminReportCreated = () => {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("modelscript:admin-overview-update"));
  }
};

export const reportUser = async (
  username: string,
  reason?: string,
  details?: string,
): Promise<SocialMutationResponse> => {
  const { data } = await api.post(`/users/${encodeURIComponent(username)}/report`, {
    reason,
    ...(details !== undefined ? { details } : {}),
  });
  notifyAdminReportCreated();
  return data;
};

export const reportPost = async (
  postId: string | number,
  reason: string,
  details?: string,
  forwardFederatedFlag?: boolean,
): Promise<{
  success: boolean;
  reportId: number;
  status: string;
  federatedFlagQueued?: boolean | undefined;
  message?: string | undefined;
}> => {
  const { data } = await api.post(`/social/posts/${postId}/report`, {
    reason,
    ...(details !== undefined ? { details } : {}),
    ...(forwardFederatedFlag !== undefined ? { forwardFederatedFlag } : {}),
  });
  notifyAdminReportCreated();
  return data;
};

export const reportResource = async (
  targetType: "package" | "repo" | "post" | "user",
  targetResourceId: string,
  reason: string,
  details?: string,
): Promise<{ success: boolean; reportId: number; status: string; targetType: string }> => {
  const { data } = await api.post("/social/reports", {
    targetType,
    targetResourceId,
    reason,
    ...(details !== undefined ? { details } : {}),
  });
  notifyAdminReportCreated();
  return data;
};

export const submitModerationAppeal = async (
  reason: string,
  details?: string,
  postId?: number,
): Promise<{ success: boolean; appealId: number; reportId: number; status: string; message?: string | undefined }> => {
  const { data } = await api.post("/users/me/appeals", {
    reason,
    ...(details !== undefined ? { details } : {}),
    ...(postId !== undefined ? { postId } : {}),
  });
  notifyAdminReportCreated();
  return data;
};

export const updateUserProfile = async (
  profileData: Record<string, unknown>,
): Promise<{ user?: SocialUserRecord | undefined; [key: string]: unknown }> => {
  const { data } = await api.put("/users/me", profileData);
  return data;
};

export const getUserFollowers = async (username: string): Promise<{ followers: SocialUserRecord[] }> => {
  const { data } = await api.get(`/users/${encodeURIComponent(username)}/followers`);
  return data;
};

export const getUserFollowing = async (username: string): Promise<{ following: SocialUserRecord[] }> => {
  const { data } = await api.get(`/users/${encodeURIComponent(username)}/following`);
  return data;
};

export const getUserSuggestions = async (limit = 4): Promise<{ suggestions: SocialUserRecord[] }> => {
  const { data } = await api.get("/users/suggestions", { params: { limit } });
  return data;
};

export const getUserPosts = async (
  username: string,
  type?: "posts" | "replies" | "reposts" | "artifacts" | "articles",
  limit?: number,
): Promise<{ posts: SocialPostRecord[] }> => {
  const params: Record<string, string | number> = {};
  if (type) params["type"] = type;
  if (limit !== undefined) params["limit"] = limit;
  const { data } = await api.get(`/social/users/${encodeURIComponent(username)}/posts`, {
    params: Object.keys(params).length > 0 ? params : undefined,
  });
  return data;
};

export const getTimeline = async (options?: {
  following?: boolean | undefined;
  federated?: boolean | undefined;
  sort?: string | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
  artifactType?: string | undefined;
  tag?: string | undefined;
}): Promise<{ posts: SocialPostRecord[] }> => {
  const endpoint = options?.federated
    ? "/social/timeline/federated"
    : options?.following
      ? "/social/timeline/following"
      : "/social/timeline";
  const params: Record<string, string | number> = {};
  if (options?.sort) params.sort = options.sort;
  if (options?.limit !== undefined) params.limit = options.limit;
  if (options?.offset !== undefined) params.offset = options.offset;
  if (options?.artifactType) params.artifactType = options.artifactType;
  if (options?.tag) params.tag = options.tag;
  const { data } = await api.get(endpoint, { params: Object.keys(params).length > 0 ? params : undefined });
  return data;
};

export const getPost = async (id: string | number): Promise<{ post: SocialPostRecord }> => {
  const { data } = await api.get(`/social/posts/${id}`);
  return data;
};

export const getPostReplies = async (id: string | number): Promise<{ posts: SocialPostRecord[] }> => {
  const { data } = await api.get(`/social/posts/${id}/replies`);
  return data;
};

export const getPostParents = async (id: string | number): Promise<{ posts: SocialPostRecord[] }> => {
  const { data } = await api.get(`/social/posts/${id}/parents`);
  return data;
};

export const getPostQuotes = async (
  id: string | number,
): Promise<{ quotes?: SocialPostRecord[] | undefined; posts?: SocialPostRecord[] | undefined }> => {
  const { data } = await api.get(`/social/posts/${id}/quotes`);
  return data;
};

export const getPostReposts = async (
  id: string | number,
): Promise<{ reposts?: SocialUserRecord[] | undefined; posts?: SocialPostRecord[] | undefined }> => {
  const { data } = await api.get(`/social/posts/${id}/reposts`);
  return data;
};

export const recordPostView = async (
  id: string | number,
): Promise<{ success?: boolean; counted?: boolean } | undefined> => {
  const res = await api.post(`/social/posts/${id}/view`).catch(() => null);
  return res?.data;
};

export const getPostAnalytics = async (id: string | number): Promise<Record<string, unknown>> => {
  const { data } = await api.get(`/social/posts/${id}/analytics`);
  return data;
};

export const likePost = async (id: string | number): Promise<{ liked: boolean }> => {
  const { data } = await api.post(`/social/posts/${id}/like`);
  return data;
};

export const repostPost = async (id: string | number): Promise<{ reposted: boolean }> => {
  const { data } = await api.post(`/social/posts/${id}/repost`);
  return data;
};

export const bookmarkPost = async (id: string | number): Promise<{ bookmarked: boolean }> => {
  const { data } = await api.post(`/social/posts/${id}/bookmark`);
  return data;
};

export const createPost = async (payload: Record<string, unknown>): Promise<{ post: SocialPostRecord }> => {
  const { data } = await api.post("/social/posts", payload);
  return data;
};

export const updatePost = async (
  id: string | number,
  payload: Record<string, unknown>,
): Promise<{ post: SocialPostRecord }> => {
  const { data } = await api.put(`/social/posts/${id}`, payload);
  return data;
};

export const getPostRevisions = async (
  postId: string | number,
): Promise<{ postId: string; currentRev: number; revisions: SocialPostRevisionRecord[] }> => {
  const { data } = await api.get(`/social/posts/${postId}/revisions`);
  return data;
};

export const getBookmarks = async (): Promise<{ posts: SocialPostRecord[] }> => {
  const { data } = await api.get("/social/bookmarks");
  return data;
};

export const getNotifications = async (
  category?: string,
): Promise<{ notifications: SocialNotificationRecord[]; unreadCount?: number | undefined }> => {
  const params = category && category !== "all" ? { category } : undefined;
  const { data } = await api.get("/social/notifications", { params });
  return data;
};

const NOTIFICATION_CATEGORIES = new Set(["all", "engineering", "packages", "mentions", "system"]);

export const markNotificationsRead = async (
  idOrCategoryOrIds?: string | number | Array<string | number>,
): Promise<void> => {
  let body: Record<string, unknown> | undefined;
  if (Array.isArray(idOrCategoryOrIds)) {
    const cleanIds = Array.from(new Set(idOrCategoryOrIds.filter((v) => v !== undefined && v !== null && v !== "")));
    if (cleanIds.length === 0) return;
    body = {
      ids: cleanIds,
      notification_ids: cleanIds,
    };
  } else if (idOrCategoryOrIds !== undefined && idOrCategoryOrIds !== null && idOrCategoryOrIds !== "") {
    if (typeof idOrCategoryOrIds === "string" && NOTIFICATION_CATEGORIES.has(idOrCategoryOrIds)) {
      body = idOrCategoryOrIds !== "all" ? { category: idOrCategoryOrIds } : undefined;
    } else {
      body = {
        id: idOrCategoryOrIds,
        notification_id: idOrCategoryOrIds,
        notification_ids: [idOrCategoryOrIds],
        ids: [idOrCategoryOrIds],
      };
    }
  }
  await api.post("/social/notifications/read", body);
};

export const triageNotifications = async (options: {
  ids?: Array<string | number> | undefined;
  category?: string | undefined;
  archived?: boolean | undefined;
  starred?: boolean | undefined;
  read?: boolean | undefined;
}): Promise<void> => {
  const cleanIds = options.ids
    ? Array.from(new Set(options.ids.filter((v) => v !== undefined && v !== null && v !== "")))
    : undefined;
  await api.post("/social/notifications/triage", {
    ...(cleanIds && cleanIds.length > 0 ? { ids: cleanIds, notification_ids: cleanIds } : {}),
    ...(options.category && options.category !== "all" ? { category: options.category } : {}),
    ...(typeof options.archived === "boolean" ? { archived: options.archived } : {}),
    ...(typeof options.starred === "boolean" ? { starred: options.starred } : {}),
    ...(typeof options.read === "boolean" ? { read: options.read } : {}),
  });
};

export const getFeeds = async (): Promise<{ feeds: SocialFeedRecord[] }> => {
  const { data } = await api.get("/social/feeds");
  return data;
};

export const subscribeFeed = async (url: string): Promise<SocialMutationResponse> => {
  const { data } = await api.post("/social/feeds/subscribe", { url });
  return data;
};

export const unsubscribeFeed = async (id: string | number): Promise<SocialMutationResponse> => {
  const { data } = await api.delete(`/social/feeds/${id}/unsubscribe`);
  return data;
};

export const getTrending = async (limit = 4): Promise<{ topics: SocialTopicRecord[] }> => {
  const { data } = await api.get("/social/trending", { params: { limit } });
  return data;
};

export const getExplore = async (options?: {
  limit?: number | undefined;
  offset?: number | undefined;
  artifactType?: string | undefined;
  tag?: string | undefined;
}): Promise<{ posts: SocialPostRecord[] }> => {
  const params: Record<string, string | number> = {};
  if (options?.limit !== undefined) params.limit = options.limit;
  if (options?.offset !== undefined) params.offset = options.offset;
  if (options?.artifactType) params.artifactType = options.artifactType;
  if (options?.tag) params.tag = options.tag;
  const { data } = await api.get("/social/explore", { params: Object.keys(params).length > 0 ? params : undefined });
  return data;
};

export const getTopicPosts = async (
  topic: string,
  options?: {
    limit?: number | undefined;
    offset?: number | undefined;
    artifactType?: string | undefined;
    sort?: "recent" | "top" | undefined;
  },
): Promise<{ posts: SocialPostRecord[] }> => {
  const params: Record<string, string | number> = {};
  if (options?.limit !== undefined) params.limit = options.limit;
  if (options?.offset !== undefined) params.offset = options.offset;
  if (options?.artifactType) params.artifactType = options.artifactType;
  if (options?.sort) params.sort = options.sort;
  const { data } = await api.get(`/social/topics/${encodeURIComponent(topic)}/posts`, {
    params: Object.keys(params).length > 0 ? params : undefined,
  });
  return data;
};

export const getRelatedTopics = async (topic: string, limit = 8): Promise<{ topics: SocialTopicRecord[] }> => {
  const { data } = await api.get(`/social/topics/${encodeURIComponent(topic)}/related`, {
    params: { limit },
  });
  return data;
};

export const getRepos = async (username?: string): Promise<{ repos: SocialRepoRecord[] }> => {
  if (username) {
    try {
      const { data } = await api.get(`/users/${encodeURIComponent(username)}/repos`);
      return data;
    } catch {
      const { data } = await api.get("/repos", { params: { username } });
      return data;
    }
  }
  const { data } = await api.get("/repos");
  return data;
};

export const getPopularRepos = async (limit?: number): Promise<{ repos: SocialRepoRecord[] }> => {
  const { data } = await api.get("/repos/popular", { params: limit ? { limit } : undefined });
  return data;
};

export const createRepo = async (
  repoData: Record<string, unknown>,
): Promise<{ repo?: SocialRepoRecord | undefined; [key: string]: unknown }> => {
  const { data } = await api.post("/repos", repoData);
  return data;
};

export const updateRepo = async (
  id: string | number,
  updates: Record<string, unknown>,
): Promise<{ repo?: SocialRepoRecord | undefined; [key: string]: unknown }> => {
  const { data } = await api.put(`/repos/${encodeURIComponent(String(id))}`, updates);
  return data;
};

export const deleteRepo = async (id: string | number): Promise<SocialMutationResponse> => {
  const { data } = await api.delete(`/repos/${encodeURIComponent(String(id))}`);
  return data;
};

export const getRepoWebhooks = async (id: string | number): Promise<{ webhooks: RepoWebhookRecord[] }> => {
  const { data } = await api.get(`/repos/${encodeURIComponent(String(id))}/webhooks`);
  return data;
};

export const createRepoWebhook = async (
  id: string | number,
  payload: Record<string, unknown>,
): Promise<{ webhook?: RepoWebhookRecord | undefined; [key: string]: unknown }> => {
  const { data } = await api.post(`/repos/${encodeURIComponent(String(id))}/webhooks`, payload);
  return data;
};

export const deleteRepoWebhook = async (
  repoId: string | number,
  webhookId: number,
): Promise<SocialMutationResponse> => {
  const { data } = await api.delete(`/repos/${encodeURIComponent(String(repoId))}/webhooks/${webhookId}`);
  return data;
};

export const getSearchCompletions = async (
  query: string,
  limit = 6,
): Promise<{
  suggestions?: SearchCompletionItem[] | undefined;
  completions?: SearchCompletionItem[] | undefined;
  posts?: SocialPostRecord[] | undefined;
}> => {
  const { data } = await api.get("/search/completions", { params: { q: query, limit } });
  return data;
};

export const searchPosts = async (query: string, limit = 30): Promise<{ posts: SocialPostRecord[] }> => {
  try {
    const { data } = await api.get("/social/explore", { params: { q: query, limit } });
    if (Array.isArray(data?.posts)) {
      return { posts: data.posts };
    }
  } catch {
    // Fall through to completions fallback
  }
  try {
    const { data } = await api.get("/search/completions", { params: { q: query, limit } });
    if (Array.isArray(data?.posts)) {
      return { posts: data.posts };
    }
  } catch {
    // Ignore search failure
  }
  return { posts: [] };
};

export const resolveFederatedActor = async (handle: string): Promise<Record<string, unknown>> => {
  const { data } = await api.post("/federation/resolve", { handle });
  return data;
};

export const deletePost = async (id: number | string): Promise<SocialMutationResponse> => {
  const { data } = await api.delete(`/social/posts/${id}`);
  return data;
};

export type AiDraftTone = "technical" | "concise" | "expand" | "hashtags";
export type AiPolishMode = "polish" | "concise" | "expand" | "hashtags";

export interface AiDraftRequest {
  artifactId?: number | null | undefined;
  artifactIds?: number[] | undefined;
  artifactMeta?:
    | {
        viewType?: string | undefined;
        title?: string | undefined;
        viewConfig?: Record<string, unknown> | string | undefined;
      }
    | undefined;
  existingText?: string | undefined;
  tone?: AiDraftTone | undefined;
  isNotebook?: boolean | undefined;
}

export interface AiDraftResponse {
  draft: string;
  notebookTitle: string;
  notebookSummary: string;
  domain: string;
  highlights?: string[] | undefined;
  suggestedHashtags: string[];
  provider: string;
  model: string;
}

export interface AiPolishRequest {
  content: string;
  mode?: AiPolishMode | undefined;
  artifactId?: number | undefined;
}

export interface AiPolishResponse {
  polished: string;
  mode: AiPolishMode;
  domain: string;
  suggestedHashtags: string[];
  provider: string;
  model: string;
}

export const draftPostWithAi = async (payload: AiDraftRequest): Promise<AiDraftResponse> => {
  const { data } = await api.post<AiDraftResponse>("/social/ai/draft", payload);
  return data;
};

export const polishPostWithAi = async (payload: AiPolishRequest): Promise<AiPolishResponse> => {
  const { data } = await api.post<AiPolishResponse>("/social/ai/polish", payload);
  return data;
};
