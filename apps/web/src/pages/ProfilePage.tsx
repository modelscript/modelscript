// SPDX-License-Identifier: AGPL-3.0-or-later

/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import {
  ArrowLeftIcon,
  CalendarIcon,
  HubotIcon,
  InfoIcon,
  KebabHorizontalIcon,
  LinkIcon,
  ListUnorderedIcon,
  LocationIcon,
  MuteIcon,
  NoEntryIcon,
  ReportIcon,
  RssIcon,
} from "@primer/octicons-react";
import { Button, Dialog, Flash, FormControl, Heading, Select, Spinner, Text, Textarea } from "@primer/react";
import React, { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import styled from "styled-components";
import { useAuth } from "../AuthContext";
import Box from "../components/Box";
import FollowButton from "../components/FollowButton";
import ProfilePosts from "../components/ProfilePosts";
import ProfileRepos from "../components/ProfileRepos";
import { CircleIconButton, StickyHeader } from "../components/SharedStyles";
import { API_BASE_URL } from "../config";

const XIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
  </svg>
);

const TabBar = styled.div`
  display: flex;
  border-bottom: 1px solid var(--color-border-default);
  margin-top: 24px;
`;

const Tab = styled.button<{ $active?: boolean }>`
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: none;
  border: none;
  color: ${(props) => (props.$active ? "var(--color-fg-default)" : "var(--color-fg-muted)")};
  font-weight: ${(props) => (props.$active ? "bold" : "normal")};
  cursor: pointer;
  transition: background-color 0.2s;
  position: relative;

  &:hover {
    background-color: var(--color-canvas-subtle);
  }

  &::after {
    content: "";
    position: absolute;
    bottom: 0;
    height: 3px;
    width: 56px;
    background: var(--gradient-cta);
    box-shadow: 0 0 10px rgba(139, 92, 246, 0.5);
    border-radius: 9999px;
    display: ${(props) => (props.$active ? "block" : "none")};
  }
`;

