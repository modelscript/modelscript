// SPDX-License-Identifier: AGPL-3.0-or-later

import { BellIcon } from "@primer/octicons-react";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getNotifications, markNotificationsRead } from "../api";
import { useAuth } from "../AuthContext";
import Box from "../components/Box";
import EmptyState from "../components/EmptyState";
import { usePageTitle } from "../util/title";
import type { NotificationCategory, NotificationItem } from "./notifications";
import {
  computeCategoryUnreadCounts,
  EngineeringNotificationCard,
  getNotificationIdsToMark,
  groupNotifications,
  matchesNotificationCategory,
  NotificationSectionDivider,
  NotificationsHeader,
  partitionNotificationsBySession,
  SectionDividerBadge,
  SectionDividerDot,
  SectionDividerMeta,
  SocialNotificationRow,
} from "./notifications";

export type { NotificationCategory };

const VIEWPORT_DWELL_MS = 1500;
const BATCH_FLUSH_DELAY_MS = 120;

const NotificationsPage: React.FC = () => {
  usePageTitle("Notifications");
  const { token, user, setUnreadCount, refreshUnreadCount } = useAuth();
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [sessionNewIds, setSessionNewIds] = useState<Set<string | number>>(() => new Set());
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<NotificationCategory>("all");
  const [unreadOnly, setUnreadOnly] = useState(false);

  const feedContainerRef = useRef<HTMLDivElement | null>(null);
  const notificationsRef = useRef<NotificationItem[]>([]);
  const dwellTimersRef = useRef<Map<string | number, ReturnType<typeof setTimeout>>>(new Map());
  const pendingReadIdsRef = useRef<Set<string | number>>(new Set());
  const batchFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    notificationsRef.current = notifications;
  }, [notifications]);

  // Stage 1: Clear the global navigation badge immediately upon opening /notifications
  useEffect(() => {
    setUnreadCount(0);
  }, [setUnreadCount]);

  const fetchNotifications = useCallback(async () => {
    if (!token) return;
    try {
      const data = await getNotifications();
      const grouped = groupNotifications(data.notifications || []);
      setNotifications(grouped);
      setSessionNewIds((prev) => {
        const next = new Set(prev);
        for (const item of grouped) {
          if (!item.read) {
            next.add(item.id);
          }
        }
        return next;
      });
      // Keep global nav badge at 0 while viewing /notifications
      setUnreadCount(0);
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

  const markBatchRead = useCallback(
    (targetRowIds: Array<string | number>) => {
      if (targetRowIds.length === 0) return;
      const rowIdSet = new Set(targetRowIds.map((id) => String(id)));
      const dbIdsToMark: Array<string | number> = [];

      for (const n of notificationsRef.current) {
        if (rowIdSet.has(String(n.id)) && !n.read) {
          dbIdsToMark.push(...getNotificationIdsToMark(n));
        }
      }

      if (token && dbIdsToMark.length > 0) {
        markNotificationsRead(dbIdsToMark).catch(() => {});
      }

      setNotifications((prev) => {
        let changed = false;
        const next = prev.map((n) => {
          if (rowIdSet.has(String(n.id)) && !n.read) {
            changed = true;
            return { ...n, read: 1 };
          }
          return n;
        });
        if (changed) {
          setUnreadCount(0);
        }
        return changed ? next : prev;
      });
    },
    [token, setUnreadCount],
  );

  const flushPendingReads = useCallback(() => {
    if (batchFlushTimerRef.current) {
      clearTimeout(batchFlushTimerRef.current);
      batchFlushTimerRef.current = null;
    }
    if (pendingReadIdsRef.current.size === 0) return;
    const ids = Array.from(pendingReadIdsRef.current);
    pendingReadIdsRef.current.clear();
    markBatchRead(ids);
  }, [markBatchRead]);

  const queueDwellRead = useCallback(
    (rowId: string | number) => {
      pendingReadIdsRef.current.add(rowId);
      if (!batchFlushTimerRef.current) {
        batchFlushTimerRef.current = setTimeout(() => {
          batchFlushTimerRef.current = null;
          flushPendingReads();
        }, BATCH_FLUSH_DELAY_MS);
      }
    },
    [flushPendingReads],
  );

  const markSingleRead = useCallback(
    (id: string | number) => {
      const existingTimer = dwellTimersRef.current.get(String(id));
      if (existingTimer) {
        clearTimeout(existingTimer);
        dwellTimersRef.current.delete(String(id));
      }
      markBatchRead([id]);
    },
    [markBatchRead],
  );

  const markAllRead = useCallback(() => {
    if (!token) return;
    for (const timer of dwellTimersRef.current.values()) {
      clearTimeout(timer);
    }
    dwellTimersRef.current.clear();
    pendingReadIdsRef.current.clear();

    const cat = activeTab === "all" ? undefined : activeTab;
    setNotifications((prev) => prev.map((n) => (matchesNotificationCategory(n, activeTab) ? { ...n, read: 1 } : n)));
    setUnreadCount(0);
    markNotificationsRead(cat)
      .then(() => {
        refreshUnreadCount();
      })
      .catch(() => {});
  }, [token, activeTab, setUnreadCount, refreshUnreadCount]);

  // Flush any active dwell timers and viewed tab unread items when switching tabs
  const handleSelectTab = useCallback(
    (nextTab: NotificationCategory) => {
      if (nextTab === activeTab) return;
      const activeIdsToFlush = new Set<string | number>(pendingReadIdsRef.current);
      for (const [idKey, timer] of dwellTimersRef.current.entries()) {
        clearTimeout(timer);
        activeIdsToFlush.add(idKey);
      }
      dwellTimersRef.current.clear();
      pendingReadIdsRef.current.clear();
      if (activeIdsToFlush.size > 0) {
        markBatchRead(Array.from(activeIdsToFlush));
      }
      setActiveTab(nextTab);
    },
    [activeTab, markBatchRead],
  );

  const unreadCounts = useMemo(() => computeCategoryUnreadCounts(notifications), [notifications]);

  const filteredNotifications = useMemo(() => {
    return notifications.filter((notif) => {
      if (unreadOnly && notif.read) return false;
      return matchesNotificationCategory(notif, activeTab);
    });
  }, [notifications, activeTab, unreadOnly]);

  const { newNotifications, earlierNotifications } = useMemo(
    () => partitionNotificationsBySession(filteredNotifications, sessionNewIds),
    [filteredNotifications, sessionNewIds],
  );

  const activeNewUnreadCount = useMemo(() => newNotifications.filter((n) => !n.read).length, [newNotifications]);

  // Stage 2: ~1.5s viewport dwell observer to smoothly fade out unread highlights as user views/scrolls
  useEffect(() => {
    if (loading) return;
    const container = feedContainerRef.current;
    const unreadInView = filteredNotifications.filter((n) => !n.read);
    if (unreadInView.length === 0) return;

    const timers = dwellTimersRef.current;

    const startDwellForId = (rowId: string) => {
      if (timers.has(rowId)) return;
      const timer = setTimeout(() => {
        timers.delete(rowId);
        queueDwellRead(rowId);
      }, VIEWPORT_DWELL_MS);
      timers.set(rowId, timer);
    };

    const cancelDwellForId = (rowId: string) => {
      const existing = timers.get(rowId);
      if (existing) {
        clearTimeout(existing);
        timers.delete(rowId);
      }
    };

    let observer: IntersectionObserver | null = null;
    if (typeof IntersectionObserver !== "undefined" && container) {
      observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            const el = entry.target as HTMLElement;
            const rowId = el.getAttribute("data-notification-id");
            const isUnread = el.getAttribute("data-unread") === "true";
            if (!rowId || !isUnread) continue;
            if (entry.isIntersecting) {
              startDwellForId(rowId);
            } else {
              cancelDwellForId(rowId);
            }
          }
        },
        { threshold: 0.35 },
      );

      const unreadEls = container.querySelectorAll<HTMLElement>('[data-notification-id][data-unread="true"]');
      unreadEls.forEach((el) => observer?.observe(el));
    }

    // Fallback for above-the-fold items in case IntersectionObserver misses initial layout frame
    const fallbackTimer = setTimeout(() => {
      if (container && typeof window !== "undefined") {
        const unreadEls = container.querySelectorAll<HTMLElement>('[data-notification-id][data-unread="true"]');
        const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 800;
        unreadEls.forEach((el) => {
          const rowId = el.getAttribute("data-notification-id");
          if (!rowId || timers.has(rowId)) return;
          const rect = el.getBoundingClientRect();
          if (rect.bottom > 0 && rect.top < viewportHeight) {
            queueDwellRead(rowId);
          }
        });
      } else {
        for (const notif of unreadInView.slice(0, 8)) {
          const key = String(notif.id);
          if (!timers.has(key)) {
            queueDwellRead(key);
          }
        }
      }
    }, VIEWPORT_DWELL_MS + 150);

    return () => {
      observer?.disconnect();
      clearTimeout(fallbackTimer);
    };
  }, [loading, filteredNotifications, queueDwellRead]);

  // Flush any remaining unread items when leaving /notifications (unmount or pagehide)
  useEffect(() => {
    const flushAllOnExit = () => {
      for (const timer of dwellTimersRef.current.values()) {
        clearTimeout(timer);
      }
      dwellTimersRef.current.clear();
      if (batchFlushTimerRef.current) {
        clearTimeout(batchFlushTimerRef.current);
        batchFlushTimerRef.current = null;
      }
      pendingReadIdsRef.current.clear();

      const hasRemainingUnread = notificationsRef.current.some((n) => !n.read);
      if (token && hasRemainingUnread) {
        setUnreadCount(0);
        markNotificationsRead().catch(() => {});
      }
    };

    window.addEventListener("pagehide", flushAllOnExit);
    return () => {
      window.removeEventListener("pagehide", flushAllOnExit);
      flushAllOnExit();
    };
  }, [token, setUnreadCount]);

  const renderNotificationItem = (notif: NotificationItem) => {
    const isSimulation =
      notif.type === "simulation_completed" || notif.type === "simulation" || notif.type === "cae_completed";
    const isSimFailed = notif.type === "simulation_failed" || notif.type === "cae_failed";
    const isPackage = notif.type === "package" || notif.type === "package_published" || notif.type === "package_yanked";
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
  };

  return (
    <Box>
      <NotificationsHeader
        activeTab={activeTab}
        setActiveTab={handleSelectTab}
        unreadOnly={unreadOnly}
        setUnreadOnly={setUnreadOnly}
        unreadCounts={unreadCounts}
        hasUnread={activeTab === "all" ? unreadCounts.all > 0 : unreadCounts[activeTab] > 0}
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
        <div ref={feedContainerRef}>
          {newNotifications.length > 0 && (
            <Box>
              <NotificationSectionDivider
                data-testid="notifications-new-divider"
                $variant="new"
                $hasActiveUnread={activeNewUnreadCount > 0}
              >
                <SectionDividerBadge $variant="new" $hasActiveUnread={activeNewUnreadCount > 0}>
                  <SectionDividerDot $active={activeNewUnreadCount > 0} />
                  New
                </SectionDividerBadge>
                <SectionDividerMeta>
                  {activeNewUnreadCount > 0 ? `${activeNewUnreadCount} unread` : "Just viewed"}
                </SectionDividerMeta>
              </NotificationSectionDivider>
              {newNotifications.map(renderNotificationItem)}
            </Box>
          )}

          {earlierNotifications.length > 0 && (
            <Box>
              {newNotifications.length > 0 && (
                <NotificationSectionDivider data-testid="notifications-earlier-divider" $variant="earlier">
                  <SectionDividerBadge $variant="earlier">Earlier</SectionDividerBadge>
                  <SectionDividerMeta>
                    {earlierNotifications.length} {earlierNotifications.length === 1 ? "notification" : "notifications"}
                  </SectionDividerMeta>
                </NotificationSectionDivider>
              )}
              {earlierNotifications.map(renderNotificationItem)}
            </Box>
          )}
        </div>
      )}
    </Box>
  );
};

export default NotificationsPage;
