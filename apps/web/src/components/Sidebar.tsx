// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  BellIcon,
  BookmarkIcon,
  CodeIcon,
  GearIcon,
  HomeIcon,
  KebabHorizontalIcon,
  PackageIcon,
  PlayIcon,
  PlusIcon,
  RepoIcon,
  RssIcon,
  SearchIcon,
  ServerIcon,
  ShieldLockIcon,
} from "@primer/octicons-react";
import { Text } from "@primer/react";
import React from "react";
import { Link, useLocation } from "react-router-dom";
import styled from "styled-components";
import { useAuth } from "../AuthContext";
import { useFeatureFlag } from "../FeatureFlagContext";
import { useTheme } from "../theme";
import Box from "./Box";

const SidebarContainer = styled.header`
  width: 275px;
  display: flex;
  flex-direction: column;
  position: sticky;
  top: var(--dev-header-height, 0px);
  height: calc(100vh - var(--dev-header-height, 0px));
  overflow-y: auto;
  padding: 16px 12px 12px 12px;
  box-sizing: border-box;

  @media (max-width: 1280px) {
    width: 80px;
    align-items: center;
    padding: 12px 4px;
  }

  @media (max-width: 500px) {
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

  .sidebar-section-header {
    @media (max-width: 1280px) {
      display: none;
    }
  }

  .post-btn-container {
    @media (max-width: 1280px) {
      padding: 0;
      width: 50px;
      height: 50px;
      display: flex;
      justify-content: center;
    }
  }

  .post-btn {
    @media (max-width: 1280px) {
      width: 50px !important;
      height: 50px !important;
      border-radius: 50% !important;
      padding: 0 !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
    }
  }

  .post-text {
    @media (max-width: 1280px) {
      display: none;
    }
  }

  .post-icon {
    @media (max-width: 1280px) {
      display: flex !important;
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
      width: 50px;
      height: 50px;
      justify-content: center;
      border-radius: 50%;
    }
  }
`;

const NavItem = styled(Link)<{ $active?: boolean }>`
  display: flex;
  align-items: center;
  text-decoration: none;
  color: ${(props) => (props.$active ? "var(--color-text-heading)" : "var(--color-text-secondary, #334155)")};
  font-size: 15px;
  font-weight: ${(props) => (props.$active ? "600" : "500")};
  width: 100%;
  box-sizing: border-box;

  svg {
    color: ${(props) => (props.$active ? "var(--color-accent-cyan)" : "var(--color-text-muted, #475569)")};
    transition:
      transform 0.2s cubic-bezier(0.16, 1, 0.3, 1),
      color 0.2s ease;
  }

  &:hover {
    text-decoration: none;
    color: var(--color-text-heading);
  }

  &:hover svg {
    color: var(--color-accent-cyan);
    transform: scale(1.08);
  }

  &:hover > div {
    background-color: var(--surface-row-hover);
    border-color: var(--color-border-default);
  }

  @media (max-width: 1280px) {
    justify-content: center;
  }
`;

const SectionHeader = styled.div`
  font-size: 11px;
  font-weight: 700;
  color: var(--color-text-muted, #475569);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  padding: 10px 14px 4px;
  user-select: none;

  @media (max-width: 1280px) {
    display: none;
  }
`;

const SectionDivider = styled.div`
  height: 1px;
  background-color: var(--color-border-default);
  margin: 6px 8px;

  @media (max-width: 1280px) {
    margin: 4px 2px;
  }
`;

const ShortcutBadge = styled.span`
  margin-left: auto;
  font-family: var(--font-mono, monospace);
  font-size: 10px;
  font-weight: 600;
  color: var(--color-text-muted);
  background: var(--color-canvas-subtle, rgba(0, 0, 0, 0.04));
  border: 1px solid var(--color-border-default);
  padding: 2px 6px;
  border-radius: 4px;
  opacity: 0;
  transform: translateX(-4px);
  transition:
    opacity 0.15s ease,
    transform 0.15s ease;
  pointer-events: none;

  @media (max-width: 1280px) {
    display: none;
  }
`;

