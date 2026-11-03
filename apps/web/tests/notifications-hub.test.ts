// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";

export type NotificationCategory = "all" | "engineering" | "packages" | "mentions" | "system";

interface NotificationItem {
  id: number;
  type: string;
  read: number;
  created_at: string;
  metadata?: Record<string, any>;
  actor_username?: string;
  post_id?: number;
}

/**
 * Filter notifications by category and unread status.
 */
function filterNotifications(
  notifications: NotificationItem[],
  category: NotificationCategory,
  unreadOnly = false,
): NotificationItem[] {
  return notifications.filter((notif) => {
    if (unreadOnly && notif.read) return false;
    if (category === "engineering") {
      return ["simulation", "simulation_completed", "simulation_failed", "cae_completed", "cae_failed"].includes(
        notif.type,
      );
    }
    if (category === "packages") {
      return ["package", "package_published", "package_yanked"].includes(notif.type);
    }
    if (category === "mentions") {
      return ["mention", "reply", "repost", "like", "follow"].includes(notif.type);
    }
    if (category === "system") {
      return ["security_alert", "credit_warning"].includes(notif.type);
    }
    return true;
  });
}

/**
 * Compute unread count breakdown across categories.
 */
function computeCategoryUnreadCounts(notifications: NotificationItem[]): Record<NotificationCategory, number> {
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
      if (["simulation", "simulation_completed", "simulation_failed", "cae_completed", "cae_failed"].includes(n.type)) {
        counts.engineering++;
      } else if (["package", "package_published", "package_yanked"].includes(n.type)) {
        counts.packages++;
      } else if (["mention", "reply", "repost", "like", "follow"].includes(n.type)) {
        counts.mentions++;
      } else if (["security_alert", "credit_warning"].includes(n.type)) {
        counts.system++;
      }
    }
  }

  return counts;
}

