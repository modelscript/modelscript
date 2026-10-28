// SPDX-License-Identifier: AGPL-3.0-or-later

import { BellIcon, FilterIcon, MentionIcon, PackageIcon, RocketIcon, ShieldIcon } from "@primer/octicons-react";
import { Button } from "@primer/react";
import React from "react";
import Box from "../../../components/Box";
import PageHeader from "../../../components/PageHeader";
import { TabButton, UnreadPill } from "../styles";
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
  return (
    <>
      <PageHeader
        title="Notifications"
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
              <Button size="small" variant="invisible" onClick={onMarkAllRead}>
                Mark read
              </Button>
            )}
          </>
        }
      />

      {/* ── Category Filter Bar ── */}
      <Box
        display="flex"
        borderBottom="1px solid var(--color-border-default)"
        style={{ overflowX: "auto", scrollbarWidth: "none" }}
      >
        <TabButton $active={activeTab === "all"} onClick={() => setActiveTab("all")}>
          <BellIcon size={14} /> All {unreadCounts.all > 0 && <UnreadPill>{unreadCounts.all}</UnreadPill>}
        </TabButton>
        <TabButton $active={activeTab === "engineering"} onClick={() => setActiveTab("engineering")}>
          <RocketIcon size={14} /> Engineering{" "}
          {unreadCounts.engineering > 0 && <UnreadPill>{unreadCounts.engineering}</UnreadPill>}
        </TabButton>
        <TabButton $active={activeTab === "packages"} onClick={() => setActiveTab("packages")}>
          <PackageIcon size={14} /> Packages{" "}
          {unreadCounts.packages > 0 && <UnreadPill>{unreadCounts.packages}</UnreadPill>}
        </TabButton>
        <TabButton $active={activeTab === "mentions"} onClick={() => setActiveTab("mentions")}>
          <MentionIcon size={14} /> Mentions{" "}
          {unreadCounts.mentions > 0 && <UnreadPill>{unreadCounts.mentions}</UnreadPill>}
        </TabButton>
        <TabButton $active={activeTab === "system"} onClick={() => setActiveTab("system")}>
          <ShieldIcon size={14} /> System {unreadCounts.system > 0 && <UnreadPill>{unreadCounts.system}</UnreadPill>}
        </TabButton>
      </Box>
    </>
  );
};
