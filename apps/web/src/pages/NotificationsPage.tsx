/* eslint-disable */
import { HeartFillIcon, MentionIcon, PersonIcon, ReplyIcon, StarIcon } from "@primer/octicons-react";
import { Heading, Spinner, Text } from "@primer/react";
import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import styled from "styled-components";
import { useAuth } from "../AuthContext";
import Box from "../components/Box";
import ProfileHoverCard from "../components/ProfileHoverCard";
import { API_BASE_URL } from "../config";

import { StickyHeader } from "../components/SharedStyles";

function formatRelativeTime(dateString: string): string {
  if (!dateString) return "";
  const date = new Date(dateString);
  const now = new Date();
  const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (diffInSeconds < 60) return `${Math.max(1, diffInSeconds)}s`;
  if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)}m`;
  if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)}h`;

  if (now.getFullYear() !== date.getFullYear()) {
    return date.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
  }
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

function formatPostContent(content: string) {
  if (!content) return null;
  const parts = content.split(/((?:^|\s)@[a-zA-Z0-9_]+)/g);
  return parts.map((part, idx) => {
    const match = part.match(/^(\s*)(@[a-zA-Z0-9_]+)$/);
    if (match) {
      const username = match[2].substring(1);
      return (
        <React.Fragment key={idx}>
          {match[1]}
          <ProfileHoverCard username={username}>
            <Link
              to={`/${username}`}
              style={{ color: "#1d9bf0", textDecoration: "none" }}
              onClick={(e) => e.stopPropagation()}
              onMouseEnter={(e) => (e.currentTarget.style.textDecoration = "underline")}
              onMouseLeave={(e) => (e.currentTarget.style.textDecoration = "none")}
            >
              {match[2]}
            </Link>
          </ProfileHoverCard>
        </React.Fragment>
      );
    }
    return <React.Fragment key={idx}>{part}</React.Fragment>;
  });
}

const NotificationWrapper = styled.div<{ $unread: boolean }>`
  display: flex;
  gap: 12px;
  padding: 16px;
  border-bottom: 1px solid var(--color-border);
  background-color: ${(props) => (props.$unread ? "var(--color-bg-secondary)" : "transparent")};
  cursor: pointer;
  transition: background-color 0.2s;

  &:hover {
    background-color: var(--color-bg-secondary);
  }
`;

const Avatar = styled.div<{ $url?: string }>`
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background-color: var(--color-accent-emphasis);
  background-image: ${(props) => (props.$url ? `url(${props.$url})` : "none")};
  background-size: cover;
  flex-shrink: 0;
`;

const AvatarsRow = styled.div`
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
`;

const getIconForType = (type: string) => {
  switch (type) {
    case "like":
      return <HeartFillIcon color="var(--color-like)" size={24} />;
    case "follow":
      return <PersonIcon color="var(--color-accent-emphasis)" size={24} />;
    case "reply":
      return <ReplyIcon color="var(--color-fg-muted)" size={24} />;
    case "repost":
      return <StarIcon color="var(--color-success)" size={24} />;
    case "mention":
      return <MentionIcon color="var(--color-accent-emphasis)" size={24} />;
    default:
      return null;
  }
};

const getMessageForType = (type: string, actors: any[]) => {
  const count = actors.length;
  if (count === 0) return null;

  const firstActor = actors[0];
  const name = firstActor.display_name || firstActor.username;

  let actorText;
  if (count === 1) {
    actorText = <Text fontWeight="bold">{name}</Text>;
  } else if (count === 2) {
    actorText = (
      <>
        <Text fontWeight="bold">{name}</Text> and{" "}
        <Text fontWeight="bold">{actors[1].display_name || actors[1].username}</Text>
      </>
    );
  } else {
    actorText = (
      <>
        <Text fontWeight="bold">{name}</Text> and {count - 1} others
      </>
    );
  }

  switch (type) {
    case "like":
      return <>{actorText} liked your post</>;
    case "follow":
      return <>{actorText} followed you</>;
    case "reply":
      return <>{actorText} replied to your post</>;
    case "repost":
      return <>{actorText} reposted your post</>;
    case "mention":
      return <>{actorText} mentioned you</>;
    default:
      return null;
  }
};

