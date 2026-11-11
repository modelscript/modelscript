// SPDX-License-Identifier: AGPL-3.0-or-later

import { Button, Flash, Heading, Text } from "@primer/react";
import React, { useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { blockUser, getUserProfile, muteUser, reportUser, unblockUser, unmuteUser } from "../api";
import { resolveNamespacePrincipal } from "../api/spaces";
import { useAuth } from "../AuthContext";
import Box from "../components/Box";
import ProfileArticles from "../components/ProfileArticles";
import ProfilePackages from "../components/ProfilePackages";
import ProfilePosts from "../components/ProfilePosts";
import ProfileRepos from "../components/ProfileRepos";
import ProfileSpaces from "../components/ProfileSpaces";
import Spinner from "../components/Spinner";
import { useToast } from "../components/ToastContext";
import { useFeatureFlag } from "../FeatureFlagContext";
import { formatProfileTitle, usePageTitle } from "../util/title";
import OrganizationPage from "./OrganizationPage";
import { ProfileHeader, ReportModal, Tab, TabBar, UnblockModal, type LinkedAccount, type ProfileData } from "./profile";

const PROFILE_TABS = ["Posts", "Replies", "Reposts", "Packages", "Articles", "Repos"];

const ProfilePage: React.FC = () => {
  const { username: rawUsername } = useParams();
  const username = rawUsername?.startsWith("@") ? rawUsername.slice(1) : rawUsername;
  const navigate = useNavigate();
  const { user, token } = useAuth();
  const hasRepos = useFeatureFlag(["git_repositories", "repositories"]);
  const hasSpaces = useFeatureFlag(["spaces_hub", "spaces"]);
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [isOrgContainer, setIsOrgContainer] = useState(false);
  const [isFollowing, setIsFollowing] = useState(false);
  const [linkedAccounts, setLinkedAccounts] = useState<LinkedAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get("tab")?.toLowerCase();
  const activeTab =
    tabParam === "spaces" && hasSpaces
      ? "Spaces"
      : (PROFILE_TABS.find(
          (t) =>
            t.toLowerCase() === tabParam ||
            (t === "Reposts" && tabParam === "repost") ||
            (t === "Replies" && tabParam === "reply"),
        ) ?? "Posts");
  const setActiveTab = (tab: string) => setSearchParams(tab === "Posts" ? {} : { tab: tab.toLowerCase() });

  const userIdentifier = profile?.display_name
    ? `${profile.display_name} (@${username})`
    : username
      ? `@${username}`
      : "";
  usePageTitle(formatProfileTitle(activeTab, userIdentifier));

  const toast = useToast();
  const [isBlocked, setIsBlocked] = useState(false);
  const [isBlockedBy, setIsBlockedBy] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [showBlockMenu, setShowBlockMenu] = useState(false);
  const [showUnblockModal, setShowUnblockModal] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  const [reportReason, setReportReason] = useState("Spam or automated bot");
  const [reportDetails, setReportDetails] = useState("");
  const [reportSuccess, setReportSuccess] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const handleBlock = async () => {
    if (!token || !username) return;
    try {
      await blockUser(username);
      setIsBlocked(true);
      setIsFollowing(false);
      toast.info(`Blocked @${username}`);
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("modelscript:user-muted-or-blocked", {
            detail: { username, action: "block" },
          }),
        );
      }
    } catch (err: any) {
      setActionError(err.message || "Failed to block user");
    } finally {
      setShowBlockMenu(false);
    }
  };

  const handleUnblock = async () => {
    if (!token || !username) return;
    try {
      await unblockUser(username);
      setIsBlocked(false);
      toast.info(`Unblocked @${username}`);
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("modelscript:user-unblocked", {
            detail: { username },
          }),
        );
      }
    } catch (err: any) {
      setActionError(err.message || "Failed to unblock user");
    } finally {
      setShowUnblockModal(false);
    }
  };

  const handleMuteToggle = async () => {
    if (!token || !username) return;
    try {
      if (isMuted) {
        await unmuteUser(username);
        setIsMuted(false);
        toast.info(`Unmuted @${username}`);
      } else {
        await muteUser(username);
        setIsMuted(true);
        toast.info(`Muted @${username}`);
        if (typeof window !== "undefined") {
          window.dispatchEvent(
            new CustomEvent("modelscript:user-muted-or-blocked", {
              detail: { username, action: "mute" },
            }),
          );
        }
      }
    } catch (err: any) {
      setActionError(err.message || "Failed to mute user");
    } finally {
      setShowBlockMenu(false);
    }
  };

  const handleReportSubmit = async () => {
    if (!token || !username) return;
    try {
      await reportUser(username, reportReason, reportDetails.trim() || undefined);
      setShowReportModal(false);
      setReportDetails("");
      setReportSuccess(true);
      setTimeout(() => setReportSuccess(false), 5000);
    } catch (err: any) {
      setActionError(err.message || "Failed to submit report");
    }
  };

  const isOwnProfile = user?.username === username;

  useEffect(() => {
    setShowBlockMenu(false);
    setShowUnblockModal(false);
    setShowReportModal(false);
  }, [username]);

  useEffect(() => {
    async function fetchProfile() {
      if (!username) return;
      setLoading(true);
      setActionError(null);
      setProfile(null);
      setIsOrgContainer(false);
      try {
        const data = await getUserProfile(username);
        setProfile(data.profile);
        setIsFollowing(Boolean(user && token && data.isFollowing));
        setIsBlocked(Boolean(user && token && data.isBlocked));
        setIsBlockedBy(Boolean(user && token && data.isBlockedBy));
        setIsMuted(Boolean(user && token && data.isMuted));
        setLinkedAccounts(data.linkedAccounts || []);
      } catch (err) {
        try {
          const principal = await resolveNamespacePrincipal(username);
          if (principal && principal.kind === "organization") {
            setIsOrgContainer(true);
            return;
          }
        } catch {
          // Ignore namespace fallback error
        }
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    fetchProfile();
  }, [username, token]);

  const handleFollowToggle = (following: boolean) => {
    setIsFollowing(following);
    setProfile((prev) =>
      prev
        ? {
            ...prev,
            follower_count: Math.max(0, prev.follower_count + (following ? 1 : -1)),
          }
        : prev,
    );
  };

  if (loading) {
    return (
      <Box p={4} display="flex" justifyContent="center">
        <Spinner size="large" />
      </Box>
    );
  }

  if (isOrgContainer && username) {
    return <OrganizationPage orgSlugOverride={username} />;
  }

  if (!profile) {
    return (
      <Box p={4}>
        <Heading as="h2">User not found</Heading>
      </Box>
    );
  }

  return (
    <Box>
      <ProfileHeader
        profile={profile}
        isOwnProfile={isOwnProfile}
        isFollowing={isFollowing}
        isBlocked={isBlocked}
        isMuted={isMuted}
        linkedAccounts={linkedAccounts}
        showBlockMenu={showBlockMenu}
        setShowBlockMenu={setShowBlockMenu}
        onFollowToggle={handleFollowToggle}
        onMuteToggle={handleMuteToggle}
        onBlock={handleBlock}
        onOpenUnblockModal={() => setShowUnblockModal(true)}
        onOpenReportModal={() => setShowReportModal(true)}
        onEditProfile={() => navigate("/settings/profile")}
      />

      {reportSuccess && (
        <Box p={3}>
          <Flash variant="success">Report submitted. Thank you for keeping our community safe.</Flash>
        </Box>
      )}
      {actionError && (
        <Box p={3}>
          <Flash variant="danger">{actionError}</Flash>
        </Box>
      )}

      {isBlockedBy ? (
        <Box p={6} textAlign="center" style={{ marginTop: "32px" }}>
          <Heading as="h2" style={{ fontSize: "20px", marginBottom: "8px" }}>
            @{profile.username} has blocked you
          </Heading>
          <Text color="var(--color-fg-muted)">
            You are blocked from following @{profile.username} and viewing their posts, articles, or activity.
          </Text>
        </Box>
      ) : isBlocked ? (
        <Box p={6} textAlign="center" style={{ marginTop: "32px" }}>
          <Heading as="h2" style={{ fontSize: "20px", marginBottom: "8px" }}>
            @{profile.username} is blocked
          </Heading>
          <Text color="var(--color-fg-muted)" style={{ display: "block", marginBottom: "16px" }}>
            You have blocked @{profile.username}. You will not see their posts, replies, or notifications.
          </Text>
          <Button variant="danger" onClick={() => setShowUnblockModal(true)} style={{ borderRadius: "9999px" }}>
            Unblock @{profile.username}
          </Button>
        </Box>
      ) : (
        <>
          <TabBar role="tablist" aria-label="Profile tabs">
            {[
              "Posts",
              ...(profile.account_type === "rss"
                ? []
                : [
                    ...["Replies", "Reposts", "Packages", "Articles", ...(hasRepos ? ["Repos"] : [])],
                    ...(hasSpaces ? ["Spaces"] : []),
                  ]),
            ].map((tab) => (
              <Tab
                key={tab}
                role="tab"
                aria-selected={activeTab === tab}
                $active={activeTab === tab}
                onClick={() => setActiveTab(tab)}
              >
                {tab}
              </Tab>
            ))}
          </TabBar>

          {activeTab === "Repos" && hasRepos ? (
            <ProfileRepos username={profile.username} isOwnProfile={isOwnProfile} />
          ) : activeTab === "Spaces" && hasSpaces ? (
            <ProfileSpaces username={profile.username} isOwnProfile={isOwnProfile} />
          ) : activeTab === "Posts" ? (
            <ProfilePosts
              username={profile.username}
              type="posts"
              isOwnProfile={isOwnProfile}
              pinnedPostId={profile.pinned_post_id}
              onPinChange={(postId, pinned) => {
                setProfile((prev) =>
                  prev
                    ? {
                        ...prev,
                        pinned_post_id: pinned ? postId : prev.pinned_post_id === postId ? null : prev.pinned_post_id,
                      }
                    : prev,
                );
              }}
            />
          ) : activeTab === "Replies" ? (
            <ProfilePosts username={profile.username} type="replies" isOwnProfile={isOwnProfile} />
          ) : activeTab === "Reposts" ? (
            <ProfilePosts username={profile.username} type="reposts" isOwnProfile={isOwnProfile} />
          ) : activeTab === "Packages" ? (
            <ProfilePackages username={profile.username} isOwnProfile={isOwnProfile} />
          ) : activeTab === "Articles" ? (
            <ProfileArticles username={profile.username} isOwnProfile={isOwnProfile} />
          ) : (
            <Box p={4} textAlign="center">
              <Heading as="h2" style={{ fontSize: "20px" }}>
                No {activeTab.toLowerCase()} yet
              </Heading>
              <Text color="var(--color-fg-muted)">
                When {profile.username} has {activeTab.toLowerCase()}, they will show up here.
              </Text>
            </Box>
          )}
        </>
      )}

      {showUnblockModal && (
        <UnblockModal
          username={profile.username}
          onUnblock={handleUnblock}
          onClose={() => setShowUnblockModal(false)}
        />
      )}

      {showReportModal && (
        <ReportModal
          username={profile.username}
          reportReason={reportReason}
          setReportReason={setReportReason}
          reportDetails={reportDetails}
          setReportDetails={setReportDetails}
          onSubmit={handleReportSubmit}
          onClose={() => setShowReportModal(false)}
        />
      )}
    </Box>
  );
};

export default ProfilePage;
