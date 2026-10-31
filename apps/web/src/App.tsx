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
import { ToastProvider } from "./components/ToastContext";
import { FeatureFlagProvider, useFeatureFlag, useFeatureFlags } from "./FeatureFlagContext";
import { InstanceBrandingProvider, useInstanceBranding } from "./InstanceBrandingContext";
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
const AdminPage = lazyWithRetry(() => import("./pages/AdminPage"));
const BookmarksPage = lazyWithRetry(() => import("./pages/BookmarksPage"));
const ClassDetailPage = lazyWithRetry(() => import("./pages/ClassDetailPage"));
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
const NotFoundPage = lazyWithRetry(() => import("./pages/NotFoundPage"));
const NotificationsPage = lazyWithRetry(() => import("./pages/NotificationsPage"));
const OAuthCallbackPage = lazyWithRetry(() => import("./pages/OAuthCallbackPage"));
const PackageDetailPage = lazyWithRetry(() => import("./pages/PackageDetailPage"));
const PlaygroundPage = lazyWithRetry(() => import("./pages/PlaygroundPage"));
const PostActivityPage = lazyWithRetry(() => import("./pages/PostActivityPage"));
const PostDetailPage = lazyWithRetry(() => import("./pages/PostDetailPage"));
const ProfilePage = lazyWithRetry(() => import("./pages/ProfilePage"));
const RenderArtifactPage = lazyWithRetry(() => import("./pages/RenderArtifactPage"));
const RepositoryListPage = lazyWithRetry(() => import("./pages/RepositoryListPage"));
const ScriptDetailPage = lazyWithRetry(() => import("./pages/ScriptDetailPage"));
const ScriptsListPage = lazyWithRetry(() => import("./pages/ScriptsListPage"));
const SolutionPage = lazyWithRetry(() => import("./pages/SolutionPage"));
const PrivacyPage = lazyWithRetry(() => import("./pages/PrivacyPage"));
const ResetPasswordPage = lazyWithRetry(() => import("./pages/ResetPasswordPage"));
const SettingsPage = lazyWithRetry(() => import("./pages/SettingsPage"));
const SetupWizardPage = lazyWithRetry(() => import("./pages/SetupWizardPage"));
const SignupPage = lazyWithRetry(() => import("./pages/SignupPage"));
const TermsPage = lazyWithRetry(() => import("./pages/TermsPage"));
const VerifyEmailPage = lazyWithRetry(() => import("./pages/VerifyEmailPage"));
const TemplateDetailPage = lazyWithRetry(() => import("./pages/TemplateDetailPage"));
const WorkspacePage = lazyWithRetry(() => import("./pages/WorkspacePage"));
const OnboardingWizardPage = lazyWithRetry(() => import("./pages/onboarding/OnboardingWizardPage"));

/**
 * Disambiguates two-segment package routes `/packages/:first/:second`:
 * - If `first` starts with `@` (e.g. `@scope/name`), it's a scoped package version list -> LibraryVersionPage.
 * - Otherwise (e.g. `Modelica/4.1.0`), it's an unscoped package detail page -> PackageDetailPage.
 */
function PackageTwoSegmentRoute() {
  const { first } = useParams<{ first?: string }>();
  if (first?.startsWith("@")) {
    return <LibraryVersionPage />;
  }
  return <PackageDetailPage />;
}

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
        if (k === "h") {
          e.preventDefault();
          navigate("/home");
        } else if (k === "e") {
          e.preventDefault();
          navigate("/explore");
        } else if (k === "n") {
          e.preventDefault();
          navigate("/notifications");
        } else if (k === "b") {
          e.preventDefault();
          navigate("/bookmarks");
        } else if (k === "f") {
          e.preventDefault();
          navigate("/feeds");
        } else if (k === "p") {
          e.preventDefault();
          navigate("/playground");
        } else if (k === "k") {
          e.preventDefault();
          navigate("/packages");
        } else if (k === "r") {
          e.preventDefault();
          navigate("/repos");
        } else if (k === "i") {
          e.preventDefault();
          navigate("/ide");
        } else if (k === "j") {
          e.preventDefault();
          navigate("/jobs");
        } else if (k === "s") {
          e.preventDefault();
          navigate("/settings");
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
  }, [navigate]);

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
  return <Navigate to={`/playground${qs ? `?${qs}` : ""}${location.hash}`} replace />;
}