function groupNotifications(notifs: any[]) {
  const grouped: any[] = [];
  const postGroups = new Map<string, any>();

  for (const notif of notifs) {
    if (notif.post_id && (notif.type === "like" || notif.type === "repost")) {
      const key = `${notif.type}-${notif.post_id}`;
      if (postGroups.has(key)) {
        const group = postGroups.get(key);
        if (!group.actors.some((a: any) => a.username === notif.actor_username)) {
          group.actors.push({
            username: notif.actor_username,
            display_name: notif.actor_display_name,
            avatar_url: notif.actor_avatar_url,
          });
        }
        if (notif.read === 0) {
          group.read = 0;
        }
      } else {
        const group = {
          ...notif,
          isGroup: true,
          actors: [
            {
              username: notif.actor_username,
              display_name: notif.actor_display_name,
              avatar_url: notif.actor_avatar_url,
            },
          ],
        };
        postGroups.set(key, group);
        grouped.push(group);
      }
    } else {
      grouped.push({
        ...notif,
        isGroup: false,
        actors: [
          {
            username: notif.actor_username,
            display_name: notif.actor_display_name,
            avatar_url: notif.actor_avatar_url,
          },
        ],
      });
    }
  }

  return grouped;
}

const NotificationsPage: React.FC = () => {
  const { token, user } = useAuth();
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) {
      setLoading(false);
      return;
    }
    async function fetchNotifications() {
      try {
        const res = await fetch(`${API_BASE_URL}/social/notifications`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const data = await res.json();
          setNotifications(groupNotifications(data.notifications));
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    fetchNotifications();
  }, [token]);

  useEffect(() => {
    if (!token) return;
    // Mark as read after a short delay so the GET request can fetch the unread status first
    const timeout = setTimeout(() => {
      fetch(`${API_BASE_URL}/social/notifications/read`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
    }, 2000);
    return () => clearTimeout(timeout);
  }, [token]);

  return (
    <Box>
      <StickyHeader>
        <Heading as="h2" style={{ fontSize: "20px", margin: 0 }}>
          Notifications
        </Heading>
      </StickyHeader>

      {loading ? (
        <Box p={4} display="flex" justifyContent="center">
          <Spinner size="large" />
        </Box>
      ) : (
        <Box>
          {notifications.map((notif) => {
            let thumbnail = null;
            if (notif.post_artifact_config && notif.post_artifact_type === "picture") {
              try {
                const conf = JSON.parse(notif.post_artifact_config);
                if (conf.url) thumbnail = conf.url;
              } catch {}
            } else if (notif.post_artifact_config && notif.post_artifact_type === "link-preview") {
              try {
                const conf = JSON.parse(notif.post_artifact_config);
                if (conf.image) thumbnail = conf.image;
              } catch {}
            }

            return (
              <NotificationWrapper
                key={notif.id}
                $unread={!notif.read}
                onClick={(e) => {
                  if ((e.target as HTMLElement).closest("a, button, .interactive-element")) return;
                  const url =
                    notif.type === "follow"
                      ? `/${notif.actors[0].username}`
                      : `/${user?.username}/status/${notif.post_id}`;
                  navigate(url);
                }}
              >
                {notif.type === "mention" || notif.type === "reply" ? (
                  <>
                    <Box width={40} display="flex" justifyContent="flex-end" pt={1}>
                      <Avatar $url={notif.actors[0].avatar_url} style={{ width: 40, height: 40 }} />
                    </Box>
                    <Box flex={1} display="flex" flexDirection="row">
                      <Box flex={1}>
                        <Box display="flex" alignItems="center" gap="4px" mb="4px" fontSize="15px">
                          <ProfileHoverCard username={notif.actors[0].username}>
                            <Link
                              to={`/${notif.actors[0].username}`}
                              style={{
                                fontWeight: "bold",
                                color: "var(--color-fg-default)",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                                textDecoration: "none",
                              }}
                              onClick={(e) => e.stopPropagation()}
                              onMouseEnter={(e) => (e.currentTarget.style.textDecoration = "underline")}
                              onMouseLeave={(e) => (e.currentTarget.style.textDecoration = "none")}
                            >
                              {notif.actors[0].display_name || notif.actors[0].username}
                            </Link>
                          </ProfileHoverCard>
                          <span
                            style={{
                              color: "var(--color-text-muted)",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            @{notif.actors[0].username}
                          </span>
                          <span style={{ color: "var(--color-text-muted)" }}>·</span>
                          <span style={{ color: "var(--color-text-muted)", whiteSpace: "nowrap" }}>
                            {formatRelativeTime(notif.created_at || new Date().toISOString())}
                          </span>
                        </Box>
                        {notif.type === "reply" && (
                          <Box fontSize="15px" color="var(--color-fg-muted)" mb="4px">
                            Replying to{" "}
                            {(() => {
                              const mentions = new Set<string>();
                              const regex = /(?:^|\s)@([a-zA-Z0-9_]+)/g;
                              let match;
                              while ((match = regex.exec(notif.post_content || "")) !== null) {
                                mentions.add(match[1]);
                              }
                              const handles = Array.from(mentions);
                              if (handles.length === 0 && user?.username) {
                                handles.push(user.username);
                              }
                              return handles.map((handle, idx) => (
                                <React.Fragment key={handle}>
                                  <ProfileHoverCard username={handle}>
                                    <Link
                                      to={`/${handle}`}
                                      style={{ color: "#1d9bf0", textDecoration: "none" }}
                                      onClick={(e) => e.stopPropagation()}
                                      onMouseEnter={(e) => (e.currentTarget.style.textDecoration = "underline")}
                                      onMouseLeave={(e) => (e.currentTarget.style.textDecoration = "none")}
                                    >
                                      @{handle}
                                    </Link>
                                  </ProfileHoverCard>
                                  {idx < handles.length - 1 && " "}
                                </React.Fragment>
                              ));
                            })()}
                          </Box>
                        )}
                        {notif.post_content && (
                          <Box
                            fontSize="15px"
                            color="var(--color-text-muted)"
                            style={{
                              display: "-webkit-box",
                              WebkitLineClamp: 3,
                              WebkitBoxOrient: "vertical",
                              overflow: "hidden",
                            }}
                          >
                            {formatPostContent(notif.post_content)}
                          </Box>
                        )}
                      </Box>
                      {thumbnail && (
                        <Box width="60px" height="60px" borderRadius="8px" overflow="hidden" ml={2} flexShrink={0}>
                          <img
                            src={thumbnail}
                            style={{ width: "100%", height: "100%", objectFit: "cover" }}
                            alt="attachment thumbnail"
                          />
                        </Box>
                      )}
                    </Box>
                  </>
                ) : (
                  <>
                    <Box width={40} display="flex" justifyContent="flex-end" pt={1}>
                      {getIconForType(notif.type)}
                    </Box>
                    <Box flex={1} display="flex" flexDirection="row">
                      <Box flex={1}>
                        <AvatarsRow>
                          {notif.actors.slice(0, 10).map((a: any) => (
                            <Avatar key={a.username} $url={a.avatar_url} />
                          ))}
                        </AvatarsRow>
                        <Box mt={1} fontSize="15px">
                          {getMessageForType(notif.type, notif.actors)}
                        </Box>
                        {notif.post_content && (
                          <Box
                            mt={1}
                            color="var(--color-text-muted)"
                            fontSize="15px"
                            style={{
                              display: "-webkit-box",
                              WebkitLineClamp: 3,
                              WebkitBoxOrient: "vertical",
                              overflow: "hidden",
                            }}
                          >
                            {formatPostContent(notif.post_content)}
                          </Box>
                        )}
                      </Box>
                      {thumbnail && (
                        <Box width="60px" height="60px" borderRadius="8px" overflow="hidden" ml={2} flexShrink={0}>
                          <img
                            src={thumbnail}
                            style={{ width: "100%", height: "100%", objectFit: "cover" }}
                            alt="attachment thumbnail"
                          />
                        </Box>
                      )}
                    </Box>
                  </>
                )}
              </NotificationWrapper>
            );
          })}
          {notifications.length === 0 && token && (
            <Box p={6} textAlign="center" color="var(--color-fg-muted)">
              Nothing to see here yet.
            </Box>
          )}
          {!token && (
            <Box p={6} textAlign="center" color="var(--color-fg-muted)">
              Please log in to view your notifications.
            </Box>
          )}
        </Box>
      )}
    </Box>
  );
};

export default NotificationsPage;
