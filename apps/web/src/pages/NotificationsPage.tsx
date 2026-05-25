/* eslint-disable */
import { HeartFillIcon, MentionIcon, PersonIcon, ReplyIcon, StarIcon } from "@primer/octicons-react";
import { Heading, Spinner, Text } from "@primer/react";
import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import styled from "styled-components";
import { useAuth } from "../AuthContext";
import Box from "../components/Box";
import { API_BASE_URL } from "../config";

const Header = styled.div`
  padding: 16px;
  border-bottom: 1px solid var(--color-border-default);
  position: sticky;
  top: 0;
  z-index: 10;
  backdrop-filter: blur(12px);
  background-color: transparent;
`;

const NotificationWrapper = styled.div<{ $unread: boolean }>`
  display: flex;
  gap: 12px;
  padding: 16px;
  border-bottom: 1px solid var(--color-border-default);
  background-color: ${(props) => (props.$unread ? "var(--color-canvas-subtle)" : "transparent")};
  cursor: pointer;
  transition: background-color 0.2s;

  &:hover {
    background-color: var(--color-canvas-subtle);
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
      <Header>
        <Heading as="h2" style={{ fontSize: "20px" }}>
          Notifications
        </Heading>
      </Header>

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
              <Link
                key={notif.id}
                to={
                  notif.type === "follow"
                    ? `/${notif.actors[0].username}`
                    : `/${user?.username}/status/${notif.post_id}`
                }
                style={{ textDecoration: "none", color: "inherit" }}
              >
                <NotificationWrapper $unread={!notif.read}>
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
                          color="var(--color-fg-muted)"
                          fontSize="15px"
                          style={{
                            display: "-webkit-box",
                            WebkitLineClamp: 3,
                            WebkitBoxOrient: "vertical",
                            overflow: "hidden",
                          }}
                        >
                          {notif.post_content}
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
                </NotificationWrapper>
              </Link>
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
