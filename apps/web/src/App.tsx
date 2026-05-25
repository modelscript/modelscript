import { BaseStyles, ThemeProvider } from "@primer/react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./AuthContext";
import AppShell from "./components/AppShell";
import BookmarksPage from "./pages/BookmarksPage";
import ClassDetailPage from "./pages/ClassDetailPage";
import EditProfilePage from "./pages/EditProfilePage";
import ExplorePage from "./pages/ExplorePage";
import FeedsPage from "./pages/FeedsPage";
import FollowersPage from "./pages/FollowersPage";
import FollowingPage from "./pages/FollowingPage";
import HomeFeedPage from "./pages/HomeFeedPage";
import LibraryListPage from "./pages/LibraryListPage";
import LibraryVersionPage from "./pages/LibraryVersionPage";
import LoginPage from "./pages/LoginPage";
import NotificationsPage from "./pages/NotificationsPage";
import OAuthCallbackPage from "./pages/OAuthCallbackPage";
import PackageDetailPage from "./pages/PackageDetailPage";
import PostActivityPage from "./pages/PostActivityPage";
import PostDetailPage from "./pages/PostDetailPage";
import ProfilePage from "./pages/ProfilePage";
import RepositoryListPage from "./pages/RepositoryListPage";
import SettingsPage from "./pages/SettingsPage";
import SignupPage from "./pages/SignupPage";
import WorkspacePage from "./pages/WorkspacePage";
import { ThemeContextProvider, useTheme } from "./theme";

function App() {
  const { theme } = useTheme();
  const { user, isLoading } = useAuth();

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
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Navigate to={user ? "/home" : "/explore"} replace />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/signup" element={<SignupPage />} />
            <Route path="/oauth/callback" element={<OAuthCallbackPage />} />

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

              {/* Repositories */}
              <Route path="/repos" element={<RepositoryListPage />} />
              <Route path="/repos/:provider/:namespace/:project/*" element={<WorkspacePage />} />

              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/settings/profile" element={<EditProfilePage />} />
              <Route path="/:username" element={<ProfilePage />} />
              <Route path="/:username/status/:id" element={<PostDetailPage />} />
              <Route path="/:username/status/:id/activity" element={<PostActivityPage />} />
              <Route path="/:username/followers" element={<FollowersPage />} />
              <Route path="/:username/following" element={<FollowingPage />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </BaseStyles>
    </ThemeProvider>
  );
}

function AppWithTheme() {
  return (
    <ThemeContextProvider>
      <AuthProvider>
        <App />
      </AuthProvider>
    </ThemeContextProvider>
  );
}

export default AppWithTheme;
