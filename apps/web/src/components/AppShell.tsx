// SPDX-License-Identifier: AGPL-3.0-or-later

import Box from "./Box";

import {
  BellIcon,
  BookIcon,
  BookmarkIcon,
  CodeIcon,
  GearIcon,
  HomeIcon,
  MoonIcon,
  PackageIcon,
  PersonIcon,
  PlayIcon,
  PlusIcon,
  RepoIcon,
  RssIcon,
  SearchIcon,
  ShieldLockIcon,
  SunIcon,
  ThreeBarsIcon,
} from "@primer/octicons-react";
import { Button, Dialog, Text } from "@primer/react";
import React from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import styled from "styled-components";
import { getClusterStatus, resetDevDb, topUpCredits, type ClusterStatus } from "../api";
import { useAuth } from "../AuthContext";
import { useTheme } from "../theme";
import DevModeBar from "./DevModeBar";
import ErrorBoundary from "./ErrorBoundary";
import RightPanel from "./RightPanel";
import Sidebar from "./Sidebar";

import { useFeatureFlag } from "../FeatureFlagContext";
import { useInstanceBranding } from "../InstanceBrandingContext";
import { ComposeContext, type ComposeInitialState } from "./ComposeContext";
import { OfflineBanner } from "./OfflineBanner";

const ComposeModal = React.lazy(() => import("./ComposeModal"));
const DevFlagsModal = React.lazy(() => import("./DevFlagsModal").then((m) => ({ default: m.DevFlagsModal })));

const ShellContainer = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  min-height: 100vh;
  background-color: transparent;
  color: var(--color-text-primary);
  padding-top: var(--dev-header-height, 0px);
  box-sizing: border-box;
`;

const ContentWrapper = styled.div<{ $isFullScreenLayout?: boolean | undefined }>`
  display: flex;
  width: 100%;
  max-width: ${(props) => (props.$isFullScreenLayout ? "100%" : "1380px")};
  justify-content: center;
`;

/* Fixed basis (not flex: 1) so the sidebar sits at the same x-position on every
   route, regardless of how wide the main column is. Sidebar itself is 275px
   (80px rail at <=1280px), right-aligned in this column. */
const SidebarWrapper = styled.div`
  flex: 0 0 320px;
  display: flex;
  justify-content: flex-end;

  @media (max-width: 1280px) {
    flex-basis: auto;
  }

  @media (max-width: 500px) {
    display: none;
  }
`;

const RightPanelWrapper = styled.div`
  flex: 1;
  display: flex;
  justify-content: flex-start;
  max-width: 350px;

  @media (max-width: 1000px) {
    display: none;
  }
`;

const MainColumn = styled.main<{
  $isWideLayout?: boolean | undefined;
  $isFullScreenLayout?: boolean | undefined;
  $isInspectorLayout?: boolean | undefined;
}>`
  flex: ${(props) =>
    props.$isWideLayout || props.$isFullScreenLayout || props.$isInspectorLayout ? "1" : "0 1 740px"};
  width: 100%;
  max-width: ${(props) =>
    props.$isFullScreenLayout
      ? "100%"
      : props.$isInspectorLayout
        ? "1140px"
        : props.$isWideLayout
          ? "1150px"
          : "740px"};
  min-width: 0;
  border-left: 1px solid var(--color-border);
  border-right: 1px solid var(--color-border);
  min-height: calc(100vh - var(--dev-header-height, 0px));
  padding-bottom: ${(props) => (props.$isFullScreenLayout ? "0px" : "80px")};
  display: flex;
  flex-direction: column;
  box-sizing: border-box;

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
  background-color: var(--surface-hud);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border-top: 1px solid var(--color-border);
  display: none;
  justify-content: space-around;
  align-items: center;
  z-index: 999;
  padding: 0 8px;
  padding-bottom: env(safe-area-inset-bottom, 0px);
  box-shadow: 0 -2px 10px rgba(0, 0, 0, 0.5);

  @media (max-width: 500px) {
    display: flex;
  }
