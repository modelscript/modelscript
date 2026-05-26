/* eslint-disable @typescript-eslint/no-unused-vars */
import {
  BellIcon,
  BookmarkIcon,
  GearIcon,
  HomeIcon,
  KebabHorizontalIcon,
  PackageIcon,
  PersonIcon,
  PlusIcon,
  RepoIcon,
  RssIcon,
  SearchIcon,
} from "@primer/octicons-react";
import { Text } from "@primer/react";
import React from "react";
import { Link, useLocation } from "react-router-dom";
import styled from "styled-components";
import { useAuth } from "../AuthContext";
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
  padding: 12px;
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
  color: var(--color-fg-default);
  font-size: 20px;
  font-weight: ${(props) => (props.$active ? "700" : "400")};
  width: 100%;
  box-sizing: border-box;

  &:hover {
    text-decoration: none;
  }

  &:hover > div {
    background-color: rgba(128, 128, 128, 0.15);
  }

  @media (max-width: 1280px) {
    justify-content: center;
  }
`;

const NavPill = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 20px;
  padding: 12px 16px;
  border-radius: 9999px;
  transition: background-color 0.2s;

  @media (max-width: 1280px) {
    width: 50px;
    height: 50px;
    padding: 0;
    justify-content: center;
    border-radius: 50%;
  }
`;

const SidebarAvatar = styled.div<{ $url?: string }>`
  width: 40px;
  height: 40px;
  min-width: 40px;
  min-height: 40px;
  border-radius: 50%;
  background-color: var(--color-done-emphasis);
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
  bottom: 80px;
  left: 12px;
  width: 250px;
  background-color: var(--color-canvas-default);
  border: 1px solid var(--color-border-subtle);
  border-radius: 16px;
  box-shadow: 0 0 15px rgba(0, 0, 0, 0.2);
  padding: 12px 0;
  z-index: 100;

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
    color: var(--color-fg-default);
    cursor: pointer;

    &:hover {
      background-color: rgba(128, 128, 128, 0.15);
    }
  }
`;

const ProfileFooterContainer = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px;
  border-radius: 9999px;
  cursor: pointer;
  transition: background-color 0.2s;

  &:hover {
    background-color: rgba(128, 128, 128, 0.15);
  }
`;

interface SidebarProps {
  onPostClick?: () => void;
}

const Sidebar: React.FC<SidebarProps> = ({ onPostClick }) => {
  const { user, token, logout, unreadCount, setUnreadCount } = useAuth();
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

  const navLinks = [];
  if (user) navLinks.push({ to: "/home", icon: HomeIcon, label: "Home" });
  navLinks.push({ to: "/explore", icon: SearchIcon, label: "Explore" });
  if (user) {
    navLinks.push({ to: "/notifications", icon: BellIcon, label: "Notifications" });
    navLinks.push({ to: "/bookmarks", icon: BookmarkIcon, label: "Bookmarks" });
    navLinks.push({ to: "/feeds", icon: RssIcon, label: "Feeds" });
  }
  navLinks.push({ to: "/packages", icon: PackageIcon, label: "Packages" });
  navLinks.push({ to: "/repos", icon: RepoIcon, label: "Repositories" });

  if (user) {
    navLinks.push({ to: `/${user.username}`, icon: PersonIcon, label: "Profile" });
    navLinks.push({ to: "/settings", icon: GearIcon, label: "Settings" });
  }

  return (
    <SidebarContainer>
      <Box mb={4} px={4}>
        <Link to={user ? "/home" : "/explore"}>
          <img
            src={theme === "dark" ? "/ms-logo-light.png" : "/ms-logo.png"}
            alt="ModelScript"
            style={{ width: 32, height: 32 }}
          />
        </Link>
      </Box>

      <Box display="flex" flexDirection="column" gap={1} flex={1} style={{ position: "relative", zIndex: 1 }}>
        {navLinks.map((link) => (
          <NavItem key={link.to} to={link.to} $active={location.pathname.startsWith(link.to)}>
            <NavPill>
              <div
                style={{
                  position: "relative",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 32,
                  height: 32,
                }}
              >
                <link.icon size={32} />
                {link.to === "/notifications" && unreadCount > 0 && (
                  <div
                    style={{
                      position: "absolute",
                      top: -4,
                      right: -6,
                      backgroundColor: "#1d9bf0",
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
                      boxShadow: "0 0 0 2px var(--color-canvas-default)",
                    }}
                  >
                    {unreadCount > 9 ? "9+" : unreadCount}
                  </div>
                )}
              </div>
              <Text className="nav-label">{link.label}</Text>
            </NavPill>
          </NavItem>
        ))}

        {user && (
          <>
            <Box mt={4} mb={4} px={4} className="sidebar-separator">
              <div style={{ height: "1px", backgroundColor: "var(--color-border-subtle)", width: "100%" }} />
            </Box>
            <Box mt={4} width="100%" px={2} className="post-btn-container">
              <button
                style={{
                  width: "100%",
                  borderRadius: "9999px",
                  fontSize: "17px",
                  padding: "14px 24px",
                  backgroundColor: "#1f1f1f",
                  color: "white",
                  border: "none",
                  fontWeight: "bold",
                  cursor: "pointer",
                }}
                onClick={onPostClick}
                className="post-btn"
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
        <Box className="profile-footer-container" style={{ position: "relative", zIndex: 9999 }}>
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
            <Box className="profile-details" color="var(--color-fg-default)">
              <KebabHorizontalIcon size={16} />
            </Box>
          </ProfileFooterContainer>
        </Box>
      )}
    </SidebarContainer>
  );
};

export default Sidebar;
