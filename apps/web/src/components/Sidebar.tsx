// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  BellIcon,
  BookIcon,
  BookmarkIcon,
  CodeIcon,
  GearIcon,
  HomeIcon,
  KebabHorizontalIcon,
  LinkExternalIcon,
  MarkGithubIcon,
  MoonIcon,
  PackageIcon,
  PersonIcon,
  PlusIcon,
  RepoIcon,
  RssIcon,
  SearchIcon,
  ServerIcon,
  ShieldLockIcon,
  SunIcon,
} from "@primer/octicons-react";
import { Text } from "@primer/react";
import React from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import styled from "styled-components";
import { useAuth } from "../AuthContext";
import { useFeatureFlag } from "../FeatureFlagContext";
import { useClickOutside } from "../hooks/useClickOutside";
import { useInstanceBranding } from "../InstanceBrandingContext";
import { useTheme } from "../theme";
import { safeCssImageUrl } from "../util/url";
import AnsatzMark from "./AnsatzLogo";
import Box from "./Box";
import { AnsatzSketchIcon } from "./icons";
import { scrollToTop } from "./ScrollToTop";

const SidebarContainer = styled.header`
  width: 272px;
  display: flex;
  flex-direction: column;
  position: sticky;
  top: var(--dev-header-height, 0px);
  height: calc(100vh - var(--dev-header-height, 0px) - var(--guest-banner-height, 0px));
  height: calc(100dvh - var(--dev-header-height, 0px) - var(--guest-banner-height, 0px));
  overflow-y: auto;
  padding: 14px 12px 12px 12px;
  box-sizing: border-box;
  gap: 4px;
  font-family: var(--ms-font-sans);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-rendering: optimizeLegibility;
  font-synthesis: none;
  transform: translateZ(0);
  backface-visibility: hidden;
  isolation: isolate;
  z-index: 20;

  @media (max-width: 1280px) {
    width: 76px;
    align-items: center;
    padding: 12px 6px;
  }

  @media (max-width: 767px) {
    display: none;
  }

  .nav-label {
    @media (max-width: 1280px) {
      display: none;
    }
  }

  .sidebar-separator {
    @media (max-width: 1280px) {
      display: none;
    }
  }

  .post-btn-container {
    @media (max-width: 1280px) {
      padding: 0;
      width: 44px;
      height: auto;
      display: flex;
      justify-content: center;
    }
  }

  .post-text {
    @media (max-width: 1280px) {
      display: none;
    }
  }

  .post-split-icon {
    flex-shrink: 0;
    @media (max-width: 1280px) {
      transform: scale(1.15);
    }
  }

  .profile-details {
    @media (max-width: 1280px) {
      display: none;
    }
  }

  .profile-footer {
    @media (max-width: 1280px) {
      padding: 0;
      width: 44px;
      height: 44px;
      justify-content: center;
      border-radius: 12px;
    }
  }
`;

const NavItem = styled(Link)<{ $active?: boolean | undefined; $compact?: boolean | undefined }>`
  display: flex;
  align-items: center;
  text-decoration: none;
  color: ${(props) => (props.$active ? "var(--color-text-heading)" : "var(--color-text-primary)")};
  font-family: var(--ms-font-sans);
  font-size: ${(props) => (props.$compact ? "14.5px" : "16.5px")};
  line-height: ${(props) => (props.$compact ? "20px" : "22px")};
  font-weight: ${(props) => (props.$active ? "650" : "500")};
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  font-synthesis: none;
  width: 100%;
  box-sizing: border-box;

  .nav-label {
    font-family: inherit;
    font-size: inherit;
    line-height: inherit;
    font-weight: inherit;
    color: inherit;
    letter-spacing: -0.01em;
  }

  .nav-leading-icon {
    color: ${(props) =>
      props.$active ? "var(--ms-brand)" : props.$compact ? "var(--color-text-muted)" : "var(--color-text-secondary)"};
    transition:
      transform 0.18s cubic-bezier(0.16, 1, 0.3, 1),
      color 0.18s ease;
  }

  .nav-external-icon {
    margin-left: auto;
    color: var(--color-text-tertiary, var(--color-text-muted));
    opacity: 0.55;
    transition:
      transform 0.18s ease,
      opacity 0.18s ease,
      color 0.18s ease;

    @media (max-width: 1280px) {
      display: none;
    }
  }

  &:hover {
    text-decoration: none;
    color: var(--color-text-heading);
  }

  &:hover .nav-leading-icon {
    color: var(--ms-brand);
  }

  &:hover .nav-external-icon {
    opacity: 0.95;
    color: var(--color-text-secondary);
    transform: translate(1px, -1px);
  }

  &:hover > div {
    background-color: ${(props) => (props.$active ? "var(--surface-selected)" : "var(--surface-row-hover)")};
    border-color: ${(props) =>
      props.$active ? "var(--color-accent-blue-border)" : "var(--color-border-subtle, transparent)"};
  }

  @media (max-width: 1280px) {
    justify-content: center;
  }
`;

const SectionDivider = styled.div`
  height: 1px;
  background-color: var(--color-border);
  margin: 6px 10px;

  @media (max-width: 1280px) {
    width: 28px;
    margin: 6px auto;
  }
`;

