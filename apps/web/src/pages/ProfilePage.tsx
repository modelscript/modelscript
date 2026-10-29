// SPDX-License-Identifier: AGPL-3.0-or-later

import { Flash, Heading, Spinner, Text } from "@primer/react";
import React, { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  blockUser,
  followUser,
  getUserProfile,
  muteUser,
  reportUser,
  unblockUser,
  unfollowUser,
  unmuteUser,
} from "../api";
import { useAuth } from "../AuthContext";
import Box from "../components/Box";
import ProfilePosts from "../components/ProfilePosts";
import ProfileRepos from "../components/ProfileRepos";
import ProfileSolutions from "../components/ProfileSolutions";
import { usePageTitle } from "../util/title";
import { ProfileHeader, ReportModal, Tab, TabBar, UnblockModal, type LinkedAccount, type ProfileData } from "./profile";

const ProfilePage: React.FC = () => {
  const { username } = useParams();
  const navigate = useNavigate();
  const { user, token } = useAuth();
  const [profile, setProfile] = useState<ProfileData | null>(null);
  usePageTitle(
    profile?.display_name ? `${profile.display_name} (@${username})` : username ? `@${username}` : "Profile",
  );
  const [isFollowing, setIsFollowing] = useState(false);
  const [linkedAccounts, setLinkedAccounts] = useState<LinkedAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("Posts");

  const [isBlocked, setIsBlocked] = useState(false);
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
      } else {
        await muteUser(username);
        setIsMuted(true);
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
    async function fetchProfile() {
      if (!username) return;
      setLoading(true);
      setActionError(null);
      setProfile(null);
      try {
        const data = await getUserProfile(username);
        setProfile(data.profile);
        setIsFollowing(Boolean(data.isFollowing));
        setIsBlocked(Boolean(data.isBlocked));
        setIsMuted(Boolean(data.isMuted));
        setLinkedAccounts(data.linkedAccounts || []);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    fetchProfile();
  }, [username, token]);

  const handleFollowToggle = async (following: boolean) => {
    if (!token || !username) return;
    try {
      if (!following) {
        await unfollowUser(username);
      } else {
        await followUser(username);
      }
      setIsFollowing(following);
      setProfile((prev) =>
        prev
          ? {
              ...prev,
              follower_count: prev.follower_count + (following ? 1 : -1),
            }
          : prev,
      );
    } catch (err) {
      console.error(err);
    }
  };

  if (loading) {
    return (
      <Box p={4} display="flex" justifyContent="center">
        <Spinner size="large" />
      </Box>
    );
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

      <TabBar role="tablist" aria-label="Profile tabs">
        {["Posts", "Solutions", ...(profile.account_type === "rss" ? [] : ["Replies", "Artifacts", "Repos"])].map(
          (tab) => (
            <Tab
              key={tab}
              role="tab"
              aria-selected={activeTab === tab}
              $active={activeTab === tab}
              onClick={() => setActiveTab(tab)}
            >
              {tab}
            </Tab>
          ),
        )}
      </TabBar>

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

      {activeTab === "Repos" ? (
        <ProfileRepos username={profile.username} isOwnProfile={isOwnProfile} />
      ) : activeTab === "Solutions" ? (
        <ProfileSolutions username={profile.username} isOwnProfile={isOwnProfile} />
      ) : activeTab === "Posts" ? (
        <ProfilePosts username={profile.username} type="posts" />
      ) : activeTab === "Replies" ? (
        <ProfilePosts username={profile.username} type="replies" />
      ) : activeTab === "Artifacts" ? (
        <ProfilePosts username={profile.username} type="artifacts" />
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
