// SPDX-License-Identifier: AGPL-3.0-or-later

export type NotificationCategory = "all" | "engineering" | "packages" | "mentions" | "system";

export interface NotificationActor {
  username?: string | undefined;
  display_name?: string | undefined;
  avatar_url?: string | undefined;
  [key: string]: unknown;
}

export interface NotificationItem {
  id: string | number;
  type: string;
  read: number | boolean;
  created_at?: string | undefined;
  actor_username?: string | undefined;
  actor_display_name?: string | undefined;
  actor_avatar_url?: string | undefined;
  actors?: NotificationActor[] | undefined;
  post_id?: string | number | undefined;
  post_author?: string | undefined;
  author_username?: string | undefined;
  post_content?: string | undefined;
  post_artifact_type?: string | undefined;
  post_artifact_config?: string | undefined;
  job_id?: string | number | undefined;
  package_name?: string | undefined;
  metadata?:
    | {
        name?: string | undefined;
        jobId?: string | number | undefined;
        packageName?: string | undefined;
        packageVersion?: string | undefined;
        distTag?: string | undefined;
        totalFiles?: number | undefined;
        profile?: string | undefined;
        duration?: number | string | undefined;
        error?: string | undefined;
        reason?: string | undefined;
        message?: string | undefined;
        balance?: number | string | undefined;
        [key: string]: unknown;
      }
    | undefined;
  isGroup?: boolean | undefined;
  [key: string]: unknown;
}