const NavPill = styled.div<{ $active?: boolean }>`
  display: inline-flex;
  align-items: center;
  gap: 16px;
  padding: 10px 14px;
  border-radius: 10px;
  width: 100%;
  border: 1px solid ${(props) => (props.$active ? "var(--color-accent-blue-border)" : "transparent")};
  background: ${(props) => (props.$active ? "var(--surface-selected)" : "transparent")};
  box-shadow: ${(props) => (props.$active ? "0 1px 3px rgba(0, 0, 0, 0.04)" : "none")};
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);

  &:hover .shortcut-badge {
    opacity: 1;
    transform: translateX(0);
  }

  @media (max-width: 1280px) {
    width: 44px;
    height: 44px;
    padding: 0;
    justify-content: center;
    border-radius: 10px;
  }
`;

const BrandHeader = styled(Link)`
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 10px;
  border-radius: 12px;
  text-decoration: none;
  margin-bottom: 10px;
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  color: var(--color-text-heading);

  &:hover {
    text-decoration: none;
    background-color: var(--surface-row-hover);
  }

  @media (max-width: 1280px) {
    justify-content: center;
    padding: 6px 0;
    margin-bottom: 8px;
  }
`;

const BrandIconBox = styled.div`
  width: 36px;
  height: 36px;
  min-width: 36px;
  min-height: 36px;
  border-radius: 9px;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #000000;
  border: 1px solid var(--color-border-default);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);
  transition:
    transform 0.2s ease,
    box-shadow 0.2s ease;

  img {
    width: 36px;
    height: 36px;
    object-fit: cover;
  }

  ${BrandHeader}:hover & {
    transform: scale(1.05);
    box-shadow: 0 3px 8px rgba(0, 0, 0, 0.2);
  }
`;

const BrandTitle = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 16px;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: var(--color-text-heading);
  white-space: nowrap;

  .brand-hub {
    color: var(--color-accent-cyan);
    font-weight: 700;
  }

  @media (max-width: 1280px) {
    display: none;
  }
`;

const SidebarAvatar = styled.div<{ $url?: string }>`
  width: 40px;
  height: 40px;
  min-width: 40px;
  min-height: 40px;
  border-radius: 50%;
  background: var(--gradient-ai);
  box-shadow: var(--glow-ai-sm);
  background-image: ${(props) => (props.$url ? `url(${props.$url})` : "none")};
  background-size: cover;
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  font-weight: bold;
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
  border: 1px solid var(--color-border-glass);
  border-radius: 16px;
  box-shadow: var(--glow-card);
  padding: 12px 0;
  z-index: 99999;

  @media (max-width: 1280px) {
    width: max-content;
  }

  button {
    width: 100%;
    padding: 12px 16px;
    background: none;
    border: none;
    text-align: left;
    font-size: 15px;
    font-weight: bold;
    color: var(--color-text-primary);
    cursor: pointer;

    &:hover {
      background-color: var(--surface-row-hover);
    }
  }
`;

const ProfileFooterContainer = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px;
  margin: 12px 0;
  border-radius: 9999px;
  cursor: pointer;
  transition: background-color 0.2s;

  &:hover {
    background-color: rgba(255, 255, 255, 0.06);
  }
`;

const GuestFooter = styled.div`
  margin-top: auto;
  padding: 14px 8px 8px 8px;
  border-top: 1px solid var(--color-border-default);
  display: flex;
  flex-direction: column;
  gap: 10px;

  @media (max-width: 1280px) {
    display: none;
  }
`;

const GuestSignInBtn = styled(Link)`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 38px;
  padding: 0 14px;
  border-radius: 8px;
  background: var(--color-bg-surface, #ffffff);
  border: 1px solid var(--color-border-strong, rgba(0, 0, 0, 0.16));
  color: var(--color-text-primary, #0f172a);
  font-size: 13.5px;
  font-weight: 600;
  text-decoration: none;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);

  &:hover {
    background: var(--surface-row-hover, #f1f5f9);
    border-color: var(--color-accent-blue-border);
    color: var(--color-text-heading);
    text-decoration: none;
    transform: translateY(-1px);
    box-shadow: 0 2px 5px rgba(0, 0, 0, 0.08);
  }

  &:active {
    transform: translateY(0);
  }
`;