const NavPill = styled.div<{ $active?: boolean | undefined; $compact?: boolean | undefined }>`
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: ${(props) => (props.$compact ? "10px" : "12px")};
  padding: ${(props) => (props.$compact ? "6px 12px" : "8px 12px")};
  border-radius: 10px;
  width: 100%;
  border: 1px solid ${(props) => (props.$active ? "var(--color-accent-blue-border)" : "transparent")};
  background: ${(props) => (props.$active ? "var(--surface-selected)" : "transparent")};
  transition:
    background-color 0.16s ease,
    border-color 0.16s ease;

  @media (max-width: 1280px) {
    width: 42px;
    height: 42px;
    padding: 0;
    justify-content: center;
    border-radius: 10px;
  }
`;

const AdminNavBadge = styled.span`
  margin-left: auto;
  font-size: 11px;
  font-weight: 700;
  padding: 1px 7px;
  border-radius: 999px;
  background: var(--color-attention-subtle);
  color: var(--color-attention-fg);
  border: 1px solid var(--color-attention-muted);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  line-height: 1.4;

  @media (max-width: 1280px) {
    position: absolute;
    top: 3px;
    right: 2px;
    margin-left: 0;
    min-width: 17px;
    height: 17px;
    padding: 0 4px;
    font-size: 10px;
    border-radius: 999px;
    background: var(--ms-warning);
    color: #ffffff;
    border: none;
    box-shadow: 0 0 0 2px var(--color-bg-primary);
  }
`;

const BrandRow = styled.div`
  display: flex;
  align-items: center;
  width: 100%;
  margin-bottom: 6px;
  box-sizing: border-box;

  @media (max-width: 1280px) {
    justify-content: center;
    margin-bottom: 6px;
  }
`;

const BrandHeader = styled(Link)`
  display: flex;
  align-items: center;
  gap: 11px;
  width: 100%;
  box-sizing: border-box;
  padding: 6px 8px;
  border-radius: 12px;
  text-decoration: none;
  color: var(--color-text-heading);
  outline: none;
  min-width: 0;
  cursor: pointer;
  user-select: none;
  transition:
    background-color 0.16s ease,
    transform 0.1s ease;

  &:hover {
    text-decoration: none;
    background-color: var(--surface-row-hover);
  }

  &:active {
    transform: scale(0.985);
  }

  &:focus-visible {
    box-shadow: 0 0 0 2px var(--ms-brand);
  }

  /* No transform on hover: scaling a ~34px tile by a few percent is a
     sub-pixel change that only blurs/shifts the glyph. Instead the tile
     glows and the accent facet brightens, with zero layout movement. */
  .brand-icon-wrap {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  &:hover .ansatz-mark:not(.ansatz-mark--custom),
  &:focus-visible .ansatz-mark:not(.ansatz-mark--custom) {
    box-shadow:
      inset 0 1px 0 var(--ansatz-tile-highlight),
      inset 0 0 0 1px var(--ansatz-tile-ring),
      var(--ansatz-tile-shadow-hover);
  }

  &:hover .ansatz-facet-accent {
    filter: brightness(1.12) saturate(1.1);
  }

  @media (prefers-reduced-motion: reduce) {
    transition: none;
    .ansatz-mark,
    .ansatz-facet-accent {
      transition: none;
    }
  }

  @media (max-width: 1280px) {
    justify-content: center;
    padding: 4px;
    width: 42px;
    height: 42px;
  }
`;

const BrandTitle = styled.div`
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 3px;
  min-width: 0;
  color: var(--color-text-heading);
  font-family: var(--ms-font-sans);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  font-synthesis: none;
  white-space: nowrap;

  .brand-top-row {
    display: flex;
    align-items: center;
    gap: 6px;
    line-height: 1.15;
  }

  .brand-name {
    font-family: var(--ms-font-sans);
    font-size: 16px;
    font-weight: 680;
    letter-spacing: -0.02em;
    color: var(--color-text-heading);
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .brand-domain-sub {
    display: flex;
    align-items: center;
    gap: 6px;
    font-family: var(--ms-font-sans);
    font-size: 12px;
    font-weight: 500;
    line-height: 1.2;
    letter-spacing: 0;
    font-variant-numeric: tabular-nums;
    color: var(--color-text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .brand-domain-sub > span:last-child {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .brand-status-dot {
    width: 6px;
    height: 6px;
    border-radius: 999px;
    background-color: var(--ms-success);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--ms-success) 18%, transparent);
    flex-shrink: 0;
  }

  .brand-badge {
    font-size: 9.5px;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    padding: 1px 5px;
    border-radius: 4px;
    background: var(--ms-brand-soft);
    border: 1px solid var(--color-accent-blue-border);
    color: var(--ms-brand);
    line-height: 1.3;
    flex-shrink: 0;
  }

  @media (max-width: 1280px) {
    display: none;
  }
`;

const FooterSection = styled.div<{ $isGuest?: boolean }>`
  padding-top: ${(props) => (props.$isGuest ? "4px" : "10px")};
  margin-top: ${(props) => (props.$isGuest ? "auto" : "6px")};
  border-top: ${(props) => (props.$isGuest ? "none" : "1px solid var(--color-border)")};
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 100%;
  box-sizing: border-box;

  @media (max-width: 1280px) {
    padding-top: ${(props) => (props.$isGuest ? "2px" : "8px")};
    border-top: ${(props) => (props.$isGuest ? "none" : "1px solid var(--color-border)")};
    align-items: center;
    gap: 8px;
  }
`;

