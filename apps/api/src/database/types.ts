// SPDX-License-Identifier: AGPL-3.0-or-later

export interface UserFederationInfo {
  id: number;
  actor_url?: string | null;
  inbox_url?: string | null;
  outbox_url?: string | null;
  remote_domain?: string | null;
  rsa_public_key?: string | null;
  rsa_private_key?: string | null;
}

export interface UserArchiveData {
  posts: any[];
  libraries: any[];
  billingHistory: any[];
  auditHistory: any[];
  bookmarks: any[];
  following: string[];
  followers: string[];
}

export interface IDatabase {
  isOpen(): boolean;
  getUserById(id: number): any;
  getUserByUsername(username: string): any;
  getUserByEmail(email: string): any;
  getUserFederationInfo(userId: number): UserFederationInfo | undefined;
  getRemoteFollowersInboxes(authorId: number): { inbox_url: string }[];
  getTotalUsersCount(): number;
  getTotalPostsCount(): number;
  setUserCreditBalance(userId: number, balance: number): void;
  linkOAuthAccount(
    userId: number,
    provider: string,
    providerUserId: string,
    accessToken?: string,
    refreshToken?: string,
    expiresAt?: string,
  ): void;
  getUserArchiveData(userId: number): UserArchiveData | null;
  getAllArtifactViews(): any[];
  updateArtifactViewConfig(id: number, viewConfig: string): void;
}
