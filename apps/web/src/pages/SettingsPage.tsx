// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  AlertIcon,
  ArchiveIcon,
  ArrowLeftIcon,
  BellIcon,
  CheckCircleIcon,
  ChevronRightIcon,
  CreditCardIcon,
  DependabotIcon,
  EyeClosedIcon,
  GiftIcon,
  KeyIcon,
  LinkIcon,
  OrganizationIcon,
  PaintbrushIcon,
  PersonIcon,
  SearchIcon,
  ShieldLockIcon,
  SlidersIcon,
  XIcon,
} from "@primer/octicons-react";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { InvitesTab } from "./settings/tabs/InvitesTab";
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
  min-width: 0;

  @media (max-width: 900px) {
    display: ${(props) => (props.$hideOnMobile ? "none" : "flex")};
  }

  /* When a tab renders its own back button inside <Header>, hide MobileBackBar so there are never two stacked back bars */
  &:has(> div > button:first-child),
  &:has(> div > div:first-child > svg:first-child) {
    & > button[data-mobile-back-bar="true"] {
      display: none !important;
    }
  }

  /* On desktop, top-level tabs should never display a misleading back arrow that hijacks navigation */
  &[data-top-level="true"] {
    @media (min-width: 901px) {
      & > div > button.subtab-back {
        display: none;
      }
      & > div > div:first-child > svg:first-child {
        display: none;
      }
      & > div > div:first-child {
        cursor: default !important;
      }
    }
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
  background: var(--surface-sticky);
  backdrop-filter: var(--backdrop-sticky);
  -webkit-backdrop-filter: var(--backdrop-sticky);
  transition: background-color 0.25s ease;
  border-bottom: 1px solid var(--color-border);
  z-index: 50;
`;

const SearchInputWrapper = styled.div`
  position: relative;
  display: flex;
  align-items: center;
  width: 100%;
`;

const SearchIconWrap = styled.span`
  position: absolute;
  left: 14px;
  display: inline-flex;
  align-items: center;
  color: var(--color-text-muted);
  pointer-events: none;
`;

const SearchInput = styled.input`
  width: 100%;
  padding: 10px 64px 10px 38px;
  border-radius: 9999px;
  border: 1px solid var(--color-border-default);
  background-color: var(--color-bg-primary);
  color: var(--color-text-primary);
  outline: none;
  font-size: 14px;
  transition:
    border-color 0.15s ease,
    box-shadow 0.15s ease;

  &:focus {
    border-color: var(--color-accent-emphasis);
    background-color: var(--color-bg-primary);
    box-shadow: 0 0 0 3px rgba(88, 166, 255, 0.15);
  }
`;

const SearchShortcutBadge = styled.kbd`
  position: absolute;
  right: 12px;
  font-size: 11px;
  font-family: var(--font-mono, monospace);
  color: var(--color-text-muted);
  background: var(--color-canvas-subtle, rgba(255, 255, 255, 0.06));
  border: 1px solid var(--color-border-default);
  border-radius: 5px;
  padding: 1px 6px;
  pointer-events: none;
`;

const ClearSearchButton = styled.button`
  position: absolute;
  right: 10px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  border: none;
  background: var(--color-canvas-subtle, rgba(255, 255, 255, 0.08));
  color: var(--color-text-muted);
  cursor: pointer;
  padding: 0;

  &:hover {
    color: var(--color-text-primary);
    background: rgba(255, 255, 255, 0.14);
  }
`;

const SidebarScrollArea = styled.div`
  flex: 1;
  overflow-y: auto;
  padding-bottom: 24px;
`;

const CategorySection = styled.div`
  margin-bottom: 8px;
`;

const CategoryHeader = styled.div`
  padding: 14px 16px 6px 16px;
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--color-text-muted);
  user-select: none;