describe("Platform Engineering & Notifications Hub", () => {
  const mockNotifications: NotificationItem[] = [
    {
      id: 1,
      type: "simulation_completed",
      read: 0,
      created_at: new Date(Date.now() - 60000).toISOString(),
      metadata: {
        jobId: "job-001",
        name: "Modelica.Electrical.Analog.Examples.ChuaCircuit",
        duration: "0.84",
        profile: "hpc-cpu-4x",
        status: "completed",
      },
    },
    {
      id: 2,
      type: "simulation_failed",
      read: 0,
      created_at: new Date(Date.now() - 120000).toISOString(),
      metadata: {
        jobId: "job-002",
        name: "Modelica.Fluid.Examples.DrumBoiler",
        error: "Singular Jacobian matrix at t = 14.2s",
        status: "failed",
      },
    },
    {
      id: 3,
      type: "package_published",
      read: 1, // already read
      created_at: new Date(Date.now() - 3600000).toISOString(),
      metadata: {
        packageName: "@modelscript/thermo",
        packageVersion: "1.4.0",
        distTag: "latest",
        totalFiles: 18,
      },
    },
    {
      id: 4,
      type: "mention",
      read: 0,
      created_at: new Date(Date.now() - 180000).toISOString(),
      actor_username: "bob",
      post_id: 104,
    },
    {
      id: 5,
      type: "credit_warning",
      read: 0,
      created_at: new Date(Date.now() - 300000).toISOString(),
      metadata: {
        balance: 6.2,
        threshold: 10,
        message: "Balance below 10 credits",
      },
    },
    {
      id: 6,
      type: "security_alert",
      read: 1,
      created_at: new Date(Date.now() - 86400000).toISOString(),
      metadata: {
        packageName: "open-solver",
        packageVersion: "0.4.1",
        reason: "CVE-2026-9011 buffer overrun vulnerability",
        severity: "critical",
      },
    },
  ];

  it("calculates accurate unread count breakdowns per category", () => {
    const counts = computeCategoryUnreadCounts(mockNotifications);
    assert.strictEqual(counts.all, 4); // 4 unread items out of 6
    assert.strictEqual(counts.engineering, 2);
    assert.strictEqual(counts.packages, 0); // only 1 package item and it is read=1
    assert.strictEqual(counts.mentions, 1);
    assert.strictEqual(counts.system, 1); // credit_warning is read=0, security_alert is read=1
  });

  it("filters notifications by engineering category", () => {
    const eng = filterNotifications(mockNotifications, "engineering");
    assert.strictEqual(eng.length, 2);
    assert.ok(eng.every((n) => n.type.startsWith("simulation")));
    assert.strictEqual(eng[0].metadata?.name, "Modelica.Electrical.Analog.Examples.ChuaCircuit");
    assert.strictEqual(eng[1].metadata?.error, "Singular Jacobian matrix at t = 14.2s");
  });

  it("filters notifications by package registry category", () => {
    const pkgs = filterNotifications(mockNotifications, "packages");
    assert.strictEqual(pkgs.length, 1);
    assert.strictEqual(pkgs[0].metadata?.packageName, "@modelscript/thermo");
    assert.strictEqual(pkgs[0].metadata?.packageVersion, "1.4.0");
  });

  it("filters notifications by system and billing category", () => {
    const sys = filterNotifications(mockNotifications, "system");
    assert.strictEqual(sys.length, 2);
    assert.ok(sys.some((n) => n.type === "credit_warning"));
    assert.ok(sys.some((n) => n.type === "security_alert"));
  });

  it("respects unread-only filtering across all categories", () => {
    const unreadAll = filterNotifications(mockNotifications, "all", true);
    assert.strictEqual(unreadAll.length, 4);
    assert.ok(unreadAll.every((n) => n.read === 0));

    const unreadPkgs = filterNotifications(mockNotifications, "packages", true);
    assert.strictEqual(unreadPkgs.length, 0);

    const unreadSys = filterNotifications(mockNotifications, "system", true);
    assert.strictEqual(unreadSys.length, 1);
    assert.strictEqual(unreadSys[0].type, "credit_warning");
  });

  it("formats engineering card metadata correctly", () => {
    const sim = mockNotifications[0];
    assert.strictEqual(sim.metadata?.name, "Modelica.Electrical.Analog.Examples.ChuaCircuit");
    assert.strictEqual(sim.metadata?.duration, "0.84");
    assert.strictEqual(sim.metadata?.profile, "hpc-cpu-4x");

    // Route navigation url targets
    const playgroundUrl = `/playground?model=${encodeURIComponent(sim.metadata?.name)}`;
    assert.strictEqual(playgroundUrl, "/playground?model=Modelica.Electrical.Analog.Examples.ChuaCircuit");
  });

  it("counts multiple likes on the same post as 1 unread notification when grouped", async () => {
    const { groupNotifications } = await import("../src/pages/notifications/types.ts");
    const rawLikes: NotificationItem[] = [
      {
        id: 10,
        type: "like",
        read: 0,
        created_at: new Date().toISOString(),
        actor_username: "alice",
        post_id: 999,
      },
      {
        id: 11,
        type: "like",
        read: 0,
        created_at: new Date().toISOString(),
        actor_username: "bob",
        post_id: 999,
      },
      {
        id: 12,
        type: "like",
        read: 0,
        created_at: new Date().toISOString(),
        actor_username: "charlie",
        post_id: 999,
      },
    ];
    const grouped = groupNotifications(rawLikes as any);
    assert.strictEqual(grouped.length, 1);
    assert.deepStrictEqual(grouped[0]!.groupedIds, [10, 11, 12]);
    const counts = computeCategoryUnreadCounts(grouped as unknown as NotificationItem[]);
    assert.strictEqual(counts.all, 1);
    assert.strictEqual(counts.mentions, 1);
  });

  it("extracts all constituent notification IDs when marking a grouped notification as read", async () => {
    const { groupNotifications, getNotificationIdsToMark } = await import("../src/pages/notifications/types.ts");
    const rawItems = [
      { id: 21, type: "repost", read: 1, actor_username: "alice", post_id: 500 },
      { id: 22, type: "repost", read: 0, actor_username: "bob", post_id: 500 },
      { id: 23, type: "mention", read: 0, actor_username: "carol", post_id: 501 },
    ];
    const grouped = groupNotifications(rawItems);
    assert.strictEqual(grouped.length, 2);
    // Even though the first repost (21) was read=1, the second repost (22) was read=0, so group is unread and tracks both IDs
    assert.strictEqual(grouped[0]!.read, 0);
    assert.deepStrictEqual(getNotificationIdsToMark(grouped[0]!), [21, 22]);
    assert.deepStrictEqual(getNotificationIdsToMark(grouped[1]!), [23]);
  });

  it("partitions freshly arrived notifications into 'New' and historical items into 'Earlier' without layout jump after dwell read", async () => {
    const { partitionNotificationsBySession, computeCategoryUnreadCounts: computeCounts } =
      await import("../src/pages/notifications/types.ts");

    const sessionNewIds = new Set<string | number>(mockNotifications.filter((n) => !n.read).map((n) => n.id));
    assert.deepStrictEqual(Array.from(sessionNewIds), [1, 2, 4, 5]);

    // Before 1.5s viewport dwell: 4 items in New (all unread), 2 items in Earlier (already read)
    const initialPartition = partitionNotificationsBySession(mockNotifications as any, sessionNewIds);
    assert.strictEqual(initialPartition.newNotifications.length, 4);
    assert.strictEqual(initialPartition.earlierNotifications.length, 2);
    assert.deepStrictEqual(
      initialPartition.earlierNotifications.map((n) => n.id),
      [3, 6],
    );

    // After 1.5s viewport dwell: items transition to read=1, highlights/counts clear to 0,
    // while New/Earlier section partitioning remains stable for the current visit
    const afterDwell = mockNotifications.map((n) => ({ ...n, read: 1 }));
    const postDwellCounts = computeCounts(afterDwell as any);
    assert.strictEqual(postDwellCounts.all, 0);

    const postDwellPartition = partitionNotificationsBySession(afterDwell as any, sessionNewIds);
    assert.strictEqual(postDwellPartition.newNotifications.length, 4);
    assert.strictEqual(postDwellPartition.newNotifications.filter((n) => !n.read).length, 0);
    assert.strictEqual(postDwellPartition.earlierNotifications.length, 2);
  });
});
