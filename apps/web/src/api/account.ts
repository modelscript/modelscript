// SPDX-License-Identifier: AGPL-3.0-or-later

import { api } from "./client";

export const updateAccount = async (data: {
  password?: string | undefined;
  username?: string | undefined;
  email?: string | undefined;
  display_name?: string | undefined;
  avatar_url?: string | undefined;
  banner_url?: string | undefined;
}) => {
  const { data: resData } = await api.put("/auth/account", data);
  return resData;
};

export const changeAccountCredentials = async (data: {
  oldPassword?: string | undefined;
  newPassword?: string | undefined;
}) => {
  const { data: resData } = await api.put("/auth/password", data);
  return resData;
};
export const updatePassword = changeAccountCredentials;

export interface ArchiveJobInfo {
  id: string;
  status: "queued" | "processing" | "completed" | "failed";
  format: "zip" | "json";
  queuePosition?: number | undefined;
  createdAt: string;
  startedAt?: string | undefined;
  completedAt?: string | undefined;
  expiresAt?: string | undefined;
  fileSizeBytes?: number | undefined;
  error?: string | undefined;
  downloadUrl?: string | undefined;
  concurrency?: number | undefined;
}

export const requestUserDataArchiveJob = async (format: "zip" | "json" = "zip"): Promise<ArchiveJobInfo> => {
  const { data } = await api.post<{ success: boolean; job: ArchiveJobInfo }>("/users/me/export", { format });
  return data.job;
};

export const getUserDataArchiveStatus = async (jobId?: string): Promise<ArchiveJobInfo | null> => {
  const query = jobId ? `?jobId=${encodeURIComponent(jobId)}` : "";
  const { data } = await api.get<{ job: ArchiveJobInfo | null }>(`/users/me/export/status${query}`);
  return data.job;
};

export const downloadUserDataArchiveJob = async (jobId?: string): Promise<Blob> => {
  const query = jobId ? `?jobId=${encodeURIComponent(jobId)}` : "";
  const response = await api.get(`/users/me/export/download${query}`, {
    responseType: "blob",
  });
  return response.data;
};

export const exportUserDataArchive = async (format: "zip" | "json" = "zip"): Promise<Blob> => {
  const response = await api.get(`/users/me/export?format=${format}`, {
    responseType: "blob",
  });
  return response.data;
};

export const deleteAccount = async () => {
  const { data } = await api.delete("/users/me");
  return data;
};

export interface NotificationPreferences {
  qualityFilter?: boolean | undefined;
  inAppSounds?: boolean | undefined;
  emailDigestFrequency?: "instant" | "daily" | "weekly" | "never" | undefined;
  channels?:
    | {
        email: boolean;
        browserPush: boolean;
        inApp: boolean;
      }
    | undefined;
  deliveryChannels?:
    | {
        inApp: boolean;
        emailNotifications: boolean;
      }
    | undefined;
  events?:
    | {
        social: {
          mentions: boolean;
          replies: boolean;
          follows: boolean;
          reposts: boolean;
        };
        engineering: {
          packageUpdates: boolean;
          starredRepoCommits: boolean;
          federatedMentions: boolean;
        };
        computeHpc: {
          jobCompleted: boolean;
          jobFailed: boolean;
          quotaThresholdAlert: boolean;
        };
      }
    | undefined;
}

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  qualityFilter: true,
  inAppSounds: true,
  emailDigestFrequency: "daily",
  channels: {
    email: true,
    browserPush: false,
    inApp: true,
  },
  deliveryChannels: {
    inApp: true,
    emailNotifications: true,
  },
  events: {
    social: {
      mentions: true,
      replies: true,
      follows: true,
      reposts: false,
    },
    engineering: {
      packageUpdates: true,
      starredRepoCommits: true,
      federatedMentions: true,
    },
    computeHpc: {
      jobCompleted: true,
      jobFailed: true,
      quotaThresholdAlert: true,
    },
  },
};

export const NOTIFICATION_PREFS_STORAGE_KEY = "modelscript_notification_prefs";

