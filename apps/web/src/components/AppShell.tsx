// SPDX-License-Identifier: AGPL-3.0-or-later

import Box from "./Box";

import {
  BookIcon,
  BookmarkIcon,
  CodeIcon,
  GearIcon,
  HomeIcon,
  InboxIcon,
  MoonIcon,
  PackageIcon,
  PersonIcon,
  PlusIcon,
  RepoIcon,
  RssIcon,
  SearchIcon,
  ShieldLockIcon,
  SignOutIcon,
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
import { MorselIcon } from "./icons";
import RightPanel from "./RightPanel";
import { scrollToTop } from "./ScrollToTop";
import Sidebar from "./Sidebar";

import { useFeatureFlag } from "../FeatureFlagContext";
import { useInstanceBranding } from "../InstanceBrandingContext";
import { ComposeContext, type ComposeInitialState } from "./ComposeContext";
import ProductTourOverlay from "./ProductTourOverlay";

const ComposeModal = React.lazy(() => import("./ComposeModal"));
const DevFlagsModal = React.lazy(() => import("./DevFlagsModal").then((m) => ({ default: m.DevFlagsModal })));

const ShellContainer = styled.div<{ $hasGuestBanner?: boolean | undefined }>`
  display: flex;
  flex-direction: column;
  align-items: center;
  min-height: 100vh;
  min-height: 100dvh;
  background-color: transparent;
  color: var(--color-text-primary);
  padding-top: var(--dev-header-height, 0px);
  box-sizing: border-box;
  --guest-banner-height: 0px;

  @media (max-width: 899px) {
    --guest-banner-height: ${(props) => (props.$hasGuestBanner ? "var(--measured-guest-banner-height, 74px)" : "0px")};
  }

  @media (max-width: 767px) {
    --guest-banner-height: 0px;
  }
`;

const ContentWrapper = styled.div<{ $isFullScreenLayout?: boolean | undefined }>`
  display: flex;
  width: 100%;
  max-width: ${(props) => (props.$isFullScreenLayout ? "100%" : "1410px")};
  justify-content: center;
`;

/* Fixed basis (not flex: 1) so the sidebar sits at the same x-position on every
   route, regardless of how wide the main column is. Sidebar itself is 272px
   (76px rail at <=1280px), right-aligned in this column. */
const SidebarWrapper = styled.div`
  flex: 0 0 320px;
  display: flex;
  justify-content: flex-end;

  @media (max-width: 1280px) {
    flex-basis: auto;
  }

  @media (max-width: 767px) {
    display: none;
  }
`;

const RightPanelWrapper = styled.div`
  flex: 0 1 350px;
  width: 100%;
  min-width: 0;
  display: flex;
  justify-content: flex-start;
  align-items: flex-start;
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
    props.$isFullScreenLayout ? "100%" : props.$isInspectorLayout || props.$isWideLayout ? "1066px" : "740px"};
  margin-right: ${(props) =>
    (props.$isWideLayout || props.$isInspectorLayout) && !props.$isFullScreenLayout ? "24px" : "0px"};
  min-width: 0;
  border-left: 1px solid var(--color-border);
  border-right: 1px solid var(--color-border);
  min-height: calc(100vh - var(--dev-header-height, 0px));
  min-height: calc(100dvh - var(--dev-header-height, 0px));
  padding-bottom: ${(props) =>
    props.$isFullScreenLayout ? "var(--guest-banner-height, 0px)" : "calc(80px + var(--guest-banner-height, 0px))"};
  display: flex;
  flex-direction: column;
  box-sizing: border-box;

  @media (max-width: 767px) {
    padding-bottom: ${(props) =>
      props.$isFullScreenLayout
        ? "0px"
        : "calc(120px + env(safe-area-inset-bottom, 0px))"}; /* Leave space for bottom bar + banner */
    border-left: none;
    border-right: none;
    margin-right: 0px;
  }
`;

const BottomBarContainer = styled.div`
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  min-height: 60px;
  height: calc(60px + env(safe-area-inset-bottom, 0px));
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

  @media (max-width: 767px) {
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
  max-height: calc(100dvh - 48px);
  overflow-y: auto;
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

  /* Sit above the mobile bottom bar (60px + safe-area) instead of underneath it. */
  @media (max-width: 767px) {
    bottom: calc(60px + env(safe-area-inset-bottom, 0px));
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

  @media (max-width: 899px) {
    padding: 0 8px;
  }

  @media (max-width: 767px) {
    padding: 0;
  }
`;

const BannerTitle = styled.span`
  font-size: 20px;
  font-weight: 750;
  letter-spacing: -0.01em;

  @media (max-width: 767px) {
    font-size: 15px;
  }
`;

const BannerSubtitle = styled.span`
  font-size: 14px;
  color: var(--color-text-muted);

  @media (max-width: 767px) {
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
  const hasPackages = useFeatureFlag("package_browser");
  const hasRepos = useFeatureFlag(["git_repositories", "repositories"]);
  const hasReferences = useFeatureFlag(["references", "scientific_references"]);
  const hasFeeds = useFeatureFlag(["feeds_page", "rss_feeds"]);
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

  const handleNavWithScroll = React.useCallback(
    (target: string) => {
      if (location.pathname === target) {
        scrollToTop({ smooth: true });
      } else {
        scrollToTop({ smooth: false });
        navigate(target);
      }
    },
    [location.pathname, navigate],
  );

  const handleMoreLinkClick = React.useCallback(
    (target: string) => {
      setIsMoreOpen(false);
      if (location.pathname === target) {
        scrollToTop({ smooth: true });
      } else {
        scrollToTop({ smooth: false });
      }
    },
    [location.pathname],
  );

  const isDev = import.meta.env.DEV;

  // Standalone full-bleed layout for /playground, /sketch, and /morsel (renders its own navbar & viewport, but shares ComposeContext & ComposeModal)
  const isStandaloneRoute =
    location.pathname.startsWith("/playground") ||
    location.pathname.startsWith("/sketch") ||
    location.pathname.startsWith("/morsel");

  // Check if current route is part of the Spaces environment (Spaces explore, Chat, Orgs, or Space detail)
  const isSpaceRoute = React.useMemo(() => {
    const p = location.pathname;
    if (p.startsWith("/spaces") || p.startsWith("/chat") || p.startsWith("/s/") || p.startsWith("/orgs/")) {
      return true;
    }
    const clean = p.replace(/^\/+|\/+$/g, "");
    const segments = clean.split("/");
    if (segments.length >= 2 && segments[0]?.startsWith("@")) {
      const reserved = new Set(["status", "about", "followers", "following"]);
      if (!reserved.has(segments[1]!)) {
        return true;
      }
    }
    return false;
  }, [location.pathname]);

  // Make wide layout for /settings/*, /admin/*, /inbox, /notifications, /bookmarks, /packages/* detail pages, and Spaces environment (no right rail, spans exactly across main + right rail width: 1066px inside 1410px centered container)
  const isWideLayout =
    location.pathname.startsWith("/settings") ||
    location.pathname.startsWith("/admin") ||
    location.pathname.startsWith("/inbox") ||
    location.pathname.startsWith("/notifications") ||
    location.pathname.startsWith("/bookmarks") ||
    (location.pathname.startsWith("/packages") &&
      location.pathname !== "/packages" &&
      location.pathname !== "/packages/") ||
    isSpaceRoute;

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

  // Make workbench layout only for multi-section Articles on /status/:id
  const isInspectorLayout = location.pathname.includes("/status/") && isNotebookInspector;

  // Make full screen layout for /repos/* detail pages
  const isFullScreenLayout =
    location.pathname.startsWith("/repos") && location.pathname !== "/repos" && location.pathname !== "/repos/";

  const showsRightPanel = !isStandaloneRoute && !isWideLayout && !isFullScreenLayout && !isInspectorLayout;

  React.useEffect(() => {
    const devBarActive = isDev && isDevHeaderVisible;
    if (!user || !hasCaeJobs || (!showsRightPanel && !devBarActive)) return;
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

      if (
        location.pathname.startsWith("/playground") ||
        location.pathname.startsWith("/sketch") ||
        location.pathname.startsWith("/morsel") ||
        location.pathname.startsWith("/ide") ||
        location.pathname.startsWith("/studio")
      ) {
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

  const hasGuestBanner = !loading && !user;
  const bannerRef = React.useRef<HTMLDivElement | null>(null);
  const [guestBannerHeight, setGuestBannerHeight] = React.useState<number>(0);

  React.useEffect(() => {
    const el = bannerRef.current;
    if (!el || !hasGuestBanner) {
      setGuestBannerHeight(0);
      return;
    }
    const updateHeight = () => {
      if (!bannerRef.current) return;
      const h = Math.round(bannerRef.current.getBoundingClientRect().height);
      setGuestBannerHeight(h);
    };
    updateHeight();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(updateHeight) : null;
    ro?.observe(el);
    window.addEventListener("resize", updateHeight);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", updateHeight);
    };
  }, [hasGuestBanner]);

  return (
    <ComposeContext.Provider value={{ openCompose: handleOpenComposeContext }}>
      <div
        style={
          {
            "--dev-header-height": !isStandaloneRoute && isDev && isDevHeaderVisible ? "40px" : "0px",
            ...(guestBannerHeight > 0 ? { "--measured-guest-banner-height": `${guestBannerHeight}px` } : {}),
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
            <ShellContainer $hasGuestBanner={hasGuestBanner}>
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
                {showsRightPanel && (
                  <RightPanelWrapper data-tour-id="tour-right-panel">
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

            {hasGuestBanner && (
              <Banner ref={bannerRef} data-testid="guest-bottom-banner">
                <BannerContent>
                  <Box display="flex" flexDirection="column" style={{ minWidth: 0 }}>
                    <BannerTitle>Join the {brandName} community</BannerTitle>
                    <BannerSubtitle>Share models, simulations, and results with engineers worldwide.</BannerSubtitle>
                  </Box>
                  <BannerActions>
                    <button className="ms-btn ms-btn-secondary ms-btn-sm" onClick={() => handleNavWithScroll("/login")}>
                      Log in
                    </button>
                    <button className="ms-btn ms-btn-primary ms-btn-sm" onClick={() => handleNavWithScroll("/signup")}>
                      Sign up
                    </button>
                  </BannerActions>
                </BannerContent>
              </Banner>
            )}

            <BottomBarContainer role="navigation" aria-label="Primary mobile navigation">
              {user && (
                <BottomBarButton
                  $active={location.pathname === "/home"}
                  onClick={() => handleNavWithScroll("/home")}
                  aria-label="Home"
                >
                  <HomeIcon size={24} />
                </BottomBarButton>
              )}
              <BottomBarButton
                data-tour-id="tour-mobile-explore"
                $active={location.pathname === "/explore"}
                onClick={() => handleNavWithScroll("/explore")}
                aria-label="Explore"
              >
                <SearchIcon size={24} />
              </BottomBarButton>
              <CenterPostButton
                aria-label="Create new post"
                onClick={() => {
                  if (user) {
                    setIsComposeOpen(true);
                  } else {
                    handleNavWithScroll("/login");
                  }
                }}
              >
                <PlusIcon size={24} />
              </CenterPostButton>
              <BottomBarButton
                $active={
                  location.pathname === "/inbox" ||
                  location.pathname === "/notifications" ||
                  location.pathname === "/bookmarks"
                }
                onClick={() => handleNavWithScroll(user ? "/inbox" : "/login")}
                style={{ position: "relative" }}
                aria-label={unreadCount > 0 ? `Inbox (${unreadCount} unread)` : "Inbox"}
              >
                <InboxIcon size={24} />
                {unreadCount > 0 && (
                  <div
                    style={{
                      position: "absolute",
                      top: 4,
                      right: 4,
                      backgroundColor: "var(--color-accent-cyan)",
                      color: "white",
                      borderRadius: "999px",
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
                    {unreadCount > 99 ? "99+" : unreadCount}
                  </div>
                )}
              </BottomBarButton>
              <BottomBarButton
                $active={Boolean(
                  user && (location.pathname === `/@${user.username}` || location.pathname === `/${user.username}`),
                )}
                onClick={() => handleNavWithScroll(user ? `/@${user.username}` : "/login")}
                aria-label="Profile"
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
                      <Link
                        to={`/@${user.username}`}
                        onClick={() => handleMoreLinkClick(`/@${user.username}`)}
                        style={{ height: "54px" }}
                      >
                        <div
                          style={{
                            width: 32,
                            height: 32,
                            borderRadius: "50%",
                            backgroundColor: "var(--ms-brand-soft)",
                            backgroundImage: user.avatar_url ? `url(${user.avatar_url})` : "none",
                            backgroundSize: "cover",
                            backgroundPosition: "center",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontSize: 13,
                            fontWeight: 700,
                            color: "var(--ms-brand)",
                            flexShrink: 0,
                          }}
                        >
                          {user.avatar_url ? null : user.username.charAt(0).toUpperCase()}
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", minWidth: 0, lineHeight: 1.25 }}>
                          <span
                            style={{
                              fontWeight: 650,
                              fontSize: "14px",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {user.display_name || user.username}
                          </span>
                          <span
                            style={{
                              fontSize: "12px",
                              color: "var(--color-text-muted)",
                              fontWeight: 400,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            @{user.username}
                          </span>
                        </div>
                      </Link>
                      <hr />
                      <Link to="/bookmarks" onClick={() => handleMoreLinkClick("/bookmarks")}>
                        <BookmarkIcon size={20} /> Bookmarks
                      </Link>
                      {hasFeeds && (
                        <Link to="/feeds" onClick={() => handleMoreLinkClick("/feeds")}>
                          <RssIcon size={20} /> Feeds
                        </Link>
                      )}
                      <hr />
                    </>
                  )}
                  <Link to="/morsel" onClick={() => handleMoreLinkClick("/morsel")}>
                    <MorselIcon size={20} /> Ansatz Morsel
                  </Link>
                  {hasPackages && (
                    <Link to="/packages" onClick={() => handleMoreLinkClick("/packages")}>
                      <PackageIcon size={20} /> Packages
                    </Link>
                  )}
                  {hasRepos && (
                    <Link to="/repos" onClick={() => handleMoreLinkClick("/repos")}>
                      <RepoIcon size={20} /> Repositories
                    </Link>
                  )}
                  {hasReferences && (
                    <Link to="/references" onClick={() => handleMoreLinkClick("/references")}>
                      <BookIcon size={20} /> References
                    </Link>
                  )}
                  <Link
                    to={
                      branding.docsBaseUrl && !branding.docsBaseUrl.trim().startsWith("/")
                        ? `${branding.docsBaseUrl.trim().replace(/\/+$/, "")}/guide/introduction`
                        : "/guide/introduction"
                    }
                    reloadDocument
                  >
                    <BookIcon size={20} /> Docs
                  </Link>
                  {hasIde && (
                    <Link to="/studio" onClick={() => handleMoreLinkClick("/studio")}>
                      <CodeIcon size={20} /> Studio
                    </Link>
                  )}
                  {hasCaeJobs && (
                    <Link to="/jobs" onClick={() => handleMoreLinkClick("/jobs")}>
                      <GearIcon size={20} /> Jobs
                    </Link>
                  )}
                  <hr />
                  {user && isAdmin && (
                    <Link to="/admin" onClick={() => handleMoreLinkClick("/admin")}>
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
                    <Link to="/settings" onClick={() => handleMoreLinkClick("/settings")}>
                      <GearIcon size={20} /> Settings
                    </Link>
                  )}
                  <button type="button" className="more-row" onClick={toggleTheme}>
                    {theme === "dark" ? <SunIcon size={20} /> : <MoonIcon size={20} />}
                    {theme === "dark" ? "Light theme" : "Dark theme"}
                  </button>
                  {user ? (
                    <>
                      <hr />
                      <button
                        type="button"
                        className="more-row"
                        style={{ color: "var(--color-danger-fg, #ef4444)" }}
                        onClick={() => {
                          setIsMoreOpen(false);
                          logout();
                          navigate("/logout", { replace: true });
                        }}
                      >
                        <SignOutIcon size={20} />
                        Log out @{user.username}
                      </button>
                    </>
                  ) : (
                    <div className="more-auth">
                      <Link
                        to="/login"
                        className="ms-btn ms-btn-secondary ms-btn-lg"
                        onClick={() => handleMoreLinkClick("/login")}
                      >
                        Log in
                      </Link>
                      <Link
                        to="/signup"
                        className="ms-btn ms-btn-primary ms-btn-lg"
                        onClick={() => handleMoreLinkClick("/signup")}
                      >
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
                      logout({ redirect: false });
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
                    navigate("/settings/billing");
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

        <ProductTourOverlay />
      </div>
    </ComposeContext.Provider>
  );
};

export default AppShell;
