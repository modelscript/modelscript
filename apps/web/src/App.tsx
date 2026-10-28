// SPDX-License-Identifier: AGPL-3.0-or-later

import { BaseStyles, ThemeProvider } from "@primer/react";
import React, { Suspense } from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate, useParams } from "react-router-dom";
import { recordPageViewBeacon } from "./api/admin";
import { AuthProvider, useAuth } from "./AuthContext";
import AdminRoute from "./components/AdminRoute";
import AppShell from "./components/AppShell";
import { CommandPalette } from "./components/CommandPalette";
import ErrorBoundary from "./components/ErrorBoundary";
import KeyboardShortcutsModal from "./components/KeyboardShortcutsModal";
import { RealtimeNotificationListener } from "./components/RealtimeNotificationListener";
import RequireAuth from "./components/RequireAuth";
import { ToastProvider } from "./components/ToastContext";
import { FeatureFlagProvider, useFeatureFlag, useFeatureFlags } from "./FeatureFlagContext";
import { ModelingPreferencesProvider } from "./ModelingPreferencesContext";
import { ThemeContextProvider, useTheme } from "./theme";

// Lazy-loaded pages for optimal initial bundle transfer
const AdminPage = React.lazy(() => import("./pages/AdminPage"));
const BookmarksPage = React.lazy(() => import("./pages/BookmarksPage"));
const ClassDetailPage = React.lazy(() => import("./pages/ClassDetailPage"));
const EditProfilePage = React.lazy(() => import("./pages/EditProfilePage"));
const EmbedPlaygroundPage = React.lazy(() => import("./pages/EmbedPlaygroundPage"));
const ExplorePage = React.lazy(() => import("./pages/ExplorePage"));
const FeedsPage = React.lazy(() => import("./pages/FeedsPage"));
const FollowersPage = React.lazy(() => import("./pages/FollowersPage"));
const FollowingPage = React.lazy(() => import("./pages/FollowingPage"));
const HomeFeedPage = React.lazy(() => import("./pages/HomeFeedPage"));
const IdeWorkspacePage = React.lazy(() => import("./pages/IdeWorkspacePage"));
const LibraryListPage = React.lazy(() => import("./pages/LibraryListPage"));
const LibraryVersionPage = React.lazy(() => import("./pages/LibraryVersionPage"));
const LoginPage = React.lazy(() => import("./pages/LoginPage"));
const NotFoundPage = React.lazy(() => import("./pages/NotFoundPage"));
const NotificationsPage = React.lazy(() => import("./pages/NotificationsPage"));
const OAuthCallbackPage = React.lazy(() => import("./pages/OAuthCallbackPage"));
const PackageDetailPage = React.lazy(() => import("./pages/PackageDetailPage"));
const PlaygroundPage = React.lazy(() => import("./pages/PlaygroundPage"));
const PostActivityPage = React.lazy(() => import("./pages/PostActivityPage"));
const PostDetailPage = React.lazy(() => import("./pages/PostDetailPage"));
const ProfilePage = React.lazy(() => import("./pages/ProfilePage"));
const RenderArtifactPage = React.lazy(() => import("./pages/RenderArtifactPage"));
const RepositoryListPage = React.lazy(() => import("./pages/RepositoryListPage"));
const ScriptDetailPage = React.lazy(() => import("./pages/ScriptDetailPage"));
const ScriptsListPage = React.lazy(() => import("./pages/ScriptsListPage"));
const SolutionPage = React.lazy(() => import("./pages/SolutionPage"));
const PrivacyPage = React.lazy(() => import("./pages/PrivacyPage"));
const ResetPasswordPage = React.lazy(() => import("./pages/ResetPasswordPage"));
const SettingsPage = React.lazy(() => import("./pages/SettingsPage"));
const SignupPage = React.lazy(() => import("./pages/SignupPage"));
const TermsPage = React.lazy(() => import("./pages/TermsPage"));
const VerifyEmailPage = React.lazy(() => import("./pages/VerifyEmailPage"));
const TemplateDetailPage = React.lazy(() => import("./pages/TemplateDetailPage"));
const WorkspacePage = React.lazy(() => import("./pages/WorkspacePage"));

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

/**
 * Core ModelScript Hub React router and layout shell.
 */
function App() {
  const { theme } = useTheme();
  const { user, isLoading } = useAuth();
  const { isLoading: isFlagsLoading } = useFeatureFlags();
  const hasIde = useFeatureFlag("heavy_vscode_ide");
  const hasCae = useFeatureFlag("cae_cloud_solver");

  if (isLoading || isFlagsLoading) {
    return <div style={{ minHeight: "100vh", backgroundColor: "var(--color-canvas-default)" }} />;
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
            <GlobalModals />
            <RealtimeNotificationListener />
            <ErrorBoundary>
              <Suspense fallback={<PageLoadingFallback />}>
                <Routes>
                  <Route path="/" element={<Navigate to={user ? "/home" : "/explore"} replace />} />
                  <Route path="/login" element={<LoginPage />} />
                  <Route path="/signup" element={<SignupPage />} />
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
      <AuthProvider>
        <FeatureFlagProvider>
          <ModelingPreferencesProvider>
            <App />
          </ModelingPreferencesProvider>
        </FeatureFlagProvider>
      </AuthProvider>
    </ThemeContextProvider>
  );
}

export default AppWithTheme;
