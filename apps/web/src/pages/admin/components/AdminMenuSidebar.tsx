// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  ClockIcon,
  DatabaseIcon,
  GearIcon,
  GlobeIcon,
  GraphIcon,
  HistoryIcon,
  LawIcon,
  PeopleIcon,
  PulseIcon,
  ReportIcon,
  ShieldLockIcon,
  SlidersIcon,
} from "@primer/octicons-react";
import React from "react";
import Box from "../../../components/Box";
import { Badge, Header, MenuColumn, TabButton } from "../styles";
import type { AdminOverviewCounts, AdminTab } from "../types";

export interface AdminMenuSidebarProps {
  activeTab: AdminTab;
  onSelectTab: (tab: AdminTab) => void;
  overviewCounts?: AdminOverviewCounts | null | undefined;
}

export const AdminMenuSidebar: React.FC<AdminMenuSidebarProps> = ({ activeTab, onSelectTab, overviewCounts }) => {
  return (
    <MenuColumn $hideOnMobile={false}>
      <Header>
        <ShieldLockIcon size={20} fill="var(--color-accent-purple)" />
        <span>Instance Admin</span>
      </Header>

      <Box
        display="flex"
        flexDirection="column"
        py={2}
        sx={{
          "@media (max-width: 900px)": {
            flexDirection: "row",
            overflowX: "auto",
            padding: "0 8px",
          },
        }}
      >
        <TabButton $active={activeTab === "moderation"} onClick={() => onSelectTab("moderation")}>
          <ReportIcon size={16} />
          <span style={{ flex: 1 }}>Moderation Queue</span>
          {overviewCounts && overviewCounts.pendingReports > 0 && (
            <Badge $variant="warning">{overviewCounts.pendingReports}</Badge>
          )}
        </TabButton>
        <TabButton $active={activeTab === "users"} onClick={() => onSelectTab("users")}>
          <PeopleIcon size={16} />
          <span style={{ flex: 1 }}>Users &amp; Governance</span>
          {overviewCounts && overviewCounts.restrictedUsers > 0 && (
            <Badge $variant="danger">{overviewCounts.restrictedUsers}</Badge>
          )}
        </TabButton>
        <TabButton $active={activeTab === "waitlist"} onClick={() => onSelectTab("waitlist")}>
          <ClockIcon size={16} />
          <span style={{ flex: 1 }}>Waitlist Applications</span>
        </TabButton>
        <TabButton $active={activeTab === "analytics"} onClick={() => onSelectTab("analytics")}>
          <GraphIcon size={16} />
          <span>Analytics &amp; Traffic</span>
        </TabButton>
        <TabButton $active={activeTab === "federation"} onClick={() => onSelectTab("federation")}>
          <GlobeIcon size={16} />
          <span style={{ flex: 1 }}>Federation Domains</span>
          {overviewCounts && overviewCounts.failedDeliveries > 0 && (
            <Badge $variant="danger">{overviewCounts.failedDeliveries}</Badge>
          )}
        </TabButton>
        <TabButton $active={activeTab === "dmca"} onClick={() => onSelectTab("dmca")}>
          <LawIcon size={16} />
          <span style={{ flex: 1 }}>DMCA Notices</span>
          {overviewCounts && overviewCounts.pendingDmca > 0 && (
            <Badge $variant="warning">{overviewCounts.pendingDmca}</Badge>
          )}
        </TabButton>
        <TabButton $active={activeTab === "audit"} onClick={() => onSelectTab("audit")}>
          <HistoryIcon size={16} />
          <span>Security &amp; Audit Logs</span>
        </TabButton>
        <TabButton $active={activeTab === "database"} onClick={() => onSelectTab("database")}>
          <DatabaseIcon size={16} />
          <span>Database &amp; Migrations</span>
        </TabButton>
        <TabButton $active={activeTab === "settings"} onClick={() => onSelectTab("settings")}>
          <GearIcon size={16} />
          <span>Instance Settings &amp; Invites</span>
        </TabButton>
        <TabButton $active={activeTab === "system"} onClick={() => onSelectTab("system")}>
          <PulseIcon size={16} />
          <span>System Health &amp; Diagnostics</span>
        </TabButton>
        <TabButton $active={activeTab === "flags"} onClick={() => onSelectTab("flags")}>
          <SlidersIcon size={16} />
          <span>Feature Flags Switchboard</span>
        </TabButton>
      </Box>
    </MenuColumn>
  );
};
