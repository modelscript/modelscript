// SPDX-License-Identifier: AGPL-3.0-or-later

import { BaseStyles, ThemeProvider } from "@primer/react";
import React, { Suspense } from "react";
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation, useNavigate, useParams } from "react-router-dom";
import { getPublicInstanceBanner, recordPageViewBeacon } from "./api/admin";
import { AuthProvider, useAuth } from "./AuthContext";
import { CapabilitiesProvider } from "./CapabilitiesContext";
import AdminRoute from "./components/AdminRoute";
import AppShell from "./components/AppShell";
import { CommandPalette } from "./components/CommandPalette";
import EnterpriseUpgradeModal from "./components/EnterpriseUpgradeModal";
import ErrorBoundary from "./components/ErrorBoundary";
import KeyboardShortcutsModal from "./components/KeyboardShortcutsModal";
import MaintenanceExperienceHost from "./components/MaintenanceExperienceHost";
import { OfflineBanner } from "./components/OfflineBanner";
import { RealtimeNotificationListener } from "./components/RealtimeNotificationListener";
import RequireAuth from "./components/RequireAuth";
import ScrollToTop, { scrollToTop } from "./components/ScrollToTop";
import { ToastProvider } from "./components/ToastContext";
import { FeatureFlagProvider, useFeatureFlag } from "./FeatureFlagContext";
import { InstanceBrandingProvider } from "./InstanceBrandingContext";
import { ModelingPreferencesProvider } from "./ModelingPreferencesContext";
import { ThemeContextProvider, useTheme } from "./theme";

const CHUNK_RELOAD_KEY = "modelscript:chunk-reload-attempted";

if (typeof window !== "undefined") {
  window.addEventListener("vite:preloadError", (event) => {
    try {
      if (!sessionStorage.getItem(CHUNK_RELOAD_KEY)) {
        sessionStorage.setItem(CHUNK_RELOAD_KEY, "1");
        event.preventDefault();
        window.location.reload();
      }
    } catch {
      // Ignore storage errors
    }
  });
}

function lazyWithRetry<T extends React.ComponentType<any>>(
  importer: () => Promise<{ default: T }>,
): React.LazyExoticComponent<T> {
  return React.lazy(async () => {
    try {
      const mod = await importer();
      try {
        if (typeof sessionStorage !== "undefined") {
          sessionStorage.removeItem(CHUNK_RELOAD_KEY);
        }
      } catch {
        // Ignore storage errors
      }
      return mod;
    } catch (err) {
      try {
        if (typeof window !== "undefined" && typeof sessionStorage !== "undefined") {
          if (!sessionStorage.getItem(CHUNK_RELOAD_KEY)) {
            sessionStorage.setItem(CHUNK_RELOAD_KEY, "1");
            window.location.reload();
            return new Promise<{ default: T }>(() => {});
          }
        }
      } catch {
        // Ignore storage errors
      }
      throw err;
    }
  });
}

