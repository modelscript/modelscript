// SPDX-License-Identifier: AGPL-3.0-or-later

import { BaseStyles, Spinner, ThemeProvider } from "@primer/react";
import React, { Suspense } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./AuthContext";
import AdminRoute from "./components/AdminRoute";
import AppShell from "./components/AppShell";
import ErrorBoundary from "./components/ErrorBoundary";
import { FeatureFlagProvider, useFeatureFlag } from "./FeatureFlagContext";
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
const SettingsPage = React.lazy(() => import("./pages/SettingsPage"));
const SignupPage = React.lazy(() => import("./pages/SignupPage"));
const TemplateDetailPage = React.lazy(() => import("./pages/TemplateDetailPage"));
const WorkspacePage = React.lazy(() => import("./pages/WorkspacePage"));

function PageLoadingFallback() {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "50vh",
        width: "100%",
      }}
    >
      <Spinner size="medium" />
    </div>
  );
}

function App() {
  const { theme } = useTheme();
  const { user, isLoading } = useAuth();
  const hasIde = useFeatureFlag("heavy_vscode_ide");
  const hasCae = useFeatureFlag("cae_cloud_solver");

  if (isLoading) {
    return <div style={{ minHeight: "100vh", backgroundColor: "var(--color-canvas-default)" }} />;
  }

  return (
    <ThemeProvider colorMode={theme === "dark" ? "night" : "day"}>
      <BaseStyles
        style={{
          backgroundColor: "var(--color-canvas-default)",
          transition: "background-color 0.3s ease",
          minHeight: "100vh",
        }}
      >
        <div id="portal-root" />
        <BrowserRouter>
          <ErrorBoundary>
            <Suspense fallback={<PageLoadingFallback />}>
              <Routes>
                <Route path="/" element={<Navigate to={user ? "/home" : "/explore"} replace />} />
                <Route path="/login" element={<LoginPage />} />
                <Route path="/signup" element={<SignupPage />} />
                <Route path="/oauth/callback" element={<OAuthCallbackPage />} />
                <Route path="/render-artifact/:id" element={<RenderArtifactPage />} />
                <Route path="/playground" element={<PlaygroundPage />} />
                <Route path="/embed/playground" element={<EmbedPlaygroundPage />} />
                <Route path="/morsel" element={<Navigate to="/playground" replace />} />
                <Route path="/embed/morsel" element={<Navigate to="/embed/playground" replace />} />

                {/* Social shell routes */}
                <Route element={<AppShell />}>
                  <Route path="/home" element={user ? <HomeFeedPage /> : <Navigate to="/explore" replace />} />
                  <Route path="/explore" element={<ExplorePage />} />
                  <Route path="/notifications" element={<NotificationsPage />} />
                  <Route path="/bookmarks" element={<BookmarksPage />} />
                  <Route path="/feeds" element={<FeedsPage />} />

                  {/* Package browser */}
                  <Route path="/packages" element={<LibraryListPage />} />
                  <Route path="/packages/:name" element={<LibraryVersionPage />} />
                  <Route path="/packages/:name/:version" element={<PackageDetailPage />} />
                  <Route path="/packages/:name/:version/classes/:className" element={<ClassDetailPage />} />

                  {/* ModelScript IDE Workbench */}
                  <Route path="/ide" element={hasIde ? <IdeWorkspacePage /> : <Navigate to="/playground" replace />} />
                  <Route
                    path="/ide/:templateId"
                    element={hasIde ? <IdeWorkspacePage /> : <Navigate to="/playground" replace />}
                  />

                  {/* Repositories */}
                  <Route path="/repos" element={<RepositoryListPage />} />
                  <Route
                    path="/repos/:provider/:namespace/:project/ide"
                    element={hasIde ? <IdeWorkspacePage /> : <Navigate to="/playground" replace />}
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

                  <Route path="/settings" element={<SettingsPage />} />
                  <Route path="/settings/profile" element={<EditProfilePage />} />
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
      </BaseStyles>
    </ThemeProvider>
  );
}

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