export function getCachedNotificationPreferences(): NotificationPreferences {
  if (typeof localStorage === "undefined") return DEFAULT_NOTIFICATION_PREFERENCES;
  try {
    const raw = localStorage.getItem(NOTIFICATION_PREFS_STORAGE_KEY);
    if (!raw) return DEFAULT_NOTIFICATION_PREFERENCES;
    const parsed = JSON.parse(raw) as Partial<NotificationPreferences>;
    return {
      ...DEFAULT_NOTIFICATION_PREFERENCES,
      ...parsed,
      channels: {
        ...DEFAULT_NOTIFICATION_PREFERENCES.channels!,
        ...(parsed.channels || {}),
      },
      deliveryChannels: {
        ...DEFAULT_NOTIFICATION_PREFERENCES.deliveryChannels!,
        ...(parsed.deliveryChannels || {}),
      },
    };
  } catch {
    return DEFAULT_NOTIFICATION_PREFERENCES;
  }
}

export const getNotificationSettings = async (): Promise<NotificationPreferences> => {
  const { data } = await api.get<NotificationPreferences>("/auth/notifications");
  if (typeof localStorage !== "undefined" && data) {
    try {
      localStorage.setItem(NOTIFICATION_PREFS_STORAGE_KEY, JSON.stringify(data));
    } catch {
      // ignore storage quota errors
    }
  }
  return data;
};

export const updateNotificationSettings = async (
  settings: Partial<NotificationPreferences>,
): Promise<{ success: boolean }> => {
  const payload: Partial<NotificationPreferences> = { ...settings };
  if (settings.channels && !settings.deliveryChannels) {
    payload.deliveryChannels = {
      inApp: settings.channels.inApp ?? true,
      emailNotifications: settings.channels.email ?? true,
    };
  }
  const { data } = await api.put("/auth/notifications", payload);
  if (typeof localStorage !== "undefined") {
    try {
      const merged = { ...getCachedNotificationPreferences(), ...payload };
      localStorage.setItem(NOTIFICATION_PREFS_STORAGE_KEY, JSON.stringify(merged));
    } catch {
      // ignore storage quota errors
    }
  }
  return data;
};

export interface ConnectedAccount {
  provider: string;
  name: string;
  connected: boolean;
  identifier?: string | undefined;
}

export const getConnectedAccounts = async (): Promise<{ providers: ConnectedAccount[] }> => {
  const { data } = await api.get<{ providers: ConnectedAccount[] }>("/auth/connected-accounts");
  return data;
};

export const unlinkConnectedAccount = async (provider: string): Promise<{ success: boolean }> => {
  const { data } = await api.delete(`/auth/connected-accounts/${encodeURIComponent(provider)}`);
  return data;
};

export const initiateOAuthLink = async (provider: string): Promise<string> => {
  const { data } = await api.post<{ redirectUrl: string }>(`/auth/link/${encodeURIComponent(provider)}`);
  return data.redirectUrl;
};

export const getUserTopics = async () => {
  const { data } = await api.get("/users/me/topics");
  return data.topics as { concept: string; is_active: boolean }[];
};

export const updateUserTopic = async (concept: string, is_active: boolean) => {
  const { data } = await api.put("/users/me/topics", { concept, is_active });
  return data;
};

// ── Key Management API ──────────────────────────────────────────

export interface PublicKeyInfo {
  id: number;
  key_id_string: string;
  public_key_pem: string;
  device_name: string | null;
  created_at: string;
  is_active: number;
}

export const getPublicKeys = async (): Promise<PublicKeyInfo[]> => {
  const { data } = await api.get<{ keys: PublicKeyInfo[] }>("/auth/keys");
  return data.keys;
};

export const addPublicKey = async (key_id_string: string, public_key_pem: string, device_name?: string) => {
  const { data } = await api.post("/auth/keys", { key_id_string, public_key_pem, device_name });
  return data;
};

export const revokePublicKey = async (id: number) => {
  const { data } = await api.delete(`/auth/keys/${id}`);
  return data;
};