// Lazy-loaded pages for optimal initial bundle transfer
const AboutAccountPage = lazyWithRetry(() => import("./pages/AboutAccountPage"));
const AdminPage = lazyWithRetry(() => import("./pages/AdminPage"));
const BookmarksPage = lazyWithRetry(() => import("./pages/BookmarksPage"));
const EditProfilePage = lazyWithRetry(() => import("./pages/EditProfilePage"));
const EmbedPlaygroundPage = lazyWithRetry(() => import("./pages/EmbedPlaygroundPage"));
const ExplorePage = lazyWithRetry(() => import("./pages/ExplorePage"));
const FeedsPage = lazyWithRetry(() => import("./pages/FeedsPage"));
const FollowersPage = lazyWithRetry(() => import("./pages/FollowersPage"));
const FollowingPage = lazyWithRetry(() => import("./pages/FollowingPage"));
const HomeFeedPage = lazyWithRetry(() => import("./pages/HomeFeedPage"));
const IdeWorkspacePage = lazyWithRetry(() => import("./pages/IdeWorkspacePage"));
const LibraryListPage = lazyWithRetry(() => import("./pages/LibraryListPage"));
const LibraryVersionPage = lazyWithRetry(() => import("./pages/LibraryVersionPage"));
const LoginPage = lazyWithRetry(() => import("./pages/LoginPage"));
const LogoutPage = lazyWithRetry(() => import("./pages/LogoutPage"));
const NotFoundPage = lazyWithRetry(() => import("./pages/NotFoundPage"));
const NotificationsPage = lazyWithRetry(() => import("./pages/NotificationsPage"));
const OAuthCallbackPage = lazyWithRetry(() => import("./pages/OAuthCallbackPage"));
const PackageDetailPage = lazyWithRetry(() => import("./pages/PackageDetailPage"));
const PlaygroundPage = lazyWithRetry(() => import("./pages/PlaygroundPage"));
const PostActivityPage = lazyWithRetry(() => import("./pages/PostActivityPage"));
const PostDetailPage = lazyWithRetry(() => import("./pages/PostDetailPage"));
const ProfilePage = lazyWithRetry(() => import("./pages/ProfilePage"));
const ReferencesPage = lazyWithRetry(() => import("./pages/ReferencesPage"));
const RenderArtifactPage = lazyWithRetry(() => import("./pages/RenderArtifactPage"));
const RepositoryListPage = lazyWithRetry(() => import("./pages/RepositoryListPage"));
const ScriptDetailPage = lazyWithRetry(() => import("./pages/ScriptDetailPage"));
const ScriptsListPage = lazyWithRetry(() => import("./pages/ScriptsListPage"));
const SolutionPage = lazyWithRetry(() => import("./pages/SolutionPage"));
const SourceDetailPage = lazyWithRetry(() => import("./pages/SourceDetailPage"));
const PrivacyPage = lazyWithRetry(() => import("./pages/PrivacyPage"));
const CookiesPage = lazyWithRetry(() => import("./pages/CookiesPage"));
const ResetPasswordPage = lazyWithRetry(() => import("./pages/ResetPasswordPage"));
const SettingsPage = lazyWithRetry(() => import("./pages/SettingsPage"));
const SetupWizardPage = lazyWithRetry(() => import("./pages/SetupWizardPage"));
const SignupPage = lazyWithRetry(() => import("./pages/SignupPage"));
const TermsPage = lazyWithRetry(() => import("./pages/TermsPage"));
const VerifyEmailPage = lazyWithRetry(() => import("./pages/VerifyEmailPage"));
const TemplateDetailPage = lazyWithRetry(() => import("./pages/TemplateDetailPage"));
const WorkspacePage = lazyWithRetry(() => import("./pages/WorkspacePage"));

/**
 * Skeleton loading placeholder rendered while lazy-loaded route bundles are fetched.
 */
function PageLoadingFallback() {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "16px",
        padding: "32px 24px",
        maxWidth: "800px",
        margin: "0 auto",
        width: "100%",
        boxSizing: "border-box",
      }}
    >
      <div className="skeleton" style={{ width: "200px", height: "28px", borderRadius: "6px" }} />
      <div className="skeleton" style={{ width: "100%", height: "140px", borderRadius: "10px" }} />
      <div className="skeleton" style={{ width: "85%", height: "90px", borderRadius: "10px" }} />
    </div>
  );
}

/**
 * Global keyboard shortcut listener (`Cmd/Ctrl+K` command palette, `?` shortcuts modal,
 * `/` search focus, and `g + <key>` chord navigation) and modal host.
 */
