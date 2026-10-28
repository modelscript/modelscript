// SPDX-License-Identifier: AGPL-3.0-or-later

import { BellIcon } from "@primer/octicons-react";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { getNotifications, markNotificationsRead } from "../api";
import { useAuth } from "../AuthContext";
import Box from "../components/Box";
import EmptyState from "../components/EmptyState";
import { usePageTitle } from "../util/title";
import type { NotificationCategory, NotificationItem } from "./notifications";
import {
  EngineeringNotificationCard,
  groupNotifications,
  NotificationsHeader,
  SocialNotificationRow,
} from "./notifications";

export type { NotificationCategory };

const NotificationsPage: React.FC = () => {
  usePageTitle("Notifications");
  const { token, user, setUnreadCount, refreshUnreadCount } = useAuth();
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<NotificationCategory>("all");
  const [unreadOnly, setUnreadOnly] = useState(false);

  const fetchNotifications = useCallback(async () => {
    if (!token) return;
    try {
      const data = await getNotifications();
      const grouped = groupNotifications(data.notifications || []);
      setNotifications(grouped);
      if (typeof data.unreadCount === "number") {
        setUnreadCount(data.unreadCount);
      } else {
        setUnreadCount(grouped.filter((n) => !n.read).length);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [token, setUnreadCount]);

  useEffect(() => {
    if (!token) {
      setLoading(false);
      return;
    }
    void fetchNotifications();
  }, [token, fetchNotifications]);

  const markSingleRead = useCallback(
    (id: string | number) => {
      if (token) {
        markNotificationsRead().catch(() => {});
      }
      setNotifications((prev) => {
        let decremented = false;
        const next = prev.map((n) => {
          if (n.id === id && !n.read) {
            decremented = true;
            return { ...n, read: 1 };
          }
          return n;
        });
        if (decremented) {
          const remainingUnread = next.filter((n) => !n.read).length;
          setUnreadCount(remainingUnread);
        }
        return next;
      });
    },
    [token, setUnreadCount],
  );

  const markAllRead = () => {
    if (!token) return;
    const cat = activeTab === "all" ? undefined : activeTab;
    markNotificationsRead(cat)
      .then(() => {
        setNotifications((prev) => {
          const next = prev.map((n) => {
            if (activeTab === "all") return { ...n, read: 1 };
            if (
              activeTab === "engineering" &&
              ["simulation", "simulation_completed", "simulation_failed"].includes(n.type)
            ) {
              return { ...n, read: 1 };
            }
            if (activeTab === "packages" && ["package", "package_published", "package_yanked"].includes(n.type)) {
              return { ...n, read: 1 };
            }
            if (activeTab === "mentions" && ["mention", "reply", "repost", "like", "follow"].includes(n.type)) {
              return { ...n, read: 1 };
            }
            if (activeTab === "system" && ["security_alert", "credit_warning"].includes(n.type)) {
              return { ...n, read: 1 };
            }
            return n;
          });
          const remainingUnread = next.filter((n) => !n.read).length;
          setUnreadCount(activeTab === "all" ? 0 : remainingUnread);
          return next;
        });
        refreshUnreadCount();
      })
      .catch(() => {});
  };

  const unreadCounts = useMemo(() => {
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
        if (["simulation", "simulation_completed", "simulation_failed"].includes(n.type)) {
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
  }, [notifications]);

  const filteredNotifications = useMemo(() => {
    return notifications.filter((notif) => {
      if (unreadOnly && notif.read) return false;
      if (activeTab === "engineering") {
        return ["simulation", "simulation_completed", "simulation_failed"].includes(notif.type);
      }
      if (activeTab === "packages") {
        return ["package", "package_published", "package_yanked"].includes(notif.type);
      }
      if (activeTab === "mentions") {
        return ["mention", "reply", "repost", "like", "follow"].includes(notif.type);
      }
      if (activeTab === "system") {
        return ["security_alert", "credit_warning"].includes(notif.type);
      }
      return true;
    });
  }, [notifications, activeTab, unreadOnly]);

  return (
    <Box>
      <NotificationsHeader
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        unreadOnly={unreadOnly}
        setUnreadOnly={setUnreadOnly}
        unreadCounts={unreadCounts}
        hasUnread={notifications.some((n) => !n.read)}
        onMarkAllRead={markAllRead}
      />

      {loading ? (
        <Box aria-busy="true" aria-label="Loading notifications">
          {[0, 1, 2, 3].map((i) => (
            <Box
              key={i}
              display="flex"
              gap="14px"
              p="16px 20px"
              style={{ borderBottom: "1px solid var(--color-border-default)" }}
            >
              <div className="skeleton" style={{ width: 36, height: 36, borderRadius: "50%", flexShrink: 0 }} />
              <Box flex={1} display="flex" flexDirection="column" gap="8px">
                <div className="skeleton" style={{ width: `${55 - i * 6}%`, height: 14, borderRadius: 4 }} />
                <div className="skeleton" style={{ width: `${85 - i * 8}%`, height: 13, borderRadius: 4 }} />
              </Box>
            </Box>
          ))}
        </Box>
      ) : filteredNotifications.length === 0 ? (
        <EmptyState
          icon={<BellIcon size={24} />}
          title={unreadOnly ? "No unread notifications" : "No notifications yet"}
          body={
            unreadOnly
              ? "You're all caught up on unread notifications in this category."
              : "When simulations complete, packages publish, or engineers mention your work, notifications will appear here."
          }
        />
      ) : (
        <Box>
          {filteredNotifications.map((notif) => {
            const isSimulation = notif.type === "simulation_completed" || notif.type === "simulation";
            const isSimFailed = notif.type === "simulation_failed";
            const isPackage = notif.type === "package" || notif.type === "package_published";
            const isSecurity = notif.type === "security_alert";
            const isCredit = notif.type === "credit_warning";

            if (isSimulation || isSimFailed || isPackage || isSecurity || isCredit) {
              return <EngineeringNotificationCard key={notif.id} notif={notif} onMarkRead={markSingleRead} />;
            }

            return (
              <SocialNotificationRow
                key={notif.id}
                notif={notif}
                currentUsername={user?.username}
                onMarkRead={markSingleRead}
              />
            );
          })}
        </Box>
      )}
    </Box>
  );
};

export default NotificationsPage;