`;

const BottomBarButton = styled.button<{ $active?: boolean | undefined }>`
  background: none;
  border: none;
  color: ${(props) => (props.$active ? "var(--ms-brand)" : "var(--color-text-muted)")};
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  transition: background-color 0.2s;

  &:hover {
    background-color: var(--ms-surface-hover);
  }
`;

const MoreSheetBackdrop = styled.div`
  position: fixed;
  inset: 0;
  z-index: 1000;
  background: rgba(2, 6, 23, 0.55);
  display: flex;
  align-items: flex-end;
`;

const MoreSheet = styled.div`
  width: 100%;
  background: var(--ms-bg-elv);
  border-top: 1px solid var(--ms-border);
  border-radius: 16px 16px 0 0;
  padding: 8px 8px calc(12px + env(safe-area-inset-bottom, 0px));
  box-shadow: var(--ms-shadow-pop);

  a:not(.ms-btn),
  button.more-row {
    display: flex;
    align-items: center;
    gap: 14px;
    width: 100%;
    height: 48px;
    padding: 0 14px;
    border: none;
    border-radius: 10px;
    background: none;
    color: var(--ms-text-1);
    font-family: inherit;
    font-size: 15px;
    font-weight: 550;
    text-decoration: none;
    cursor: pointer;
  }

  a:not(.ms-btn):hover,
  button.more-row:hover {
    background: var(--ms-surface-hover);
  }

  hr {
    border: none;
    border-top: 1px solid var(--ms-divider);
    margin: 6px 8px;
  }

  .more-auth {
    display: flex;
    gap: 8px;
    padding: 6px 6px 0;
  }

  .more-auth a {
    flex: 1;
    justify-content: center;
    height: var(--ms-control-lg);
    border-radius: var(--ms-radius-pill);
  }
`;

const CenterPostButton = styled.button`
  width: 50px;
  height: 50px;
  border-radius: 50%;
  background: var(--ms-brand);
  color: var(--ms-brand-contrast);
  border: none;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  box-shadow: var(--ms-brand-shadow);
  margin-top: -20px;
  transition:
    transform 0.2s,
    background-color 0.2s;

  &:hover {
    background: var(--ms-brand-hover);
  }

  &:active {
    transform: scale(0.95);
  }
`;

const Banner = styled.div`
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  background-color: var(--surface-overlay);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border-top: 1px solid var(--color-border-glass);
  color: var(--color-text-primary);
  padding: 12px 24px;
  display: flex;
  justify-content: center;
  z-index: 100;
  box-shadow: 0 -4px 20px rgba(0, 0, 0, 0.25);

  @media (min-width: 900px) {
    display: none;
  }

  /* Sit above the mobile bottom bar (60px) instead of underneath it. */
  @media (max-width: 500px) {
    bottom: 60px;
    padding: 10px 16px;
  }
`;

const BannerContent = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  max-width: 1280px;
  width: 100%;
  padding: 0 40px;

  @media (max-width: 500px) {
    padding: 0;
  }
`;

const BannerTitle = styled.span`
  font-size: 20px;
  font-weight: 750;
  letter-spacing: -0.01em;

  @media (max-width: 500px) {
    font-size: 15px;
  }
`;

const BannerSubtitle = styled.span`
  font-size: 14px;
  color: var(--color-text-muted);

  @media (max-width: 500px) {
    display: none;
  }
`;

const BannerActions = styled.div`
  display: flex;
  gap: 8px;
  flex-shrink: 0;

  & > button {
    white-space: nowrap;
  }
`;