function GlobalModals() {
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = React.useState(false);
  const [isShortcutsModalOpen, setIsShortcutsModalOpen] = React.useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const hasCae = useFeatureFlag("cae_cloud_solver");
  const hasFeeds = useFeatureFlag(["feeds_page", "rss_feeds"]);
  const hasRepos = useFeatureFlag(["git_repositories", "repositories"]);

  React.useEffect(() => {
    let pendingG = false;
    let pendingGTimer: ReturnType<typeof setTimeout> | null = null;

    const handleKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement;
      const isInput =
        activeEl?.tagName === "INPUT" ||
        activeEl?.tagName === "TEXTAREA" ||
        (activeEl as HTMLElement)?.isContentEditable;

      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        setIsCommandPaletteOpen((prev) => !prev);
        return;
      }

      if (isInput) return;

      if (e.key === "?" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        setIsShortcutsModalOpen((prev) => !prev);
        return;
      }

      if (e.key === "/" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        const searchInput = document.querySelector(
          'input[type="search"], input[placeholder*="Search"]',
        ) as HTMLInputElement;
        if (searchInput) {
          searchInput.focus();
        } else {
          setIsCommandPaletteOpen(true);
        }
        return;
      }

      if ((e.key === "g" || e.key === "G") && !e.metaKey && !e.ctrlKey && !e.altKey) {
        pendingG = true;
        if (pendingGTimer) clearTimeout(pendingGTimer);
        pendingGTimer = setTimeout(() => {
          pendingG = false;
        }, 1000);
        return;
      }

      if (pendingG) {
        pendingG = false;
        if (pendingGTimer) clearTimeout(pendingGTimer);
        const k = e.key.toLowerCase();
        const navWithScroll = (target: string) => {
          if (location.pathname === target) {
            scrollToTop({ smooth: true });
          } else {
            scrollToTop({ smooth: false });
            navigate(target);
          }
        };
        if (k === "h") {
          e.preventDefault();
          navWithScroll("/home");
        } else if (k === "e") {
          e.preventDefault();
          navWithScroll("/explore");
        } else if (k === "n") {
          e.preventDefault();
          navWithScroll("/notifications");
        } else if (k === "b") {
          e.preventDefault();
          navWithScroll("/bookmarks");
        } else if (k === "f") {
          if (hasFeeds) {
            e.preventDefault();
            navWithScroll("/feeds");
          }
        } else if (k === "p") {
          e.preventDefault();
          navWithScroll("/sketch");
        } else if (k === "k") {
          e.preventDefault();
          navWithScroll("/packages");
        } else if (k === "r") {
          if (hasRepos) {
            e.preventDefault();
            navWithScroll("/repos");
          }
        } else if (k === "i") {
          e.preventDefault();
          navWithScroll("/studio");
        } else if (k === "j") {
          if (hasCae) {
            e.preventDefault();
            navWithScroll("/jobs");
          }
        } else if (k === "s") {
          e.preventDefault();
          navWithScroll("/settings");
        }
      }
    };

    const handleOpenPalette = () => setIsCommandPaletteOpen(true);
    const handleClosePalette = () => setIsCommandPaletteOpen(false);
    const handleOpenShortcuts = () => setIsShortcutsModalOpen(true);
    const handleCloseShortcuts = () => setIsShortcutsModalOpen(false);

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("modelscript:open-command-palette", handleOpenPalette);
    window.addEventListener("modelscript:close-command-palette", handleClosePalette);
    window.addEventListener("modelscript:open-shortcuts", handleOpenShortcuts);
    window.addEventListener("modelscript:open-shortcuts-modal", handleOpenShortcuts);
    window.addEventListener("modelscript:close-shortcuts-modal", handleCloseShortcuts);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("modelscript:open-command-palette", handleOpenPalette);
      window.removeEventListener("modelscript:close-command-palette", handleClosePalette);
      window.removeEventListener("modelscript:open-shortcuts", handleOpenShortcuts);
      window.removeEventListener("modelscript:open-shortcuts-modal", handleOpenShortcuts);
      window.removeEventListener("modelscript:close-shortcuts-modal", handleCloseShortcuts);
      if (pendingGTimer) clearTimeout(pendingGTimer);
    };
  }, [navigate, hasCae, hasFeeds, hasRepos, location.pathname]);

  return (
    <>
      <CommandPalette
        isOpen={isCommandPaletteOpen}
        onClose={() => setIsCommandPaletteOpen(false)}
        onOpenCompose={(detail?: unknown) =>
          window.dispatchEvent(new CustomEvent("modelscript:open-compose", { detail }))
        }
      />
      <KeyboardShortcutsModal isOpen={isShortcutsModalOpen} onClose={() => setIsShortcutsModalOpen(false)} />
      <EnterpriseUpgradeModal />
    </>
  );
}

