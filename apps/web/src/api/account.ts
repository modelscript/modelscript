// SPDX-License-Identifier: AGPL-3.0-or-later

/* eslint-disable @typescript-eslint/no-explicit-any */
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

export const getNotificationSettings = async (): Promise<NotificationPreferences> => {
  const { data } = await api.get<NotificationPreferences>("/auth/notifications");
  return data;
};

export const updateNotificationSettings = async (
  settings: Partial<NotificationPreferences>,
): Promise<{ success: boolean }> => {
  const { data } = await api.put("/auth/notifications", settings);
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