const GuestAuthActions = styled.div`
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;

  .guest-auth-expanded {
    display: flex;
    gap: 8px;
    width: 100%;
  }

  .guest-auth-btn {
    flex: 1;
    height: 36px;
    border-radius: 10px;
    font-size: 13.5px;
    font-weight: 600;
    padding: 0 12px;
  }

  @media (max-width: 1280px) {
    .guest-auth-expanded {
      display: none;
    }
  }
`;

const GuestRailAuthButton = styled.button<{ $active?: boolean | undefined }>`
  display: none;

  @media (max-width: 1280px) {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 42px;
    height: 42px;
    padding: 0;
    border-radius: 10px;
    border: 1px solid ${(props) => (props.$active ? "var(--ms-brand)" : "var(--color-accent-blue-border)")};
    background: ${(props) => (props.$active ? "var(--ms-brand)" : "var(--ms-brand-soft)")};
    color: ${(props) => (props.$active ? "var(--ms-brand-contrast, #ffffff)" : "var(--ms-brand)")};
    cursor: pointer;
    transition:
      background-color 0.16s ease,
      border-color 0.16s ease,
      color 0.16s ease,
      box-shadow 0.16s ease,
      transform 0.12s ease;

    &:hover {
      background: var(--ms-brand);
      border-color: var(--ms-brand);
      color: var(--ms-brand-contrast, #ffffff);
      box-shadow: var(--ms-brand-shadow);
    }

    &:active {
      transform: scale(0.96);
    }

    &:focus-visible {
      outline: none;
      box-shadow: 0 0 0 2px var(--ms-brand);
    }
  }
`;

const GuestAuthPopover = styled.div<{ $left: number; $bottom: number }>`
  position: fixed;
  left: ${(props) => props.$left}px;
  bottom: ${(props) => props.$bottom}px;
  width: 248px;
  background-color: var(--surface-overlay);
  backdrop-filter: blur(18px);
  -webkit-backdrop-filter: blur(18px);
  border: 1px solid var(--color-border-default);
  border-radius: 14px;
  box-shadow: var(--ms-shadow-pop);
  padding: 14px;
  z-index: 200;
  display: flex;
  flex-direction: column;
  gap: 10px;
  box-sizing: border-box;

  .popover-header {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .popover-title {
    font-size: 14px;
    font-weight: 700;
    line-height: 1.2;
    color: var(--color-text-heading);
    letter-spacing: -0.01em;
  }

  .popover-subtitle {
    font-size: 12px;
    line-height: 1.38;
    color: var(--color-text-muted);
    margin: 0;
  }

  .popover-actions {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .popover-btn {
    width: 100%;
    height: 34px;
    border-radius: 9px;
    font-size: 13px;
    font-weight: 600;
    justify-content: center;
    text-decoration: none;
    box-sizing: border-box;
  }

  .popover-github-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    width: 100%;
    height: 34px;
    border-radius: 9px;
    border: 1px solid var(--color-border-default);
    background: var(--color-canvas-subtle);
    color: var(--color-text-primary);
    font-family: inherit;
    font-size: 12.5px;
    font-weight: 600;
    cursor: pointer;
    transition:
      background-color 0.15s ease,
      border-color 0.15s ease;

    &:hover {
      background: var(--surface-row-hover);
      border-color: var(--color-accent-blue-border);
    }
  }
`;

const UtilityFooterRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 2px 4px 0 4px;
  min-height: 28px;
  width: 100%;
  box-sizing: border-box;

  @media (max-width: 1280px) {
    justify-content: center;
    padding: 0;
  }
`;

const PoweredByFooter = styled.a`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11.5px;
  line-height: 1;
  color: var(--color-text-muted);
  text-decoration: none;
  transition: color 0.15s ease;
  min-width: 0;
  white-space: nowrap;

  .powered-by-icon {
    width: 14px;
    height: 14px;
    border-radius: 3px;
    object-fit: cover;
    flex-shrink: 0;
    display: inline-block;
  }

  .powered-by-brand {
    font-weight: 600;
    color: var(--color-text-primary);
    transition: color 0.15s ease;
  }

  &:hover {
    color: var(--color-text-primary);
    text-decoration: none;

    .powered-by-brand {
      color: var(--ms-brand);
    }
  }

  @media (max-width: 1280px) {
    display: none;
  }
`;

const ThemeToggleSwitch = styled.button<{ $dragging?: boolean | undefined }>`
  position: relative;
  display: inline-flex;
  align-items: center;
  padding: 2px;
  border-radius: 8px;
  background: var(--color-canvas-subtle);
  border: 1px solid var(--color-border-default);
  gap: 2px;
  margin-left: auto;
  flex-shrink: 0;
  cursor: ${(props) => (props.$dragging ? "grabbing" : "pointer")};
  user-select: none;
  -webkit-user-select: none;
  touch-action: none;
  outline: none;

  &:focus-visible {
    box-shadow: 0 0 0 2px var(--ms-brand);
  }

  @media (max-width: 1280px) {
    margin-left: 0;
  }
`;

const ThemeToggleThumb = styled.span<{ $offsetPx: number; $dragging?: boolean | undefined }>`
  position: absolute;
  top: 2px;
  left: 2px;
  width: 24px;
  height: 22px;
  border-radius: 6px;
  background: var(--color-bg-elevated);
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.12);
  transform: translate3d(${(props) => props.$offsetPx}px, 0, 0);
  transition: ${(props) => (props.$dragging ? "none" : "transform 0.14s cubic-bezier(0.16, 1, 0.3, 1)")};
  pointer-events: none;
  z-index: 0;
