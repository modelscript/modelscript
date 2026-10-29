// SPDX-License-Identifier: AGPL-3.0-or-later

import { api } from "./client";

export const getUserProfile = async (username: string): Promise<any> => {
  const { data } = await api.get(`/users/${encodeURIComponent(username)}`);
  return data;
};

export const followUser = async (username: string): Promise<any> => {
  const { data } = await api.post(`/users/${encodeURIComponent(username)}/follow`);
  return data;
};

export const unfollowUser = async (username: string): Promise<any> => {
  const { data } = await api.delete(`/users/${encodeURIComponent(username)}/follow`);
  return data;
};

export const blockUser = async (username: string): Promise<any> => {
  const { data } = await api.post(`/users/${encodeURIComponent(username)}/block`);
  return data;
};

export const unblockUser = async (username: string): Promise<any> => {
  const { data } = await api.delete(`/users/${encodeURIComponent(username)}/block`);
  return data;
};

export const muteUser = async (username: string): Promise<any> => {
  const { data } = await api.post(`/users/${encodeURIComponent(username)}/mute`);
  return data;
};

export const unmuteUser = async (username: string): Promise<any> => {
  const { data } = await api.delete(`/users/${encodeURIComponent(username)}/mute`);
  return data;
};

const notifyAdminReportCreated = () => {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("modelscript:admin-overview-update"));
  }
};

