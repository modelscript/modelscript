import { HeartFillIcon, PersonIcon, ReplyIcon, StarIcon } from "@primer/octicons-react";
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
    default:
      return null;
  }
};

const getMessageForType = (type: string, actorName: string) => {
  switch (type) {
    case "like":
      return (
        <>
          <Text fontWeight="bold">{actorName}</Text> liked your post
        </>
      );
    case "follow":
      return (
        <>
          <Text fontWeight="bold">{actorName}</Text> followed you
        </>
      );
    case "reply":
      return (
        <>
          <Text fontWeight="bold">{actorName}</Text> replied to your post
        </>
      );
    case "repost":
      return (
        <>
          <Text fontWeight="bold">{actorName}</Text> reposted your post
        </>
      );
    default:
      return null;
  }
};

const NotificationsPage: React.FC = () => {
  const { token, user } = useAuth();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
          setNotifications(data.notifications);
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
    // Mark as read when viewing the page
    fetch(`${API_BASE_URL}/social/notifications/read`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
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
          {notifications.map((notif) => (
            <Link
              key={notif.id}
              to={notif.type === "follow" ? `/${notif.actor_username}` : `/${user?.username}/status/${notif.post_id}`}
              style={{ textDecoration: "none", color: "inherit" }}
            >
              <NotificationWrapper $unread={!notif.read}>
                <Box width={40} display="flex" justifyContent="flex-end">
                  {getIconForType(notif.type)}
                </Box>
                <Box flex={1}>
                  <Avatar $url={notif.actor_avatar_url} />
                  <Box mt={2}>{getMessageForType(notif.type, notif.actor_display_name || notif.actor_username)}</Box>
                </Box>
              </NotificationWrapper>
            </Link>
          ))}
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