const GuestSignUpBtn = styled(Link)`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 38px;
  padding: 0 14px;
  border-radius: 8px;
  background: var(--gradient-cta);
  border: 1px solid transparent;
  color: #ffffff !important;
  font-size: 13.5px;
  font-weight: 600;
  text-decoration: none;
  box-shadow: 0 2px 8px rgba(124, 58, 237, 0.28);
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);

  &:hover {
    box-shadow: 0 4px 14px rgba(124, 58, 237, 0.4);
    transform: translateY(-1px);
    filter: brightness(1.05);
    color: #ffffff !important;
    text-decoration: none;
  }

  &:active {
    transform: translateY(0);
  }
`;

interface SidebarProps {
  onPostClick?: () => void;
}

const Sidebar: React.FC<SidebarProps> = ({ onPostClick }) => {
  const { user, isAdmin, logout, unreadCount, setUnreadCount } = useAuth();
  const { theme } = useTheme();
  const location = useLocation();
  const [showLogoutMenu, setShowLogoutMenu] = React.useState(false);

  React.useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest(".profile-footer-container")) {
        setShowLogoutMenu(false);
      }
    };
    document.addEventListener("click", handleClickOutside);
    return () => document.removeEventListener("click", handleClickOutside);
  }, []);

  React.useEffect(() => {
    if (location.pathname === "/notifications") {
      setUnreadCount(0);
    }
  }, [location.pathname, setUnreadCount]);

  const hasIde = useFeatureFlag("heavy_vscode_ide");
  const hasCae = useFeatureFlag("cae_cloud_solver");

  const communityLinks = [];
  if (user) communityLinks.push({ to: "/home", icon: HomeIcon, label: "Home", shortcut: "g h" });
  communityLinks.push({ to: "/explore", icon: SearchIcon, label: "Explore", shortcut: "g e" });
  if (user) {
    communityLinks.push({ to: "/notifications", icon: BellIcon, label: "Notifications", shortcut: "g n" });
    communityLinks.push({ to: "/bookmarks", icon: BookmarkIcon, label: "Bookmarks" });
    communityLinks.push({ to: "/feeds", icon: RssIcon, label: "Feeds" });
  }

  const studioLinks = [
    { to: "/playground", icon: PlayIcon, label: "Playground", shortcut: "g p" },
    { to: "/packages", icon: PackageIcon, label: "Packages", shortcut: "g k" },
    { to: "/repos", icon: RepoIcon, label: "Repositories", shortcut: "g r" },
  ];
  if (hasIde) {
    studioLinks.push({ to: "/ide", icon: CodeIcon, label: "IDE", shortcut: "g i" });
  }
  if (hasCae) {
    studioLinks.push({ to: "/jobs", icon: ServerIcon, label: "Jobs" });
  }

  const systemLinks = [];
  if (user) {
    systemLinks.push({ to: "/settings", icon: GearIcon, label: "Settings", shortcut: "g s" });
    if (isAdmin) {
      systemLinks.push({ to: "/admin", icon: ShieldLockIcon, label: "Admin" });
    }
  }

  const renderLinkItem = (link: { to: string; icon: any; label: string; shortcut?: string }) => (
    <NavItem key={link.to} to={link.to} $active={location.pathname.startsWith(link.to)}>
      <NavPill $active={location.pathname.startsWith(link.to)}>
        <div
          style={{
            position: "relative",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 28,
            height: 28,
          }}
        >
          <link.icon size={24} />
          {link.to === "/notifications" && unreadCount > 0 && (
            <div
              style={{
                position: "absolute",
                top: -4,
                right: -6,
                backgroundColor: "var(--color-accent-cyan)",
                color: "white",
                borderRadius: "50%",
                minWidth: "20px",
                height: "20px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "11px",
                fontWeight: "bold",
                padding: "0 4px",
                boxShadow: "0 0 0 2px var(--color-bg-primary)",
              }}
            >
              {unreadCount > 9 ? "9+" : unreadCount}
            </div>
          )}
        </div>
        <Text className="nav-label">{link.label}</Text>
        {link.shortcut && <ShortcutBadge className="shortcut-badge">{link.shortcut}</ShortcutBadge>}
      </NavPill>
    </NavItem>
  );

  return (
    <SidebarContainer>
      <BrandHeader to={user ? "/home" : "/explore"}>
        <BrandIconBox>
          <img src={theme === "dark" ? "/ms-logo-light.png" : "/ms-logo.png"} alt="ModelScript" />
        </BrandIconBox>
        <BrandTitle className="nav-label">
          <span>ModelScript</span>
          <span className="brand-hub">Hub</span>
        </BrandTitle>
      </BrandHeader>

      <Box
        display="flex"
        flexDirection="column"
        gap={1}
        flex={1}
        style={{ position: "relative", zIndex: 1, marginTop: "4px" }}
      >
        {communityLinks.map(renderLinkItem)}

        <SectionDivider />
        <SectionHeader>Modeling Studio</SectionHeader>
        {studioLinks.map(renderLinkItem)}

        {systemLinks.length > 0 && (
          <>
            <SectionDivider />
            <SectionHeader>System</SectionHeader>
            {systemLinks.map(renderLinkItem)}
          </>
        )}

        {user && (
          <>
            <Box mt={4} mb={4} px={4} className="sidebar-separator">
              <div style={{ height: "1px", backgroundColor: "var(--color-border)", width: "100%" }} />
            </Box>
            <Box mt={4} width="100%" px={2} className="post-btn-container">
              <button
                style={{
                  width: "100%",
                  borderRadius: "10px",
                  fontSize: "15px",
                  padding: "12px 20px",
                  background: "var(--gradient-cta)",
                  color: "white",
                  border: "none",
                  fontWeight: "600",
                  cursor: "pointer",
                  boxShadow: "var(--glow-ai-sm)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "8px",
                  transition: "opacity 0.2s ease, transform 0.1s ease, box-shadow 0.2s ease",
                }}
                onClick={onPostClick}
                className="post-btn"
              >
                <span className="post-text">✨ Synthesize / Post</span>
                <span className="post-icon" style={{ display: "none" }}>
                  <PlusIcon size={20} />
                </span>
              </button>
            </Box>
          </>
        )}
      </Box>

      {user && (
        <Box className="profile-footer-container" position="relative" zIndex={99999}>
          {showLogoutMenu && (
            <LogoutMenu>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  logout();
                  setShowLogoutMenu(false);
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
            <Box display="flex" alignItems="center" gap={3}>
              <SidebarAvatar $url={user.avatar_url}>
                {user.avatar_url ? null : user.username.charAt(0).toUpperCase()}
              </SidebarAvatar>
              <Box display="flex" flexDirection="column" className="profile-details">
                <Text style={{ fontWeight: "bold", fontSize: "15px", display: "block" }}>
                  {user.display_name || (user.username === "dev" ? "Dev User" : user.username)}
                </Text>
                <Text className="handle-text" style={{ display: "block", marginTop: "-2px" }}>
                  @{user.username}
                </Text>
              </Box>
            </Box>
            <Box className="profile-details" color="var(--color-text-muted)">
              <KebabHorizontalIcon size={16} />
            </Box>
          </ProfileFooterContainer>
        </Box>
      )}

      {!user && (
        <GuestFooter>
          <Box display="flex" gap={2}>
            <GuestSignInBtn to="/login" style={{ flex: 1 }}>
              Log in
            </GuestSignInBtn>
            <GuestSignUpBtn to="/signup" style={{ flex: 1 }}>
              Sign up
            </GuestSignUpBtn>
          </Box>
        </GuestFooter>
      )}
    </SidebarContainer>
  );
};

export default Sidebar;