function PageViewTracker() {
  const location = useLocation();
  const lastPathRef = React.useRef<string>("");

  React.useEffect(() => {
    const pathname = location.pathname || "/";
    // Skip root redirect path `/` since it immediately replaces with `/home` or `/explore`
    if (pathname === "/" || pathname === lastPathRef.current) return;
    lastPathRef.current = pathname;
    recordPageViewBeacon(pathname, "web");
  }, [location.pathname]);

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
  const { user, isLoading, setSession } = useAuth();
  const branding = useInstanceBranding();
  const { isLoading: isFlagsLoading } = useFeatureFlags();
  const hasIde = useFeatureFlag("heavy_vscode_ide");
  const hasCae = useFeatureFlag("cae_cloud_solver");

  if (isLoading || isFlagsLoading || (user && !user.onboarding_completed && !branding.loaded)) {
    return (
      <div style={{ minHeight: "100vh", backgroundColor: "transparent" }}>
        <PageLoadingFallback />
      </div>
    );
  }

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
                      <Navigate
                        to={
                          user
                            ? branding.onboardingWizardEnabled && !user.onboarding_completed
                              ? "/onboarding"
                              : "/home"
                            : "/explore"
                        }
                        replace
                      />
                    }
                  />
                  <Route path="/setup" element={<SetupWizardPage onLoginSuccess={setSession} />} />
                  <Route path="/login" element={<LoginPage />} />
                  <Route path="/signup" element={<SignupPage />} />
                  <Route
                    path="/onboarding"
                    element={
                      <RequireAuth feature="guided onboarding">
                        <OnboardingWizardPage />
                      </RequireAuth>
                    }
                  />
                  <Route path="/terms" element={<TermsPage />} />
                  <Route path="/privacy" element={<PrivacyPage />} />
                  <Route path="/oauth/callback" element={<OAuthCallbackPage />} />
                  <Route path="/verify-email" element={<VerifyEmailPage />} />
                  <Route path="/reset-password" element={<ResetPasswordPage />} />
                  <Route path="/render-artifact/:id" element={<RenderArtifactPage />} />
                  <Route path="/embed/playground" element={<EmbedPlaygroundPage />} />
                  <Route path="/morsel" element={<PreserveParamsNavigate to="/playground" />} />
                  <Route path="/embed/morsel" element={<PreserveParamsNavigate to="/embed/playground" />} />
                  <Route path="/solutions/:username/:slug" element={<SolutionPage />} />

                  {/* Social shell routes */}
                  <Route element={<AppShell />}>
                    <Route path="/playground" element={<PlaygroundPage />} />
                    <Route path="/home" element={user ? <HomeFeedPage /> : <Navigate to="/explore" replace />} />
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
                        <RequireAuth feature="your RSS feeds">
                          <FeedsPage />
                        </RequireAuth>
                      }
                    />

                    {/* Package browser (unscoped & @scope/name) */}
                    <Route path="/packages" element={<LibraryListPage />} />
                    <Route path="/packages/:name" element={<LibraryVersionPage />} />
                    <Route path="/packages/:first/:second" element={<PackageTwoSegmentRoute />} />
                    <Route path="/packages/:scope/:name/:version" element={<PackageDetailPage />} />
                    <Route path="/packages/:name/:version/classes/:className" element={<ClassDetailPage />} />
                    <Route path="/packages/:scope/:name/:version/classes/:className" element={<ClassDetailPage />} />

                    {/* ModelScript IDE Workbench */}
                    <Route path="/ide" element={hasIde ? <IdeWorkspacePage /> : <IdeFallbackNavigate />} />
                    <Route path="/ide/:templateId" element={hasIde ? <IdeWorkspacePage /> : <IdeFallbackNavigate />} />

                    {/* Repositories */}
                    <Route path="/repos" element={<RepositoryListPage />} />
                    <Route
                      path="/repos/:provider/:namespace/:project/ide"
                      element={hasIde ? <IdeWorkspacePage /> : <IdeFallbackNavigate />}
                    />
                    <Route path="/repos/:provider/:namespace/:project/*" element={<WorkspacePage />} />

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
                    <Route path="/scripts" element={<Navigate to="/jobs" replace />} />
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
                    <Route path="/:username" element={<ProfilePage />} />
                    <Route path="/:username/status/:id" element={<PostDetailPage />} />
                    <Route path="/:username/status/:id/activity" element={<PostActivityPage />} />
                    <Route path="/:username/followers" element={<FollowersPage />} />
                    <Route path="/:username/following" element={<FollowingPage />} />
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
