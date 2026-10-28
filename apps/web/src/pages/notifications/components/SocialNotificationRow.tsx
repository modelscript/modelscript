// SPDX-License-Identifier: AGPL-3.0-or-later

import React from "react";
import { Link, useNavigate } from "react-router-dom";
import Box from "../../../components/Box";
import ProfileHoverCard from "../../../components/ProfileHoverCard";
import { safeJsonParse } from "../../../util/json";
import { formatPostContent, formatRelativeTime, getIconForType, getMessageForType } from "../formatters";
import { Avatar, AvatarsRow, NotificationWrapper } from "../styles";
import type { NotificationItem } from "../types";

export interface SocialNotificationRowProps {
  notif: NotificationItem;
  currentUsername?: string | undefined;
  onMarkRead?: ((id: string | number) => void) | undefined;
}

export const SocialNotificationRow: React.FC<SocialNotificationRowProps> = ({ notif, currentUsername, onMarkRead }) => {
  const navigate = useNavigate();

  let thumbnail: string | null = null;
  if (notif.post_artifact_config && notif.post_artifact_type === "picture") {
    const conf = safeJsonParse<{ url?: string | undefined }>(notif.post_artifact_config, {});
    if (conf.url) thumbnail = conf.url;
  } else if (notif.post_artifact_config && notif.post_artifact_type === "link-preview") {
    const conf = safeJsonParse<{ image?: string | undefined }>(notif.post_artifact_config, {});
    if (conf.image) thumbnail = conf.image;
  }

  const primaryActor = notif.actors?.[0] || {
    username: notif.actor_username || "user",
    display_name: notif.actor_display_name || notif.actor_username || "User",
    avatar_url: notif.actor_avatar_url,
  };

  const handleRowClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest("a, button, .interactive-element")) return;
    if (!notif.read) {
      onMarkRead?.(notif.id);
    }
    const postAuthor = notif.post_author || notif.author_username || primaryActor.username || currentUsername;
    const url =
      notif.type === "follow"
        ? primaryActor.username
          ? `/${primaryActor.username}`
          : "/home"
        : `/${postAuthor}/status/${notif.post_id}`;
    navigate(url);
  };

  return (
    <NotificationWrapper key={notif.id} $unread={!notif.read} onClick={handleRowClick}>
      {notif.type === "mention" || notif.type === "reply" ? (
        <>
          <Box width={36} display="flex" justifyContent="flex-end" pt={1}>
            <Avatar $url={primaryActor.avatar_url} style={{ width: 36, height: 36 }} />
          </Box>
          <Box flex={1} display="flex" flexDirection="row">
            <Box flex={1}>
              <Box display="flex" alignItems="center" gap="4px" mb="4px" fontSize="14px">
                <ProfileHoverCard username={primaryActor.username || ""}>
                  <Link
                    to={`/${primaryActor.username}`}
                    style={{
                      fontWeight: "bold",
                      color: "var(--color-fg-default)",
                      textDecoration: "none",
                    }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {primaryActor.display_name || primaryActor.username}
                  </Link>
                </ProfileHoverCard>
                <span style={{ color: "var(--color-fg-muted)" }}>@{primaryActor.username}</span>
                <span style={{ color: "var(--color-fg-muted)" }}>·</span>
                <span style={{ color: "var(--color-fg-muted)" }}>
                  {formatRelativeTime(notif.created_at || new Date().toISOString())}
                </span>
              </Box>
              {notif.post_content && (
                <Box fontSize="14px" color="var(--color-fg-muted)">
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
          <Box width={36} display="flex" justifyContent="center" pt={1}>
            {getIconForType(notif.type)}
          </Box>
          <Box flex={1}>
            <AvatarsRow>
              {notif.actors?.slice(0, 10).map((a) => (
                <Avatar key={a.username} $url={a.avatar_url} />
              ))}
            </AvatarsRow>
            <Box mt={1} fontSize="14px">
              {getMessageForType(notif.type, notif.actors, currentUsername)}
            </Box>
            {notif.post_content && (
              <Box mt={1} color="var(--color-fg-muted)" fontSize="14px">
                {formatPostContent(notif.post_content)}
              </Box>
            )}
          </Box>
        </>
      )}
    </NotificationWrapper>
  );
};
