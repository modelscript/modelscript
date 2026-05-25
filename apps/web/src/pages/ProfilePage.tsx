/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import {
  ArrowLeftIcon,
  CalendarIcon,
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
import { Button, Heading, Spinner, Text } from "@primer/react";
import React, { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import styled from "styled-components";
import { useAuth } from "../AuthContext";
import Box from "../components/Box";
import FollowButton from "../components/FollowButton";
import ProfilePosts from "../components/ProfilePosts";
import ProfileRepos from "../components/ProfileRepos";
import { API_BASE_URL } from "../config";

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
    height: 4px;
    width: 56px;
    background-color: var(--color-accent-emphasis);
    border-radius: 9999px;
    display: ${(props) => (props.$active ? "block" : "none")};
  }
`;

const ProfilePage: React.FC = () => {
  const { username } = useParams();
  const { user, token } = useAuth();
  const [profile, setProfile] = useState<any>(null);
  const [isFollowing, setIsFollowing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("Posts");

  const [isBlocked, setIsBlocked] = useState(false);
  const [showBlockMenu, setShowBlockMenu] = useState(false);
  const [showUnblockModal, setShowUnblockModal] = useState(false);

  const handleBlock = () => {
    setIsBlocked(true);
    setShowBlockMenu(false);
  };

  const handleUnblock = () => {
    setIsBlocked(false);
    setShowUnblockModal(false);
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
          setIsFollowing(data.isFollowing);
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
      <Box
        position="sticky"
        top="var(--dev-header-height, 0px)"
        bg="rgba(255, 255, 255, 0.85)"
        style={{ backdropFilter: "blur(12px)", zIndex: 10 }}
        display="flex"
        alignItems="center"
        px={3}
        py={2}
        gap={3}
      >
        <button
          onClick={() => window.history.back()}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            width: "36px",
            height: "36px",
            borderRadius: "50%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--color-fg-default)",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "var(--color-canvas-subtle)")}
          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
        >
          <ArrowLeftIcon size={20} />
        </button>
        <Box display="flex" flexDirection="column">
          <Heading as="h2" style={{ fontSize: "20px", margin: 0, lineHeight: 1.2 }}>
            {profile.display_name || profile.username}
          </Heading>
          <Text color="var(--color-fg-muted)" style={{ fontSize: "13px" }}>
            {Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(
              profile.post_count || 0,
            )}{" "}
            posts
          </Text>
        </Box>
      </Box>

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
              backgroundColor: "var(--color-accent-emphasis)",
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
                        bg="var(--color-bg-primary)"
                        border="1px solid var(--color-border-subtle)"
                        borderRadius="12px"
                        boxShadow="0 4px 12px rgba(0,0,0,0.15)"
                        py={2}
                        zIndex={100}
                        minWidth="280px"
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
                          <MuteIcon size={20} /> Mute
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
          {profile.account_type === "rss" && (
            <span
              style={{
                fontSize: "12px",
                padding: "2px 8px",
                backgroundColor: "var(--color-accent-subtle)",
                color: "var(--color-accent-fg)",
                borderRadius: "12px",
                display: "inline-flex",
                alignItems: "center",
                gap: "4px",
              }}
            >
              <RssIcon size={12} /> RSS Feed
            </span>
          )}
        </Heading>
        <Text color="var(--color-fg-muted)">@{profile.username}</Text>

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
          <Box display="flex" alignItems="center" gap={1} color="var(--color-fg-muted)">
            <CalendarIcon size={16} />{" "}
            <Text style={{ fontSize: "14px" }}>Joined {new Date(profile.created_at).toLocaleDateString()}</Text>
          </Box>
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
        {["Posts", "Replies", "Packages", "Repos"].map((tab) => (
          <Tab key={tab} $active={activeTab === tab} onClick={() => setActiveTab(tab)}>
            {tab}
          </Tab>
        ))}
      </TabBar>

      {activeTab === "Repos" ? (
        <ProfileRepos username={profile.username} isOwnProfile={isOwnProfile} />
      ) : activeTab === "Posts" ? (
        <ProfilePosts username={profile.username} />
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
            bg="var(--color-bg-primary)"
            borderRadius="16px"
            p={4}
            minWidth="300px"
            maxWidth="320px"
            boxShadow="0 4px 12px rgba(0,0,0,0.15)"
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
                backgroundColor: "#0f1419",
                color: "white",
                border: "none",
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
                background: "transparent",
              }}
              onClick={() => setShowUnblockModal(false)}
            >
              Cancel
            </Button>
          </Box>
        </div>
      )}
    </Box>
  );
};

export default ProfilePage;
