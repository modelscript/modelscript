// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  BellIcon,
  CheckIcon,
  FilterIcon,
  GearIcon,
  MentionIcon,
  PackageIcon,
  RocketIcon,
  ShieldIcon,
} from "@primer/octicons-react";
import { Button } from "@primer/react";
import React from "react";
import { useNavigate } from "react-router-dom";
import PageHeader from "../../../components/PageHeader";
import { scrollToTop } from "../../../components/ScrollToTop";
import { TabBar, TabButton, UnreadPill } from "../styles";
import type { NotificationCategory } from "../types";

export interface NotificationsHeaderProps {
  activeTab: NotificationCategory;
  setActiveTab: (tab: NotificationCategory) => void;
  unreadOnly: boolean;
  setUnreadOnly: React.Dispatch<React.SetStateAction<boolean>>;
  unreadCounts: Record<NotificationCategory, number>;
  hasUnread: boolean;
  onMarkAllRead: () => void;
}

export const NotificationsHeader: React.FC<NotificationsHeaderProps> = ({
  activeTab,
  setActiveTab,
  unreadOnly,
  setUnreadOnly,
  unreadCounts,
  hasUnread,
  onMarkAllRead,
}) => {
  const navigate = useNavigate();

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
        title="Notifications"
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
            <Button
              size="small"
              variant="invisible"
              aria-label="Notification settings"
              title="Notification settings"
              onClick={() => navigate("/settings?tab=notifications")}
            >
              <GearIcon size={16} />
            </Button>
          </>
        }
      />

      {/* ── Category Filter Bar ── */}
      <TabBar role="tablist" aria-label="Notification categories">
        <TabButton
          role="tab"
          aria-selected={activeTab === "all"}
          $active={activeTab === "all"}
          onClick={() => handleTabClick("all")}
        >
          <BellIcon size={14} /> All {unreadCounts.all > 0 && <UnreadPill>{unreadCounts.all}</UnreadPill>}
        </TabButton>
        <TabButton
          role="tab"
          aria-selected={activeTab === "engineering"}
          $active={activeTab === "engineering"}
          onClick={() => handleTabClick("engineering")}
        >
          <RocketIcon size={14} /> Engineering{" "}
          {unreadCounts.engineering > 0 && <UnreadPill>{unreadCounts.engineering}</UnreadPill>}
        </TabButton>
        <TabButton
          role="tab"
          aria-selected={activeTab === "packages"}
          $active={activeTab === "packages"}
          onClick={() => handleTabClick("packages")}
        >
          <PackageIcon size={14} /> Packages{" "}
          {unreadCounts.packages > 0 && <UnreadPill>{unreadCounts.packages}</UnreadPill>}
        </TabButton>
        <TabButton
          role="tab"
          aria-selected={activeTab === "mentions"}
          $active={activeTab === "mentions"}
          onClick={() => handleTabClick("mentions")}
        >
          <MentionIcon size={14} /> Social{" "}
          {unreadCounts.mentions > 0 && <UnreadPill>{unreadCounts.mentions}</UnreadPill>}
        </TabButton>
        <TabButton
          role="tab"
          aria-selected={activeTab === "system"}
          $active={activeTab === "system"}
          onClick={() => handleTabClick("system")}
        >
          <ShieldIcon size={14} /> System {unreadCounts.system > 0 && <UnreadPill>{unreadCounts.system}</UnreadPill>}
        </TabButton>
      </TabBar>
    </>
  );
};
