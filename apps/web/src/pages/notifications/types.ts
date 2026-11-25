// SPDX-License-Identifier: AGPL-3.0-or-later

export type NotificationCategory = "all" | "engineering" | "packages" | "mentions" | "system";
export type InboxView = "inbox" | "saved" | "outbox" | "archive";
export type InboxLayoutPlacement = "left" | "right";
export type InboxDensity = "compact" | "comfortable";

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
  archived?: number | boolean | undefined;
  starred?: number | boolean | undefined;
  isBookmark?: boolean | undefined;
  isOutboxJob?: boolean | undefined;
  bookmarkedPost?: Record<string, unknown> | undefined;
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
        solver?: string | undefined;
        status?: string | undefined;
        costCredits?: number | string | undefined;
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
  "bookmark",
]);
const SYSTEM_NOTIFICATION_TYPES = new Set(["security_alert", "credit_warning"]);

export function isEngineeringNotification(notif: Pick<NotificationItem, "type">): boolean {
  return (
    ENGINEERING_NOTIFICATION_TYPES.has(notif.type) ||
    PACKAGE_NOTIFICATION_TYPES.has(notif.type) ||
    SYSTEM_NOTIFICATION_TYPES.has(notif.type)
  );
}

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

export function matchesNotificationSearch(notif: NotificationItem, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const meta = notif.metadata || {};
  const haystacks = [
    notif.type,
    notif.actor_username,
    notif.actor_display_name,
    notif.post_author,
    notif.post_content,
    notif.package_name,
    meta.name,
    meta.packageName,
    meta.packageVersion,
    meta.profile,
    meta.solver,
    meta.error,
    meta.reason,
    meta.message,
    ...(notif.actors || []).flatMap((a) => [a.username, a.display_name]),
  ];
  return haystacks.some((val) => typeof val === "string" && val.toLowerCase().includes(q));
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
    if (!n.read && !n.archived) {
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

export function computeInboxViewCounts(
  notifications: readonly NotificationItem[],
  bookmarkedItems: readonly NotificationItem[] = [],
  outboxItems: readonly NotificationItem[] = [],
): Record<InboxView, number> {
  let inbox = 0;
  let starredNotifs = 0;
  let archive = 0;
  let engineeringDispatched = 0;

  for (const n of notifications) {
    if (n.archived) {
      archive++;
    } else {
      inbox++;
    }
    if (n.starred) {
      starredNotifs++;
    }
    if (ENGINEERING_NOTIFICATION_TYPES.has(n.type) || PACKAGE_NOTIFICATION_TYPES.has(n.type)) {
      engineeringDispatched++;
    }
  }

  return {
    inbox,
    saved: starredNotifs + bookmarkedItems.length,
    outbox: outboxItems.length > 0 ? outboxItems.length : engineeringDispatched,
    archive,
  };
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asId(value: unknown): string | number | undefined {
  return typeof value === "string" || typeof value === "number" ? value : undefined;
}

export function bookmarkPostToNotificationItem(post: Record<string, unknown>): NotificationItem {
  const rawArtifactView = post["artifact_view"];
  const artifactView =
    rawArtifactView && typeof rawArtifactView === "object" && !Array.isArray(rawArtifactView)
      ? (rawArtifactView as Record<string, unknown>)
      : undefined;
  const viewConfig = artifactView?.["view_config"] ?? post["artifact_config"];
  const postId = asId(post["id"]);
  const username = asString(post["username"]);
  const displayName = asString(post["display_name"]);
  const avatarUrl = asString(post["avatar_url"]);
  return {
    id: `bookmark-${String(postId ?? "")}`,
    type: "bookmark",
    read: 1,
    starred: 1,
    archived: 0,
    isBookmark: true,
    bookmarkedPost: post,
    post_id: postId,
    actor_username: username || "engineer",
    actor_display_name: displayName || username || "Engineer",
    actor_avatar_url: avatarUrl,
    post_author: username,
    post_content: asString(post["content"]) || "",
    post_artifact_type: asString(artifactView?.["view_type"]) || asString(post["artifact_type"]),
    post_artifact_config:
      typeof viewConfig === "string" ? viewConfig : viewConfig ? JSON.stringify(viewConfig) : undefined,
    created_at: asString(post["created_at"]),
    actors: [
      {
        username: username || "engineer",
        display_name: displayName || username || "Engineer",
        avatar_url: avatarUrl,
      },
    ],
  };
}

export function hpcJobToNotificationItem(job: Record<string, unknown>, currentUsername?: string): NotificationItem {
  const status = asString(job["status"]);
  const isFailed = status === "failed" || status === "error" || status === "cancelled";
  const jobId = asId(job["id"]);
  const costCredits = job["costCredits"];
  return {
    id: `outbox-job-${String(jobId ?? "")}`,
    type: isFailed ? "simulation_failed" : "simulation_completed",
    read: 1,
    archived: 0,
    starred: 0,
    isOutboxJob: true,
    job_id: jobId,
    actor_username: currentUsername || "you",
    created_at: asString(job["completedAt"]) || asString(job["startedAt"]) || new Date().toISOString(),
    metadata: {
      name: asString(job["name"]) || `Job #${String(jobId ?? "")}`,
      jobId,
      profile: asString(job["computeProfile"]) || "standard",
      duration: typeof job["cpuSeconds"] === "number" ? job["cpuSeconds"].toFixed(2) : undefined,
      solver: asString(job["solver"]) || "CVODE",
      status: status || "completed",
      costCredits: typeof costCredits === "number" || typeof costCredits === "string" ? costCredits : undefined,
    },
  };
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
        if (notif.starred) {
          group.starred = 1;
        }
        if (!notif.archived) {
          group.archived = 0;
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
