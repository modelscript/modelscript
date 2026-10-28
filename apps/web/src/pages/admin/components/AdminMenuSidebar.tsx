// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  DatabaseIcon,
  GlobeIcon,
  GraphIcon,
  HistoryIcon,
  LawIcon,
  ReportIcon,
  ShieldLockIcon,
  SlidersIcon,
} from "@primer/octicons-react";
import React from "react";
import Box from "../../../components/Box";
import { Header, MenuColumn, TabButton } from "../styles";
import type { AdminTab } from "../types";

export interface AdminMenuSidebarProps {
  activeTab: AdminTab;
  onSelectTab: (tab: AdminTab) => void;
}

export const AdminMenuSidebar: React.FC<AdminMenuSidebarProps> = ({ activeTab, onSelectTab }) => {
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
          <span>Moderation Queue</span>
        </TabButton>
        <TabButton $active={activeTab === "analytics"} onClick={() => onSelectTab("analytics")}>
          <GraphIcon size={16} />
          <span>Analytics &amp; Traffic</span>
        </TabButton>
        <TabButton $active={activeTab === "federation"} onClick={() => onSelectTab("federation")}>
          <GlobeIcon size={16} />
          <span>Federation Domains</span>
        </TabButton>
        <TabButton $active={activeTab === "dmca"} onClick={() => onSelectTab("dmca")}>
          <LawIcon size={16} />
          <span>DMCA Notices</span>
        </TabButton>
        <TabButton $active={activeTab === "audit"} onClick={() => onSelectTab("audit")}>
          <HistoryIcon size={16} />
          <span>Security &amp; Audit Logs</span>
        </TabButton>
        <TabButton $active={activeTab === "database"} onClick={() => onSelectTab("database")}>
          <DatabaseIcon size={16} />
          <span>Database &amp; Migrations</span>
        </TabButton>
        <TabButton $active={activeTab === "flags"} onClick={() => onSelectTab("flags")}>
          <SlidersIcon size={16} />
          <span>Feature Flags Switchboard</span>
        </TabButton>
      </Box>
    </MenuColumn>
  );
};
