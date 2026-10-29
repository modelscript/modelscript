// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  BellIcon,
  BookIcon,
  BookmarkIcon,
  CodeIcon,
  GearIcon,
  HomeIcon,
  KebabHorizontalIcon,
  MoonIcon,
  PackageIcon,
  PersonIcon,
  PlayIcon,
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
import { useTheme } from "../theme";
import { safeCssImageUrl } from "../util/url";
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
    font-size: 17px;
    font-weight: 700;

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

const NavItem = styled(Link)<{ $active?: boolean | undefined }>`
  display: flex;
  align-items: center;
  text-decoration: none;
  color: var(--color-text-heading, #0f1419);
  font-size: 17px;
  line-height: 22px;
  font-weight: ${(props) => (props.$active ? "700" : "500")};
  width: 100%;
  box-sizing: border-box;

  .nav-label {
    font-size: 17px;
    line-height: 22px;
    font-weight: inherit;
    color: inherit;
  }

  svg {
    color: ${(props) => (props.$active ? "var(--color-accent-cyan)" : "var(--color-text-heading, #0f1419)")};
    transition:
      transform 0.2s cubic-bezier(0.16, 1, 0.3, 1),
      color 0.2s ease;
  }

  &:hover {
    text-decoration: none;
    color: var(--color-text-heading, #0f1419);
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

const SectionDivider = styled.div`
  height: 1px;
  background-color: var(--color-border-default);
  margin: 8px 10px;

  @media (max-width: 1280px) {
    margin: 6px 2px;
  }
`;

const NavPill = styled.div<{ $active?: boolean | undefined }>`
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 16px;
  padding: 9px 14px;
  border-radius: 10px;
  width: 100%;
  border: 1px solid ${(props) => (props.$active ? "var(--color-accent-blue-border)" : "transparent")};
  background: ${(props) => (props.$active ? "var(--surface-selected)" : "transparent")};
  box-shadow: ${(props) => (props.$active ? "0 1px 3px rgba(0, 0, 0, 0.04)" : "none")};
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);

  @media (max-width: 1280px) {
    width: 44px;
    height: 44px;
    padding: 0;
    justify-content: center;
    border-radius: 10px;
  }
