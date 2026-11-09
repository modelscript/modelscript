// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  ArchiveIcon,
  BellIcon,
  BookmarkIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  InboxIcon,
  PaperAirplaneIcon,
} from "@primer/octicons-react";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  bookmarkPost,
  getBookmarks,
  getNotifications,
  getUserHpcJobs,
  markNotificationsRead,
  triageNotifications,
} from "../api";
import { useAuth } from "../AuthContext";
import Box from "../components/Box";
import EmptyState from "../components/EmptyState";
import { usePageTitle } from "../util/title";
import type {
  InboxDensity,
  InboxLayoutPlacement,
  InboxView,
  NotificationCategory,
  NotificationItem,
} from "./notifications";
import {
  bookmarkPostToNotificationItem,
  computeCategoryUnreadCounts,
  computeInboxViewCounts,
  EngineeringNotificationCard,
  getNotificationIdsToMark,
  groupNotifications,
  hpcJobToNotificationItem,
  InboxReadingPane,
  InboxSplitLayout,
  matchesNotificationCategory,
  matchesNotificationSearch,
  NotificationSectionDivider,
  NotificationsHeader,
  partitionNotificationsBySession,
  SectionDividerBadge,
  SectionDividerDot,
  SectionDividerMeta,
  SocialNotificationRow,
  StreamPane,
} from "./notifications";

export type { InboxDensity, InboxLayoutPlacement, InboxView, NotificationCategory };

const VIEWPORT_DWELL_MS = 1500;
const BATCH_FLUSH_DELAY_MS = 120;
const VALID_INBOX_VIEWS = new Set<InboxView>(["inbox", "saved", "outbox", "archive"]);

export interface NotificationsPageProps {
  initialView?: InboxView | undefined;
}