const AppShell: React.FC = () => {
  const [isComposeOpen, setIsComposeOpen] = React.useState(false);
  const [isResetDbDialogOpen, setIsResetDbDialogOpen] = React.useState(false);
  const [isResettingDb, setIsResettingDb] = React.useState(false);
  const [resetError, setResetError] = React.useState<string | null>(null);
  const [isDevHeaderVisible, setIsDevHeaderVisible] = React.useState(
    () => localStorage.getItem("modelscript:dev_header") !== "false",
  );
  const [isDevFlagsModalOpen, setIsDevFlagsModalOpen] = React.useState(false);
  const {
    user,
    isAdmin,
    isLoading: loading,
    logout,
    unreadCount,
    adminPendingCount,
    creditBalance,
    refreshWallet,
  } = useAuth();
  const [clusterStatus, setClusterStatus] = React.useState<ClusterStatus | null>(null);
  const [isTopUpModalOpen, setIsTopUpModalOpen] = React.useState(false);
  const [isTopUpLoading, setIsTopUpLoading] = React.useState(false);
  const [topUpSuccess, setTopUpSuccess] = React.useState<string | null>(null);
  const [topUpError, setTopUpError] = React.useState<string | null>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const { theme, toggleTheme } = useTheme();
  const [isMoreOpen, setIsMoreOpen] = React.useState(false);
  const hasCaeJobs = useFeatureFlag("cae_cloud_solver");
  const hasIde = useFeatureFlag("heavy_vscode_ide");
  const branding = useInstanceBranding();
  const brandName = branding.instanceName || "Ansatz";

  const handleToggleDevHeader = React.useCallback((next?: boolean) => {
    setIsDevHeaderVisible((prev) => {
      const resolved = typeof next === "boolean" ? next : !prev;
      try {
        localStorage.setItem("modelscript:dev_header", String(resolved));
      } catch {
        // Ignore storage errors
      }
      return resolved;
    });
  }, []);

  React.useEffect(() => {
    setIsMoreOpen(false);
  }, [location.pathname]);

  const isDev = import.meta.env.DEV;

  // Standalone full-bleed layout for /playground (renders its own navbar & viewport, but shares ComposeContext & ComposeModal)
  const isStandaloneRoute = location.pathname.startsWith("/playground");

  // Make wide layout for /settings/* and /admin/* (no right panel)
  const isWideLayout = location.pathname.startsWith("/settings") || location.pathname.startsWith("/admin");

  const [isNotebookInspector, setIsNotebookInspector] = React.useState(false);

  React.useEffect(() => {
    if (!location.pathname.includes("/status/")) {
      setIsNotebookInspector(false);
    }
  }, [location.pathname]);

  React.useEffect(() => {
    const handleNotebookInspector = (e: Event) => {
      const customEvent = e as CustomEvent<{ active?: boolean }>;
      setIsNotebookInspector(Boolean(customEvent.detail?.active));
    };
    window.addEventListener("modelscript:notebook-inspector", handleNotebookInspector);
    return () => {
      window.removeEventListener("modelscript:notebook-inspector", handleNotebookInspector);
    };
  }, []);

  // Make workbench layout only for multi-section Engineering Notebooks on /status/:id
  const isInspectorLayout = location.pathname.includes("/status/") && isNotebookInspector;

  // Make full screen layout for /packages/* and /repos/* detail pages
  const isFullScreenLayout =
    (location.pathname.startsWith("/packages/") && location.pathname !== "/packages/") ||
    (location.pathname.startsWith("/repos") && location.pathname !== "/repos" && location.pathname !== "/repos/");

  const showsRightPanel = !isStandaloneRoute && !isWideLayout && !isFullScreenLayout && !isInspectorLayout;

  React.useEffect(() => {
    const devBarActive = isDev && isDevHeaderVisible;
    if (!user || (!hasCaeJobs && !devBarActive) || (!showsRightPanel && !devBarActive)) return;
    let mounted = true;
    const fetchCluster = () => {
      if (document.visibilityState !== "visible") return;
      getClusterStatus()
        .then((data) => {
          if (mounted) setClusterStatus(data);
        })
        .catch(() => {});
    };
    fetchCluster();
    const interval = setInterval(fetchCluster, 15000);
    const handleVisibility = () => {
      if (document.visibilityState === "visible") fetchCluster();
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      mounted = false;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [user, showsRightPanel, hasCaeJobs, isDev, isDevHeaderVisible]);

  React.useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (isDev && (e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === "d" || e.key === "D")) {
        e.preventDefault();
        handleToggleDevHeader();
        return;
      }

      if (location.pathname.startsWith("/playground") || location.pathname.startsWith("/ide")) {
        return;
      }
      const activeEl = document.activeElement;
      const isInput =
        activeEl?.tagName === "INPUT" ||
        activeEl?.tagName === "TEXTAREA" ||
        (activeEl as HTMLElement)?.isContentEditable;

      if (isInput) return;

      if ((e.key === "c" || e.key === "C") && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        if (!user) {
          navigate("/login");
          return;
        }
        setIsComposeOpen(true);
        return;
      }
    };
    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => {
      window.removeEventListener("keydown", handleGlobalKeyDown);
    };
  }, [location.pathname, user, navigate, isDev, handleToggleDevHeader]);

  const [composeInitialState, setComposeInitialState] = React.useState<ComposeInitialState | undefined>(undefined);

  const handleOpenComposeContext = React.useCallback((initial?: string | ComposeInitialState) => {
    if (typeof initial === "string") {
      setComposeInitialState({ content: initial });
    } else if (initial) {
      setComposeInitialState(initial);
    } else {
      setComposeInitialState(undefined);
    }
    setIsComposeOpen(true);
  }, []);

  React.useEffect(() => {
    const handleOpenCompose = (e: Event) => {
      const detail = (e as CustomEvent)?.detail;
      if (detail) {
        setComposeInitialState(typeof detail === "string" ? { content: detail } : detail);
      }
      setIsComposeOpen(true);
    };
    const handleOpenTopUp = () => {
      setIsTopUpModalOpen(true);
    };
    const handleToggleDev = () => {
      handleToggleDevHeader();
    };
    const handleOpenDevFlags = () => {
      setIsDevFlagsModalOpen(true);
    };
    const handleOpenResetDb = () => {
      setResetError(null);
      setIsResetDbDialogOpen(true);
    };
    window.addEventListener("modelscript:open-compose", handleOpenCompose);
    window.addEventListener("modelscript:open-topup", handleOpenTopUp);
    window.addEventListener("modelscript:toggle-dev-header", handleToggleDev);
    window.addEventListener("modelscript:open-dev-flags", handleOpenDevFlags);
    window.addEventListener("modelscript:open-reset-db", handleOpenResetDb);
    return () => {
      window.removeEventListener("modelscript:open-compose", handleOpenCompose);
      window.removeEventListener("modelscript:open-topup", handleOpenTopUp);
      window.removeEventListener("modelscript:toggle-dev-header", handleToggleDev);
      window.removeEventListener("modelscript:open-dev-flags", handleOpenDevFlags);
      window.removeEventListener("modelscript:open-reset-db", handleOpenResetDb);
    };
  }, [handleToggleDevHeader]);

  return (
    <ComposeContext.Provider value={{ openCompose: handleOpenComposeContext }}>
      <OfflineBanner />
      <div
        style={
          {
            "--dev-header-height": !isStandaloneRoute && isDev && isDevHeaderVisible ? "40px" : "0px",
          } as React.CSSProperties
        }
      >
        {!isStandaloneRoute && isDev && (
          <DevModeBar
            isExpanded={isDevHeaderVisible}
            onToggleExpanded={handleToggleDevHeader}
            onOpenFlagsModal={() => setIsDevFlagsModalOpen(true)}
            onOpenResetDbDialog={() => {
              setResetError(null);
              setIsResetDbDialogOpen(true);
            }}
            onOpenTopUpModal={() => setIsTopUpModalOpen(true)}
            clusterStatus={clusterStatus}
            onClusterStatusChange={setClusterStatus}
          />
        )}
        {isStandaloneRoute ? (
          <ErrorBoundary>
            <Outlet context={{ openCompose: handleOpenComposeContext }} />
          </ErrorBoundary>
        ) : (
          <>
            <ShellContainer>
              <ContentWrapper $isFullScreenLayout={isFullScreenLayout}>
                <SidebarWrapper>
                  <Sidebar onPostClick={() => setIsComposeOpen(true)} />
                </SidebarWrapper>
                <MainColumn
                  $isWideLayout={isWideLayout}
                  $isFullScreenLayout={isFullScreenLayout}
                  $isInspectorLayout={isInspectorLayout}
                >
                  <ErrorBoundary>
                    <Outlet context={{ openCompose: handleOpenComposeContext }} />
                  </ErrorBoundary>
                </MainColumn>
                {!isWideLayout && !isFullScreenLayout && !isInspectorLayout && (
                  <RightPanelWrapper>
                    <RightPanel
                      clusterInfo={clusterStatus}
                      onOpenCommandPalette={() => {
                        window.dispatchEvent(new CustomEvent("modelscript:open-command-palette"));
                      }}
                    />
                  </RightPanelWrapper>
                )}
              </ContentWrapper>
            </ShellContainer>

            {!loading && !user && (
              <Banner>
                <BannerContent>
                  <Box display="flex" flexDirection="column" style={{ minWidth: 0 }}>
                    <BannerTitle>Join the {brandName} community</BannerTitle>
                    <BannerSubtitle>Share models, simulations, and results with engineers worldwide.</BannerSubtitle>
                  </Box>
                  <BannerActions>
                    <button className="ms-btn ms-btn-secondary ms-btn-sm" onClick={() => navigate("/login")}>
                      Log in
                    </button>
                    <button className="ms-btn ms-btn-primary ms-btn-sm" onClick={() => navigate("/signup")}>
                      Sign up
                    </button>
                  </BannerActions>
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
                      backgroundColor: "var(--color-accent-cyan)",
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
                      boxShadow: "0 0 0 2px var(--color-bg-primary)",
                    }}
                  >
                    {unreadCount > 9 ? "9+" : unreadCount}
                  </div>
                )}
              </BottomBarButton>
              <BottomBarButton
                $active={Boolean(user && location.pathname === `/${user.username}`)}
                onClick={() => navigate(user ? `/${user.username}` : "/login")}
              >
                <PersonIcon size={24} />
              </BottomBarButton>
              <BottomBarButton
                $active={isMoreOpen}
                onClick={() => setIsMoreOpen((v) => !v)}
                aria-label="More"
                aria-expanded={isMoreOpen}
              >
                <ThreeBarsIcon size={24} />
              </BottomBarButton>
            </BottomBarContainer>

            {isMoreOpen && (
              <MoreSheetBackdrop onClick={() => setIsMoreOpen(false)}>
                <MoreSheet role="dialog" aria-label="More" onClick={(e) => e.stopPropagation()}>
                  {user && (
                    <>
                      <Link to="/bookmarks">
                        <BookmarkIcon size={20} /> Bookmarks
                      </Link>
                      <Link to="/feeds">
                        <RssIcon size={20} /> Feeds
                      </Link>
                      <hr />
                    </>
                  )}
                  <Link to="/playground">
                    <PlayIcon size={20} /> Playground
                  </Link>
                  <Link to="/packages">
                    <PackageIcon size={20} /> Packages
                  </Link>
                  <Link to="/repos">
                    <RepoIcon size={20} /> Repositories
                  </Link>
                  <Link to="/guide/introduction" reloadDocument>
                    <BookIcon size={20} /> Docs
                  </Link>
                  {hasIde && (
                    <Link to="/ide">
                      <CodeIcon size={20} /> IDE
                    </Link>
                  )}
                  {hasCaeJobs && (
                    <Link to="/jobs">
                      <GearIcon size={20} /> Jobs
                    </Link>
                  )}
                  <hr />
                  {user && isAdmin && (
                    <Link to="/admin">
                      <ShieldLockIcon size={20} />
                      <span style={{ flex: 1 }}>Admin</span>
                      {adminPendingCount > 0 && (
                        <span
                          style={{
                            fontSize: "11px",
                            fontWeight: 700,
                            padding: "2px 8px",
                            borderRadius: "12px",
                            background: "rgba(210, 153, 34, 0.2)",
                            color: "#d29922",
                          }}
                        >
                          {adminPendingCount > 99 ? "99+" : adminPendingCount}
                        </span>
                      )}
                    </Link>
                  )}
                  {user && (
                    <Link to="/settings">
                      <GearIcon size={20} /> Settings
                    </Link>
                  )}
                  <button type="button" className="more-row" onClick={toggleTheme}>
                    {theme === "dark" ? <SunIcon size={20} /> : <MoonIcon size={20} />}
                    {theme === "dark" ? "Light theme" : "Dark theme"}
                  </button>
                  {!user && (
                    <div className="more-auth">
                      <Link to="/login" className="ms-btn ms-btn-secondary ms-btn-lg">
                        Log in
                      </Link>
                      <Link to="/signup" className="ms-btn ms-btn-primary ms-btn-lg">
                        Sign up
                      </Link>
                    </div>
                  )}
                </MoreSheet>
              </MoreSheetBackdrop>
            )}
          </>
        )}

        {isComposeOpen && (
          <React.Suspense fallback={null}>
            <ComposeModal
              initialState={composeInitialState}
              onClose={() => {
                setIsComposeOpen(false);
                setComposeInitialState(undefined);
              }}
              onPostCreated={(post) => {
                window.dispatchEvent(new CustomEvent("modelscript:post-created", { detail: post }));
              }}
            />
          </React.Suspense>
        )}

        {isResetDbDialogOpen && (
          <Dialog
            title="Reset Development Database"
            onClose={() => {
              if (!isResettingDb) setIsResetDbDialogOpen(false);
            }}
            width="large"
          >
            <Box display="flex" flexDirection="column" gap={3}>
              <Text as="p" color="var(--color-fg-default)" style={{ margin: 0, lineHeight: 1.5 }}>
                Are you sure you want to reload the database with seed and development data? This will clear all
                existing test posts, comments, and sessions.
              </Text>
              {resetError && (
                <Text as="p" color="var(--color-danger-fg)" style={{ margin: 0, fontSize: "13px" }}>
                  {resetError}
                </Text>
              )}
              <Box display="flex" justifyContent="flex-end" gap={2} style={{ paddingTop: "4px" }}>
                <Button onClick={() => setIsResetDbDialogOpen(false)} disabled={isResettingDb}>
                  Cancel
                </Button>
                <Button
                  variant="danger"
                  disabled={isResettingDb}
                  onClick={async () => {
                    setIsResettingDb(true);
                    setResetError(null);
                    try {
                      await resetDevDb();
                      logout();
                      setTimeout(() => {
                        window.location.reload();
                      }, 100);
                    } catch (e: unknown) {
                      const errResponse = (e as { response?: { data?: { error?: string } } })?.response?.data?.error;
                      setResetError(errResponse || "Failed to reset database");
                      setIsResettingDb(false);
                    }
                  }}
                >
                  {isResettingDb ? "Resetting..." : "Reset Database"}
                </Button>
              </Box>
            </Box>
          </Dialog>
        )}

        {isTopUpModalOpen && (
          <Dialog
            title="Compute Wallet & Cloud Credits"
            onClose={() => {
              setIsTopUpModalOpen(false);
              setTopUpSuccess(null);
              setTopUpError(null);
            }}
            width="large"
          >
            <Box display="flex" flexDirection="column" gap={3}>
              <Box
                p={3}
                borderRadius="8px"
                bg="var(--color-canvas-subtle)"
                border="1px solid var(--color-border-default)"
              >
                <Text style={{ fontSize: "12px", color: "var(--color-text-muted)", display: "block" }}>
                  Current Credit Balance
                </Text>
                <div
                  style={{
                    fontSize: "32px",
                    fontWeight: "800",
                    color: "var(--color-accent-purple)",
                    marginTop: "4px",
                  }}
                >
                  {creditBalance.toFixed(2)} cr
                </div>
                <span style={{ fontSize: "11px", color: "var(--color-status-verified)" }}>
                  ● Active for Cloud Simulation, SU2 CFD, and CalculiX FEA
                </span>
              </Box>

              {topUpError && (
                <Box
                  p={2}
                  bg="rgba(239, 68, 68, 0.15)"
                  border="1px solid rgba(239, 68, 68, 0.3)"
                  borderRadius="6px"
                  color="var(--color-danger-fg, #ef4444)"
                  fontSize="13px"
                >
                  ✕ {topUpError}
                </Box>
              )}

              {topUpSuccess && (
                <Box
                  p={2}
                  bg="rgba(16, 185, 129, 0.15)"
                  border="1px solid rgba(16, 185, 129, 0.3)"
                  borderRadius="6px"
                  color="var(--color-status-verified)"
                  fontSize="13px"
                >
                  ✓ {topUpSuccess}
                </Box>
              )}

              <Text style={{ fontSize: "13px", fontWeight: 600 }}>Quick Credit Reload (Instant Sandbox / Dev):</Text>
              <Box display="flex" gap={2}>
                {[50, 200, 500].map((amt) => (
                  <button
                    key={amt}
                    disabled={isTopUpLoading}
                    onClick={async () => {
                      setIsTopUpLoading(true);
                      setTopUpSuccess(null);
                      setTopUpError(null);
                      try {
                        const res = await topUpCredits(amt);
                        await refreshWallet();
                        const resObj = res as { newBalance?: number; balance?: number } | null | undefined;
                        const newBal =
                          typeof resObj?.newBalance === "number"
                            ? resObj.newBalance
                            : (resObj?.balance ?? creditBalance + amt);
                        setTopUpSuccess(`Added +${amt} credits! New balance: ${newBal.toFixed(2)} cr`);
                      } catch (err: unknown) {
                        const errorMsg =
                          (err as { response?: { data?: { error?: string } }; message?: string })?.response?.data
                            ?.error ||
                          (err as Error)?.message ||
                          String(err);
                        setTopUpError(errorMsg);
                      } finally {
                        setIsTopUpLoading(false);
                      }
                    }}
                    style={{
                      flex: 1,
                      padding: "10px",
                      borderRadius: "8px",
                      border: "1px solid var(--color-border-default)",
                      background: "var(--ms-surface-hover)",
                      color: "var(--color-text-primary)",
                      fontWeight: 600,
                      cursor: isTopUpLoading ? "not-allowed" : "pointer",
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      gap: "4px",
                      transition: "all 0.2s",
                    }}
                  >
                    <span style={{ fontSize: "15px", color: "var(--color-accent-purple)" }}>+{amt} cr</span>
                    <span style={{ fontSize: "11px", color: "var(--color-text-muted)" }}>
                      ${(amt * 0.1).toFixed(2)}
                    </span>
                  </button>
                ))}
              </Box>

              <Box
                display="flex"
                justifyContent="space-between"
                alignItems="center"
                style={{ paddingTop: "8px" }}
                borderTop="1px solid var(--color-border-subtle)"
              >
                <button
                  onClick={() => {
                    setIsTopUpModalOpen(false);
                    navigate("/settings");
                  }}
                  style={{
                    background: "none",
                    border: "none",
                    color: "var(--color-accent-cyan)",
                    fontSize: "12px",
                    cursor: "pointer",
                    padding: 0,
                  }}
                >
                  View Full Usage &amp; Ledger →
                </button>
                <Button onClick={() => setIsTopUpModalOpen(false)}>Done</Button>
              </Box>
            </Box>
          </Dialog>
        )}

        {isDevFlagsModalOpen && (
          <React.Suspense fallback={null}>
            <DevFlagsModal isOpen={isDevFlagsModalOpen} onClose={() => setIsDevFlagsModalOpen(false)} />
          </React.Suspense>
        )}
      </div>
    </ComposeContext.Provider>
  );
};

export default AppShell;