export const reportUser = async (username: string, reason?: string, details?: string): Promise<any> => {
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

export const updateUserProfile = async (profileData: Record<string, any>): Promise<any> => {
  const { data } = await api.put("/users/me", profileData);
  return data;
};

export const getUserFollowers = async (username: string): Promise<{ followers: any[] }> => {
  const { data } = await api.get(`/users/${encodeURIComponent(username)}/followers`);
  return data;
};

export const getUserFollowing = async (username: string): Promise<{ following: any[] }> => {
  const { data } = await api.get(`/users/${encodeURIComponent(username)}/following`);
  return data;
};

export const getUserSuggestions = async (limit = 4): Promise<{ suggestions: any[] }> => {
  const { data } = await api.get("/users/suggestions", { params: { limit } });
  return data;
};

export const getUserPosts = async (
  username: string,
  type?: "posts" | "replies" | "artifacts",
): Promise<{ posts: any[] }> => {
  const { data } = await api.get(`/social/users/${encodeURIComponent(username)}/posts`, {
    params: type ? { type } : undefined,
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
}): Promise<{ posts: any[] }> => {
  const endpoint = options?.federated
    ? "/social/timeline/federated"
    : options?.following
      ? "/social/timeline/following"
      : "/social/timeline";
  const params: Record<string, any> = {};
  if (options?.sort) params.sort = options.sort;
  if (options?.limit !== undefined) params.limit = options.limit;
  if (options?.offset !== undefined) params.offset = options.offset;
  if (options?.artifactType) params.artifactType = options.artifactType;
  if (options?.tag) params.tag = options.tag;
  const { data } = await api.get(endpoint, { params: Object.keys(params).length > 0 ? params : undefined });
  return data;
};

export const getPost = async (id: string | number): Promise<{ post: any }> => {
  const { data } = await api.get(`/social/posts/${id}`);
  return data;
};

export const getPostReplies = async (id: string | number): Promise<{ posts: any[] }> => {
  const { data } = await api.get(`/social/posts/${id}/replies`);
  return data;
};

export const getPostParents = async (id: string | number): Promise<{ posts: any[] }> => {
  const { data } = await api.get(`/social/posts/${id}/parents`);
  return data;
};

export const getPostQuotes = async (
  id: string | number,
): Promise<{ quotes?: any[] | undefined; posts?: any[] | undefined }> => {
  const { data } = await api.get(`/social/posts/${id}/quotes`);
  return data;
};

export const getPostReposts = async (
  id: string | number,
): Promise<{ reposts?: any[] | undefined; posts?: any[] | undefined }> => {
  const { data } = await api.get(`/social/posts/${id}/reposts`);
  return data;
};

export const recordPostView = async (
  id: string | number,
): Promise<{ success?: boolean; counted?: boolean } | undefined> => {
  const res = await api.post(`/social/posts/${id}/view`).catch(() => null);
  return res?.data;
};

export const getPostAnalytics = async (id: string | number): Promise<any> => {
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

export const createPost = async (payload: Record<string, any>): Promise<{ post: any }> => {
  const { data } = await api.post("/social/posts", payload);
  return data;
};

export const updatePost = async (id: string | number, payload: Record<string, any>): Promise<{ post: any }> => {
  const { data } = await api.put(`/social/posts/${id}`, payload);
  return data;
};

export const getBookmarks = async (): Promise<{ posts: any[] }> => {
  const { data } = await api.get("/social/bookmarks");
  return data;
};

export const getNotifications = async (
  category?: string,
): Promise<{ notifications: any[]; unreadCount?: number | undefined }> => {
  const params = category && category !== "all" ? { category } : undefined;
  const { data } = await api.get("/social/notifications", { params });
  return data;
};

export const markNotificationsRead = async (category?: string): Promise<void> => {
  const body = category && category !== "all" ? { category } : undefined;
  await api.post("/social/notifications/read", body);
};

export const getFeeds = async (): Promise<{ feeds: any[] }> => {
  const { data } = await api.get("/social/feeds");
  return data;
};

export const subscribeFeed = async (url: string): Promise<any> => {
  const { data } = await api.post("/social/feeds/subscribe", { url });
  return data;
};

export const unsubscribeFeed = async (id: string | number): Promise<any> => {
  const { data } = await api.delete(`/social/feeds/${id}/unsubscribe`);
  return data;
};

export const getTrending = async (limit = 4): Promise<{ topics: any[] }> => {
  const { data } = await api.get("/social/trending", { params: { limit } });
  return data;
};

export const getExplore = async (options?: {
  limit?: number | undefined;
  offset?: number | undefined;
  artifactType?: string | undefined;
  tag?: string | undefined;
}): Promise<{ posts: any[] }> => {
  const params: Record<string, any> = {};
  if (options?.limit !== undefined) params.limit = options.limit;
  if (options?.offset !== undefined) params.offset = options.offset;
  if (options?.artifactType) params.artifactType = options.artifactType;
  if (options?.tag) params.tag = options.tag;
  const { data } = await api.get("/social/explore", { params: Object.keys(params).length > 0 ? params : undefined });
  return data;
};

export const getTopicPosts = async (
  topic: string,
  options?: { limit?: number | undefined; offset?: number | undefined; artifactType?: string | undefined },
): Promise<{ posts: any[] }> => {
  const params: Record<string, any> = {};
  if (options?.limit !== undefined) params.limit = options.limit;
  if (options?.offset !== undefined) params.offset = options.offset;
  if (options?.artifactType) params.artifactType = options.artifactType;
  const { data } = await api.get(`/social/topics/${encodeURIComponent(topic)}/posts`, {
    params: Object.keys(params).length > 0 ? params : undefined,
  });
  return data;
};

export const getRepos = async (username?: string): Promise<{ repos: any[] }> => {
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

export const getPopularRepos = async (limit?: number): Promise<{ repos: any[] }> => {
  const { data } = await api.get("/repos/popular", { params: limit ? { limit } : undefined });
  return data;
};

export const createRepo = async (repoData: Record<string, any>): Promise<any> => {
  const { data } = await api.post("/repos", repoData);
  return data;
};

export const updateRepo = async (id: string | number, updates: Record<string, any>): Promise<any> => {
  const { data } = await api.put(`/repos/${encodeURIComponent(String(id))}`, updates);
  return data;
};

export const deleteRepo = async (id: string | number): Promise<any> => {
  const { data } = await api.delete(`/repos/${encodeURIComponent(String(id))}`);
  return data;
};

export const getRepoWebhooks = async (id: string | number): Promise<{ webhooks: any[] }> => {
  const { data } = await api.get(`/repos/${encodeURIComponent(String(id))}/webhooks`);
  return data;
};

export const createRepoWebhook = async (id: string | number, payload: Record<string, any>): Promise<any> => {
  const { data } = await api.post(`/repos/${encodeURIComponent(String(id))}/webhooks`, payload);
  return data;
};

export const deleteRepoWebhook = async (repoId: string | number, webhookId: number): Promise<any> => {
  const { data } = await api.delete(`/repos/${encodeURIComponent(String(repoId))}/webhooks/${webhookId}`);
  return data;
};

export const getSearchCompletions = async (
  query: string,
  limit = 6,
): Promise<{ suggestions?: any[] | undefined; completions?: any[] | undefined; posts?: any[] | undefined }> => {
  const { data } = await api.get("/search/completions", { params: { q: query, limit } });
  return data;
};

export const searchPosts = async (query: string, limit = 30): Promise<{ posts: any[] }> => {
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

export const resolveFederatedActor = async (handle: string): Promise<any> => {
  const { data } = await api.post("/federation/resolve", { handle });
  return data;
};

export const deletePost = async (id: number | string): Promise<any> => {
  const { data } = await api.delete(`/social/posts/${id}`);
  return data;
};

export type AiDraftTone = "technical" | "concise" | "expand" | "hashtags";
export type AiPolishMode = "polish" | "concise" | "expand" | "hashtags";

export interface AiDraftRequest {
  artifactId?: number | undefined;
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
