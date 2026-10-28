// SPDX-License-Identifier: AGPL-3.0-or-later

import { ArrowLeftIcon, ChevronRightIcon } from "@primer/octicons-react";
import React, { useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import styled from "styled-components";
import { useAuth } from "../AuthContext";
import Box from "../components/Box";
import { useFeatureFlag } from "../FeatureFlagContext";
import { usePageTitle } from "../util/title";

// Extracted Tab Subcomponents
import { AccountTab } from "./settings/tabs/AccountTab";
import { BillingTab } from "./settings/tabs/BillingTab";
import { BotsTab } from "./settings/tabs/BotsTab";
import { ConnectedAccountsTab } from "./settings/tabs/ConnectedAccountsTab";
import { DataArchiveTab } from "./settings/tabs/DataArchiveTab";
import { DisplayAndPreferencesTab } from "./settings/tabs/DisplayAndPreferencesTab";
import { ModelingPreferencesTab } from "./settings/tabs/ModelingPreferencesTab";
import { NotificationFiltersTab } from "./settings/tabs/NotificationFiltersTab";
import { OrganizationTab } from "./settings/tabs/OrganizationTab";
import { PrivacyTab } from "./settings/tabs/PrivacyTab";
import { SecurityTab } from "./settings/tabs/SecurityTab";
import { TokensTab } from "./settings/tabs/TokensTab";

const SettingsContainer = styled.div`
  display: flex;
  width: 100%;
  height: 100%;
  min-height: calc(100vh - var(--dev-header-height, 0px));
`;

const MenuColumn = styled.div<{ $hideOnMobile: boolean }>`
  flex: 0 0 350px;
  border-right: 1px solid var(--color-border-default);
  display: flex;
  flex-direction: column;

  @media (max-width: 900px) {
    flex: 1;
    display: ${(props) => (props.$hideOnMobile ? "none" : "flex")};
    border-right: none;
  }
`;

const DetailColumn = styled.div<{ $hideOnMobile: boolean }>`
  flex: 1;
  display: flex;
  flex-direction: column;

  @media (max-width: 900px) {
    display: ${(props) => (props.$hideOnMobile ? "none" : "flex")};
  }
`;

const MobileBackBar = styled.button`
  display: none;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  background: transparent;
  border: none;
  border-bottom: 1px solid var(--color-border-default);
  color: var(--color-text-primary);
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;

  @media (max-width: 900px) {
    display: flex;
  }
`;

const Header = styled.div`
  padding: 0 16px;
  min-height: 53px;
  font-size: var(--text-xl, 20px);
  font-weight: 700;
  letter-spacing: -0.01em;
  color: var(--color-text-heading);
  display: flex;
  align-items: center;
  gap: 12px;
  position: sticky;
  top: var(--dev-header-height, 0px);
  background: var(--surface-hud);
  backdrop-filter: saturate(160%) blur(14px);
  -webkit-backdrop-filter: saturate(160%) blur(14px);
  border-bottom: 1px solid var(--color-border);
  z-index: 10;
`;

const SearchInput = styled.input`
  width: 100%;
  padding: 12px 16px;
  border-radius: 9999px;
  border: 1px solid var(--color-border-default);
  background-color: var(--color-bg-primary);
  color: var(--color-text-primary);
  outline: none;
  font-size: 15px;

  &:focus {
    border-color: var(--color-accent-emphasis);
    background-color: var(--color-bg-primary);
  }
`;

const MenuItem = styled.button<{ $active?: boolean | undefined }>`
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px;
  background-color: ${(props) => (props.$active ? "rgba(139, 92, 246, 0.08)" : "transparent")};
  border: none;
  border-right: ${(props) => (props.$active ? "3px solid var(--color-accent-purple)" : "3px solid transparent")};
  cursor: pointer;
  text-align: left;
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  color: ${(props) => (props.$active ? "var(--color-text-primary)" : "var(--color-text-secondary)")};

  &:hover {
    background-color: rgba(255, 255, 255, 0.04);
    color: var(--color-text-primary);
  }

  span {
    font-size: 15px;
    font-weight: ${(props) => (props.$active ? "600" : "500")};
  }
`;

export type TabType =
  | "account"
  | "notifications"
  | "display"
  | "contentPreferences"
  | "other"
  | "accountInfo"
  | "changePassword"
  | "connectedAccounts"
  | "security"
  | "billing"
  | "bots"
  | "privacy"
  | "dataArchive"
  | "deleteAccount"
  | "notificationFilters"
  | "modelingPreferences"
  | "organizations"
  | "tokens";

const SettingsPage: React.FC = () => {
  const { tab: pathTab } = useParams<{ tab?: string | undefined }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const effectiveTab = (pathTab || searchParams.get("tab")) as TabType | null;
  const [activeTab, setActiveTab] = useState<TabType>(effectiveTab || "account");
  const [mobileShowMenu, setMobileShowMenu] = useState<boolean>(!effectiveTab);
  const [searchQuery, setSearchQuery] = useState("");

  const { isAdmin } = useAuth();
  const navigate = useNavigate();
  usePageTitle("Settings");

  const hasBots = useFeatureFlag("bot_accounts");

  React.useEffect(() => {
    if (effectiveTab && effectiveTab !== activeTab) {
      setActiveTab(effectiveTab);
      setMobileShowMenu(false);
    }
  }, [effectiveTab, activeTab]);

  const handleTabChange = (tab: TabType) => {
    setActiveTab(tab);
    setMobileShowMenu(false);
    if (pathTab) {
      navigate(`/settings?tab=${encodeURIComponent(tab)}`);
    } else {
      setSearchParams({ tab });
    }
  };

  const handleMobileOrAccountBack = () => {
    if (typeof window !== "undefined" && window.innerWidth <= 900) {
      setMobileShowMenu(true);
    } else {
      handleTabChange("account");
    }
  };

  const needsMobileBackBar =
    activeTab === "notifications" ||
    activeTab === "display" ||
    activeTab === "contentPreferences" ||
    activeTab === "other" ||
    activeTab === "privacy" ||
    activeTab === "modelingPreferences";

  return (
    <SettingsContainer>
      <MenuColumn $hideOnMobile={!mobileShowMenu}>
        <Header>Settings</Header>
        <Box p={3}>
          <SearchInput
            placeholder="Search Settings"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </Box>
        {(() => {
          const menuList = [
            {
              id: "account",
              label: "Your account",
              tab: "account" as TabType,
              keywords: "username email password profile credentials",
              isActive: activeTab === "account" || activeTab === "accountInfo" || activeTab === "changePassword",
            },
            {
              id: "security",
              label: "Security and account access",
              tab: "security" as TabType,
              keywords: "2fa security access keys ssh token sessions",
              isActive: activeTab === "security",
            },
            {
              id: "billing",
              label: "Subscription & Compute Quotas",
              tab: "billing" as TabType,
              keywords: "billing quota compute invoice payment usage subscription commercial license plan credits tier",
              isActive: activeTab === "billing",
            },
            {
              id: "organizations",
              label: "Team & Organizations",
              tab: "organizations" as TabType,
              keywords: "team organization organizations company seats members invite roles collaborate license",
              isActive: activeTab === "organizations",
            },
            ...(hasBots
              ? [
                  {
                    id: "bots",
                    label: "Developer / Bots",
                    tab: "bots" as TabType,
                    keywords: "bots developer tokens webhook agents",
                    isActive: activeTab === "bots",
                  },
                ]
              : []),
            {
              id: "tokens",
              label: "Personal Access Tokens",
              tab: "tokens" as TabType,
              keywords: "api tokens pat keys access personal scopes cicd registry publish",
              isActive: activeTab === "tokens",
            },
            {
              id: "privacy",
              label: "Privacy & Data Protection",
              tab: "privacy" as TabType,
              keywords: "privacy safety gdpr ccpa data export archive delete erasure protection tracking cookies",
              isActive: activeTab === "privacy" || activeTab === "dataArchive" || activeTab === "deleteAccount",
            },
            {
              id: "notifications",
              label: "Notifications",
              tab: "notifications" as TabType,
              keywords: "notifications alerts email push filters mentions frequency digest",
              isActive: activeTab === "notifications" || activeTab === "notificationFilters",
            },
            {
              id: "contentPreferences",
              label: "Content preferences",
              tab: "contentPreferences" as TabType,
              keywords: "content preferences topics feed interests recommendations",
              isActive: activeTab === "contentPreferences",
            },
            {
              id: "modelingPreferences",
              label: "Modeling & Simulation",
              tab: "modelingPreferences" as TabType,
              keywords: "modeling simulation monaco editor compiler flattener solver cvode wasm tolerance",
              isActive: activeTab === "modelingPreferences",
            },
            {
              id: "display",
              label: "Accessibility, display, and languages",
              tab: "display" as TabType,
              keywords: "display accessibility theme dark light language font",
              isActive: activeTab === "display",
            },
            ...(isAdmin
              ? [
                  {
                    id: "admin",
                    label: "Instance Administration",
                    tab: "account" as TabType,
                    keywords: "admin instance moderation federation dmca audit database migrations",
                    isActive: false,
                    onClick: () => navigate("/admin"),
                  },
                ]
              : []),
            {
              id: "resources",
              label: "Help & Resources",
              tab: "other" as TabType,
              keywords: "resources help support docs terms shortcuts keyboard guide",
              isActive: activeTab === "other",
            },
          ];

          const filtered = menuList.filter((item) => {
            if (!searchQuery.trim()) return true;
            const q = searchQuery.toLowerCase();
            return item.label.toLowerCase().includes(q) || item.keywords.includes(q);
          });

          if (filtered.length === 0) {
            return (
              <Box p={3} textAlign="center" color="var(--color-fg-muted)">
                No settings found matching &ldquo;{searchQuery}&rdquo;
              </Box>
            );
          }

          return filtered.map((item) => (
            <MenuItem
              key={item.id}
              $active={item.isActive}
              onClick={() => (item.onClick ? item.onClick() : handleTabChange(item.tab))}
            >
              <span>{item.label}</span>
              <ChevronRightIcon size={16} fill="var(--color-text-muted)" />
            </MenuItem>
          ));
        })()}
      </MenuColumn>

      <DetailColumn $hideOnMobile={mobileShowMenu}>
        {needsMobileBackBar && (
          <MobileBackBar type="button" onClick={() => setMobileShowMenu(true)}>
            <ArrowLeftIcon size={18} />
            <span>Back to Settings</span>
          </MobileBackBar>
        )}
        {(activeTab === "account" || activeTab === "accountInfo" || activeTab === "changePassword") && (
          <AccountTab subView={activeTab} onNavigate={handleTabChange} onBack={() => setMobileShowMenu(true)} />
        )}
        {activeTab === "connectedAccounts" && <ConnectedAccountsTab onBack={() => handleTabChange("account")} />}
        {activeTab === "security" && <SecurityTab onBack={handleMobileOrAccountBack} />}
        {(activeTab === "notifications" || activeTab === "notificationFilters") && (
          <NotificationFiltersTab subView={activeTab} onNavigate={handleTabChange} />
        )}
        {(activeTab === "display" || activeTab === "contentPreferences" || activeTab === "other") && (
          <DisplayAndPreferencesTab subView={activeTab} onNavigate={handleTabChange} />
        )}
        {(activeTab === "privacy" || activeTab === "deleteAccount") && (
          <PrivacyTab subView={activeTab} onNavigate={handleTabChange} />
        )}
        {activeTab === "dataArchive" && <DataArchiveTab onBack={() => handleTabChange("privacy")} />}
        {activeTab === "billing" && <BillingTab onBack={handleMobileOrAccountBack} />}
        {activeTab === "organizations" && (
          <OrganizationTab
            onBack={handleMobileOrAccountBack}
            onNavigateTab={(tab) => handleTabChange(tab as TabType)}
          />
        )}
        {activeTab === "bots" && <BotsTab onBack={handleMobileOrAccountBack} />}
        {activeTab === "tokens" && <TokensTab onBack={handleMobileOrAccountBack} />}
        {activeTab === "modelingPreferences" && <ModelingPreferencesTab />}
      </DetailColumn>
    </SettingsContainer>
  );
};

export default SettingsPage;