// ── Auth & Session Management API ───────────────────────────────

export const verifyEmail = async (
  token: string,
): Promise<{ success: boolean; message: string; creditsGranted: number; user: any }> => {
  const { data } = await api.post("/auth/verify-email", { token });
  return data;
};

export const resendVerificationEmail = async (
  email: string,
): Promise<{ success?: boolean | undefined; message: string }> => {
  const { data } = await api.post("/auth/resend-verification", { email });
  return data;
};

export const requestPasswordReset = async (
  email: string,
): Promise<{ success: boolean; message: string; resetToken?: string | undefined }> => {
  const { data } = await api.post("/auth/forgot-password", { email });
  return data;
};

export const resetPassword = async (
  token: string,
  newPassword: string,
): Promise<{ success: boolean; message: string }> => {
  const { data } = await api.post("/auth/reset-password", { token, newPassword });
  return data;
};

export const revokeAllSessions = async (): Promise<{ success: boolean; message: string; token: string }> => {
  const { data } = await api.post("/auth/revoke-sessions");
  return data;
};

export interface Setup2FAResponse {
  secret: string;
  otpauthUri?: string | undefined;
  otpAuthUri?: string | undefined;
  message?: string | undefined;
}

export interface Verify2FAResponse {
  success: boolean;
  message: string;
  backupCodes: string[];
}

export interface Challenge2FAResponse {
  token: string;
  user: any;
  message: string;
}

export const setup2FA = async (): Promise<Setup2FAResponse> => {
  const { data } = await api.post("/auth/2fa/setup");
  return data;
};

export const verify2FA = async (code: string, secret?: string): Promise<Verify2FAResponse> => {
  const { data } = await api.post("/auth/2fa/verify", { code, ...(secret ? { secret } : {}) });
  return data;
};

export const challenge2FA = async (tempToken: string, code: string): Promise<Challenge2FAResponse> => {
  const { data } = await api.post("/auth/2fa/challenge", { tempToken, code });
  return data;
};

export const disable2FA = async (password?: string, code?: string): Promise<{ success: boolean; message: string }> => {
  const { data } = await api.post("/auth/2fa/disable", { password, code });
  return data;
};

export const regenerateBackupCodes2FA = async (
  password?: string,
  code?: string,
): Promise<{ success: boolean; message: string; backupCodes: string[] }> => {
  const { data } = await api.post("/auth/2fa/backup-codes/regenerate", { password, code });
  return data;
};

export const logoutApi = async (): Promise<{ success: boolean; message: string }> => {
  try {
    const { data } = await api.post("/auth/logout");
    return data;
  } catch {
    return { success: true, message: "Logged out" };
  }
};

// ── Granular Scoped Personal Access Tokens (PAT) ─────────────────────────

export interface ApiTokenDto {
  id: number;
  user_id: number;
  name: string;
  token_prefix: string;
  scopes: string[];
  package_pattern: string;
  expires_at: string | null;
  last_used_at: string | null;
  last_used_ip: string | null;
  created_at: string;
}

export interface CreatedApiTokenResponse extends ApiTokenDto {
  token: string; // The plaintext secret, shown only once
  message: string;
}

export const getApiTokens = async (): Promise<ApiTokenDto[]> => {
  const { data } = await api.get("/auth/tokens");
  return data.tokens || [];
};

export const createApiToken = async (payload: {
  name: string;
  scopes: string[];
  packagePattern?: string | undefined;
  expiresInDays?: number | undefined;
}): Promise<CreatedApiTokenResponse> => {
  const { data } = await api.post("/auth/tokens", payload);
  return data;
};

export const revokeApiToken = async (tokenId: number): Promise<{ success: boolean }> => {
  const { data } = await api.delete(`/auth/tokens/${tokenId}`);
  return data;
};

// ── Privacy, Federation, Social Graph & Web Push API ────────────────────

export interface ProfileFieldItem {
  name: string;
  value: string;
  verified_at?: string | null | undefined;
}