`;

const MenuItem = styled.button<{ $active?: boolean | undefined }>`
  width: 100%;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 11px 16px;
  background-color: ${(props) => (props.$active ? "rgba(139, 92, 246, 0.1)" : "transparent")};
  border: none;
  border-right: ${(props) =>
    props.$active ? "3px solid var(--color-accent-purple, #8b5cf6)" : "3px solid transparent"};
  cursor: pointer;
  text-align: left;
  transition: all 0.18s cubic-bezier(0.16, 1, 0.3, 1);
  color: ${(props) => (props.$active ? "var(--color-text-primary)" : "var(--color-text-secondary)")};

  &:hover {
    background-color: ${(props) => (props.$active ? "rgba(139, 92, 246, 0.14)" : "rgba(255, 255, 255, 0.04)")};
    color: var(--color-text-primary);
  }

  .menu-item-left {
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 0;
  }

  .menu-item-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    color: ${(props) => (props.$active ? "var(--color-accent-purple, #a78bfa)" : "var(--color-text-muted)")};
    flex-shrink: 0;
  }

  span.menu-item-label {
    font-size: 14.5px;
    font-weight: ${(props) => (props.$active ? "600" : "500")};
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
`;

const DeepSearchSection = styled.div`
  margin: 0 12px 12px 12px;
  border: 1px solid var(--color-border-default);
  border-radius: 10px;
  background: var(--color-canvas-subtle, rgba(255, 255, 255, 0.02));
  overflow: hidden;
`;

const DeepSearchHeader = styled.div`
  padding: 8px 12px;
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--color-accent-cyan, #06b6d4);
  background: rgba(6, 182, 212, 0.06);
  border-bottom: 1px solid var(--color-border-subtle, rgba(255, 255, 255, 0.06));
  display: flex;
  justify-content: space-between;
  align-items: center;
`;

const DeepSearchItemButton = styled.button`
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px 12px;
  background: transparent;
  border: none;
  border-bottom: 1px solid var(--color-border-subtle, rgba(255, 255, 255, 0.06));
  text-align: left;
  cursor: pointer;
  color: var(--color-text-primary);
  transition: background-color 0.15s ease;

  &:last-child {
    border-bottom: none;
  }

  &:hover {
    background-color: rgba(139, 92, 246, 0.1);
  }
`;

const DeepSearchTabBadge = styled.span`
  font-size: 10.5px;
  font-weight: 600;
  padding: 1px 7px;
  border-radius: 999px;
  background: rgba(139, 92, 246, 0.15);
  color: var(--color-accent-purple, #c084fc);
  border: 1px solid rgba(139, 92, 246, 0.3);
  white-space: nowrap;
`;

const StatusToastBanner = styled.div<{ $variant: "success" | "error" }>`
  margin: 12px 16px 4px 16px;
  padding: 12px 16px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  background: ${(props) =>
    props.$variant === "success"
      ? "var(--color-success-subtle, rgba(46, 160, 67, 0.15))"
      : "var(--color-danger-subtle, rgba(248, 81, 73, 0.15))"};
  color: ${(props) =>
    props.$variant === "success" ? "var(--color-success-fg, #3fb950)" : "var(--color-danger-fg, #f85149)"};
  border: 1px solid ${(props) => (props.$variant === "success" ? "rgba(63, 185, 80, 0.4)" : "rgba(248, 81, 73, 0.4)")};
  font-size: 14px;
  font-weight: 500;
`;

export type TabType =
  | "account"
  | "notifications"
  | "display"
  | "displayAndLanguages"
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
  | "modeling"
  | "modelingPreferences"
  | "organizations"
  | "invites"
  | "tokens";

export type SubViewType =
  | "main"
  | "accountInfo"
  | "changePassword"
  | "deleteAccount"
  | "notificationFilters"
  | "contentPreferences"
  | "other";

export interface DeepSettingEntry {
  id: string;
  title: string;
  description: string;
  tab: TabType;
  tabLabel: string;
  subView?: SubViewType | undefined;
  originTab?: TabType | undefined;
  keywords: string;
}

export const DEEP_SETTINGS_INDEX: DeepSettingEntry[] = [
  // 1. Your Account
  {
    id: "account-public-profile",
    title: "Edit Public Profile (Bio, Avatar, Banner)",
    description: "Update your public display name, bio, location, website, avatar, and header banner.",
    tab: "account",
    tabLabel: "Your Account",
    subView: "accountInfo",
    keywords: "profile bio avatar banner display name handle website location",
  },
  {
    id: "account-info",
    title: "Account Information (Username & Email)",
    description: "Manage your handle, primary email address, and account verification status.",
    tab: "account",
    tabLabel: "Your Account",
    subView: "accountInfo",
    keywords: "username email address handle account info verification",
  },
  {
    id: "account-email-verification",
    title: "Email Verification Status",
    description: "Check whether your email address is verified or resend a verification link.",
    tab: "account",
    tabLabel: "Your Account",
    keywords: "verify email verification resend link unverified",
  },
  {
    id: "account-change-password",
    title: "Change Password",
    description: "Update your account password or set a direct login password for SSO accounts.",
    tab: "account",
    tabLabel: "Your Account",
    subView: "changePassword",
    keywords: "change password credentials reset passphrase login",
  },
  {
    id: "account-delete",
    title: "Delete Account",
    description: "Permanently erase your account and personal records under GDPR Art. 17 & CCPA.",
    tab: "deleteAccount",
    tabLabel: "Your Account",
    subView: "deleteAccount",
    originTab: "account",
    keywords: "delete account deactivate erase gdpr ccpa right to erasure destroy",
  },

  // 2. Security & 2FA
  {
    id: "security-2fa-totp",
    title: "Two-Factor Authentication (2FA / TOTP)",
    description: "Protect your account with time-based one-time passwords (1Password, Authy, Authenticator).",
    tab: "security",
    tabLabel: "Security & 2FA",
    keywords: "two-factor authentication 2fa totp authenticator otp mfa security",
  },
  {
    id: "security-backup-codes",
    title: "2FA Backup Recovery Codes",
    description: "View remaining single-use recovery codes or regenerate a new set of backup codes.",
    tab: "security",
    tabLabel: "Security & 2FA",
    keywords: "backup codes recovery 2fa totp emergency access",
  },
  {
    id: "security-ssh-signing-keys",
    title: "SSH & Federation Signing Keys",
    description: "Register and revoke WebCrypto RSASSA-PKCS1-v1_5 device keys and public PEM keys.",
    tab: "security",
    tabLabel: "Security & 2FA",
    keywords: "ssh keys federation signing webcrypto public key pem device keystore",
  },
  {
    id: "security-verified-account-keys",
    title: "Signed Account & User-Held Signing Keys",
    description:
      "Register Ed25519 or FIDO2 hardware keys (YubiKey) to activate Signed Account status and sign Git commits and ActivityPub posts.",
    tab: "security",
    tabLabel: "Security & 2FA",
    keywords: "signed account signing keys ed25519 sshsig ssh fido2 yubikey badge strict mode git transport",
  },
  {
    id: "security-revoke-sessions",
    title: "Revoke All Sessions",
    description: "Immediately invalidate all active JWT sessions across other browsers and mobile devices.",
    tab: "security",
    tabLabel: "Security & 2FA",
    keywords: "revoke all sessions sign out devices jwt token invalidation",
  },

  // 3. Connected Accounts
  {
    id: "connected-oidc-sso",
    title: "Enterprise Single Sign-On (OIDC)",
    description: "Link corporate identity providers (Keycloak, Okta, Microsoft Entra ID).",
    tab: "connectedAccounts",
    tabLabel: "Connected Accounts",
    keywords: "oidc sso single sign-on enterprise keycloak okta entra oauth",
  },
  {
    id: "connected-github",
    title: "GitHub Account Integration",
    description: "Link your GitHub developer profile to synchronize public SSH keys and git repositories.",
    tab: "connectedAccounts",
    tabLabel: "Connected Accounts",
    keywords: "github oauth link connected account git repository ssh",
  },
  {
    id: "connected-gitlab",
    title: "GitLab Account Integration",
    description: "Link your GitLab account for enterprise git repository pipelines and webhooks.",
    tab: "connectedAccounts",
    tabLabel: "Connected Accounts",
    keywords: "gitlab oauth link connected account ci cd pipelines",
  },
  {
    id: "connected-twitter-x",
    title: "X (Twitter) Identity Verification",
    description: "Verify your public engineering identity and earn the Verified on X badge.",
    tab: "connectedAccounts",
    tabLabel: "Connected Accounts",
    keywords: "twitter x social verification badge oauth link",
  },

  // 4. Modeling & Simulation
  {
    id: "modeling-default-solver",
    title: "Default DAE Solver (CVODE / IDA / RK45)",
    description: "Select the default numerical integrator for differential-algebraic equation systems.",
    tab: "modeling",
    tabLabel: "Modeling & Simulation",
    keywords: "default dae solver cvode ida rk45 dopri5 sundials bdf integrator",
  },
  {
    id: "modeling-solver-tolerance",
    title: "Relative Solver Tolerance",
    description: "Configure default relative (relTol) and absolute (absTol) numerical solver tolerances.",
    tab: "modeling",
    tabLabel: "Modeling & Simulation",
    keywords: "relative solver tolerance reltol abstol accuracy precision step size",
  },
  {
    id: "modeling-stop-time",
    title: "Default Simulation Stop Time & Intervals",
    description: "Set default simulation duration (stopTime) and trajectory output grid points.",
    tab: "modeling",
    tabLabel: "Modeling & Simulation",
    keywords: "stop time intervals steps simulation horizon duration",
  },
  {
    id: "modeling-flattener-backend",
    title: "Flattener Backend (Hybrid / WASM / TS)",
    description: "Choose between Hybrid, WebAssembly kernel, or TypeScript Modelica flattener.",
    tab: "modeling",
    tabLabel: "Modeling & Simulation",
    keywords: "flattener backend hybrid wasm ts compiler modelica dae arena",
  },
  {
    id: "modeling-monaco-font-tab",
    title: "Monaco Editor Font Size & Tab Size",
    description: "Customize code editor font size (12px–18px) and space indentation width.",
    tab: "modeling",
    tabLabel: "Modeling & Simulation",
    keywords: "monaco editor font size tab size indentation spaces code",
  },
  {
    id: "modeling-word-wrap-minimap",
    title: "Editor Word Wrap & Code Minimap",
    description: "Toggle automatic equation line wrapping and structural code minimap preview.",
    tab: "modeling",
    tabLabel: "Modeling & Simulation",
    keywords: "word wrap minimap monaco editor line numbers",
  },
  {
    id: "modeling-realtime-lint",
    title: "Real-time Lint on Type",
    description: "Enable or disable live Modelica and ModelScript compiler lint diagnostics while editing.",
    tab: "modeling",
    tabLabel: "Modeling & Simulation",
    keywords: "real-time lint on type diagnostics compiler errors warnings",
  },
  {
    id: "modeling-auto-simulate",
    title: "Auto-Simulate on Model Load",
    description: "Automatically execute simulation runs when opening a model in Morsel.",
    tab: "modeling",
    tabLabel: "Modeling & Simulation",
    keywords: "auto-simulate morsel run automatically model load",
  },

  // 5. Display & Accessibility
  {
    id: "display-theme-mode",
    title: "Theme Mode (Dark / Light)",
    description: "Switch between dark night mode and high-contrast daylight theme.",
    tab: "displayAndLanguages",
    tabLabel: "Display & Accessibility",
    keywords: "theme mode dark light appearance color scheme night day",
  },
  {
    id: "display-colorblind-palette",
    title: "Colorblind Safe Palette",
    description: "Enable accessible Okabe-Ito and Viridis color palettes for plots and schematics.",
    tab: "displayAndLanguages",
    tabLabel: "Display & Accessibility",
    keywords: "colorblind safe palette accessibility plots charts okabe-ito viridis",
  },
  {
    id: "display-font-scale-motion",
    title: "UI Font Scale & Reduced Motion",
    description: "Adjust interface text scaling and minimize animations for vestibular accessibility.",
    tab: "displayAndLanguages",
    tabLabel: "Display & Accessibility",
    keywords: "ui font scale reduced motion accessibility zoom animations",
  },
  {
    id: "display-language-locale",
    title: "Interface Language & Locale",
    description: "Select your preferred display language and regional formatting.",
    tab: "displayAndLanguages",
    tabLabel: "Display & Accessibility",
    keywords: "language locale english internationalization i18n",
  },
  {
    id: "display-engineering-persona",
    title: "Primary Engineering Discipline & Persona",
    description: "Tailor Quickstart Studio templates for Physical Systems, SysML v2, CAD, or HPC.",
    tab: "displayAndLanguages",
    tabLabel: "Display & Accessibility",
    subView: "contentPreferences",
    keywords: "engineering persona discipline modelica sysml cad hpc onboarding",
  },
  {
    id: "display-muted-keywords-topics",
    title: "Muted Keywords & Topics",
    description: "Customize feed topic recommendations and filter unwanted keywords or concepts.",
    tab: "displayAndLanguages",
    tabLabel: "Display & Accessibility",
    subView: "contentPreferences",
    keywords: "muted keywords topics content preferences feed recommendations filter",
  },
  {
    id: "display-shortcuts-docs",
    title: "Keyboard Shortcuts & Engineering Documentation",
    description: "Open the keyboard shortcut cheat sheet (?) and language reference manuals.",
    tab: "displayAndLanguages",
    tabLabel: "Display & Accessibility",
    subView: "other",
    keywords: "keyboard shortcuts hotkeys help documentation resources fmi modelica spec",
  },

  // 6. Notifications
  {
    id: "notifications-email-digest",
    title: "Email Digest Frequency",
    description: "Configure instant, daily, or weekly email digests for missed notifications.",
    tab: "notifications",
    tabLabel: "Notifications",
    keywords: "email digest frequency daily weekly instant notifications summary",
  },
  {
    id: "notifications-web-push",
    title: "Web Push Notifications",
    description: "Enable real-time browser and desktop push alerts for mentions and compute jobs.",
    tab: "notifications",
    tabLabel: "Notifications",
    keywords: "web push notifications browser alerts desktop realtime",
  },
  {
    id: "notifications-quality-filter",
    title: "Notification Quality Filter",
    description: "Filter out lower-quality content and suspected automated bot interactions.",
    tab: "notifications",
    tabLabel: "Notifications",
    keywords: "quality filter spam bots notifications stream",
  },
  {
    id: "notifications-hpc-jobs",
    title: "HPC & Solver Job Completion Alerts",
    description: "Get notified when cloud simulation runs or SLURM batch jobs finish or fail.",
    tab: "notifications",
    tabLabel: "Notifications",
    keywords: "hpc solver job completion alerts slurm simulation failure",
  },

  // 7. Privacy & Federation
  {
    id: "privacy-profile-discovery",
    title: "Profile Discovery & Search Engine Indexing",
    description: "Control whether your profile is listed in public directories and indexed by search engines.",
    tab: "privacy",
    tabLabel: "Privacy & Federation",
    keywords: "profile discovery search engine indexing noindex directory discoverable",
  },
  {
    id: "privacy-manual-follower-approval",
    title: "Manual Follower Approval (Locked Account)",
    description: "Require manual approval before new followers can subscribe to your updates.",
    tab: "privacy",
    tabLabel: "Privacy & Federation",
    keywords: "manual follower approval locked account private follow requests",
  },
  {
    id: "privacy-default-post-visibility",
    title: "Default Post Visibility",
    description: "Set default audience (Public, Unlisted, Followers-Only, Direct) for new posts.",
    tab: "privacy",
    tabLabel: "Privacy & Federation",
    keywords: "default post visibility public unlisted followers direct privacy",
  },
  {
    id: "privacy-verified-links",
    title: "Verified Profile Links (rel=me / ORCID)",
    description: "Verify ownership of personal websites, academic pages, and ORCID researcher IDs.",
    tab: "privacy",
    tabLabel: "Privacy & Federation",
    keywords: "verified profile links rel=me orcid verification academic identity",
  },
  {
    id: "privacy-account-migration",
    title: "Account Migration & Aliases (ActivityPub Move)",
    description: "Configure alsoKnownAs account aliases or migrate followers to another fediverse server.",
    tab: "privacy",
    tabLabel: "Privacy & Federation",
    keywords: "account migration aliases activitypub move alsoknownas redirect fediverse",
  },
  {
    id: "privacy-blocked-muted-accounts",
    title: "Blocked & Muted Accounts",
    description: "Review and manage blocked users, muted accounts, and silenced federated domains.",
    tab: "privacy",
    tabLabel: "Privacy & Federation",
    keywords: "blocked muted accounts users domains silence moderation safety",
  },
  {
    id: "privacy-social-graph-csv",
    title: "Social Graph CSV Import / Export",
    description: "Export or import your following, block, and mute lists in Mastodon-compatible CSV format.",
    tab: "privacy",
    tabLabel: "Privacy & Federation",
    keywords: "social graph csv import export following blocks mutes portability",
  },

  // 8. Data Archive & Portability
  {
    id: "archive-gdpr-zip-json",
    title: "GDPR ZIP / JSON Data Archive",
    description: "Download a complete ZIP or JSON archive with an offline HTML viewer (GDPR Art. 20).",
    tab: "dataArchive",
    tabLabel: "Data Archive & Portability",
    keywords: "gdpr zip json data archive download export portability offline viewer",
  },

  // 9. API Tokens (PAT)
  {
    id: "tokens-pat",
    title: "Personal Access Tokens (PAT)",
    description: "Generate scoped API keys for the msx CLI, CI/CD runners, and package publishing.",
    tab: "tokens",
    tabLabel: "API Tokens (PAT)",
    keywords: "personal access tokens pat api keys cli registry publish scopes",
  },

  // 10. AI Bots & Agents
  {
    id: "bots-autonomous-agents",
    title: "Autonomous AI Bots & Token Rotation",
    description: "Register automated bot accounts, configure LLM models and system prompts, and rotate keys.",
    tab: "bots",
    tabLabel: "AI Bots & Agents",
    keywords: "autonomous ai bots agents token rotation llm gemini webhook",
  },

  // 11. Organizations
  {
    id: "organizations-rbac",
    title: "Organizations & RBAC Roles",
    description: "Create engineering organizations and manage Owner, Admin, Maintainer, and Member seats.",
    tab: "organizations",
    tabLabel: "Organizations",
    keywords: "organizations rbac roles team members seats owner admin maintainer",
  },

  // 12. Billing & Compute Credits
  {
    id: "billing-compute-credits",
    title: "Compute Credits & Tier Subscriptions",
    description: "Manage Pro/Enterprise subscriptions, SLURM HPC quotas, wallet top-ups, and invoices.",
    tab: "billing",
    tabLabel: "Billing & Compute Credits",
    keywords: "compute credits tier subscriptions billing wallet top-up stripe invoices quota",
  },

  // 13. Invites & Referrals
  {
    id: "invites-golden-tickets",
    title: "Invite Codes",
    description: "Generate single-use Golden Ticket invitation links to onboard colleagues and researchers.",
    tab: "invites",
    tabLabel: "Invites & Referrals",
    keywords: "invite codes golden tickets referrals share colleague onboarding",
  },
];

interface SidebarMenuItemConfig {
  id: string;
  label: string;
  tab: TabType;
  icon: React.ComponentType<{ size?: number | "small" | "medium" | "large"; fill?: string }>;
  keywords: string;
  isActive: boolean;
  onClick?: (() => void) | undefined;
}

interface SidebarCategoryConfig {
  category: string;
  items: SidebarMenuItemConfig[];
}

function resolveTabAndSubView(
  rawTab: string | null | undefined,
  rawSubView: string | null | undefined,
): { tab: TabType; subView: SubViewType } {
  const validSubViews = new Set<SubViewType>([
    "main",
    "accountInfo",
    "changePassword",
    "deleteAccount",
    "notificationFilters",
    "contentPreferences",
    "other",
  ]);
  const explicitSubView: SubViewType =
    rawSubView && validSubViews.has(rawSubView as SubViewType) ? (rawSubView as SubViewType) : "main";

  switch (rawTab) {
    case "accountInfo":
      return { tab: "account", subView: "accountInfo" };
    case "changePassword":
      return { tab: "account", subView: "changePassword" };
    case "deleteAccount":
      return { tab: "deleteAccount", subView: "deleteAccount" };
    case "notificationFilters":
      return { tab: "notifications", subView: "notificationFilters" };
    case "contentPreferences":
      return { tab: "displayAndLanguages", subView: "contentPreferences" };
    case "other":
      return { tab: "displayAndLanguages", subView: "other" };
    case "display":
    case "displayAndLanguages":
      return { tab: "displayAndLanguages", subView: explicitSubView };
    case "modeling":
    case "modelingPreferences":
      return { tab: "modeling", subView: explicitSubView };
    case "account":
    case "security":
    case "connectedAccounts":
    case "notifications":
    case "privacy":
    case "dataArchive":
    case "tokens":
    case "bots":
    case "organizations":
    case "billing":
    case "invites":
      return { tab: rawTab, subView: explicitSubView };
    default:
      return { tab: "account", subView: explicitSubView };
  }
}

const SettingsPage: React.FC = () => {
  const params = useParams<{ tab?: string | undefined; section?: string | undefined }>();
  const pathTab = params.section || params.tab;
  const [searchParams, setSearchParams] = useSearchParams();
  const queryTab = searchParams.get("tab");
  const querySubView = searchParams.get("subView");
  const querySuccess = searchParams.get("success");
  const queryError = searchParams.get("error");

  const { isAdmin, user } = useAuth();
  const isUserAdmin = Boolean(
    user && (isAdmin || user.account_type === "admin" || user.role === "admin" || user.isAdmin === true),
  );
  const navigate = useNavigate();
  usePageTitle("Settings");

  const hasBots = useFeatureFlag(["bot_accounts", "ai_bots", "bots"]);
  const hasBilling = useFeatureFlag(["billing", "billing_stripe_live"]);
  const hasOrganizations = useFeatureFlag(["organizations", "orgs"]);
  const hasInvites = useFeatureFlag(["invites", "user_invites"]);

  const isTabAvailable = useCallback(
    (tab: TabType): boolean => {
      if (tab === "bots") return hasBots;
      if (tab === "billing") return hasBilling;
      if (tab === "organizations") return hasOrganizations;
      if (tab === "invites") return hasInvites;
      return true;
    },
    [hasBots, hasBilling, hasOrganizations, hasInvites],
  );

  const effectiveRawTab = pathTab || queryTab;
  const initialResolved = resolveTabAndSubView(effectiveRawTab, querySubView);
  const initialSafeTab = isTabAvailable(initialResolved.tab) ? initialResolved.tab : "account";
  const initialSafeSubView = isTabAvailable(initialResolved.tab) ? initialResolved.subView : "main";

  const [activeTab, setActiveTab] = useState<TabType>(initialSafeTab);
  const [subView, setSubView] = useState<SubViewType>(initialSafeSubView);
  const [originTab, setOriginTab] = useState<TabType | null>(null);
  const [mobileShowMenu, setMobileShowMenu] = useState<boolean>(!effectiveRawTab && !querySubView);
  const [searchQuery, setSearchQuery] = useState("");
  const [dismissedBannerKey, setDismissedBannerKey] = useState<string | null>(null);

  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const detailColumnRef = useRef<HTMLDivElement | null>(null);

  const syncUrl = useCallback(
    (nextTab: TabType, nextSubView: SubViewType = "main") => {
      if (pathTab) {
        const suffix = nextSubView !== "main" ? `?subView=${encodeURIComponent(nextSubView)}` : "";
        navigate(`/settings/${encodeURIComponent(nextTab)}${suffix}`);
      } else {
        const nextParams: Record<string, string> = { tab: nextTab };
        if (nextSubView !== "main") {
          nextParams.subView = nextSubView;
        }
        setSearchParams(nextParams);
      }
    },
    [navigate, pathTab, setSearchParams],
  );

  // Synchronize state when URL path or query parameters change
  useEffect(() => {
    if (effectiveRawTab || querySubView) {
      const resolved = resolveTabAndSubView(effectiveRawTab, querySubView);
      if (!isTabAvailable(resolved.tab)) {
        setActiveTab("account");
        setSubView("main");
        setMobileShowMenu(false);
        syncUrl("account", "main");
        return;
      }
      setActiveTab(resolved.tab);
      setSubView(resolved.subView);
      setMobileShowMenu(false);
    }
  }, [effectiveRawTab, querySubView, isTabAvailable, syncUrl]);

  // If currently active tab becomes unavailable due to feature flag updates, fallback to account
  useEffect(() => {
    if (!isTabAvailable(activeTab)) {
      setActiveTab("account");
      setSubView("main");
      syncUrl("account", "main");
    }
  }, [activeTab, isTabAvailable, syncUrl]);

  // Handle direct navigation to /settings/admin
  useEffect(() => {
    if (effectiveRawTab === "admin") {
      if (isUserAdmin) {
        navigate("/admin");
      } else {
        setActiveTab("account");
        setSubView("main");
        syncUrl("account", "main");
      }
    }
  }, [effectiveRawTab, isUserAdmin, navigate, syncUrl]);

  // Global keyboard shortcut (`/` or `Cmd/Ctrl+K`) to focus settings search when on SettingsPage
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement;
      const isInput =
        activeEl?.tagName === "INPUT" ||
        activeEl?.tagName === "TEXTAREA" ||
        (activeEl as HTMLElement)?.isContentEditable;

      if (e.key === "/" && !e.metaKey && !e.ctrlKey && !e.altKey && !isInput) {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      } else if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
        // Focus settings search input if user presses Cmd/Ctrl+K inside settings
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Clicking a top-level item directly in the sidebar
  const handleSidebarTabSelect = useCallback(
    (tab: TabType) => {
      if (!isTabAvailable(tab)) return;
      setOriginTab(null);
      setSubView("main");
      setActiveTab(tab);
      setMobileShowMenu(false);
      syncUrl(tab, "main");
    },
    [isTabAvailable, syncUrl],
  );

  // Navigating from inside a tab component (e.g., AccountTab -> connectedAccounts / dataArchive / deleteAccount / changePassword)
  const handleTabNavigate = useCallback(
    (target: TabType) => {
      if (!isTabAvailable(target)) return;
      if (target === "accountInfo" || target === "changePassword") {
        setOriginTab("account");
        setActiveTab("account");
        setSubView(target);
        setMobileShowMenu(false);
        syncUrl("account", target);
        return;
      }

      if (target === "deleteAccount") {
        const fromTab: TabType = activeTab === "privacy" ? "privacy" : "account";
        setOriginTab(fromTab);
        setActiveTab("deleteAccount");
        setSubView("deleteAccount");
        setMobileShowMenu(false);
        syncUrl(fromTab, "deleteAccount");
        return;
      }

      if (target === "connectedAccounts" || target === "dataArchive") {
        const fromTab: TabType = activeTab === "privacy" ? "privacy" : "account";
        setOriginTab(fromTab);
        setActiveTab(target);
        setSubView("main");
        setMobileShowMenu(false);
        syncUrl(target, "main");
        return;
      }

      // If PrivacyTab's deleteAccount view calls onNavigate("privacy") to cancel/go back, return to originTab
      if (target === "privacy" && (activeTab === "deleteAccount" || subView === "deleteAccount")) {
        const returnTo: TabType = originTab || "privacy";
        setOriginTab(null);
        setSubView("main");
        setActiveTab(returnTo);
        setMobileShowMenu(false);
        syncUrl(returnTo, "main");
        return;
      }

      if (target === "contentPreferences" || target === "other") {
        setOriginTab("displayAndLanguages");
        setActiveTab("displayAndLanguages");
        setSubView(target);
        setMobileShowMenu(false);
        syncUrl("displayAndLanguages", target);
        return;
      }

      if (target === "notificationFilters") {
        setOriginTab("notifications");
        setActiveTab("notifications");
        setSubView("notificationFilters");
        setMobileShowMenu(false);
        syncUrl("notifications", "notificationFilters");
        return;
      }

      const resolved = resolveTabAndSubView(target, "main");
      if (!isTabAvailable(resolved.tab)) return;
      setOriginTab(null);
      setActiveTab(resolved.tab);
      setSubView(resolved.subView);
      setMobileShowMenu(false);
      syncUrl(resolved.tab, resolved.subView);
    },
    [activeTab, isTabAvailable, originTab, subView, syncUrl],
  );

  const handleMobileOrAccountBack = useCallback(() => {
    const isMobileViewport = typeof window !== "undefined" && window.innerWidth <= 900;

    if (subView !== "main") {
      const returnTab: TabType =
        activeTab === "deleteAccount"
          ? originTab || "account"
          : activeTab === "accountInfo" || activeTab === "changePassword"
            ? "account"
            : activeTab;
      setSubView("main");
      setActiveTab(returnTab);
      setOriginTab(null);
      syncUrl(returnTab, "main");
      return;
    }

    if (activeTab === "deleteAccount" || originTab) {
      const returnTab: TabType = originTab || "account";
      setOriginTab(null);
      setSubView("main");
      setActiveTab(returnTab);
      syncUrl(returnTab, "main");
      if (isMobileViewport && !originTab) {
        setMobileShowMenu(true);
      }
      return;
    }

    if (isMobileViewport) {
      setMobileShowMenu(true);
    }
  }, [activeTab, originTab, subView, syncUrl]);

  const handleSelectDeepSetting = useCallback(
    (entry: DeepSettingEntry) => {
      if (!isTabAvailable(entry.tab)) return;
      const nextSubView: SubViewType = entry.subView || "main";
      setOriginTab(entry.originTab || (nextSubView !== "main" ? entry.tab : null));
      setActiveTab(entry.tab);
      setSubView(nextSubView);
      setMobileShowMenu(false);
      syncUrl(entry.tab, nextSubView);

      setTimeout(() => {
        detailColumnRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 40);
    },
    [isTabAvailable, syncUrl],
  );

  const categories: SidebarCategoryConfig[] = useMemo(
    () => [
      {
        category: "Identity & Access",
        items: [
          {
            id: "account",
            label: "Your Account",
            tab: "account",
            icon: PersonIcon,
            keywords: "username email password profile credentials deactivate delete account",
            isActive:
              activeTab === "account" ||
              activeTab === "accountInfo" ||
              activeTab === "changePassword" ||
              (activeTab === "deleteAccount" && originTab !== "privacy"),
          },
          {
            id: "security",
            label: "Security & 2FA",
            tab: "security",
            icon: ShieldLockIcon,
            keywords: "2fa totp security access keys ssh token sessions backup codes",
            isActive: activeTab === "security",
          },
          {
            id: "connectedAccounts",
            label: "Connected Accounts",
            tab: "connectedAccounts",
            icon: LinkIcon,
            keywords: "connected accounts github gitlab oidc sso twitter x oauth link",
            isActive: activeTab === "connectedAccounts",
          },
          ...(isUserAdmin
            ? [
                {
                  id: "admin",
                  label: "Instance Administration",
                  tab: "account" as TabType,
                  icon: ShieldLockIcon,
                  keywords: "admin instance moderation federation dmca audit database migrations",
                  isActive: false,
                  onClick: () => navigate("/admin"),
                },
              ]
            : []),
        ],
      },
      {
        category: "Workspace & Preferences",
        items: [
          {
            id: "modeling",
            label: "Modeling & Simulation",
            tab: "modeling",
            icon: SlidersIcon,
            keywords: "modeling simulation monaco editor compiler flattener solver cvode ida rk45 wasm tolerance",
            isActive: activeTab === "modeling" || activeTab === "modelingPreferences",
          },
          {
            id: "displayAndLanguages",
            label: "Display & Accessibility",
            tab: "displayAndLanguages",
            icon: PaintbrushIcon,
            keywords:
              "display accessibility theme dark light language font colorblind motion content preferences persona shortcuts",
            isActive:
              activeTab === "displayAndLanguages" ||
              activeTab === "display" ||
              activeTab === "contentPreferences" ||
              activeTab === "other",
          },
          {
            id: "notifications",
            label: "Notifications",
            tab: "notifications",
            icon: BellIcon,
            keywords: "notifications alerts email push filters mentions frequency digest hpc",
            isActive: activeTab === "notifications" || activeTab === "notificationFilters",
          },
        ],
      },
      {
        category: "Privacy & Compliance",
        items: [
          {
            id: "privacy",
            label: "Privacy & Federation",
            tab: "privacy",
            icon: EyeClosedIcon,
            keywords:
              "privacy federation safety gdpr ccpa visibility locked accountfollowers rel=me orcid migration aliases blocked muted csv",
            isActive: activeTab === "privacy" || (activeTab === "deleteAccount" && originTab === "privacy"),
          },
          {
            id: "dataArchive",
            label: "Data Archive & Portability",
            tab: "dataArchive",
            icon: ArchiveIcon,
            keywords: "data archive portability gdpr zip json export activity git repository clone",
            isActive: activeTab === "dataArchive",
          },
        ],
      },
      {
        category: "Developer & Automation",
        items: [
          {
            id: "tokens",
            label: "API Tokens (PAT)",
            tab: "tokens",
            icon: KeyIcon,
            keywords: "api tokens pat keys access personal scopes cicd registry publish cli",
            isActive: activeTab === "tokens",
          },
          ...(hasBots
            ? [
                {
                  id: "bots",
                  label: "AI Bots & Agents",
                  tab: "bots",
                  icon: DependabotIcon,
                  keywords: "ai bots developer tokens webhook agents autonomous llm rotation",
                  isActive: activeTab === "bots",
                },
              ]
            : []),
        ],
      },
      ...(hasOrganizations || hasBilling || hasInvites
        ? [
            {
              category: "Billing & Teams",
              items: [
                ...(hasOrganizations
                  ? [
                      {
                        id: "organizations",
                        label: "Organizations",
                        tab: "organizations",
                        icon: OrganizationIcon,
                        keywords: "team organization organizations company seats members invite roles rbac collaborate",
                        isActive: activeTab === "organizations",
                      },
                    ]
                  : []),
                ...(hasBilling
                  ? [
                      {
                        id: "billing",
                        label: "Billing & Compute Credits",
                        tab: "billing",
                        icon: CreditCardIcon,
                        keywords:
                          "billing quota compute credits invoice payment usage subscription commercial license plan tier wallet",
                        isActive: activeTab === "billing",
                      },
                    ]
                  : []),
                ...(hasInvites
                  ? [
                      {
                        id: "invites",
                        label: "Invites & Referrals",
                        tab: "invites",
                        icon: GiftIcon,
                        keywords: "invites invite golden tickets referrals share access team friend pass code",
                        isActive: activeTab === "invites",
                      },
                    ]
                  : []),
              ],
            },
          ]
        : []),
    ],
    [activeTab, isUserAdmin, navigate, originTab, hasBots, hasOrganizations, hasBilling, hasInvites],
  );

  const normalizedQuery = searchQuery.trim().toLowerCase();

  const matchingDeepSettings = useMemo(() => {
    if (!normalizedQuery) return [];
    const tokens = normalizedQuery.split(/\s+/).filter(Boolean);
    return DEEP_SETTINGS_INDEX.filter((entry) => {
      if (entry.tab === "bots" && !hasBots) return false;
      if (entry.tab === "billing" && !hasBilling) return false;
      if (entry.tab === "organizations" && !hasOrganizations) return false;
      if (entry.tab === "invites" && !hasInvites) return false;
      const haystack = `${entry.title} ${entry.description} ${entry.tabLabel} ${entry.keywords}`.toLowerCase();
      return tokens.every((tok) => haystack.includes(tok));
    });
  }, [normalizedQuery, hasBots, hasBilling, hasOrganizations, hasInvites]);

  const filteredCategories = useMemo(() => {
    if (!normalizedQuery) return categories;
    const tokens = normalizedQuery.split(/\s+/).filter(Boolean);
    const matchingTabsFromDeep = new Set<TabType>(
      matchingDeepSettings.map((d) => (d.tab === "deleteAccount" ? "account" : d.tab)),
    );

    return categories
      .map((cat) => {
        const matchingItems = cat.items.filter((item) => {
          const haystack = `${cat.category} ${item.label} ${item.keywords}`.toLowerCase();
          return tokens.every((tok) => haystack.includes(tok)) || matchingTabsFromDeep.has(item.tab);
        });
        return {
          ...cat,
          items: matchingItems,
        };
      })
      .filter((cat) => cat.items.length > 0);
  }, [categories, matchingDeepSettings, normalizedQuery]);

  const isTopLevelView =
    subView === "main" &&
    !originTab &&
    activeTab !== "accountInfo" &&
    activeTab !== "changePassword" &&
    activeTab !== "deleteAccount";

  // Mobile back bar fallback for tabs that do not render their own <Header> back button
  const needsMobileBackBar =
    activeTab === "notifications" ||
    activeTab === "notificationFilters" ||
    activeTab === "display" ||
    activeTab === "displayAndLanguages" ||
    activeTab === "contentPreferences" ||
    activeTab === "other" ||
    activeTab === "security" ||
    activeTab === "modeling" ||
    activeTab === "modelingPreferences";

  const activeBannerKey = querySuccess ? `success:${querySuccess}` : queryError ? `error:${queryError}` : null;
  const showUrlBanner = Boolean(activeBannerKey && dismissedBannerKey !== activeBannerKey);

  const handleDismissUrlBanner = () => {
    if (activeBannerKey) {
      setDismissedBannerKey(activeBannerKey);
    }
    if (searchParams.has("success") || searchParams.has("error")) {
      const next = new URLSearchParams(searchParams);
      next.delete("success");
      next.delete("error");
      setSearchParams(next, { replace: true });
    }
  };

  const accountSubView: "account" | "accountInfo" | "changePassword" =
    activeTab === "accountInfo" || subView === "accountInfo"
      ? "accountInfo"
      : activeTab === "changePassword" || subView === "changePassword"
        ? "changePassword"
        : "account";

  const notificationSubView: "notifications" | "notificationFilters" =
    activeTab === "notificationFilters" || subView === "notificationFilters" ? "notificationFilters" : "notifications";

  const displaySubView: "display" | "contentPreferences" | "other" =
    activeTab === "contentPreferences" || subView === "contentPreferences"
      ? "contentPreferences"
      : activeTab === "other" || subView === "other"
        ? "other"
        : "display";

  const privacySubView: "privacy" | "deleteAccount" =
    activeTab === "deleteAccount" || subView === "deleteAccount" ? "deleteAccount" : "privacy";

  return (
    <SettingsContainer>
      <MenuColumn $hideOnMobile={!mobileShowMenu}>
        <Header>Settings</Header>
        <Box p={3}>
          <SearchInputWrapper>
            <SearchIconWrap>
              <SearchIcon size={16} />
            </SearchIconWrap>
            <SearchInput
              ref={searchInputRef}
              type="search"
              aria-label="Search settings"
              placeholder="Search settings, solvers, 2FA, tokens..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  if (searchQuery) {
                    setSearchQuery("");
                  } else {
                    searchInputRef.current?.blur();
                  }
                } else if (e.key === "Enter" && matchingDeepSettings.length > 0) {
                  handleSelectDeepSetting(matchingDeepSettings[0]!);
                }
              }}
            />
            {searchQuery ? (
              <ClearSearchButton
                type="button"
                aria-label="Clear search"
                onClick={() => {
                  setSearchQuery("");
                  searchInputRef.current?.focus();
                }}
              >
                <XIcon size={14} />
              </ClearSearchButton>
            ) : (
              <SearchShortcutBadge>/</SearchShortcutBadge>
            )}
          </SearchInputWrapper>
        </Box>

        <SidebarScrollArea>
          {normalizedQuery.length > 0 && matchingDeepSettings.length > 0 && (
            <DeepSearchSection aria-label="Matching Settings">
              <DeepSearchHeader>
                <span>Matching Settings</span>
                <span>{matchingDeepSettings.length} found</span>
              </DeepSearchHeader>
              {matchingDeepSettings.slice(0, 12).map((entry) => (
                <DeepSearchItemButton key={entry.id} type="button" onClick={() => handleSelectDeepSetting(entry)}>
                  <Box display="flex" justifyContent="space-between" alignItems="center" gap={2}>
                    <span style={{ fontSize: "13.5px", fontWeight: 600, color: "var(--color-text-primary)" }}>
                      {entry.title}
                    </span>
                    <DeepSearchTabBadge>{entry.tabLabel}</DeepSearchTabBadge>
                  </Box>
                  <span style={{ fontSize: "12px", color: "var(--color-text-muted)", lineHeight: 1.35 }}>
                    {entry.description}
                  </span>
                </DeepSearchItemButton>
              ))}
            </DeepSearchSection>
          )}

          {filteredCategories.length === 0 && matchingDeepSettings.length === 0 ? (
            <Box p={3} textAlign="center" color="var(--color-fg-muted)">
              No settings found matching &ldquo;{searchQuery}&rdquo;
            </Box>
          ) : (
            filteredCategories.map((group) => (
              <CategorySection key={group.category}>
                <CategoryHeader>{group.category}</CategoryHeader>
                {group.items.map((item) => {
                  const IconComponent = item.icon;
                  return (
                    <MenuItem
                      key={item.id}
                      type="button"
                      $active={item.isActive}
                      onClick={() => (item.onClick ? item.onClick() : handleSidebarTabSelect(item.tab))}
                    >
                      <div className="menu-item-left">
                        <span className="menu-item-icon">
                          <IconComponent size={16} />
                        </span>
                        <span className="menu-item-label">{item.label}</span>
                      </div>
                      <ChevronRightIcon size={16} fill="var(--color-text-muted)" />
                    </MenuItem>
                  );
                })}
              </CategorySection>
            ))
          )}
        </SidebarScrollArea>
      </MenuColumn>

      <DetailColumn
        ref={detailColumnRef}
        $hideOnMobile={mobileShowMenu}
        data-top-level={isTopLevelView ? "true" : "false"}
      >
        {showUrlBanner && (querySuccess || queryError) && (
          <StatusToastBanner $variant={querySuccess ? "success" : "error"} role="status">
            <Box display="flex" alignItems="center" gap={2}>
              {querySuccess ? <CheckCircleIcon size={18} /> : <AlertIcon size={18} />}
              <span>{querySuccess || queryError}</span>
            </Box>
            <button
              type="button"
              aria-label="Dismiss notification"
              onClick={handleDismissUrlBanner}
              style={{
                background: "transparent",
                border: "none",
                color: "inherit",
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                padding: "4px",
              }}
            >
              <XIcon size={16} />
            </button>
          </StatusToastBanner>
        )}

        {needsMobileBackBar && (
          <MobileBackBar type="button" data-mobile-back-bar="true" onClick={handleMobileOrAccountBack}>
            <ArrowLeftIcon size={18} />
            <span>Back to Settings</span>
          </MobileBackBar>
        )}

        {(activeTab === "account" || activeTab === "accountInfo" || activeTab === "changePassword") && (
          <AccountTab subView={accountSubView} onNavigate={handleTabNavigate} onBack={handleMobileOrAccountBack} />
        )}

        {activeTab === "connectedAccounts" && <ConnectedAccountsTab onBack={handleMobileOrAccountBack} />}

        {activeTab === "security" && <SecurityTab onBack={handleMobileOrAccountBack} />}

        {(activeTab === "notifications" || activeTab === "notificationFilters") && (
          <NotificationFiltersTab
            subView={notificationSubView}
            onNavigate={handleTabNavigate}
            {...({ onBack: handleMobileOrAccountBack } as Record<string, unknown>)}
          />
        )}

        {(activeTab === "display" ||
          activeTab === "displayAndLanguages" ||
          activeTab === "contentPreferences" ||
          activeTab === "other") && (
          <DisplayAndPreferencesTab
            subView={displaySubView}
            onNavigate={(tab) => handleTabNavigate(tab as TabType)}
            {...({ onBack: handleMobileOrAccountBack } as Record<string, unknown>)}
          />
        )}

        {(activeTab === "privacy" || activeTab === "deleteAccount") && (
          <PrivacyTab subView={privacySubView} onNavigate={handleTabNavigate} onBack={handleMobileOrAccountBack} />
        )}

        {activeTab === "dataArchive" && <DataArchiveTab onBack={handleMobileOrAccountBack} />}

        {hasBilling && activeTab === "billing" && <BillingTab onBack={handleMobileOrAccountBack} />}

        {hasOrganizations && activeTab === "organizations" && (
          <OrganizationTab
            onBack={handleMobileOrAccountBack}
            onNavigateTab={(tab) => handleTabNavigate(tab as TabType)}
          />
        )}

        {hasInvites && activeTab === "invites" && <InvitesTab onBack={handleMobileOrAccountBack} />}

        {hasBots && activeTab === "bots" && <BotsTab onBack={handleMobileOrAccountBack} />}

        {activeTab === "tokens" && <TokensTab onBack={handleMobileOrAccountBack} />}

        {(activeTab === "modeling" || activeTab === "modelingPreferences") && (
          <ModelingPreferencesTab {...({ onBack: handleMobileOrAccountBack } as Record<string, unknown>)} />
        )}
      </DetailColumn>
    </SettingsContainer>
  );
};

export default SettingsPage;
