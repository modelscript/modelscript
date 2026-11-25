// SPDX-License-Identifier: AGPL-3.0-or-later

import { AlertIcon, GearIcon, GitBranchIcon, LawIcon, PeopleIcon, PlugIcon, SlidersIcon } from "@primer/octicons-react";
import { ActionList, Label } from "@primer/react";
import React from "react";
import Box from "../../../components/Box";
import { SidebarCard } from "./styles";
import type { SettingsSection } from "./types";

export interface SettingsSidebarProps {
  activeSection: SettingsSection;
  memberCount: number;
  onSelectSection: (section: SettingsSection) => void;
}

export const SettingsSidebar: React.FC<SettingsSidebarProps> = ({ activeSection, memberCount, onSelectSection }) => (
  <Box>
    <SidebarCard>
      <ActionList>
        <ActionList.Item selected={activeSection === "general"} onClick={() => onSelectSection("general")}>
          <ActionList.LeadingVisual>
            <GearIcon />
          </ActionList.LeadingVisual>
          General
        </ActionList.Item>

        <ActionList.Item selected={activeSection === "access"} onClick={() => onSelectSection("access")}>
          <ActionList.LeadingVisual>
            <PeopleIcon />
          </ActionList.LeadingVisual>
          Members & Roles
          <ActionList.TrailingVisual>
            <Label variant="accent" style={{ fontSize: "11px" }}>
              {memberCount}
            </Label>
          </ActionList.TrailingVisual>
        </ActionList.Item>

        <ActionList.Item selected={activeSection === "git"} onClick={() => onSelectSection("git")}>
          <ActionList.LeadingVisual>
            <GitBranchIcon />
          </ActionList.LeadingVisual>
          Git Vault & PDM
        </ActionList.Item>

        <ActionList.Item selected={activeSection === "plm"} onClick={() => onSelectSection("plm")}>
          <ActionList.LeadingVisual>
            <LawIcon />
          </ActionList.LeadingVisual>
          Change Control & Governance
        </ActionList.Item>

        <ActionList.Item selected={activeSection === "features"} onClick={() => onSelectSection("features")}>
          <ActionList.LeadingVisual>
            <SlidersIcon />
          </ActionList.LeadingVisual>
          Modules & Tabs
        </ActionList.Item>

        <ActionList.Item selected={activeSection === "integrations"} onClick={() => onSelectSection("integrations")}>
          <ActionList.LeadingVisual>
            <PlugIcon />
          </ActionList.LeadingVisual>
          Integrations & Jira
        </ActionList.Item>

        <ActionList.Divider />

        <ActionList.Item
          variant="danger"
          selected={activeSection === "danger"}
          onClick={() => onSelectSection("danger")}
        >
          <ActionList.LeadingVisual>
            <AlertIcon />
          </ActionList.LeadingVisual>
          Danger Zone
        </ActionList.Item>
      </ActionList>
    </SidebarCard>
  </Box>
);