export interface PrivacyFederationSettings {
  discoverable: boolean;
  indexable: boolean;
  locked: boolean;
  default_post_visibility: "public" | "unlisted" | "followers" | "direct";
  profile_fields: ProfileFieldItem[];
  also_known_as: string[];
  moved_to_actor_url: string | null;
  actor_url: string | null;
}

export interface FollowRequestUser {
  id: number;
  username: string;
  display_name?: string | null | undefined;
  avatar_url?: string | null | undefined;
  actor_url?: string | null | undefined;
  remote_domain?: string | null | undefined;
  created_at?: string | undefined;
}

export interface BlockedOrMutedUser {
  id: number;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  remote_domain: string | null;
  created_at: string;
}

export interface PushSubscriptionRecord {
  id: number;
  endpoint: string;
  alerts?: Record<string, boolean> | undefined;
  created_at: string;
}

export const getPrivacySettings = async (): Promise<PrivacyFederationSettings> => {
  const { data } = await api.get<PrivacyFederationSettings>("/users/me/privacy");
  return data;
};

export const updatePrivacySettings = async (payload: {
  discoverable?: boolean | undefined;
  indexable?: boolean | undefined;
  locked?: boolean | undefined;
  default_post_visibility?: "public" | "unlisted" | "followers" | "direct" | undefined;
  profile_fields?: ProfileFieldItem[] | undefined;
  also_known_as?: string[] | undefined;
}): Promise<{ success: boolean }> => {
  const { data } = await api.put<{ success: boolean }>("/users/me", payload);
  return data;
};

export const verifyProfileFields = async (
  profile_fields?: ProfileFieldItem[],
): Promise<{ success: boolean; profile_fields: ProfileFieldItem[] }> => {
  const { data } = await api.post<{ success: boolean; profile_fields: ProfileFieldItem[] }>("/users/me/verify-fields", {
    ...(profile_fields ? { profile_fields } : {}),
  });
  return data;
};

export const getFollowRequests = async (): Promise<FollowRequestUser[]> => {
  const { data } = await api.get<{ requests: FollowRequestUser[] }>("/users/me/follow-requests");
  return data.requests || [];
};

export const acceptFollowRequest = async (followerId: number): Promise<{ success: boolean }> => {
  const { data } = await api.post<{ success: boolean }>(`/users/me/follow-requests/${followerId}/accept`);
  return data;
};

export const rejectFollowRequest = async (followerId: number): Promise<{ success: boolean }> => {
  const { data } = await api.post<{ success: boolean }>(`/users/me/follow-requests/${followerId}/reject`);
  return data;
};

export const getBlockedUsers = async (): Promise<BlockedOrMutedUser[]> => {
  const { data } = await api.get<{ blocked: BlockedOrMutedUser[] }>("/users/me/blocked");
  return data.blocked || [];
};

export const getMutedUsers = async (): Promise<BlockedOrMutedUser[]> => {
  const { data } = await api.get<{ muted: BlockedOrMutedUser[] }>("/users/me/muted");
  return data.muted || [];
};

export const updateAccountAliases = async (
  alsoKnownAs: string[],
): Promise<{ success: boolean; alsoKnownAs: string[] }> => {
  const { data } = await api.post<{ success: boolean; alsoKnownAs: string[] }>("/users/me/aliases", {
    alsoKnownAs,
  });
  return data;
};

export const migrateAccountToActor = async (
  targetActorUrl: string,
): Promise<{ success: boolean; movedToActorUrl: string; migratedLocalFollowers: number }> => {
  const { data } = await api.post<{
    success: boolean;
    movedToActorUrl: string;
    migratedLocalFollowers: number;
  }>("/users/me/move", { targetActorUrl });
  return data;
};

export const exportSocialGraph = async (
  format: "json" | "csv" = "json",
  type: "following" | "blocks" | "mutes" = "following",
): Promise<Blob | { following: string[]; blocks: string[]; mutes: string[] }> => {
  if (format === "csv") {
    const response = await api.get(`/users/me/social-graph/export?format=csv&type=${type}`, {
      responseType: "blob",
    });
    return response.data;
  }
  const { data } = await api.get<{ following: string[]; blocks: string[]; mutes: string[] }>(
    "/users/me/social-graph/export?format=json",
  );
  return data;
};