`;

const ThemeToggleIconSlot = styled.span<{ $active?: boolean | undefined }>`
  position: relative;
  z-index: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 22px;
  border-radius: 6px;
  color: ${(props) => (props.$active ? "var(--ms-brand)" : "var(--color-text-muted)")};
  transition: color 0.15s ease;
  pointer-events: none;

  ${ThemeToggleSwitch}:hover & {
    color: ${(props) => (props.$active ? "var(--ms-brand)" : "var(--color-text-heading)")};
  }
`;

const SidebarAvatar = styled.div<{ $url?: string | undefined }>`
  width: 36px;
  height: 36px;
  min-width: 36px;
  min-height: 36px;
  border-radius: 50%;
  background: var(--gradient-ai);
  box-shadow: var(--glow-ai-sm);
  background-image: ${(props) => safeCssImageUrl(props.$url)};
  background-size: cover;
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  font-weight: bold;
  font-size: 14px;
  flex-shrink: 0;
`;

const LogoutMenu = styled.div`
  position: absolute;
  bottom: calc(100% + 8px);
  left: 0;
  width: 100%;
  background-color: var(--surface-overlay);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border: 1px solid var(--color-border-default);
  border-radius: 12px;
  box-shadow: var(--ms-shadow-pop);
  padding: 8px 0;
  z-index: 50;

  @media (max-width: 1280px) {
    width: max-content;
  }

  button {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 9px 14px;
    background: none;
    border: none;
    text-align: left;
    font-family: inherit;
    font-size: 13.5px;
    font-weight: 600;
    color: var(--color-text-primary);
    cursor: pointer;

    &:hover {
      background-color: var(--surface-row-hover);
    }
  }

  hr {
    margin: 4px 0;
    border: none;
    border-top: 1px solid var(--ms-divider);
  }
`;

const ProfileFooterContainer = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 10px;
  border-radius: 10px;
  cursor: pointer;
  transition: background-color 0.16s ease;

  &:hover {
    background-color: var(--surface-row-hover);
  }
`;

const SplitPostButtonContainer = styled.div`
  display: flex;
  align-items: stretch;
  width: 100%;
  height: 40px;
  background: var(--ms-brand);
  border-radius: 10px;
  box-shadow: var(--ms-brand-shadow);
  overflow: hidden;
  box-sizing: border-box;
  border: 1px solid var(--color-accent-blue-border, transparent);
  transition:
    box-shadow 0.16s ease,
    transform 0.12s ease;

  &:hover {
    box-shadow: 0 10px 28px -6px color-mix(in srgb, var(--ms-brand) 55%, transparent);
  }

  @media (max-width: 1280px) {
    flex-direction: column;
    width: 44px;
    height: auto;
    border-radius: 12px;
  }
`;

const SplitPostButtonAction = styled.button`
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 100%;
  padding: 0 8px;
  background: transparent;
  border: none;
  color: var(--ms-brand-contrast, #ffffff);
  font-family: inherit;
  font-size: 15px;
  font-weight: 650;
  line-height: 1;
  letter-spacing: -0.01em;
  cursor: pointer;
  user-select: none;
  transition:
    background-color 0.16s ease,
    color 0.16s ease;

  &:hover {
    background-color: rgba(255, 255, 255, 0.15);
    color: var(--ms-brand-contrast, #ffffff);
  }

  &:active {
    background-color: rgba(0, 0, 0, 0.12);
  }

  &:focus-visible {
    outline: 2px solid #ffffff;
    outline-offset: -2px;
    z-index: 2;
  }

  @media (max-width: 1280px) {
    width: 44px;
    height: 42px;
    padding: 0;
    gap: 0;
  }
`;

const SplitSketchButtonLink = styled(Link)`
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 100%;
  padding: 0 8px;
  background: transparent;
  border: none;
  color: var(--ms-brand-contrast, #ffffff);
  font-family: inherit;
  font-size: 15px;
  font-weight: 650;
  line-height: 1;
  letter-spacing: -0.01em;
  text-decoration: none;
  cursor: pointer;
  user-select: none;
  transition:
    background-color 0.16s ease,
    color 0.16s ease;

  &:hover {
    background-color: rgba(255, 255, 255, 0.15);
    color: var(--ms-brand-contrast, #ffffff);
    text-decoration: none;
  }

  &:active {
    background-color: rgba(0, 0, 0, 0.12);
  }

  &:focus-visible {
    outline: 2px solid #ffffff;
    outline-offset: -2px;
    z-index: 2;
  }

  @media (max-width: 1280px) {
    width: 44px;
    height: 42px;
    padding: 0;
    gap: 0;
  }
`;

const SplitPostButtonDivider = styled.div`
  width: 1px;
  height: 22px;
  align-self: center;
  background-color: rgba(255, 255, 255, 0.28);
  flex-shrink: 0;

  @media (max-width: 1280px) {
    width: 26px;
    height: 1px;
    margin: 0 auto;
  }
`;

interface SidebarLinkItem {
  to: string;
  icon: any;
  label: string;
  reloadDocument?: boolean | undefined;
  isExternalSurface?: boolean | undefined;
}