const ProfilePage: React.FC = () => {
  const { username } = useParams();
  const { user, token } = useAuth();
  const [profile, setProfile] = useState<any>(null);
  const [isFollowing, setIsFollowing] = useState(false);
  const [linkedAccounts, setLinkedAccounts] = useState<any[]>([]);
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
    if (!token) return;
    try {
      const res = await fetch(`${API_BASE_URL}/users/${username}/block`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        setIsBlocked(true);
        setIsFollowing(false);
      }
    } catch (err: any) {
      setActionError(err.message || "Failed to block user");
    } finally {
      setShowBlockMenu(false);
    }
  };

  const handleUnblock = async () => {
    if (!token) return;
    try {
      const res = await fetch(`${API_BASE_URL}/users/${username}/block`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        setIsBlocked(false);
      }
    } catch (err: any) {
      setActionError(err.message || "Failed to unblock user");
    } finally {
      setShowUnblockModal(false);
    }
  };

  const handleMuteToggle = async () => {
    if (!token) return;
    try {
      const res = await fetch(`${API_BASE_URL}/users/${username}/mute`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setIsMuted(Boolean(data.muted));
      }
    } catch (err: any) {
      setActionError(err.message || "Failed to mute user");
    } finally {
      setShowBlockMenu(false);
    }
  };

  const handleReportSubmit = async () => {
    if (!token) return;
    try {
      const res = await fetch(`${API_BASE_URL}/users/${username}/report`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ reason: reportReason, details: reportDetails }),
      });
      if (res.ok) {
        setShowReportModal(false);
        setReportDetails("");
        setReportSuccess(true);
        setTimeout(() => setReportSuccess(false), 5000);
      }
    } catch (err: any) {
      setActionError(err.message || "Failed to submit report");
    }
  };

  const isOwnProfile = user?.username === username;

  useEffect(() => {
    async function fetchProfile() {
      try {
        const res = await fetch(`${API_BASE_URL}/users/${username}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (res.ok) {
          const data = await res.json();
          setProfile(data.profile);
          setIsFollowing(Boolean(data.isFollowing));
          setIsBlocked(Boolean(data.isBlocked));
          setIsMuted(Boolean(data.isMuted));
          setLinkedAccounts(data.linkedAccounts || []);
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    fetchProfile();
  }, [username, token]);

  const toggleFollow = async () => {
    if (!token) return;
    try {
      const method = isFollowing ? "DELETE" : "POST";
      const res = await fetch(`${API_BASE_URL}/users/${username}/follow`, {
        method,
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        setIsFollowing(!isFollowing);
        setProfile((prev) => ({
          ...prev,
          follower_count: prev.follower_count + (isFollowing ? -1 : 1),
        }));
      }
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
      <StickyHeader style={{ padding: "8px 16px", gap: "12px" }}>
        <CircleIconButton onClick={() => window.history.back()}>
          <ArrowLeftIcon size={20} />
        </CircleIconButton>
        <Box display="flex" flexDirection="column">
          <Heading
            as="h2"
            style={{ fontSize: "20px", margin: 0, lineHeight: 1.2, display: "flex", alignItems: "center", gap: "6px" }}
          >
            {profile.display_name || profile.username}
            {profile.account_type === "rss" && <RssIcon size={20} color="var(--color-fg-muted)" />}
            {profile.account_type === "bot" && <HubotIcon size={20} color="var(--color-fg-muted)" />}
          </Heading>
          <Text color="var(--color-fg-muted)" style={{ fontSize: "13px" }}>
            {Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(
              profile.post_count || 0,
            )}{" "}
            posts
          </Text>
        </Box>
      </StickyHeader>

      <Box
        style={{
          height: "200px",
          backgroundColor: "var(--color-canvas-subtle)",
          backgroundImage: profile.banner_url ? `url(${profile.banner_url})` : "none",
          backgroundSize: "cover",
          backgroundPosition: "center",
        }}
      />
      <Box px={4} style={{ marginTop: "-65px" }}>
        <Box display="flex" justifyContent="space-between" alignItems="flex-end">
          <Box
            style={{
              width: "134px",
              height: "134px",
              borderRadius: "50%",
              backgroundColor: "var(--color-accent-purple)",
              border: "4px solid var(--color-bg-primary)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "white",
              fontSize: "48px",
              fontWeight: "bold",
              backgroundImage: profile.avatar_url ? `url(${profile.avatar_url})` : "none",
              backgroundSize: "cover",
            }}
          >
            {!profile.avatar_url && profile.username.charAt(0).toUpperCase()}
          </Box>
          <Box mb={2} display="flex" gap={2} alignItems="center">
            {isOwnProfile ? (
              <Button
                onClick={() => (window.location.href = "/settings")}
                style={{ borderRadius: "9999px", fontWeight: "bold" }}
              >
                Edit profile
              </Button>
            ) : (
              <>
                <Box position="relative">
                  <button
                    onClick={() => setShowBlockMenu(!showBlockMenu)}
                    style={{
                      width: "32px",
                      height: "32px",
                      borderRadius: "50%",
                      border: "1px solid var(--color-border-default)",
                      background: "none",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "var(--color-fg-default)",
                      padding: 0,
                    }}
                  >
                    <KebabHorizontalIcon size={16} />
                  </button>
                  {showBlockMenu && (
                    <>
                      <div
                        style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, zIndex: 99 }}
                        onClick={() => setShowBlockMenu(false)}
                      />
                      <Box
                        position="absolute"
                        top="100%"
                        right="0"
                        mt={1}
                        style={{
                          backgroundColor: "rgba(14, 20, 36, 0.95)",
                          backdropFilter: "blur(16px)",
                          WebkitBackdropFilter: "blur(16px)",
                          border: "1px solid var(--color-border-glass, rgba(255, 255, 255, 0.12))",
                          borderRadius: "12px",
                          boxShadow: "0 10px 30px rgba(0, 0, 0, 0.5)",
                          padding: "8px 0",
                          zIndex: 100,
                          minWidth: "280px",
                        }}
                      >
                        <button
                          style={{
                            width: "100%",
                            padding: "12px 16px",
                            background: "none",
                            border: "none",
                            textAlign: "left",
                            cursor: "pointer",
                            fontWeight: "bold",
                            display: "flex",
                            alignItems: "center",
                            gap: "12px",
                            color: "var(--color-fg-default)",
                          }}
                          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "var(--color-canvas-subtle)")}
                          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
                        >
                          <InfoIcon size={20} /> About this account
                        </button>
                        <button
                          style={{
                            width: "100%",
                            padding: "12px 16px",
                            background: "none",
                            border: "none",
                            textAlign: "left",
                            cursor: "pointer",
                            fontWeight: "bold",
                            display: "flex",
                            alignItems: "center",
                            gap: "12px",
                            color: "var(--color-fg-default)",
                          }}
                          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "var(--color-canvas-subtle)")}
                          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
                        >
                          <ListUnorderedIcon size={20} /> Add/remove from Lists
                        </button>
                        <button
                          style={{
                            width: "100%",
                            padding: "12px 16px",
                            background: "none",
                            border: "none",
                            textAlign: "left",
                            cursor: "pointer",
                            fontWeight: "bold",
                            display: "flex",
                            alignItems: "center",
                            gap: "12px",
                            color: "var(--color-fg-default)",
                          }}
                          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "var(--color-canvas-subtle)")}
                          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
                        >
                          <ListUnorderedIcon size={20} /> View Lists
                        </button>
                        <button
                          style={{
                            width: "100%",
                            padding: "12px 16px",
                            background: "none",
                            border: "none",
                            textAlign: "left",
                            cursor: "pointer",
                            fontWeight: "bold",
                            display: "flex",
                            alignItems: "center",
                            gap: "12px",
                            color: "var(--color-fg-default)",
                          }}
                          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "var(--color-canvas-subtle)")}
                          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
                        >
                          <LinkIcon size={20} /> Copy link to profile
                        </button>
                        <button
                          onClick={handleMuteToggle}
                          style={{
                            width: "100%",
                            padding: "12px 16px",
                            background: "none",
                            border: "none",
                            textAlign: "left",
                            cursor: "pointer",
                            fontWeight: "bold",
                            display: "flex",
                            alignItems: "center",
                            gap: "12px",
                            color: "var(--color-fg-default)",
                          }}
                          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "var(--color-canvas-subtle)")}
                          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
                        >
                          <MuteIcon size={20} /> {isMuted ? "Unmute" : "Mute"} @{profile.username}
                        </button>
                        <button
                          onClick={handleBlock}
                          style={{
                            width: "100%",
                            padding: "12px 16px",
                            background: "none",
                            border: "none",
                            textAlign: "left",
                            cursor: "pointer",
                            fontWeight: "bold",
                            display: "flex",
                            alignItems: "center",
                            gap: "12px",
                            color: "var(--color-fg-default)",
                          }}
                          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "var(--color-canvas-subtle)")}
                          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
                        >
                          <NoEntryIcon size={20} /> Block @{profile.username}
                        </button>
                        <button
                          onClick={() => {
                            setShowBlockMenu(false);
                            setShowReportModal(true);
                          }}
                          style={{
                            width: "100%",
                            padding: "12px 16px",
                            background: "none",
                            border: "none",
                            textAlign: "left",
                            cursor: "pointer",
                            fontWeight: "bold",
                            display: "flex",
                            alignItems: "center",
                            gap: "12px",
                            color: "var(--color-fg-default)",
                          }}
                          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "var(--color-canvas-subtle)")}
                          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
                        >
                          <ReportIcon size={20} /> Report @{profile.username}
                        </button>
                      </Box>
                    </>
                  )}
                </Box>
                {isBlocked ? (
                  <Button
                    variant="danger"
                    onClick={() => setShowUnblockModal(true)}
                    style={{ borderRadius: "9999px", fontWeight: "bold" }}
                  >
                    Blocked
                  </Button>
                ) : (
                  <FollowButton
                    username={profile.username}
                    initialIsFollowing={isFollowing}
                    isRssFeed={profile.account_type === "rss"}
                    onToggle={(following) => {
                      setIsFollowing(following);
                      setProfile((prev) => ({
                        ...prev,
                        follower_count: prev.follower_count + (following ? 1 : -1),
                      }));
                    }}
                  />
                )}
              </>
            )}
          </Box>
        </Box>

        <Heading
          as="h1"
          style={{
            marginTop: "16px",
            fontSize: "24px",
            fontWeight: 800,
            display: "flex",
            alignItems: "center",
            gap: "8px",
          }}
        >
          {profile.display_name || profile.username}
          {profile.account_type === "rss" && <RssIcon size={24} color="var(--color-fg-muted)" />}
          {profile.account_type === "bot" && <HubotIcon size={24} color="var(--color-fg-muted)" />}
          {linkedAccounts.some((acc: any) => acc.provider === "twitter") && (
            <span
              style={{
                fontSize: "12px",
                padding: "2px 8px",
                backgroundColor: "var(--color-neutral-muted, rgba(128, 128, 128, 0.2))",
                color: "var(--color-fg-default)",
                borderRadius: "12px",
                display: "inline-flex",
                alignItems: "center",
                gap: "4px",
                fontWeight: "normal",
              }}
            >
              <XIcon /> Verified
            </span>
          )}
        </Heading>
        <Text color="var(--color-fg-muted)">@{profile.username}</Text>

        {profile.account_type === "bot" && profile.owner_username && (
          <Box mt={1} mb={2}>
            <Text color="var(--color-fg-muted)" fontSize="14px">
              <HubotIcon size={14} style={{ marginRight: "4px" }} />
              Managed by <Link to={`/${profile.owner_username}`}>@{profile.owner_username}</Link>
            </Text>
          </Box>
        )}

        {profile.bio && (
          <Box mt={3}>
            <Text>{profile.bio}</Text>
          </Box>
        )}

        <Box mt={3} display="flex" gap={3} flexWrap="wrap">
          {profile.location && (
            <Box display="flex" alignItems="center" gap={1} color="var(--color-fg-muted)">
              <LocationIcon size={16} /> <Text style={{ fontSize: "14px" }}>{profile.location}</Text>
            </Box>
          )}
          {profile.website && (
            <Box display="flex" alignItems="center" gap={1} color="var(--color-fg-muted)">
              <LinkIcon size={16} />{" "}
              <a
                href={profile.website}
                target="_blank"
                rel="noreferrer"
                style={{ color: "var(--color-accent-emphasis)", textDecoration: "none" }}
              >
                {profile.website}
              </a>
            </Box>
          )}
          {profile.account_type !== "rss" && (
            <Box display="flex" alignItems="center" gap={1} color="var(--color-fg-muted)">
              <CalendarIcon size={16} />{" "}
              <Text style={{ fontSize: "14px" }}>Joined {new Date(profile.created_at).toLocaleDateString()}</Text>
            </Box>
          )}
        </Box>

        {profile.account_type !== "rss" && (
          <Box mt={3} display="flex" gap={4}>
            <Link
              to={`/${profile.username}/following`}
              style={{ textDecoration: "none", color: "var(--color-fg-default)" }}
            >
              <Text style={{ fontWeight: "bold" }}>{profile.following_count}</Text>{" "}
              <Text color="var(--color-fg-muted)">Following</Text>
            </Link>
            <Link
              to={`/${profile.username}/followers`}
              style={{ textDecoration: "none", color: "var(--color-fg-default)" }}
            >
              <Text style={{ fontWeight: "bold" }}>{profile.follower_count}</Text>{" "}
              <Text color="var(--color-fg-muted)">Followers</Text>
            </Link>
          </Box>
        )}
      </Box>

      <TabBar>
        {["Posts", ...(profile.account_type === "rss" ? [] : ["Replies", "Artifacts", "Repos"])].map((tab) => (
          <Tab key={tab} $active={activeTab === tab} onClick={() => setActiveTab(tab)}>
            {tab}
          </Tab>
        ))}
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
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 999,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: "rgba(0,0,0,0.4)",
          }}
        >
          <Box
            style={{
              backgroundColor: "rgba(14, 20, 36, 0.95)",
              backdropFilter: "blur(16px)",
              WebkitBackdropFilter: "blur(16px)",
              border: "1px solid var(--color-border-glass, rgba(255, 255, 255, 0.12))",
              borderRadius: "16px",
              padding: "24px",
              minWidth: "300px",
              maxWidth: "340px",
              boxShadow: "0 10px 30px rgba(0, 0, 0, 0.5)",
            }}
          >
            <Heading as="h3" style={{ fontSize: "20px", marginBottom: "8px" }}>
              Unblock @{profile.username}?
            </Heading>
            <Text color="var(--color-fg-muted)" style={{ display: "block", marginBottom: "24px", lineHeight: "1.4" }}>
              They will be able to follow you and engage with your public posts.
            </Text>
            <Button
              style={{
                width: "100%",
                marginBottom: "12px",
                borderRadius: "9999px",
                padding: "10px",
                fontWeight: "bold",
                background: "var(--gradient-cta)",
                color: "white",
                border: "none",
                boxShadow: "0 2px 8px rgba(139, 92, 246, 0.3)",
              }}
              onClick={handleUnblock}
            >
              Unblock
            </Button>
            <Button
              style={{
                width: "100%",
                borderRadius: "9999px",
                padding: "10px",
                fontWeight: "bold",
                border: "1px solid var(--color-border-default)",
                background: "rgba(255, 255, 255, 0.04)",
                color: "var(--color-fg-default)",
              }}
              onClick={() => setShowUnblockModal(false)}
            >
              Cancel
            </Button>
          </Box>
        </div>
      )}

      {showReportModal && (
        <Dialog title={`Report @${profile.username}`} onClose={() => setShowReportModal(false)}>
          <Box p={3} display="flex" flexDirection="column" gap={3}>
            <FormControl>
              <FormControl.Label>Reason</FormControl.Label>
              <Select value={reportReason} onChange={(e) => setReportReason(e.target.value)}>
                <Select.Option value="Spam or automated bot">Spam or automated bot</Select.Option>
                <Select.Option value="Harassment or abuse">Harassment or abuse</Select.Option>
                <Select.Option value="Copyright or license violation">Copyright or license violation</Select.Option>
                <Select.Option value="Malicious or harmful code">Malicious or harmful code</Select.Option>
                <Select.Option value="Other">Other</Select.Option>
              </Select>
            </FormControl>
            <FormControl>
              <FormControl.Label>Additional Details (Optional)</FormControl.Label>
              <Textarea
                value={reportDetails}
                onChange={(e) => setReportDetails(e.target.value)}
                placeholder="Describe why you are reporting this account..."
                rows={4}
                block
              />
            </FormControl>
            <Box display="flex" justifyContent="flex-end" gap={2} mt={2}>
              <Button onClick={() => setShowReportModal(false)}>Cancel</Button>
              <Button variant="danger" onClick={handleReportSubmit}>
                Submit Report
              </Button>
            </Box>
          </Box>
        </Dialog>
      )}
    </Box>
  );
};

export default ProfilePage;
