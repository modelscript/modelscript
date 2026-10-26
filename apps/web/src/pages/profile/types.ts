// SPDX-License-Identifier: AGPL-3.0-or-later

export interface ProfileData {
  username: string;
  display_name?: string | null | undefined;
  avatar_url?: string | null | undefined;
  banner_url?: string | null | undefined;
  bio?: string | null | undefined;
  location?: string | null | undefined;
  website?: string | null | undefined;
  account_type?: "local" | "remote" | "bot" | "rss" | string | undefined;
  actor_url?: string | null | undefined;
  owner_username?: string | null | undefined;
  follower_count: number;
  following_count: number;
  post_count?: number | undefined;
  created_at: string;
}

export interface LinkedAccount {
  provider: string;
  username?: string | undefined;
}
