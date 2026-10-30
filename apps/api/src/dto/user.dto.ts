// SPDX-License-Identifier: AGPL-3.0-or-later

export interface UserPublicDTO {
  id: number;
  username: string;
  displayName: string;
  avatarUrl?: string | null;
  bio?: string | null;
  engineeringPersona?: string | null;
  followerCount?: number;
  followingCount?: number;
  postCount?: number;
  createdAt: string;
}

export interface UserSelfDTO extends UserPublicDTO {
  email: string;
  accountType: string;
  role: string;
  creditBalance: number;
  onboardingCompleted: boolean;
  invitesRemaining: number;
  totpEnabled: boolean;
  emailVerified: boolean;
}

export function toUserPublicDTO(row: Record<string, unknown>): UserPublicDTO {
  const dto: UserPublicDTO = {
    id: Number(row["id"]),
    username: String(row["username"] || ""),
    displayName: String(row["display_name"] || row["username"] || ""),
    avatarUrl: row["avatar_url"] ? String(row["avatar_url"]) : null,
    bio: row["bio"] ? String(row["bio"]) : null,
    engineeringPersona: row["engineering_persona"] ? String(row["engineering_persona"]) : null,
    createdAt: row["created_at"] ? new Date(String(row["created_at"])).toISOString() : new Date().toISOString(),
  };
  if (typeof row["follower_count"] === "number") dto.followerCount = row["follower_count"];
  if (typeof row["following_count"] === "number") dto.followingCount = row["following_count"];
  if (typeof row["post_count"] === "number") dto.postCount = row["post_count"];
  return dto;
}

export function toUserSelfDTO(row: Record<string, unknown>): UserSelfDTO {
  return {
    ...toUserPublicDTO(row),
    email: String(row["email"] || ""),
    accountType: String(row["account_type"] || "individual"),
    role: String(row["role"] || "user"),
    creditBalance: Number(row["credit_balance"] ?? 0),
    onboardingCompleted: Boolean(row["onboarding_completed"]),
    invitesRemaining: Number(row["invites_remaining"] ?? 0),
    totpEnabled: Boolean(row["totp_enabled"]),
    emailVerified: Boolean(row["email_verified"]),
  };
}