function PreserveParamsNavigate({ to }: { to: string }) {
  const location = useLocation();
  return <Navigate to={`${to}${location.search}${location.hash}`} replace />;
}

function IdeFallbackNavigate() {
  const location = useLocation();
  const params = useParams<{
    templateId?: string | undefined;
    provider?: string | undefined;
    namespace?: string | undefined;
    project?: string | undefined;
  }>();
  const searchParams = new URLSearchParams(location.search);
  if (params.templateId && !searchParams.has("template")) {
    searchParams.set("template", params.templateId);
  }
  if (params.provider && params.namespace && params.project && !searchParams.has("repo")) {
    searchParams.set("repo", `${params.provider}/${params.namespace}/${params.project}`);
  }
  const qs = searchParams.toString();
  return <Navigate to={`/sketch${qs ? `?${qs}` : ""}${location.hash}`} replace />;
}

function LegacyUserRedirect() {
  const { username } = useParams<{ username?: string | undefined }>();
  const location = useLocation();
  const cleanUsername = (username ? decodeURIComponent(username) : "").replace(/^@/, "");
  const subPath = location.pathname.replace(new RegExp(`^/users/${username || ""}`), "");
  const target = `/@${cleanUsername}${subPath}${location.search}${location.hash}`;
  return <Navigate to={target} replace />;
}

function UserRootRouteGuard({ element }: { element: React.ReactElement }) {
  const { username } = useParams<{ username?: string | undefined }>();
  const location = useLocation();

  if (!username) {
    return <NotFoundPage />;
  }

  // Handle percent-encoded @ (%40) by redirecting to canonical /@...
  if (username.startsWith("%40") || username.toLowerCase().startsWith("%40")) {
    const cleanPath = location.pathname.replace(/^\/%40/i, "/@");
    return <Navigate to={`${cleanPath}${location.search}${location.hash}`} replace />;
  }

  // All user profile and status routes MUST start with '@'
  if (!username.startsWith("@")) {
    return <NotFoundPage />;
  }

  return element;
}

function PageViewTracker() {
  const location = useLocation();
  const navigate = useNavigate();
  const { justLoggedOut, clearJustLoggedOut } = useAuth();
  const lastPathRef = React.useRef<string>("");
  const visitedLogoutPageRef = React.useRef<boolean>(false);

  React.useEffect(() => {
    const handleLoggedOut = () => {
      visitedLogoutPageRef.current = false;
      navigate("/logout", { replace: true });
    };
    window.addEventListener("modelscript:logged-out", handleLoggedOut);
    return () => {
      window.removeEventListener("modelscript:logged-out", handleLoggedOut);
    };
  }, [navigate]);

  React.useEffect(() => {
    const pathname = location.pathname || "/";
    if (pathname === "/logout") {
      visitedLogoutPageRef.current = true;
    } else if (visitedLogoutPageRef.current && justLoggedOut) {
      visitedLogoutPageRef.current = false;
      clearJustLoggedOut();
    }

    // Skip root redirect path `/`, maintenance fallback, and automated scanner probe paths
    const scannerProbeRe =
      /(?:^|\/)\.[^/]*|\.(?:php|asp|aspx|jsp|cgi|env|swp|swo|bak)(?:\/|$)|^\/(?:maintenance\.html|wp-admin|wp-login(?:\.php)?|wp-content|wp-includes|xmlrpc\.php|phpmyadmin|pma|adminer)(?:\/|$)/i;
    if (pathname === "/" || pathname === lastPathRef.current || scannerProbeRe.test(pathname)) return;
    lastPathRef.current = pathname;
    recordPageViewBeacon(pathname, "web");
  }, [location.pathname, justLoggedOut, clearJustLoggedOut]);

  return null;
}

