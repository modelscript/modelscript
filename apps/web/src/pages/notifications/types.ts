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
  groupedIds?: Array<string | number> | undefined;
  [key: string]: unknown;
}

const ENGINEERING_NOTIFICATION_TYPES = new Set([
  "simulation",
  "simulation_completed",
  "simulation_failed",
  "cae_completed",
  "cae_failed",
]);
const PACKAGE_NOTIFICATION_TYPES = new Set(["package", "package_published", "package_yanked"]);
const SOCIAL_NOTIFICATION_TYPES = new Set([
  "mention",
  "reply",
  "quote",
  "repost",
  "like",
  "follow",
  "follow_request",
  "follow_accepted",
]);
const SYSTEM_NOTIFICATION_TYPES = new Set(["security_alert", "credit_warning"]);

export function matchesNotificationCategory(
  notif: Pick<NotificationItem, "type">,
  category: NotificationCategory,
): boolean {
  if (category === "all") return true;
  if (category === "engineering") return ENGINEERING_NOTIFICATION_TYPES.has(notif.type);
  if (category === "packages") return PACKAGE_NOTIFICATION_TYPES.has(notif.type);
  if (category === "mentions") return SOCIAL_NOTIFICATION_TYPES.has(notif.type);
  if (category === "system") return SYSTEM_NOTIFICATION_TYPES.has(notif.type);
  return true;
}

export function computeCategoryUnreadCounts(
  notifications: readonly NotificationItem[],
): Record<NotificationCategory, number> {
  const counts: Record<NotificationCategory, number> = {
    all: 0,
    engineering: 0,
    packages: 0,
    mentions: 0,
    system: 0,
  };
  for (const n of notifications) {
    if (!n.read) {
      counts.all++;
      if (ENGINEERING_NOTIFICATION_TYPES.has(n.type)) {
        counts.engineering++;
      } else if (PACKAGE_NOTIFICATION_TYPES.has(n.type)) {
        counts.packages++;
      } else if (SOCIAL_NOTIFICATION_TYPES.has(n.type)) {
        counts.mentions++;
      } else if (SYSTEM_NOTIFICATION_TYPES.has(n.type)) {
        counts.system++;
      }
    }
  }
  return counts;
}

export function getNotificationIdsToMark(notif: NotificationItem): Array<string | number> {
  if (Array.isArray(notif.groupedIds) && notif.groupedIds.length > 0) {
    return notif.groupedIds;
  }
  return [notif.id];
}

export function partitionNotificationsBySession(
  notifications: readonly NotificationItem[],
  sessionNewIds: ReadonlySet<string | number>,
): {
  newNotifications: NotificationItem[];
  earlierNotifications: NotificationItem[];
} {
  const newNotifications: NotificationItem[] = [];
  const earlierNotifications: NotificationItem[] = [];

  for (const notif of notifications) {
    if (!notif.read || sessionNewIds.has(notif.id)) {
      newNotifications.push(notif);
    } else {
      earlierNotifications.push(notif);
    }
  }

  return { newNotifications, earlierNotifications };
}

export function groupNotifications(notifs: NotificationItem[]): NotificationItem[] {
  const grouped: NotificationItem[] = [];
  const postGroups = new Map<string, NotificationItem>();

  for (const notif of notifs) {
    if (notif.post_id && (notif.type === "like" || notif.type === "repost")) {
      const key = `${notif.type}-${notif.post_id}`;
      if (postGroups.has(key)) {
        const group = postGroups.get(key)!;
        if (!group.actors) {
          group.actors = [];
        }
        if (!group.actors.some((a) => a.username === notif.actor_username)) {
          group.actors.push({
            username: notif.actor_username,
            display_name: notif.actor_display_name,
            avatar_url: notif.actor_avatar_url,
          });
        }
        if (!group.groupedIds) {
          group.groupedIds = [group.id];
        }
        if (!group.groupedIds.includes(notif.id)) {
          group.groupedIds.push(notif.id);
        }
        if (notif.read === 0 || notif.read === false) {
          group.read = 0;
        }
      } else {
        const group: NotificationItem = {
          ...notif,
          isGroup: true,
          groupedIds: [notif.id],
          actors: [
            {
              username: notif.actor_username,
              display_name: notif.actor_display_name,
              avatar_url: notif.actor_avatar_url,
            },
          ],
        };
        postGroups.set(key, group);
        grouped.push(group);
      }
    } else {
      grouped.push({
        ...notif,
        isGroup: false,
        groupedIds: [notif.id],
        actors: [
          {
            username: notif.actor_username,
            display_name: notif.actor_display_name,
            avatar_url: notif.actor_avatar_url,
          },
        ],
      });
    }
  }

  return grouped;
}
