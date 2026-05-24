/* eslint-disable @typescript-eslint/no-unused-vars, no-empty */
import {
  BellIcon,
  BookmarkIcon,
  GearIcon,
  HomeIcon,
  PackageIcon,
  PersonIcon,
  PlusIcon,
  RepoIcon,
  SearchIcon,
} from "@primer/octicons-react";
import { Text } from "@primer/react";
import React from "react";
import { Link, useLocation } from "react-router-dom";
import styled from "styled-components";
import { useAuth } from "../AuthContext";
import { API_BASE_URL } from "../config";
import { useTheme } from "../theme";
import Box from "./Box";

const SidebarContainer = styled.header`
  width: 275px;
  display: flex;
  flex-direction: column;
  height: 100vh;
  position: sticky;
  top: 0;
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
    background-color: var(--color-canvas-subtle);
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

interface SidebarProps {
  onPostClick?: () => void;
}

const Sidebar: React.FC<SidebarProps> = ({ onPostClick }) => {
  const { user, token } = useAuth();
  const { theme } = useTheme();
  const location = useLocation();
  const [unreadCount, setUnreadCount] = React.useState(0);

  React.useEffect(() => {
    if (!token) return;
    async function fetchUnread() {
      try {
        const res = await fetch(`${API_BASE_URL}/social/notifications`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const data = await res.json();
          setUnreadCount(data.unreadCount);
        }
      } catch (err) {}
    }
    fetchUnread();

    // Poll every minute
    const interval = setInterval(fetchUnread, 60000);
    return () => clearInterval(interval);
  }, [token, location.pathname]); // Re-fetch when location changes to clear it after viewing page

  const navLinks = [
    { to: "/home", icon: HomeIcon, label: "Home" },
    { to: "/explore", icon: SearchIcon, label: "Explore" },
  ];
  if (user) {
    navLinks.push({ to: "/notifications", icon: BellIcon, label: "Notifications" });
    navLinks.push({ to: "/bookmarks", icon: BookmarkIcon, label: "Bookmarks" });
  }
  navLinks.push({ to: "/packages", icon: PackageIcon, label: "Packages" });
  navLinks.push({ to: "/repos", icon: RepoIcon, label: "Repositories" });

  if (user) {
    navLinks.push({ to: `/${user.username}`, icon: PersonIcon, label: "Profile" });
    navLinks.push({ to: "/settings", icon: GearIcon, label: "Settings" });
  }

  return (
    <SidebarContainer>
      <Box mb={4} px={3}>
        <Link to="/home">
          <img
            src={theme === "dark" ? "/ms-logo-light.png" : "/ms-logo.png"}
            alt="ModelScript"
            style={{ width: 32, height: 32 }}
          />
        </Link>
      </Box>

      <Box display="flex" flexDirection="column" gap={1} flex={1}>
        {navLinks.map((link) => (
          <NavItem key={link.to} to={link.to} $active={location.pathname.startsWith(link.to)}>
            <NavPill>
              <Box position="relative">
                <link.icon size={32} />
                {link.to === "/notifications" && unreadCount > 0 && (
                  <Box
                    position="absolute"
                    top={-4}
                    right={-6}
                    backgroundColor="var(--color-accent-emphasis)"
                    color="white"
                    borderRadius="9999px"
                    fontSize="10px"
                    px={1}
                    fontWeight="bold"
                  >
                    {unreadCount > 9 ? "9+" : unreadCount}
                  </Box>
                )}
              </Box>
              <Text className="nav-label">{link.label}</Text>
            </NavPill>
          </NavItem>
        ))}

        {user && (
          <>
            <Box mt={4} mb={2} px={4} className="sidebar-separator">
              <div style={{ height: "1px", backgroundColor: "var(--color-border-subtle)", width: "100%" }} />
            </Box>
            <Box mt={2} width="100%" px={2} className="post-btn-container">
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
        <Box
          p={3}
          display="flex"
          alignItems="center"
          gap={3}
          className="profile-footer"
          sx={{
            borderRadius: "9999px",
            cursor: "pointer",
            "&:hover": { backgroundColor: "var(--color-canvas-subtle)" },
          }}
        >
          <Box
            sx={{
              width: 40,
              height: 40,
              borderRadius: "50%",
              backgroundColor: "var(--color-accent-emphasis)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "white",
              fontWeight: "bold",
              flexShrink: 0,
            }}
          >
            {user.username.charAt(0).toUpperCase()}
          </Box>
          <Box display="flex" flexDirection="column" className="profile-details">
            <Text style={{ fontWeight: "bold", fontSize: "15px" }}>{user.username}</Text>
            <Text color="var(--color-fg-muted)" style={{ fontSize: "15px" }}>
              @{user.username}
            </Text>
          </Box>
        </Box>
      )}
    </SidebarContainer>
  );
};

export default Sidebar;