interface SidebarProps {
  onPostClick?: (() => void) | undefined;
  onSketchClick?: (() => void) | undefined;
}

const THEME_THUMB_TRAVEL_PX = 26;
const THEME_DRAG_THRESHOLD_PX = 6;

const Sidebar: React.FC<SidebarProps> = ({ onPostClick, onSketchClick }) => {
  const { user, isAdmin, logout, unreadCount, setUnreadCount, adminPendingCount } = useAuth();
  const { theme, toggleTheme, setTheme } = useTheme();
  const ThemeIcon = theme === "dark" ? SunIcon : MoonIcon;
  const themeLabel = theme === "dark" ? "Light theme" : "Dark theme";
  const location = useLocation();
  const navigate = useNavigate();
  const [showLogoutMenu, setShowLogoutMenu] = React.useState(false);
  const [showGuestAuthMenu, setShowGuestAuthMenu] = React.useState(false);
  const [guestPopoverPos, setGuestPopoverPos] = React.useState<{ left: number; bottom: number }>({
    left: 84,
    bottom: 52,
  });
  const guestAuthTriggerRef = React.useRef<HTMLButtonElement | null>(null);
  const guestAuthPopoverRef = React.useRef<HTMLDivElement | null>(null);
  const [themeDragOffset, setThemeDragOffset] = React.useState<number | null>(null);
  const themeDragRef = React.useRef<{
    pointerId: number;
    startX: number;
    baseOffset: number;
    moved: boolean;
    maxAbsDelta: number;
  } | null>(null);
  const suppressThemeClickRef = React.useRef(false);

  const effectiveThumbOffset =
    themeDragOffset !== null ? themeDragOffset : theme === "dark" ? THEME_THUMB_TRAVEL_PX : 0;
  const activeVisualTheme =
    themeDragOffset !== null ? (themeDragOffset >= THEME_THUMB_TRAVEL_PX / 2 ? "dark" : "light") : theme;

  const updateGuestPopoverPosition = React.useCallback(() => {
    const trigger = guestAuthTriggerRef.current;
    if (!trigger || typeof window === "undefined") return;
    const rect = trigger.getBoundingClientRect();
    const left = Math.max(12, Math.round(rect.right + 10));
    const bottom = Math.max(12, Math.round(window.innerHeight - rect.bottom));
    setGuestPopoverPos({ left, bottom });
  }, []);

  useClickOutside(
    guestAuthPopoverRef,
    () => {
      setShowGuestAuthMenu(false);
    },
    showGuestAuthMenu,
    {
      ignoreRefs: [guestAuthTriggerRef],
      closeOnEscape: true,
    },
  );

  React.useEffect(() => {
    setShowGuestAuthMenu(false);
  }, [location.pathname]);

  React.useEffect(() => {
    if (!showGuestAuthMenu) return;
    updateGuestPopoverPosition();
    const handleViewportChange = () => {
      if (window.innerWidth > 1280) {
        setShowGuestAuthMenu(false);
        return;
      }
      updateGuestPopoverPosition();
    };
    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", updateGuestPopoverPosition, true);
    return () => {
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", updateGuestPopoverPosition, true);
    };
  }, [showGuestAuthMenu, updateGuestPopoverPosition]);

  React.useEffect(() => {
    if (!showLogoutMenu) return;
    const handlePointerDown = (e: MouseEvent | TouchEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && !target.closest(".profile-footer-container")) {
        setShowLogoutMenu(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setShowLogoutMenu(false);
      }
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [showLogoutMenu]);

  React.useEffect(() => {
    if (location.pathname === "/notifications") {
      setUnreadCount(0);
    }
  }, [location.pathname, setUnreadCount]);

  const hasIde = useFeatureFlag("heavy_vscode_ide");
  const hasCae = useFeatureFlag("cae_cloud_solver");
  const hasPackages = useFeatureFlag("package_browser");
  const hasRepos = useFeatureFlag(["git_repositories", "repositories"]);
  const hasReferences = useFeatureFlag(["references", "scientific_references"]);
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const hasFeeds = useFeatureFlag("feeds_page") || useFeatureFlag("rss_feeds");
  const branding = useInstanceBranding();
  const customLogoSrc = theme === "dark" ? branding.brandLogoDarkUrl || branding.brandLogoUrl : branding.brandLogoUrl;
  const docsBase = (branding.docsBaseUrl || "").trim().replace(/\/+$/, "");
  const nodeDomainLabel = React.useMemo(() => {
    if (typeof window !== "undefined" && window.location?.hostname) {
      const h = window.location.hostname;
      if (h !== "localhost" && h !== "127.0.0.1") return h;
    }
    return "ansatz.social";
  }, []);

  const handleSketchClick = (e: React.MouseEvent) => {
    if (onSketchClick) {
      e.preventDefault();
      onSketchClick();
      return;
    }
    if (location.pathname === "/sketch" || location.pathname.startsWith("/sketch/")) {
      e.preventDefault();
      scrollToTop({ smooth: true });
    } else {
      scrollToTop({ smooth: false });
    }
  };

  // 1. Primary in-shell social / community links
  const communityLinks: SidebarLinkItem[] = [];
  if (user) communityLinks.push({ to: "/home", icon: HomeIcon, label: "Home" });
  communityLinks.push({ to: "/explore", icon: SearchIcon, label: "Explore" });
  if (user) {
    communityLinks.push({ to: "/notifications", icon: BellIcon, label: "Notifications" });
    communityLinks.push({ to: "/bookmarks", icon: BookmarkIcon, label: "Bookmarks" });
    if (hasFeeds) {
      communityLinks.push({ to: "/feeds", icon: RssIcon, label: "Feeds" });
    }
    communityLinks.push({ to: `/@${user.username}`, icon: PersonIcon, label: "Profile" });
  }

  // 2. Primary in-shell registry & engineering hub links
  const registryLinks: SidebarLinkItem[] = [];
  if (hasPackages) {
    registryLinks.push({ to: "/packages", icon: PackageIcon, label: "Packages" });
  }
  if (hasIde) {
    registryLinks.push({ to: "/studio", icon: CodeIcon, label: "Studio" });
  }
  if (hasRepos) {
    registryLinks.push({ to: "/repos", icon: RepoIcon, label: "Repositories" });
  }
  if (hasReferences) {
    registryLinks.push({ to: "/references", icon: BookIcon, label: "References" });
  }
  if (hasCae) {
    registryLinks.push({ to: "/jobs", icon: ServerIcon, label: "Jobs" });
  }
  if (user && isAdmin) {
    registryLinks.push({ to: "/admin", icon: ShieldLockIcon, label: "Admin" });
  }

  const renderLinkItem = (link: SidebarLinkItem, compact = false) => {
    const isActive = location.pathname === link.to || location.pathname.startsWith(`${link.to}/`);
    return (
      <NavItem
        key={link.to}
        to={link.to}
        data-tour-id={link.to === "/explore" ? "tour-explore" : undefined}
        reloadDocument={Boolean(link.reloadDocument)}
        title={link.label}
        aria-label={link.label}
        $active={isActive}
        $compact={compact}
        onClick={() => {
          if (location.pathname === link.to) {
            scrollToTop({ smooth: true });
          } else {
            scrollToTop({ smooth: false });
          }
        }}
      >
        <NavPill $active={isActive} $compact={compact}>
          <div
            className="nav-leading-icon"
            style={{
              position: "relative",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: compact ? 18 : 22,
              height: compact ? 18 : 22,
              flexShrink: 0,
            }}
          >
            <link.icon size={compact ? 16 : 19} />
            {link.to === "/notifications" && unreadCount > 0 && (
              <div
                style={{
                  position: "absolute",
                  top: -4,
                  right: -6,
                  backgroundColor: "var(--ms-brand)",
                  color: "white",
                  borderRadius: "999px",
                  minWidth: "17px",
                  height: "17px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "10px",
                  fontWeight: "bold",
                  padding: "0 4px",
                  boxShadow: "0 0 0 2px var(--color-bg-primary)",
                }}
              >
                {unreadCount > 99 ? "99+" : unreadCount}
              </div>
            )}
          </div>
          <Text className="nav-label">{link.label}</Text>
          {link.isExternalSurface && <LinkExternalIcon size={12} className="nav-external-icon" />}
          {link.to === "/admin" && adminPendingCount > 0 && (
            <AdminNavBadge data-testid="admin-nav-badge" aria-label={`${adminPendingCount} pending admin events`}>
              {adminPendingCount > 99 ? "99+" : adminPendingCount}
            </AdminNavBadge>
          )}
        </NavPill>
      </NavItem>
    );
  };

  return (
    <SidebarContainer>
      <BrandRow>
        <BrandHeader
          to={user ? "/home" : "/explore"}
          title={branding.instanceTagline || branding.instanceName}
          onClick={() => {
            const homeTarget = user ? "/home" : "/explore";
            if (location.pathname === homeTarget) {
              scrollToTop({ smooth: true });
            } else {
              scrollToTop({ smooth: false });
            }
          }}
        >
          <div className="brand-icon-wrap">
            <AnsatzMark
              size={34}
              logoUrl={customLogoSrc}
              alt={branding.instanceName || "Ansatz"}
              accentColor={branding.brandAccentColor}
            />
          </div>
          <BrandTitle className="nav-label" data-testid="sidebar-brand-title">
            <div className="brand-top-row">
              <span className="brand-name">{branding.instanceName || "Ansatz"}</span>
              <span className="brand-badge" data-testid="sidebar-brand-badge">
                {branding.instanceBadge?.trim() || "Beta"}
              </span>
            </div>
            <div className="brand-domain-sub" data-testid="sidebar-brand-domain">
              <span className="brand-status-dot" aria-hidden="true" />
              <span>{nodeDomainLabel}</span>
            </div>
          </BrandTitle>
        </BrandHeader>
      </BrandRow>

      <Box
        display="flex"
        flexDirection="column"
        gap={1}
        flex={1}
        style={{ position: "relative", zIndex: 1, marginTop: "2px" }}
      >
        {communityLinks.map((link) => renderLinkItem(link, false))}

        {/* Only show divider between social & registry sections when logged in (multiple community items) */}
        {user && <SectionDivider />}

        <div
          data-tour-id="tour-registry"
          style={{ display: "flex", flexDirection: "column", gap: "4px", width: "100%" }}
        >
          {registryLinks.map((link) => renderLinkItem(link, false))}
        </div>

        {user && (
          <Box mt={2} width="100%" px={1} className="post-btn-container">
            <SplitPostButtonContainer className="post-split-btn-group" data-testid="sidebar-split-post-button">
              <SplitPostButtonAction
                type="button"
                onClick={onPostClick}
                className="post-split-btn post-split-btn-primary"
                aria-label="New post"
                title="Create new post"
                data-testid="sidebar-post-button"
              >
                <PlusIcon size={16} className="post-split-icon" />
                <span className="post-text">Post</span>
              </SplitPostButtonAction>
              <SplitPostButtonDivider aria-hidden="true" className="post-split-divider" />
              <SplitSketchButtonLink
                to="/sketch"
                onClick={handleSketchClick}
                className="post-split-btn post-split-btn-sketch"
                aria-label="New sketch"
                title="Ansatz Sketch"
                data-testid="sidebar-sketch-button"
              >
                <AnsatzSketchIcon size={16} variant="triangle" color="currentColor" className="post-split-icon" />
                <span className="post-text">Sketch</span>
              </SplitSketchButtonLink>
            </SplitPostButtonContainer>
          </Box>
        )}
      </Box>

      <FooterSection $isGuest={!user}>
        {user ? (
          <Box className="profile-footer-container" position="relative" zIndex={20}>
            {showLogoutMenu && (
              <LogoutMenu>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleTheme();
                  }}
                >
                  <ThemeIcon size={16} /> {themeLabel}
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowLogoutMenu(false);
                    if (location.pathname === "/settings") {
                      scrollToTop({ smooth: true });
                    } else {
                      scrollToTop({ smooth: false });
                      navigate("/settings");
                    }
                  }}
                >
                  <GearIcon size={16} /> Settings
                </button>
                <hr />
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowLogoutMenu(false);
                    logout();
                    navigate("/logout", { replace: true });
                  }}
                >
                  Log out @{user.username}
                </button>
              </LogoutMenu>
            )}
            <ProfileFooterContainer
              className="profile-footer"
              onClick={(e) => {
                e.stopPropagation();
                setShowLogoutMenu(!showLogoutMenu);
              }}
            >
              <Box display="flex" alignItems="center" gap={2.5} style={{ minWidth: 0 }}>
                <SidebarAvatar $url={user.avatar_url}>
                  {user.avatar_url ? null : user.username.charAt(0).toUpperCase()}
                </SidebarAvatar>
                <Box display="flex" flexDirection="column" className="profile-details" style={{ minWidth: 0 }}>
                  <Text
                    style={{
                      fontWeight: 700,
                      fontSize: "13.5px",
                      lineHeight: "18px",
                      display: "block",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {user.display_name || (user.username === "dev" ? "Dev User" : user.username)}
                  </Text>
                  <Text
                    className="handle-text"
                    style={{
                      fontSize: "12px",
                      lineHeight: "15px",
                      display: "block",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    @{user.username}
                  </Text>
                </Box>
              </Box>
              <Box className="profile-details" color="var(--color-text-muted)">
                <KebabHorizontalIcon size={16} />
              </Box>
            </ProfileFooterContainer>
          </Box>
        ) : (
          <GuestAuthActions className="guest-auth-actions">
            <div className="guest-auth-expanded">
              <Link
                to="/login"
                className="ms-btn ms-btn-secondary guest-auth-btn"
                onClick={() => {
                  if (location.pathname === "/login") {
                    scrollToTop({ smooth: true });
                  } else {
                    scrollToTop({ smooth: false });
                  }
                }}
              >
                Log in
              </Link>
              <Link
                to="/signup"
                className="ms-btn ms-btn-primary guest-auth-btn"
                onClick={() => {
                  if (location.pathname === "/signup") {
                    scrollToTop({ smooth: true });
                  } else {
                    scrollToTop({ smooth: false });
                  }
                }}
              >
                Sign up
              </Link>
            </div>

            <GuestRailAuthButton
              ref={guestAuthTriggerRef}
              type="button"
              $active={showGuestAuthMenu || location.pathname === "/login" || location.pathname === "/signup"}
              aria-label="Log in or sign up"
              aria-expanded={showGuestAuthMenu}
              title="Log in or sign up"
              data-testid="sidebar-guest-auth-trigger"
              onClick={() => {
                setShowGuestAuthMenu((prev) => {
                  const next = !prev;
                  if (next) {
                    updateGuestPopoverPosition();
                  }
                  return next;
                });
              }}
            >
              <PersonIcon size={19} />
            </GuestRailAuthButton>

            {showGuestAuthMenu && (
              <GuestAuthPopover
                ref={guestAuthPopoverRef}
                role="dialog"
                aria-label="Account sign in or sign up"
                data-testid="sidebar-guest-auth-popover"
                $left={guestPopoverPos.left}
                $bottom={guestPopoverPos.bottom}
              >
                <div className="popover-header">
                  <AnsatzMark
                    size={26}
                    logoUrl={customLogoSrc}
                    alt={branding.instanceName || "Ansatz"}
                    accentColor={branding.brandAccentColor}
                  />
                  <span className="popover-title">Join {branding.instanceName || "Ansatz"}</span>
                </div>
                <p className="popover-subtitle">
                  Simulate physical systems, publish packages, and collaborate with engineers.
                </p>
                <div className="popover-actions">
                  <Link
                    to="/signup"
                    className="ms-btn ms-btn-primary popover-btn"
                    onClick={() => {
                      setShowGuestAuthMenu(false);
                      if (location.pathname === "/signup") {
                        scrollToTop({ smooth: true });
                      } else {
                        scrollToTop({ smooth: false });
                      }
                    }}
                  >
                    Sign up
                  </Link>
                  <Link
                    to="/login"
                    className="ms-btn ms-btn-secondary popover-btn"
                    onClick={() => {
                      setShowGuestAuthMenu(false);
                      if (location.pathname === "/login") {
                        scrollToTop({ smooth: true });
                      } else {
                        scrollToTop({ smooth: false });
                      }
                    }}
                  >
                    Log in
                  </Link>
                  <button
                    type="button"
                    className="popover-github-btn"
                    onClick={() => {
                      setShowGuestAuthMenu(false);
                      window.location.href = "/api/v1/auth/login/github";
                    }}
                  >
                    <MarkGithubIcon size={15} />
                    Continue with GitHub
                  </button>
                </div>
              </GuestAuthPopover>
            )}
          </GuestAuthActions>
        )}

        <UtilityFooterRow>
          {branding.showPoweredBy && (
            <PoweredByFooter
              href={docsBase || "https://modelscript.org"}
              target="_blank"
              rel="noopener noreferrer"
              data-testid="sidebar-powered-by"
              title="Powered by the ModelScript Polyglot Compiler & Simulation Engine"
            >
              <img
                src={theme === "dark" ? "/ms-logo-light.png" : "/ms-logo.png"}
                alt=""
                className="powered-by-icon"
                width={14}
                height={14}
                aria-hidden="true"
              />
              <span>
                Powered by <span className="powered-by-brand">ModelScript</span>
              </span>
            </PoweredByFooter>
          )}

          <ThemeToggleSwitch
            type="button"
            role="switch"
            aria-checked={theme === "dark"}
            aria-label="Toggle color theme"
            title={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
            data-testid="sidebar-theme-toggle"
            $dragging={themeDragOffset !== null}
            onPointerDown={(e) => {
              if (e.pointerType === "mouse" && e.button !== 0) return;
              suppressThemeClickRef.current = false;
              const baseOffset = theme === "dark" ? THEME_THUMB_TRAVEL_PX : 0;
              themeDragRef.current = {
                pointerId: e.pointerId,
                startX: e.clientX,
                baseOffset,
                moved: false,
                maxAbsDelta: 0,
              };
              try {
                e.currentTarget.setPointerCapture(e.pointerId);
              } catch {
                // Ignore pointer capture errors in headless/synthetic environments
              }
            }}
            onPointerMove={(e) => {
              const drag = themeDragRef.current;
              if (!drag || drag.pointerId !== e.pointerId) return;
              const deltaX = e.clientX - drag.startX;
              const absDelta = Math.abs(deltaX);
              if (absDelta > drag.maxAbsDelta) {
                drag.maxAbsDelta = absDelta;
              }
              if (!drag.moved && absDelta >= THEME_DRAG_THRESHOLD_PX) {
                drag.moved = true;
              }
              if (drag.moved) {
                const nextOffset = Math.max(0, Math.min(THEME_THUMB_TRAVEL_PX, drag.baseOffset + deltaX));
                setThemeDragOffset(nextOffset);
              }
            }}
            onPointerUp={(e) => {
              const drag = themeDragRef.current;
              if (!drag || drag.pointerId !== e.pointerId) return;
              themeDragRef.current = null;
              try {
                e.currentTarget.releasePointerCapture(e.pointerId);
              } catch {
                // Ignore pointer capture errors
              }
              if (drag.moved) {
                const deltaX = e.clientX - drag.startX;
                const finalOffset = Math.max(0, Math.min(THEME_THUMB_TRAVEL_PX, drag.baseOffset + deltaX));
                const targetTheme = finalOffset >= THEME_THUMB_TRAVEL_PX / 2 ? "dark" : "light";
                if (targetTheme === theme && drag.maxAbsDelta < THEME_THUMB_TRAVEL_PX / 2) {
                  toggleTheme();
                } else {
                  setTheme(targetTheme);
                }
                suppressThemeClickRef.current = true;
              }
              setThemeDragOffset(null);
            }}
            onPointerCancel={(e) => {
              const drag = themeDragRef.current;
              if (!drag || drag.pointerId !== e.pointerId) return;
              themeDragRef.current = null;
              try {
                e.currentTarget.releasePointerCapture(e.pointerId);
              } catch {
                // Ignore pointer capture errors
              }
              setThemeDragOffset(null);
            }}
            onClick={(e) => {
              if (suppressThemeClickRef.current) {
                suppressThemeClickRef.current = false;
                e.preventDefault();
                return;
              }
              toggleTheme();
            }}
          >
            <ThemeToggleThumb
              data-theme-thumb="true"
              $offsetPx={effectiveThumbOffset}
              $dragging={themeDragOffset !== null}
            />
            <ThemeToggleIconSlot $active={activeVisualTheme === "light"} aria-hidden="true">
              <SunIcon size={13} />
            </ThemeToggleIconSlot>
            <ThemeToggleIconSlot $active={activeVisualTheme === "dark"} aria-hidden="true">
              <MoonIcon size={13} />
            </ThemeToggleIconSlot>
          </ThemeToggleSwitch>
        </UtilityFooterRow>
      </FooterSection>
    </SidebarContainer>
  );
};

export default Sidebar;
