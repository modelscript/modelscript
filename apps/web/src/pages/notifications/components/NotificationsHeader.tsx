// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  ArchiveIcon,
  BellIcon,
  BookmarkIcon,
  CheckIcon,
  FilterIcon,
  GearIcon,
  InboxIcon,
  MentionIcon,
  PackageIcon,
  PaperAirplaneIcon,
  RocketIcon,
  SearchIcon,
  ShieldIcon,
  XIcon,
} from "@primer/octicons-react";
import { Button } from "@primer/react";
import React from "react";
import { useNavigate } from "react-router-dom";
import PageHeader from "../../../components/PageHeader";
import { scrollToTop } from "../../../components/ScrollToTop";
import {
  CompactSearchBox,
  CountPill,
  FilterPill,
  FilterPillGroup,
  FilterStrip,
  TabBar,
  TabButton,
  UnreadPill,
} from "../styles";
import type { InboxView, NotificationCategory } from "../types";

export interface NotificationsHeaderProps {
  activeView?: InboxView | undefined;
  setActiveView?: ((view: InboxView) => void) | undefined;
  viewCounts?: Record<InboxView, number> | undefined;
  activeTab: NotificationCategory;
  setActiveTab: (tab: NotificationCategory) => void;
  unreadOnly: boolean;
  setUnreadOnly: React.Dispatch<React.SetStateAction<boolean>>;
  unreadCounts: Record<NotificationCategory, number>;
  hasUnread: boolean;
  onMarkAllRead: () => void;
  onArchiveAll?: (() => void) | undefined;
  searchQuery?: string | undefined;
  setSearchQuery?: ((q: string) => void) | undefined;
}