`;

const AdminNavBadge = styled.span`
  margin-left: auto;
  font-size: 11px;
  font-weight: 700;
  padding: 2px 8px;
  border-radius: 12px;
  background: rgba(210, 153, 34, 0.2);
  color: #d29922;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  line-height: 1.4;

  @media (max-width: 1280px) {
    position: absolute;
    top: 4px;
    right: 2px;
    margin-left: 0;
    min-width: 18px;
    height: 18px;
    padding: 0 4px;
    font-size: 10px;
    border-radius: 999px;
    background: #d29922;
    color: #ffffff;
    box-shadow: 0 0 0 2px var(--color-bg-primary);
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
  font-size: 18px;
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

const SidebarAvatar = styled.div<{ $url?: string | undefined }>`
  width: 40px;
  height: 40px;
  min-width: 40px;
  min-height: 40px;
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
  z-index: 50;

  @media (max-width: 1280px) {
    width: max-content;
  }

  button {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 10px 16px;
    background: none;
    border: none;
    text-align: left;
    font-family: inherit;
    font-size: 14px;
    font-weight: 600;
    color: var(--color-text-primary);
    cursor: pointer;

    &:hover {
      background-color: var(--surface-row-hover);
    }
  }

  hr {
    margin: 6px 0;
    border: none;
    border-top: 1px solid var(--ms-divider);
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
    background-color: var(--surface-row-hover);
  }
`;

const GuestFooter = styled.div`
  margin-top: auto;
  padding: 14px 8px 8px 8px;
  border-top: 1px solid var(--color-border-default);
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 100%;
  box-sizing: border-box;

  @media (max-width: 1280px) {
    padding: 10px 4px 4px 4px;
    align-items: center;
    gap: 6px;

    .guest-theme-label {
      display: none;
    }

    .guest-auth-actions {
      flex-direction: column;
      width: 100%;
      gap: 6px;
    }

    .guest-auth-actions a {
      padding: 6px 4px;
      font-size: 11px;
      text-align: center;
      justify-content: center;
    }
  }

  @media (max-width: 899px) {
    display: none;
  }
`;

const GuestThemeToggle = styled.button`
  align-self: flex-start;

  @media (max-width: 1280px) {
    align-self: center;
  }
`;

interface SidebarProps {
  onPostClick?: (() => void) | undefined;
}

const Sidebar: React.FC<SidebarProps> = ({ onPostClick }) => {
  const { user, isAdmin, logout, unreadCount, setUnreadCount, adminPendingCount } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const ThemeIcon = theme === "dark" ? SunIcon : MoonIcon;
  const themeLabel = theme === "dark" ? "Light theme" : "Dark theme";
  const location = useLocation();
  const navigate = useNavigate();
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
  if (user) communityLinks.push({ to: "/home", icon: HomeIcon, label: "Home" });
  communityLinks.push({ to: "/explore", icon: SearchIcon, label: "Explore" });
  if (user) {
    communityLinks.push({ to: "/notifications", icon: BellIcon, label: "Notifications" });
    communityLinks.push({ to: "/bookmarks", icon: BookmarkIcon, label: "Bookmarks" });
    communityLinks.push({ to: "/feeds", icon: RssIcon, label: "Feeds" });
    communityLinks.push({ to: `/${user.username}`, icon: PersonIcon, label: "Profile" });
  }

  const studioLinks: {
    to: string;
    icon: any;
    label: string;
    reloadDocument?: boolean;
  }[] = [
    { to: "/playground", icon: PlayIcon, label: "Playground" },
    { to: "/packages", icon: PackageIcon, label: "Packages" },
    { to: "/repos", icon: RepoIcon, label: "Repositories" },
    { to: "/guide/introduction", icon: BookIcon, label: "Docs", reloadDocument: true },
  ];
  if (hasIde) {
    studioLinks.push({ to: "/ide", icon: CodeIcon, label: "IDE" });
  }
  if (hasCae) {
    studioLinks.push({ to: "/jobs", icon: ServerIcon, label: "Jobs" });
  }

  const systemLinks = [];
  if (user && isAdmin) {
    systemLinks.push({ to: "/admin", icon: ShieldLockIcon, label: "Admin" });
  }

  const renderLinkItem = (link: { to: string; icon: any; label: string; reloadDocument?: boolean | undefined }) => {
    const isActive = location.pathname === link.to || location.pathname.startsWith(`${link.to}/`);
    return (
      <NavItem
        key={link.to}
        to={link.to}
        reloadDocument={Boolean(link.reloadDocument)}
        title={link.label}
        aria-label={link.label}
        $active={isActive}
      >
        <NavPill $active={isActive}>
          <div
            style={{
              position: "relative",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 24,
              height: 24,
            }}
          >
            <link.icon size={20} />
            {link.to === "/notifications" && unreadCount > 0 && (
              <div
                style={{
                  position: "absolute",
                  top: -4,
                  right: -6,
                  backgroundColor: "var(--color-accent-cyan)",
                  color: "white",
                  borderRadius: "50%",
                  minWidth: "18px",
                  height: "18px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "10px",
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
        {studioLinks.map(renderLinkItem)}

        {systemLinks.length > 0 && (
          <>
            <SectionDivider />
            {systemLinks.map(renderLinkItem)}
          </>
        )}

        {user && (
          <>
            <Box mt={3} width="100%" px={2} className="post-btn-container">
              <button
                type="button"
                onClick={onPostClick}
                className="ms-btn ms-btn-primary ms-btn-lg ms-btn-block post-btn"
                aria-label="New post"
              >
                <span className="post-text">Post</span>
                <span className="post-icon" style={{ display: "none" }}>
                  <PlusIcon size={20} />
                </span>
              </button>
            </Box>
          </>
        )}
      </Box>

      {user && (
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
                  navigate("/settings");
                }}
              >
                <GearIcon size={16} /> Settings
              </button>
              <hr />
              <button
                type="button"
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
                <Text style={{ fontWeight: 700, fontSize: "13.5px", lineHeight: "18px", display: "block" }}>
                  {user.display_name || (user.username === "dev" ? "Dev User" : user.username)}
                </Text>
                <Text className="handle-text" style={{ fontSize: "12.5px", lineHeight: "16px", display: "block" }}>
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
          <GuestThemeToggle
            type="button"
            className="ms-btn ms-btn-quiet ms-btn-sm"
            onClick={toggleTheme}
            title={themeLabel}
            aria-label={themeLabel}
          >
            <ThemeIcon size={14} /> <span className="guest-theme-label">{themeLabel}</span>
          </GuestThemeToggle>
          <Box display="flex" gap={2} className="guest-auth-actions">
            <Link to="/login" className="ms-btn ms-btn-secondary" style={{ flex: 1 }}>
              Log in
            </Link>
            <Link to="/signup" className="ms-btn ms-btn-primary" style={{ flex: 1 }}>
              Sign up
            </Link>
          </Box>
        </GuestFooter>
      )}
    </SidebarContainer>
  );
};

export default Sidebar;