export const importSocialGraph = async (payload: {
  following?: string[] | undefined;
  blocks?: string[] | undefined;
  mutes?: string[] | undefined;
  csv?: string | undefined;
  type?: "following" | "blocks" | "mutes" | undefined;
  mode?: "merge" | "overwrite" | undefined;
}): Promise<{
  success: boolean;
  importedFollowing: number;
  importedBlocks: number;
  importedMutes: number;
}> => {
  const { data } = await api.post("/users/me/social-graph/import", payload);
  return data;
};

export const getPushSubscriptions = async (): Promise<PushSubscriptionRecord[]> => {
  const { data } = await api.get<{ subscriptions: PushSubscriptionRecord[] }>("/users/me/push-subscriptions");
  return data.subscriptions || [];
};

export const registerPushSubscription = async (payload: {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  alerts?: Record<string, boolean> | undefined;
}): Promise<{ subscription: PushSubscriptionRecord }> => {
  const { data } = await api.post<{ subscription: PushSubscriptionRecord }>("/users/me/push-subscriptions", payload);
  return data;
};

export const deletePushSubscription = async (id: number): Promise<{ success: boolean }> => {
  const { data } = await api.delete<{ success: boolean }>(`/users/me/push-subscriptions/${id}`);
  return data;
};

import type { AccountSigningKeyInfo, SigningKeyLogItem, UserSigningKeysResponse } from "../types/api";

export const getUserSigningKeys = async (): Promise<UserSigningKeysResponse> => {
  const { data } = await api.get<UserSigningKeysResponse>("/users/me/signing-keys");
  return data;
};

export const getSigningKeyChallenge = async (_publicKeyOpenssh?: string): Promise<{ challenge: string }> => {
  const { data } = await api.get<{ challenge: string }>("/users/me/signing-challenge");
  return data;
};

export const registerAccountSigningKey = async (payload: {
  publicKeyOpenssh: string;
  label?: string;
  trustLevel?: string;
  challenge?: string;
  signature?: string;
  delegation?: {
    masterKeyId: number;
    signature: string;
  };
}): Promise<AccountSigningKeyInfo> => {
  const { data } = await api.post<AccountSigningKeyInfo>("/users/me/signing-keys", payload);
  return data;
};

export const getDelegationStatement = async (
  deviceKeyId: number,
  masterKeyId: number,
): Promise<{ statement: string }> => {
  const { data } = await api.get<{ statement: string }>(
    `/users/me/signing-keys/${deviceKeyId}/delegation-statement?masterKeyId=${masterKeyId}`,
  );
  return data;
};

export const delegateAccountSigningKey = async (
  deviceKeyId: number,
  masterKeyId: number,
  signature: string,
): Promise<{ success: boolean; key: AccountSigningKeyInfo }> => {
  const { data } = await api.post<{ success: boolean; key: AccountSigningKeyInfo }>(
    `/users/me/signing-keys/${deviceKeyId}/delegate`,
    { masterKeyId, signature },
  );
  return data;
};

export const revokeAccountSigningKey = async (keyId: number, reason?: string): Promise<{ success: boolean }> => {
  const { data } = await api.post<{ success: boolean }>(`/users/me/signing-keys/${keyId}/revoke`, { reason });
  return data;
};

export const updateSigningPolicy = async (
  strict: boolean,
): Promise<{ success: boolean; signing_policy_strict: boolean }> => {
  const { data } = await api.put<{ success: boolean; signing_policy_strict: boolean }>("/users/me/signing-policy", {
    strict,
  });
  return data;
};

export const getSigningKeyLog = async (usernameOrId: string | number): Promise<SigningKeyLogItem[]> => {
  const { data } = await api.get<{ log: SigningKeyLogItem[] }>(`/users/${usernameOrId}/signing-keys/log`);
  return data.log || [];
};