const NotificationsPage: React.FC<NotificationsPageProps> = ({ initialView }) => {
  usePageTitle("Inbox");
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { token, user, setUnreadCount, refreshUnreadCount } = useAuth();

  const resolvedInitialView = useMemo<InboxView>(() => {
    const paramView = searchParams.get("view") as InboxView | null;
    if (paramView && VALID_INBOX_VIEWS.has(paramView)) return paramView;
    return initialView || "inbox";
  }, [searchParams, initialView]);

  const [activeView, setActiveViewState] = useState<InboxView>(resolvedInitialView);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [bookmarkedItems, setBookmarkedItems] = useState<NotificationItem[]>([]);
  const [outboxItems, setOutboxItems] = useState<NotificationItem[]>([]);
  const [sessionNewIds, setSessionNewIds] = useState<Set<string | number>>(() => new Set());
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<NotificationCategory>("all");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | number | null>(null);

  const [layoutPlacement, setLayoutPlacement] = useState<InboxLayoutPlacement>(() => {
    if (typeof window !== "undefined" && window.localStorage) {
      const saved = window.localStorage.getItem("modelscript:inbox-layout");
      if (saved === "right" || saved === "left") return saved;
    }
    return "left";
  });

  const handleToggleLayoutPlacement = useCallback(() => {
    setLayoutPlacement((prev) => {
      const next = prev === "left" ? "right" : "left";
      if (typeof window !== "undefined" && window.localStorage) {
        window.localStorage.setItem("modelscript:inbox-layout", next);
      }
      return next;
    });
  }, []);

  const [density, setDensity] = useState<InboxDensity>(() => {
    if (typeof window !== "undefined" && window.localStorage) {
      const saved = window.localStorage.getItem("modelscript:inbox-density");
      if (saved === "comfortable" || saved === "compact") return saved;
    }
    return "compact";
  });

  const handleToggleDensity = useCallback(() => {
    setDensity((prev) => {
      const next = prev === "compact" ? "comfortable" : "compact";
      if (typeof window !== "undefined" && window.localStorage) {
        window.localStorage.setItem("modelscript:inbox-density", next);
      }
      return next;
    });
  }, []);

  const [newSectionCollapsed, setNewSectionCollapsed] = useState(false);
  const [earlierSectionCollapsed, setEarlierSectionCollapsed] = useState(false);

  useEffect(() => {
    setActiveViewState(resolvedInitialView);
  }, [resolvedInitialView]);

  const handleSelectView = useCallback(
    (nextView: InboxView) => {
      setActiveViewState(nextView);
      const nextParams = new URLSearchParams(searchParams);
      if (nextView === "inbox" && !initialView) {
        nextParams.delete("view");
      } else {
        nextParams.set("view", nextView);
      }
      setSearchParams(nextParams, { replace: true });
    },
    [searchParams, setSearchParams, initialView],
  );

  const feedContainerRef = useRef<HTMLDivElement | null>(null);
  const notificationsRef = useRef<NotificationItem[]>([]);
  const dwellTimersRef = useRef<Map<string | number, ReturnType<typeof setTimeout>>>(new Map());
  const pendingReadIdsRef = useRef<Set<string | number>>(new Set());
  const batchFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    notificationsRef.current = notifications;
  }, [notifications]);

  // Stage 1: Clear the global navigation badge immediately upon opening /inbox or /notifications
  useEffect(() => {
    setUnreadCount(0);
  }, [setUnreadCount]);

  const fetchInboxData = useCallback(async () => {
    if (!token) return;
    try {
      const [notifData, bookmarkData, hpcJobs] = await Promise.all([
        getNotifications(),
        getBookmarks().catch(() => ({ posts: [] })),
        getUserHpcJobs(20).catch(() => []),
      ]);

      const grouped = groupNotifications(notifData.notifications || []);
      setNotifications(grouped);

      const convertedBookmarks = (bookmarkData.posts || []).map((p: Record<string, any>) =>
        bookmarkPostToNotificationItem(p),
      );
      setBookmarkedItems(convertedBookmarks);

      const convertedOutbox = (hpcJobs || []).map((j) =>
        hpcJobToNotificationItem(j as unknown as Record<string, any>, user?.username),
      );
      setOutboxItems(convertedOutbox);

      setSessionNewIds((prev) => {
        const next = new Set(prev);
        for (const item of grouped) {
          if (!item.read) {
            next.add(item.id);
          }
        }
        return next;
      });
      setUnreadCount(0);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [token, user?.username, setUnreadCount]);

  useEffect(() => {
    if (!token) {
      setNotifications([]);
      setBookmarkedItems([]);
      setOutboxItems([]);
      setLoading(false);
      return;
    }
    void fetchInboxData();
  }, [token, fetchInboxData]);

  // Sync bookmark removals when toggled elsewhere
  useEffect(() => {
    const handleBookmarkToggled = (e: Event) => {
      const detail = (e as CustomEvent<{ postId: number | string; bookmarked: boolean }>).detail;
      if (!detail || detail.bookmarked) return;
      setBookmarkedItems((prev) => prev.filter((item) => String(item.post_id) !== String(detail.postId)));
    };
    window.addEventListener("modelscript:bookmark-toggled", handleBookmarkToggled);
    return () => window.removeEventListener("modelscript:bookmark-toggled", handleBookmarkToggled);
  }, []);

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
  const viewCounts = useMemo(
    () => computeInboxViewCounts(notifications, bookmarkedItems, outboxItems),
    [notifications, bookmarkedItems, outboxItems],
  );

  const viewBaseItems = useMemo<NotificationItem[]>(() => {
    if (activeView === "saved") {
      const starredNotifs = notifications.filter((n) => Boolean(n.starred));
      return [...starredNotifs, ...bookmarkedItems];
    }
    if (activeView === "outbox") {
      if (outboxItems.length > 0) return outboxItems;
      return notifications.filter(
        (n) => matchesNotificationCategory(n, "engineering") || matchesNotificationCategory(n, "packages"),
      );
    }
    if (activeView === "archive") {
      return notifications.filter((n) => Boolean(n.archived));
    }
    return notifications.filter((n) => !n.archived);
  }, [activeView, notifications, bookmarkedItems, outboxItems]);

  const filteredNotifications = useMemo(() => {
    return viewBaseItems.filter((notif) => {
      if (unreadOnly && notif.read) return false;
      if (!matchesNotificationCategory(notif, activeTab)) return false;
      if (!matchesNotificationSearch(notif, searchQuery)) return false;
      return true;
    });
  }, [viewBaseItems, activeTab, unreadOnly, searchQuery]);

  // Keep selectedId valid when filtered list changes
  useEffect(() => {
    if (filteredNotifications.length === 0) {
      setSelectedId(null);
      return;
    }
    const stillPresent = filteredNotifications.some((n) => String(n.id) === String(selectedId));
    if (!stillPresent) {
      setSelectedId(filteredNotifications[0]!.id);
    }
  }, [filteredNotifications, selectedId]);

  const selectedItem = useMemo(
    () => filteredNotifications.find((n) => String(n.id) === String(selectedId)) || null,
    [filteredNotifications, selectedId],
  );

  const { newNotifications, earlierNotifications } = useMemo(
    () =>
      activeView === "inbox"
        ? partitionNotificationsBySession(filteredNotifications, sessionNewIds)
        : { newNotifications: [], earlierNotifications: filteredNotifications },
    [activeView, filteredNotifications, sessionNewIds],
  );

  const activeNewUnreadCount = useMemo(() => newNotifications.filter((n) => !n.read).length, [newNotifications]);

  // Triage handlers
  const handleToggleArchive = useCallback(
    (target: NotificationItem) => {
      if (target.isBookmark || target.isOutboxJob) return;
      const nextArchived = !target.archived;
      const targetIds = getNotificationIdsToMark(target);

      // Advance selection to neighbor before archiving out of view
      const currentIdx = filteredNotifications.findIndex((n) => String(n.id) === String(target.id));
      if (currentIdx !== -1 && filteredNotifications.length > 1) {
        const nextItem = filteredNotifications[currentIdx + 1] || filteredNotifications[currentIdx - 1];
        if (nextItem) setSelectedId(nextItem.id);
      }

      setNotifications((prev) =>
        prev.map((n) =>
          String(n.id) === String(target.id)
            ? { ...n, archived: nextArchived ? 1 : 0, ...(nextArchived ? { read: 1 } : {}) }
            : n,
        ),
      );

      if (token && targetIds.length > 0) {
        triageNotifications({ ids: targetIds, archived: nextArchived }).catch(() => {});
      }
    },
    [filteredNotifications, token],
  );

  const handleArchiveAll = useCallback(() => {
    if (!token) return;
    const cat = activeTab === "all" ? undefined : activeTab;
    setNotifications((prev) =>
      prev.map((n) => (!n.archived && matchesNotificationCategory(n, activeTab) ? { ...n, archived: 1, read: 1 } : n)),
    );
    setUnreadCount(0);
    triageNotifications({ category: cat, archived: true }).catch(() => {});
  }, [token, activeTab, setUnreadCount]);

  const handleToggleStar = useCallback(
    (target: NotificationItem) => {
      if (target.isOutboxJob) return;
      if (target.isBookmark && target.post_id) {
        setBookmarkedItems((prev) => prev.filter((item) => String(item.id) !== String(target.id)));
        if (token) {
          bookmarkPost(target.post_id).catch(() => {});
        }
        return;
      }
      const nextStarred = !target.starred;
      const targetIds = getNotificationIdsToMark(target);
      setNotifications((prev) =>
        prev.map((n) => (String(n.id) === String(target.id) ? { ...n, starred: nextStarred ? 1 : 0 } : n)),
      );
      if (token && targetIds.length > 0) {
        triageNotifications({ ids: targetIds, starred: nextStarred }).catch(() => {});
      }
    },
    [token],
  );

  const handleToggleRead = useCallback(
    (target: NotificationItem) => {
      if (target.isBookmark || target.isOutboxJob) return;
      const nextRead = !target.read;
      const targetIds = getNotificationIdsToMark(target);
      setNotifications((prev) =>
        prev.map((n) => (String(n.id) === String(target.id) ? { ...n, read: nextRead ? 1 : 0 } : n)),
      );
      if (token && targetIds.length > 0) {
        triageNotifications({ ids: targetIds, read: nextRead }).catch(() => {});
      }
    },
    [token],
  );

  const handleOpenPrimaryTarget = useCallback(
    (target: NotificationItem) => {
      if (!target.read && !target.isBookmark && !target.isOutboxJob) {
        markSingleRead(target.id);
      }
      const meta = target.metadata || {};
      const isSimulation =
        target.type === "simulation_completed" || target.type === "simulation" || target.type === "cae_completed";
      const isSimFailed = target.type === "simulation_failed" || target.type === "cae_failed";
      const isPackage =
        target.type === "package" || target.type === "package_published" || target.type === "package_yanked";

      if (isSimulation || isSimFailed) {
        if (meta.name) {
          navigate(`/morsel?model=${encodeURIComponent(meta.name)}`);
        } else {
          navigate(meta.jobId || target.job_id ? `/jobs/${meta.jobId || target.job_id}` : "/jobs");
        }
      } else if (isPackage) {
        navigate(
          meta.packageName || target.package_name
            ? `/packages/${meta.packageName || target.package_name}`
            : "/packages",
        );
      } else if (target.type === "credit_warning") {
        navigate("/settings/billing");
      } else if (target.type === "security_alert") {
        navigate("/settings/security");
      } else {
        const primaryActor = target.actors?.[0] || { username: target.actor_username };
        const postAuthor = target.post_author || target.author_username || user?.username || primaryActor.username;
        const isFollow =
          target.type === "follow" || target.type === "follow_request" || target.type === "follow_accepted";
        const url =
          isFollow || !target.post_id
            ? primaryActor.username
              ? `/@${primaryActor.username}`
              : "/home"
            : `/@${postAuthor}/status/${target.post_id}`;
        navigate(url);
      }
    },
    [markSingleRead, navigate, user?.username],
  );

  // Keyboard navigation & triage shortcuts (J/K, E, S, U, Enter)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const targetEl = e.target as HTMLElement | null;
      if (
        !targetEl ||
        targetEl.tagName === "INPUT" ||
        targetEl.tagName === "TEXTAREA" ||
        targetEl.isContentEditable ||
        e.metaKey ||
        e.ctrlKey ||
        e.altKey
      ) {
        return;
      }

      if (filteredNotifications.length === 0) return;
      const currentIdx = filteredNotifications.findIndex((n) => String(n.id) === String(selectedId));

      if (e.key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        const nextIdx = currentIdx < filteredNotifications.length - 1 ? currentIdx + 1 : 0;
        const nextItem = filteredNotifications[nextIdx];
        if (nextItem) {
          setSelectedId(nextItem.id);
          if (!nextItem.read && !nextItem.isBookmark && !nextItem.isOutboxJob) {
            markSingleRead(nextItem.id);
          }
        }
      } else if (e.key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        const prevIdx = currentIdx > 0 ? currentIdx - 1 : filteredNotifications.length - 1;
        const prevItem = filteredNotifications[prevIdx];
        if (prevItem) {
          setSelectedId(prevItem.id);
          if (!prevItem.read && !prevItem.isBookmark && !prevItem.isOutboxJob) {
            markSingleRead(prevItem.id);
          }
        }
      } else if (e.key === "e" && selectedItem) {
        e.preventDefault();
        handleToggleArchive(selectedItem);
      } else if (e.key === "s" && selectedItem) {
        e.preventDefault();
        handleToggleStar(selectedItem);
      } else if (e.key === "u" && selectedItem) {
        e.preventDefault();
        handleToggleRead(selectedItem);
      } else if (e.key === "Enter" && selectedItem) {
        e.preventDefault();
        handleOpenPrimaryTarget(selectedItem);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    filteredNotifications,
    selectedId,
    selectedItem,
    markSingleRead,
    handleToggleArchive,
    handleToggleStar,
    handleToggleRead,
    handleOpenPrimaryTarget,
  ]);

  // Stage 2: ~1.5s viewport dwell observer to smoothly fade out unread highlights as user views/scrolls
  useEffect(() => {
    if (loading || activeView !== "inbox") return;
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
        { root: container, threshold: 0.35 },
      );

      const unreadEls = container.querySelectorAll<HTMLElement>('[data-notification-id][data-unread="true"]');
      unreadEls.forEach((el) => observer?.observe(el));
    }

    const fallbackTimer = setTimeout(() => {
      if (container && typeof window !== "undefined") {
        const unreadEls = container.querySelectorAll<HTMLElement>('[data-notification-id][data-unread="true"]');
        const containerRect = container.getBoundingClientRect();
        unreadEls.forEach((el) => {
          const rowId = el.getAttribute("data-notification-id");
          if (!rowId || timers.has(rowId)) return;
          const rect = el.getBoundingClientRect();
          if (rect.bottom > containerRect.top && rect.top < containerRect.bottom) {
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
  }, [loading, activeView, filteredNotifications, queueDwellRead]);

  // Flush any remaining unread items when leaving /inbox (unmount or pagehide)
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

      const hasRemainingUnread = notificationsRef.current.some((n) => !n.read && !n.archived);
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

  const handleSelectItem = useCallback((notif: NotificationItem) => {
    setSelectedId(notif.id);
  }, []);

  const renderNotificationItem = (notif: NotificationItem) => {
    const isSelected = String(notif.id) === String(selectedId);
    const isSimulation =
      notif.type === "simulation_completed" || notif.type === "simulation" || notif.type === "cae_completed";
    const isSimFailed = notif.type === "simulation_failed" || notif.type === "cae_failed";
    const isPackage = notif.type === "package" || notif.type === "package_published" || notif.type === "package_yanked";
    const isSecurity = notif.type === "security_alert";
    const isCredit = notif.type === "credit_warning";

    if (isSimulation || isSimFailed || isPackage || isSecurity || isCredit) {
      return (
        <EngineeringNotificationCard
          key={notif.id}
          notif={notif}
          selected={isSelected}
          density={density}
          onSelect={handleSelectItem}
          onMarkRead={markSingleRead}
          onToggleStar={handleToggleStar}
          onToggleArchive={handleToggleArchive}
        />
      );
    }

    return (
      <SocialNotificationRow
        key={notif.id}
        notif={notif}
        currentUsername={user?.username}
        selected={isSelected}
        density={density}
        onSelect={handleSelectItem}
        onMarkRead={markSingleRead}
        onToggleStar={handleToggleStar}
        onToggleArchive={handleToggleArchive}
      />
    );
  };

  const renderEmptyState = () => {
    if (searchQuery.trim()) {
      return (
        <EmptyState
          icon={<InboxIcon size={24} />}
          title="No items match your filter"
          body="Try clearing the search query or switching domain categories."
        />
      );
    }
    if (activeView === "saved") {
      return (
        <EmptyState
          icon={<BookmarkIcon size={24} />}
          title="No saved items or bookmarks yet"
          body="Bookmark posts, models, and simulations across the platform or press S on any inbox item to save it here for quick reference."
        />
      );
    }
    if (activeView === "outbox") {
      return (
        <EmptyState
          icon={<PaperAirplaneIcon size={24} />}
          title="No dispatched engineering runs yet"
          body="When you dispatch cloud simulations, HPC Slurm jobs, or publish packages, your outgoing run history will appear here."
        />
      );
    }
    if (activeView === "archive") {
      return (
        <EmptyState
          icon={<ArchiveIcon size={24} />}
          title="Archive is empty"
          body="Items you mark as done (E) in your Inbox will be stored here."
        />
      );
    }
    return (
      <EmptyState
        icon={<BellIcon size={24} />}
        title={unreadOnly ? "No unread items in Inbox" : "Inbox Zero — you're all caught up"}
        body={
          unreadOnly
            ? "You're all caught up on unread notifications in this category."
            : "When simulations complete, packages publish, or engineers mention your work, items will appear here."
        }
      />
    );
  };

  return (
    <Box>
      <NotificationsHeader
        activeView={activeView}
        setActiveView={handleSelectView}
        viewCounts={viewCounts}
        activeTab={activeTab}
        setActiveTab={handleSelectTab}
        unreadOnly={unreadOnly}
        setUnreadOnly={setUnreadOnly}
        unreadCounts={unreadCounts}
        hasUnread={activeTab === "all" ? unreadCounts.all > 0 : unreadCounts[activeTab] > 0}
        onMarkAllRead={markAllRead}
        onArchiveAll={handleArchiveAll}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        layoutPlacement={layoutPlacement}
        onToggleLayoutPlacement={handleToggleLayoutPlacement}
        density={density}
        onToggleDensity={handleToggleDensity}
      />

      {loading ? (
        <Box aria-busy="true" aria-label="Loading inbox">
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
        renderEmptyState()
      ) : (
        <InboxSplitLayout data-testid="inbox-split-layout" $layoutPlacement={layoutPlacement}>
          {layoutPlacement === "right" ? (
            <>
              <InboxReadingPane
                selectedItem={selectedItem}
                activeView={activeView}
                currentUsername={user?.username}
                onToggleArchive={handleToggleArchive}
                onToggleStar={handleToggleStar}
                onToggleRead={handleToggleRead}
                onOpenPrimaryTarget={handleOpenPrimaryTarget}
              />
              <StreamPane ref={feedContainerRef} data-testid="inbox-stream-pane" $placement="right">
                {newNotifications.length > 0 && (
                  <Box>
                    <NotificationSectionDivider
                      data-testid="notifications-new-divider"
                      $variant="new"
                      $hasActiveUnread={activeNewUnreadCount > 0}
                      onClick={() => setNewSectionCollapsed((prev) => !prev)}
                      style={{ cursor: "pointer", userSelect: "none" }}
                    >
                      <Box display="flex" alignItems="center" gap="6px">
                        {newSectionCollapsed ? <ChevronRightIcon size={12} /> : <ChevronDownIcon size={12} />}
                        <SectionDividerBadge $variant="new" $hasActiveUnread={activeNewUnreadCount > 0}>
                          <SectionDividerDot $active={activeNewUnreadCount > 0} />
                          New
                        </SectionDividerBadge>
                      </Box>
                      <SectionDividerMeta>
                        {activeNewUnreadCount > 0
                          ? `${activeNewUnreadCount} unread`
                          : `${newNotifications.length} items`}
                      </SectionDividerMeta>
                    </NotificationSectionDivider>
                    {!newSectionCollapsed && newNotifications.map(renderNotificationItem)}
                  </Box>
                )}

                {earlierNotifications.length > 0 && (
                  <Box>
                    <NotificationSectionDivider
                      data-testid="notifications-earlier-divider"
                      $variant="earlier"
                      onClick={() => setEarlierSectionCollapsed((prev) => !prev)}
                      style={{ cursor: "pointer", userSelect: "none" }}
                    >
                      <Box display="flex" alignItems="center" gap="6px">
                        {earlierSectionCollapsed ? <ChevronRightIcon size={12} /> : <ChevronDownIcon size={12} />}
                        <SectionDividerBadge $variant="earlier">Earlier</SectionDividerBadge>
                      </Box>
                      <SectionDividerMeta>
                        {earlierNotifications.length}{" "}
                        {earlierNotifications.length === 1 ? "notification" : "notifications"}
                      </SectionDividerMeta>
                    </NotificationSectionDivider>
                    {!earlierSectionCollapsed && earlierNotifications.map(renderNotificationItem)}
                  </Box>
                )}
              </StreamPane>
            </>
          ) : (
            <>
              <StreamPane ref={feedContainerRef} data-testid="inbox-stream-pane" $placement="left">
                {newNotifications.length > 0 && (
                  <Box>
                    <NotificationSectionDivider
                      data-testid="notifications-new-divider"
                      $variant="new"
                      $hasActiveUnread={activeNewUnreadCount > 0}
                      onClick={() => setNewSectionCollapsed((prev) => !prev)}
                      style={{ cursor: "pointer", userSelect: "none" }}
                    >
                      <Box display="flex" alignItems="center" gap="6px">
                        {newSectionCollapsed ? <ChevronRightIcon size={12} /> : <ChevronDownIcon size={12} />}
                        <SectionDividerBadge $variant="new" $hasActiveUnread={activeNewUnreadCount > 0}>
                          <SectionDividerDot $active={activeNewUnreadCount > 0} />
                          New
                        </SectionDividerBadge>
                      </Box>
                      <SectionDividerMeta>
                        {activeNewUnreadCount > 0
                          ? `${activeNewUnreadCount} unread`
                          : `${newNotifications.length} items`}
                      </SectionDividerMeta>
                    </NotificationSectionDivider>
                    {!newSectionCollapsed && newNotifications.map(renderNotificationItem)}
                  </Box>
                )}

                {earlierNotifications.length > 0 && (
                  <Box>
                    <NotificationSectionDivider
                      data-testid="notifications-earlier-divider"
                      $variant="earlier"
                      onClick={() => setEarlierSectionCollapsed((prev) => !prev)}
                      style={{ cursor: "pointer", userSelect: "none" }}
                    >
                      <Box display="flex" alignItems="center" gap="6px">
                        {earlierSectionCollapsed ? <ChevronRightIcon size={12} /> : <ChevronDownIcon size={12} />}
                        <SectionDividerBadge $variant="earlier">Earlier</SectionDividerBadge>
                      </Box>
                      <SectionDividerMeta>
                        {earlierNotifications.length}{" "}
                        {earlierNotifications.length === 1 ? "notification" : "notifications"}
                      </SectionDividerMeta>
                    </NotificationSectionDivider>
                    {!earlierSectionCollapsed && earlierNotifications.map(renderNotificationItem)}
                  </Box>
                )}
              </StreamPane>

              <InboxReadingPane
                selectedItem={selectedItem}
                activeView={activeView}
                currentUsername={user?.username}
                onToggleArchive={handleToggleArchive}
                onToggleStar={handleToggleStar}
                onToggleRead={handleToggleRead}
                onOpenPrimaryTarget={handleOpenPrimaryTarget}
              />
            </>
          )}
        </InboxSplitLayout>
      )}
    </Box>
  );
};

export default NotificationsPage;
