/* eslint-disable */
import Box from "./Box";

import { BellIcon, HomeIcon, MoonIcon, PersonIcon, PlusIcon, SearchIcon, SunIcon, XIcon } from "@primer/octicons-react";
import React from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import styled from "styled-components";
import { useAuth } from "../AuthContext";
import { useTheme } from "../theme";
import ComposeModal from "./ComposeModal";
import RightPanel from "./RightPanel";
import Sidebar from "./Sidebar";

import { ComposeContext } from "./ComposeContext";

const ShellContainer = styled.div`
  display: flex;
  justify-content: center;
  min-height: 100vh;
  background-color: var(--color-canvas-default);
  color: var(--color-text-primary);
  padding-top: var(--dev-header-height, 0px);
  box-sizing: border-box;
`;

const ContentWrapper = styled.div<{ $isFullScreenLayout?: boolean }>`
  display: flex;
  width: 100%;
  max-width: ${(props) => (props.$isFullScreenLayout ? "100%" : "1290px")};
`;

const SidebarWrapper = styled.div`
  flex: 1;
  display: flex;
  justify-content: flex-end;
  max-width: 340px;
`;

const RightPanelWrapper = styled.div`
  flex: 1;
  display: flex;
  justify-content: flex-start;
`;

const MainColumn = styled.main<{ $isWideLayout?: boolean; $isFullScreenLayout?: boolean }>`
  flex: ${(props) => (props.$isWideLayout || props.$isFullScreenLayout ? "1" : "0 1 600px")};
  width: 100%;
  max-width: ${(props) => (props.$isFullScreenLayout ? "100%" : props.$isWideLayout ? "1050px" : "600px")};
  min-width: 0;
  border-left: 1px solid var(--color-border);
  border-right: 1px solid var(--color-border);
  min-height: calc(100vh - var(--dev-header-height, 0px));
  padding-bottom: ${(props) => (props.$isFullScreenLayout ? "0px" : "80px")};
  display: flex;
  flex-direction: column;

  @media (max-width: 500px) {
    padding-bottom: ${(props) =>
      props.$isFullScreenLayout ? "0px" : "120px"}; /* Leave space for bottom bar + banner */
    border-left: none;
    border-right: none;
  }
`;

const BottomBarContainer = styled.div`
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  height: 60px;
  background-color: var(--color-canvas-default);
  border-top: 1px solid var(--color-border);
  display: none;
  justify-content: space-around;
  align-items: center;
  z-index: 999;
  padding: 0 8px;
  box-shadow: 0 -2px 10px rgba(0, 0, 0, 0.05);

  @media (max-width: 500px) {
    display: flex;
  }
`;

const BottomBarButton = styled.button<{ $active?: boolean }>`
  background: none;
  border: none;
  color: ${(props) => (props.$active ? "var(--color-accent-emphasis)" : "var(--color-fg-default)")};
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  transition: background-color 0.2s;

  &:hover {
    background-color: var(--color-canvas-subtle);
  }
`;

const CenterPostButton = styled.button`
  width: 50px;
  height: 50px;
  border-radius: 50%;
  background-color: #1f1f1f;
  color: white;
  border: none;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  box-shadow: 0 4px 10px rgba(0, 0, 0, 0.2);
  margin-top: -20px;
  transition: transform 0.2s;

  &:active {
    transform: scale(0.95);
  }
`;

const Banner = styled.div`
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  background-color: #1f1f1f;
  color: #fff;
  padding: 12px 24px;
  display: flex;
  justify-content: center;
  z-index: 100;
  box-shadow: 0 -2px 10px rgba(0, 0, 0, 0.2);
`;

const BannerContent = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  max-width: 1280px;
  width: 100%;
  padding: 0 40px;