export function InstanceAnnouncementBanner({
  initialBanner,
}: {
  initialBanner?: {
    instanceName?: string;
    maintenanceMode: boolean;
    maintenanceLevel?: "off" | "scheduled" | "read_only" | "lockdown";
    maintenanceEta?: string;
    announcementBanner: string;
    announcementLevel: "info" | "warning" | "critical";
    needsSetup?: boolean;
  };
}) {
  const location = useLocation();
  const [banner, setBanner] = React.useState(initialBanner ?? null);
  const [dismissed, setDismissed] = React.useState(false);

  React.useEffect(() => {
    if (initialBanner) return;
    let mounted = true;
    getPublicInstanceBanner()
      .then((res) => {
        if (mounted) setBanner(res);
      })
      .catch(() => {});

    const handleUpdated = (e: Event) => {
      const detail = (e as CustomEvent<Record<string, unknown> | undefined>).detail;
      if (detail && typeof detail === "object") {
        setBanner((prev) =>
          prev
            ? ({ ...prev, ...detail } as NonNullable<typeof initialBanner>)
            : (detail as unknown as NonNullable<typeof initialBanner>),
        );
        if (detail["maintenanceMode"] || detail["maintenanceLevel"] === "scheduled") {
          setDismissed(false);
        }
      } else {
        getPublicInstanceBanner()
          .then((res) => {
            if (mounted) setBanner(res);
          })
          .catch(() => {});
      }
    };
    window.addEventListener("modelscript:branding-updated", handleUpdated);
    return () => {
      mounted = false;
      window.removeEventListener("modelscript:branding-updated", handleUpdated);
    };
  }, [initialBanner]);

  if (!banner || dismissed) return null;

  if (banner.needsSetup) {
    if (location.pathname.startsWith("/setup")) {
      return null;
    }
    return (
      <div
        role="status"
        data-testid="instance-setup-banner"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "12px",
          padding: "10px 16px",
          fontSize: "13px",
          fontWeight: 600,
          backgroundColor: "rgba(37, 99, 235, 0.16)",
          borderBottom: "1px solid rgba(37, 99, 235, 0.45)",
          color: "#3b82f6",
        }}
      >
        <div>
          <strong style={{ marginRight: "8px" }}>[FIRST-BOOT SETUP]</strong>
          <span>
            Welcome to your new {banner.instanceName || "Ansatz"} instance! No administrator account has been configured
            yet.
          </span>
        </div>
        <Link
          to="/setup"
          style={{
            padding: "5px 12px",
            borderRadius: "6px",
            backgroundColor: "#2563eb",
            color: "#ffffff",
            textDecoration: "none",
            fontSize: "12px",
            fontWeight: 700,
            whiteSpace: "nowrap",
          }}
        >
          Launch Install Wizard →
        </Link>
      </div>
    );
  }

  const isScheduled = banner.maintenanceLevel === "scheduled";
  if (!banner.maintenanceMode && !isScheduled && !banner.announcementBanner) return null;

  const isCritical = banner.maintenanceMode || banner.announcementLevel === "critical";
  const isWarning = !isCritical && (isScheduled || banner.announcementLevel === "warning");

  return (
    <div
      role="status"
      data-testid="instance-announcement-banner"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "12px",
        padding: "8px 16px",
        fontSize: "13px",
        fontWeight: 600,
        backgroundColor: isCritical
          ? "rgba(239, 68, 68, 0.16)"
          : isWarning
            ? "rgba(245, 158, 11, 0.16)"
            : "rgba(59, 130, 246, 0.14)",
        borderBottom: `1px solid ${
          isCritical ? "rgba(239, 68, 68, 0.4)" : isWarning ? "rgba(245, 158, 11, 0.4)" : "rgba(59, 130, 246, 0.35)"
        }`,
        color: isCritical ? "#ef4444" : isWarning ? "#f59e0b" : "#3b82f6",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
        {banner.maintenanceMode && (
          <strong>{banner.maintenanceLevel === "lockdown" ? "[LOCKDOWN MAINTENANCE]" : "[MAINTENANCE MODE]"}</strong>
        )}
        {!banner.maintenanceMode && isScheduled && <strong>[UPCOMING MAINTENANCE]</strong>}
        <span>{banner.announcementBanner || "Scheduled instance maintenance is currently in progress."}</span>
        {banner.maintenanceEta && (
          <span
            style={{
              padding: "1px 7px",
              borderRadius: "999px",
              fontSize: "11px",
              fontFamily: "monospace",
              background: "rgba(0, 0, 0, 0.15)",
            }}
          >
            ETA: {banner.maintenanceEta}
          </span>
        )}
      </div>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        style={{
          background: "transparent",
          border: "none",
          color: "inherit",
          cursor: "pointer",
          fontSize: "12px",
          fontWeight: 700,
        }}
      >
        Dismiss
      </button>
    </div>
  );
}