export const NotificationsHeader: React.FC<NotificationsHeaderProps> = ({
  activeView = "inbox",
  setActiveView,
  viewCounts = { inbox: 0, saved: 0, outbox: 0, archive: 0 },
  activeTab,
  setActiveTab,
  unreadOnly,
  setUnreadOnly,
  unreadCounts,
  hasUnread,
  onMarkAllRead,
  onArchiveAll,
  searchQuery = "",
  setSearchQuery,
}) => {
  const navigate = useNavigate();

  const handleViewClick = (view: InboxView) => {
    if (activeView === view) {
      scrollToTop({ smooth: true });
    } else {
      setActiveView?.(view);
      scrollToTop({ smooth: false });
    }
  };

  const handleTabClick = (tab: NotificationCategory) => {
    if (activeTab === tab) {
      scrollToTop({ smooth: true });
    } else {
      setActiveTab(tab);
      scrollToTop({ smooth: false });
    }
  };

  return (
    <>
      <PageHeader
        title="Inbox"
        divider={false}
        badge={unreadCounts.all > 0 ? <UnreadPill>{unreadCounts.all} unread</UnreadPill> : undefined}
        actions={
          <>
            <Button
              size="small"
              variant={unreadOnly ? "primary" : "invisible"}
              leadingVisual={FilterIcon}
              onClick={() => setUnreadOnly((prev) => !prev)}
            >
              {unreadOnly ? "Unread Only" : "Filter Unread"}
            </Button>
            {hasUnread && (
              <Button size="small" variant="invisible" leadingVisual={CheckIcon} onClick={onMarkAllRead}>
                {activeTab === "all" ? "Mark all read" : "Mark tab read"}
              </Button>
            )}
            {activeView === "inbox" && viewCounts.inbox > 0 && onArchiveAll && (
              <Button size="small" variant="invisible" leadingVisual={ArchiveIcon} onClick={onArchiveAll}>
                Archive view
              </Button>
            )}
            <Button
              size="small"
              variant="invisible"
              aria-label="Notification settings"
              title="Inbox & notification settings"
              onClick={() => navigate("/settings?tab=notifications")}
            >
              <GearIcon size={16} />
            </Button>
          </>
        }
      />

      {/* ── Primary Lifecycle View Tabs (Inbox / Saved / Outbox / Archive) ── */}
      <TabBar role="tablist" aria-label="Inbox views">
        <TabButton
          role="tab"
          aria-selected={activeView === "inbox"}
          $active={activeView === "inbox"}
          onClick={() => handleViewClick("inbox")}
        >
          <InboxIcon size={15} /> Inbox{" "}
          {unreadCounts.all > 0 ? (
            <UnreadPill>{unreadCounts.all}</UnreadPill>
          ) : viewCounts.inbox > 0 ? (
            <CountPill>{viewCounts.inbox}</CountPill>
          ) : null}
        </TabButton>
        <TabButton
          role="tab"
          aria-selected={activeView === "saved"}
          $active={activeView === "saved"}
          onClick={() => handleViewClick("saved")}
        >
          <BookmarkIcon size={15} /> Saved {viewCounts.saved > 0 && <CountPill>{viewCounts.saved}</CountPill>}
        </TabButton>
        <TabButton
          role="tab"
          aria-selected={activeView === "outbox"}
          $active={activeView === "outbox"}
          onClick={() => handleViewClick("outbox")}
        >
          <PaperAirplaneIcon size={15} /> Outbox {viewCounts.outbox > 0 && <CountPill>{viewCounts.outbox}</CountPill>}
        </TabButton>
        <TabButton
          role="tab"
          aria-selected={activeView === "archive"}
          $active={activeView === "archive"}
          onClick={() => handleViewClick("archive")}
        >
          <ArchiveIcon size={15} /> Archive {viewCounts.archive > 0 && <CountPill>{viewCounts.archive}</CountPill>}
        </TabButton>
      </TabBar>

      {/* ── Secondary Domain Filter Strip & Search ── */}
      <FilterStrip role="toolbar" aria-label="Notification categories and search">
        <FilterPillGroup role="tablist" aria-label="Notification categories">
          <FilterPill
            role="tab"
            aria-selected={activeTab === "all"}
            $active={activeTab === "all"}
            onClick={() => handleTabClick("all")}
          >
            <BellIcon size={12} /> All {unreadCounts.all > 0 && <UnreadPill>{unreadCounts.all}</UnreadPill>}
          </FilterPill>
          <FilterPill
            role="tab"
            aria-selected={activeTab === "engineering"}
            $active={activeTab === "engineering"}
            onClick={() => handleTabClick("engineering")}
          >
            <RocketIcon size={12} /> Engineering{" "}
            {unreadCounts.engineering > 0 && <UnreadPill>{unreadCounts.engineering}</UnreadPill>}
          </FilterPill>
          <FilterPill
            role="tab"
            aria-selected={activeTab === "packages"}
            $active={activeTab === "packages"}
            onClick={() => handleTabClick("packages")}
          >
            <PackageIcon size={12} /> Packages{" "}
            {unreadCounts.packages > 0 && <UnreadPill>{unreadCounts.packages}</UnreadPill>}
          </FilterPill>
          <FilterPill
            role="tab"
            aria-selected={activeTab === "mentions"}
            $active={activeTab === "mentions"}
            onClick={() => handleTabClick("mentions")}
          >
            <MentionIcon size={12} /> Social{" "}
            {unreadCounts.mentions > 0 && <UnreadPill>{unreadCounts.mentions}</UnreadPill>}
          </FilterPill>
          <FilterPill
            role="tab"
            aria-selected={activeTab === "system"}
            $active={activeTab === "system"}
            onClick={() => handleTabClick("system")}
          >
            <ShieldIcon size={12} /> System {unreadCounts.system > 0 && <UnreadPill>{unreadCounts.system}</UnreadPill>}
          </FilterPill>
        </FilterPillGroup>

        {setSearchQuery && (
          <CompactSearchBox>
            <SearchIcon size={13} />
            <input
              type="text"
              placeholder="Filter inbox, models, saved..."
              aria-label="Filter inbox items"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button
                type="button"
                aria-label="Clear inbox search"
                onClick={() => setSearchQuery("")}
                style={{
                  position: "absolute",
                  right: 6,
                  background: "none",
                  border: "none",
                  padding: 2,
                  cursor: "pointer",
                  color: "var(--color-fg-muted)",
                  display: "inline-flex",
                }}
              >
                <XIcon size={12} />
              </button>
            )}
          </CompactSearchBox>
        )}
      </FilterStrip>
    </>
  );
};
