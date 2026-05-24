import Box from "./Box";

import { BellIcon, HomeIcon, PersonIcon, PlusIcon, SearchIcon } from "@primer/octicons-react";
import React from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import styled from "styled-components";
import { useAuth } from "../AuthContext";
import ComposeModal from "./ComposeModal";
import RightPanel from "./RightPanel";
import Sidebar from "./Sidebar";

// eslint-disable-next-line react-refresh/only-export-components
export const ComposeContext = React.createContext({ openCompose: () => {} });

const ShellContainer = styled.div`
  display: flex;
  justify-content: center;
  min-height: 100vh;
  background-color: var(--color-canvas-default);
  color: var(--color-text-primary);
  padding-top: var(--dev-header-height, 0px);
`;

const ContentWrapper = styled.div`
  display: flex;
  width: 100%;
  max-width: 1290px;
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

const MainColumn = styled.main<{ $isSettings?: boolean }>`
  flex: ${(props) => (props.$isSettings ? "1" : "0 1 600px")};
  width: 100%;
  max-width: ${(props) => (props.$isSettings ? "950px" : "600px")};
  min-width: 0;
  border-left: 1px solid var(--color-border-default);
  border-right: 1px solid var(--color-border-default);
  min-height: calc(100vh - var(--dev-header-height, 0px));
  padding-bottom: 80px;

  @media (max-width: 500px) {
    padding-bottom: 120px; /* Leave space for bottom bar + banner */
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
  border-top: 1px solid var(--color-border-subtle);
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
  const { user, loading, login, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const isDev = import.meta.env.DEV;
  const isSettings = location.pathname.startsWith("/settings");

  return (
    <ComposeContext.Provider value={{ openCompose: () => setIsComposeOpen(true) }}>
      <div style={{ "--dev-header-height": isDev ? "40px" : "0px" } as React.CSSProperties}>
        {isDev && (
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
              <div>
                {!user ? (
                  <button
                    onClick={() => login("dev@modelscript.org", "password")}
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
                    Login as Dev
                  </button>
                ) : (
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
              </div>
            </div>
          </div>
        )}
        <ShellContainer>
          <ContentWrapper>
            <SidebarWrapper>
              <Sidebar onPostClick={() => setIsComposeOpen(true)} />
            </SidebarWrapper>
            <MainColumn $isSettings={isSettings}>
              <Outlet context={{ openCompose: () => setIsComposeOpen(true) }} />
            </MainColumn>
            {!isSettings && (
              <RightPanelWrapper>
                <RightPanel />
              </RightPanelWrapper>
            )}
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
          <BottomBarButton $active={location.pathname === "/home"} onClick={() => navigate("/home")}>
            <HomeIcon size={24} />
          </BottomBarButton>
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
          >
            <BellIcon size={24} />
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