/**
 * Core Ansatz React router and layout shell (powered by ModelScript).
 */
function App() {
  const { theme } = useTheme();
  const { user, isLoading, setSession, justLoggedOut } = useAuth();
  const hasIde = useFeatureFlag("heavy_vscode_ide");
  const hasCae = useFeatureFlag("cae_cloud_solver");
  const hasRepos = useFeatureFlag(["git_repositories", "repositories"]);
  const hasReferences = useFeatureFlag(["references", "scientific_references"]);
  const hasFeeds = useFeatureFlag(["feeds_page", "rss_feeds"]);

  return (
    <ThemeProvider colorMode={theme === "dark" ? "night" : "day"}>
      <BaseStyles
        style={{
          backgroundColor: "transparent",
          fontFamily: "var(--ms-font-sans)",
          color: "var(--ms-text-1)",
          minHeight: "100vh",
        }}
      >
        <div id="portal-root" />
        <ToastProvider>
          <BrowserRouter>
            <ScrollToTop />
            <PageViewTracker />
            <OfflineBanner />
            <InstanceAnnouncementBanner />
            <MaintenanceExperienceHost />
            <GlobalModals />
            <RealtimeNotificationListener />
            <ErrorBoundary>
              <Suspense fallback={<PageLoadingFallback />}>
                <Routes>
                  <Route
                    path="/"
                    element={
                      isLoading ? (
                        <PageLoadingFallback />
                      ) : (
                        <Navigate to={user ? "/home" : justLoggedOut ? "/logout" : "/explore"} replace />
                      )
                    }
                  />
                  <Route path="/setup" element={<SetupWizardPage onLoginSuccess={setSession} />} />
                  <Route path="/login" element={<LoginPage />} />
                  <Route path="/logout" element={<LogoutPage />} />
                  <Route path="/signup" element={<SignupPage />} />
                  <Route path="/onboarding" element={<Navigate to="/home?tour=1" replace />} />
                  <Route path="/terms" element={<TermsPage />} />
                  <Route path="/privacy" element={<PrivacyPage />} />
                  <Route path="/cookies" element={<CookiesPage />} />
                  <Route path="/oauth/callback" element={<OAuthCallbackPage />} />
                  <Route path="/verify-email" element={<VerifyEmailPage />} />
                  <Route path="/reset-password" element={<ResetPasswordPage />} />
                  <Route path="/render-artifact/:id" element={<RenderArtifactPage />} />
                  <Route path="/embed/playground" element={<EmbedPlaygroundPage />} />
                  <Route path="/embed/sketch" element={<EmbedPlaygroundPage />} />
                  <Route path="/morsel" element={<PreserveParamsNavigate to="/sketch" />} />
                  <Route path="/embed/morsel" element={<PreserveParamsNavigate to="/embed/sketch" />} />
                  <Route path="/solutions/:username/:slug" element={<SolutionPage />} />

                  {/* Social shell routes */}
                  <Route element={<AppShell />}>
                    <Route path="/sketch" element={<PlaygroundPage />} />
                    <Route path="/playground" element={<PlaygroundPage />} />
                    <Route
                      path="/home"
                      element={
                        user ? <HomeFeedPage /> : <Navigate to={justLoggedOut ? "/logout" : "/explore"} replace />
                      }
                    />
                    <Route path="/feed" element={<Navigate to="/home" replace />} />
                    <Route path="/explore" element={<ExplorePage />} />
                    <Route
                      path="/notifications"
                      element={
                        <RequireAuth feature="your notifications">
                          <NotificationsPage />
                        </RequireAuth>
                      }
                    />
                    <Route
                      path="/bookmarks"
                      element={
                        <RequireAuth feature="your bookmarks">
                          <BookmarksPage />
                        </RequireAuth>
                      }
                    />
                    <Route
                      path="/feeds"
                      element={
                        hasFeeds ? (
                          <RequireAuth feature="your RSS feeds">
                            <FeedsPage />
                          </RequireAuth>
                        ) : (
                          <Navigate to={user ? "/home" : "/explore"} replace />
                        )
                      }
                    />

                    {/* Package browser (unscoped & @scope/name) */}
                    <Route path="/packages" element={<LibraryListPage />} />
                    <Route path="/packages/:name" element={<LibraryVersionPage />} />
                    <Route path="/packages/:first/:second" element={<PackageDetailPage />} />
                    <Route path="/packages/:scope/:name/:version" element={<PackageDetailPage />} />
                    <Route path="/packages/:name/:version/classes/:className" element={<PackageDetailPage />} />
                    <Route path="/packages/:scope/:name/:version/classes/:className" element={<PackageDetailPage />} />

                    {/* Studio */}
                    <Route path="/studio" element={hasIde ? <IdeWorkspacePage /> : <IdeFallbackNavigate />} />
                    <Route
                      path="/studio/:templateId"
                      element={hasIde ? <IdeWorkspacePage /> : <IdeFallbackNavigate />}
                    />
                    <Route path="/ide" element={<PreserveParamsNavigate to="/studio" />} />
                    <Route path="/ide/:templateId" element={<PreserveParamsNavigate to="/studio" />} />

                    {/* Repositories */}
                    <Route
                      path="/repos"
                      element={hasRepos ? <RepositoryListPage /> : <Navigate to="/packages" replace />}
                    />
                    <Route
                      path="/repos/:provider/:namespace/:project/studio"
                      element={hasRepos && hasIde ? <IdeWorkspacePage /> : <IdeFallbackNavigate />}
                    />
                    <Route
                      path="/repos/:provider/:namespace/:project/ide"
                      element={hasRepos && hasIde ? <IdeWorkspacePage /> : <IdeFallbackNavigate />}
                    />
                    <Route
                      path="/repos/:provider/:namespace/:project/*"
                      element={hasRepos ? <WorkspacePage /> : <Navigate to="/packages" replace />}
                    />

                    {/* Scholarly Reference Manager & Source URN Resolver */}
                    <Route
                      path="/references"
                      element={hasReferences ? <ReferencesPage /> : <Navigate to="/packages" replace />}
                    />
                    <Route
                      path="/sources/:identifier"
                      element={hasReferences ? <SourceDetailPage /> : <Navigate to="/packages" replace />}
                    />
                    <Route
                      path="/sources/*"
                      element={hasReferences ? <SourceDetailPage /> : <Navigate to="/packages" replace />}
                    />

                    {/* Cloud Jobs & HPC Queue */}
                    <Route path="/jobs" element={hasCae ? <ScriptsListPage /> : <Navigate to="/packages" replace />} />
                    <Route
                      path="/jobs/templates/:id"
                      element={hasCae ? <TemplateDetailPage /> : <Navigate to="/packages" replace />}
                    />
                    <Route
                      path="/jobs/:id"
                      element={hasCae ? <ScriptDetailPage /> : <Navigate to="/packages" replace />}
                    />

                    {/* Legacy /scripts alias routes */}
                    <Route
                      path="/scripts"
                      element={hasCae ? <Navigate to="/jobs" replace /> : <Navigate to="/packages" replace />}
                    />
                    <Route
                      path="/scripts/templates/:id"
                      element={hasCae ? <TemplateDetailPage /> : <Navigate to="/packages" replace />}
                    />
                    <Route
                      path="/scripts/:id"
                      element={hasCae ? <ScriptDetailPage /> : <Navigate to="/packages" replace />}
                    />

                    {/* Instance Administration */}
                    <Route
                      path="/admin/*"
                      element={
                        <AdminRoute>
                          <AdminPage />
                        </AdminRoute>
                      }
                    />

                    <Route
                      path="/settings"
                      element={
                        <RequireAuth feature="your settings">
                          <SettingsPage />
                        </RequireAuth>
                      }
                    />
                    <Route
                      path="/settings/profile"
                      element={
                        <RequireAuth feature="your profile settings">
                          <EditProfilePage />
                        </RequireAuth>
                      }
                    />
                    <Route
                      path="/settings/:tab"
                      element={
                        <RequireAuth feature="your settings">
                          <SettingsPage />
                        </RequireAuth>
                      }
                    />
                    <Route path="/p/:id" element={<PostDetailPage />} />
                    <Route path="/posts/:id" element={<PostDetailPage />} />
                    {/* Backward-compatible redirects: /users/:username -> /@:username */}
                    <Route path="/users/:username" element={<LegacyUserRedirect />} />
                    <Route path="/users/:username/about" element={<LegacyUserRedirect />} />
                    <Route path="/users/:username/status/:id" element={<LegacyUserRedirect />} />
                    <Route path="/users/:username/status/:id/activity" element={<LegacyUserRedirect />} />
                    <Route path="/users/:username/followers" element={<LegacyUserRedirect />} />
                    <Route path="/users/:username/following" element={<LegacyUserRedirect />} />

                    {/* Canonical user profile and status routes with '@' guard */}
                    <Route path="/:username" element={<UserRootRouteGuard element={<ProfilePage />} />} />
                    <Route path="/:username/about" element={<UserRootRouteGuard element={<AboutAccountPage />} />} />
                    <Route path="/:username/status/:id" element={<UserRootRouteGuard element={<PostDetailPage />} />} />
                    <Route
                      path="/:username/status/:id/activity"
                      element={<UserRootRouteGuard element={<PostActivityPage />} />}
                    />
                    <Route path="/:username/followers" element={<UserRootRouteGuard element={<FollowersPage />} />} />
                    <Route path="/:username/following" element={<UserRootRouteGuard element={<FollowingPage />} />} />
                    <Route path="*" element={<NotFoundPage />} />
                  </Route>
                </Routes>
              </Suspense>
            </ErrorBoundary>
          </BrowserRouter>
        </ToastProvider>
      </BaseStyles>
    </ThemeProvider>
  );
}

/**
 * Top-level application wrapper providing theme, authentication, feature flag,
 * and modeling preference contexts around {@link App}.
 */
function AppWithTheme() {
  return (
    <ThemeContextProvider>
      <InstanceBrandingProvider>
        <CapabilitiesProvider>
          <AuthProvider>
            <FeatureFlagProvider>
              <ModelingPreferencesProvider>
                <App />
              </ModelingPreferencesProvider>
            </FeatureFlagProvider>
          </AuthProvider>
        </CapabilitiesProvider>
      </InstanceBrandingProvider>
    </ThemeContextProvider>
  );
}

export default AppWithTheme;