`;

const AppShell: React.FC = () => {
  const [isComposeOpen, setIsComposeOpen] = React.useState(false);
  const [isDevHeaderVisible, setIsDevHeaderVisible] = React.useState(true);
  const { user, loading, login, logout, unreadCount } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { theme, toggleTheme } = useTheme();

  const isDev = import.meta.env.DEV;

  // Make wide layout for /settings/*
  const isWideLayout = location.pathname.startsWith("/settings");

  // Make full screen layout for /packages/* and /repos/*
  const isFullScreenLayout =
    (location.pathname.startsWith("/packages/") && location.pathname !== "/packages/") ||
    (location.pathname.startsWith("/repos") && location.pathname !== "/repos" && location.pathname !== "/repos/");

  return (
    <ComposeContext.Provider value={{ openCompose: () => setIsComposeOpen(true) }}>
      <div style={{ "--dev-header-height": isDev && isDevHeaderVisible ? "40px" : "0px" } as React.CSSProperties}>
        {isDev && isDevHeaderVisible && (
          <div
            style={{
              backgroundColor: "#6f42c1",
              color: "white",
              padding: "0 24px",
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              zIndex: 1000,
              position: "fixed",
              top: 0,
              left: 0,
              right: 0,
              height: "40px",
              boxSizing: "border-box",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                width: "100%",
                maxWidth: "1280px",
                alignItems: "center",
              }}
            >
              <span style={{ fontWeight: "bold", fontSize: "13px", letterSpacing: "1px" }}>DEV MODE</span>
              <div style={{ display: "flex", gap: "16px", alignItems: "center" }}>
                <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                  <button
                    onClick={async () => {
                      if (confirm("Are you sure you want to reload the database with dev data?")) {
                        try {
                          const res = await fetch("/api/v1/dev/reset", { method: "POST" });
                          if (res.ok) {
                            logout();
                            setTimeout(() => {
                              window.location.reload();
                            }, 100);
                          } else {
                            alert("Failed to reset database");
                          }
                        } catch (e) {
                          alert("Failed to connect to dev server");
                        }
                      }
                    }}
                    style={{
                      background: "rgba(255,255,255,0.2)",
                      color: "white",
                      border: "none",
                      borderRadius: "4px",
                      padding: "4px 12px",
                      fontWeight: "bold",
                      cursor: "pointer",
                      fontSize: "12px",
                      marginRight: "8px",
                    }}
                  >
                    Reload DB
                  </button>
                  <span style={{ fontSize: "12px", opacity: 0.8, marginRight: "4px" }}>
                    {!user ? "Login as:" : "Switch user:"}
                  </span>
                  {[
                    { email: "dev@modelscript.org", initial: "D" },
                    { email: "alice@modelscript.org", initial: "A" },
                    { email: "bob@modelscript.org", initial: "B" },
                  ].map((u) => (
                    <button
                      key={u.email}
                      onClick={() => {
                        if (!user || user.email !== u.email) {
                          if (user) logout();
                          setTimeout(() => login(u.email, "password"), user ? 100 : 0);
                        }
                      }}
                      style={{
                        width: "26px",
                        height: "26px",
                        borderRadius: "50%",
                        border: user?.email === u.email ? "2px solid white" : "none",
                        backgroundColor: user?.email === u.email ? "#5a32a3" : "rgba(255,255,255,0.3)",
                        color: "white",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontWeight: "bold",
                        fontSize: "12px",
                        cursor: "pointer",
                        padding: 0,
                      }}
                      title={!user ? `Login as ${u.email}` : `Switch to ${u.email}`}
                    >
                      {u.initial}
                    </button>
                  ))}
                  <button
                    onClick={toggleTheme}
                    style={{
                      background: "rgba(255,255,255,0.2)",
                      color: "white",
                      border: "none",
                      borderRadius: "4px",
                      padding: "4px 8px",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      marginLeft: "8px",
                    }}
                    title="Toggle Theme"
                  >
                    {theme === "dark" ? <SunIcon size={16} /> : <MoonIcon size={16} />}
                  </button>
                </div>
                {user && (
                  <button
                    onClick={() => logout()}
                    style={{
                      background: "white",
                      color: "#6f42c1",
                      border: "none",
                      borderRadius: "4px",
                      padding: "4px 12px",
                      fontWeight: "bold",
                      cursor: "pointer",
                      fontSize: "12px",
                    }}
                  >
                    Logout
                  </button>
                )}
                <button
                  onClick={() => setIsDevHeaderVisible(false)}
                  style={{
                    background: "transparent",
                    color: "white",
                    border: "none",
                    padding: "4px",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    opacity: 0.7,
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.opacity = "1")}
                  onMouseLeave={(e) => (e.currentTarget.style.opacity = "0.7")}
                  title="Hide Dev Mode Header"
                >
                  <XIcon size={16} />
                </button>
              </div>
            </div>
          </div>
        )}
        <ShellContainer>
          <ContentWrapper $isFullScreenLayout={isFullScreenLayout}>
            <SidebarWrapper>
              <Sidebar onPostClick={() => setIsComposeOpen(true)} />
            </SidebarWrapper>
            <MainColumn $isWideLayout={isWideLayout} $isFullScreenLayout={isFullScreenLayout}>
              <Outlet context={{ openCompose: () => setIsComposeOpen(true) }} />
            </MainColumn>
            {!isWideLayout && !isFullScreenLayout && (
              <RightPanelWrapper>
                <RightPanel />
              </RightPanelWrapper>
            )}
            {isFullScreenLayout && <div style={{ flex: 1, maxWidth: "max(0px, calc(340px - 275px))" }} />}
          </ContentWrapper>
        </ShellContainer>

        {!loading && !user && (
          <Banner style={{ bottom: window.innerWidth <= 500 ? "60px" : "0" }}>
            <BannerContent>
              <Box display="flex" flexDirection="column">
                <span style={{ fontSize: "22px", fontWeight: 800 }}>Don't miss what's happening</span>
                <span style={{ fontSize: "15px" }}>People on ModelScript are the first to know.</span>
              </Box>
              <Box display="flex" gap={3}>
                <button
                  onClick={() => navigate("/login")}
                  style={{
                    background: "transparent",
                    border: "1px solid rgba(255,255,255,0.4)",
                    color: "#fff",
                    borderRadius: 9999,
                    padding: "8px 16px",
                    fontWeight: "bold",
                    cursor: "pointer",
                    fontSize: 15,
                    minWidth: 80,
                  }}
                >
                  Log in
                </button>
                <button
                  onClick={() => navigate("/signup")}
                  style={{
                    background: "#fff",
                    border: "none",
                    color: "#1f1f1f",
                    borderRadius: 9999,
                    padding: "8px 16px",
                    fontWeight: "bold",
                    cursor: "pointer",
                    fontSize: 15,
                    minWidth: 80,
                  }}
                >
                  Sign up
                </button>
              </Box>
            </BannerContent>
          </Banner>
        )}

        <BottomBarContainer>
          {user && (
            <BottomBarButton $active={location.pathname === "/home"} onClick={() => navigate("/home")}>
              <HomeIcon size={24} />
            </BottomBarButton>
          )}
          <BottomBarButton $active={location.pathname === "/explore"} onClick={() => navigate("/explore")}>
            <SearchIcon size={24} />
          </BottomBarButton>
          <CenterPostButton
            onClick={() => {
              if (user) {
                setIsComposeOpen(true);
              } else {
                navigate("/login");
              }
            }}
          >
            <PlusIcon size={24} />
          </CenterPostButton>
          <BottomBarButton
            $active={location.pathname === "/notifications"}
            onClick={() => navigate(user ? "/notifications" : "/login")}
            style={{ position: "relative" }}
          >
            <BellIcon size={24} />
            {unreadCount > 0 && (
              <div
                style={{
                  position: "absolute",
                  top: 4,
                  right: 4,
                  backgroundColor: "#1d9bf0",
                  color: "white",
                  borderRadius: "50%",
                  minWidth: "16px",
                  height: "16px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "10px",
                  fontWeight: "bold",
                  padding: "0 4px",
                  boxShadow: "0 0 0 2px var(--color-canvas-default)",
                }}
              >
                {unreadCount > 9 ? "9+" : unreadCount}
              </div>
            )}
          </BottomBarButton>
          <BottomBarButton
            $active={user && location.pathname === `/${user.username}`}
            onClick={() => navigate(user ? `/${user.username}` : "/login")}
          >
            <PersonIcon size={24} />
          </BottomBarButton>
        </BottomBarContainer>

        {isComposeOpen && (
          <ComposeModal onClose={() => setIsComposeOpen(false)} onPostCreated={() => window.location.reload()} />
        )}
      </div>
    </ComposeContext.Provider>
  );
};

export default AppShell;
