// SPDX-License-Identifier: AGPL-3.0-or-later

import { ArchiveIcon, BookmarkFillIcon, StarFillIcon, StarIcon } from "@primer/octicons-react";
import React from "react";
import { Link, useNavigate } from "react-router-dom";
import Box from "../../../components/Box";
import ProfileHoverCard from "../../../components/ProfileHoverCard";
import { safeJsonParse } from "../../../util/json";
import { formatPostContent, formatRelativeTime, getIconForType, getMessageForType } from "../formatters";
import {
  Avatar,
  AvatarOverflowPill,
  AvatarsRow,
  NotificationWrapper,
  QuickActionIconButton,
  UnreadDotButton,
} from "../styles";
import type { NotificationItem } from "../types";

export interface SocialNotificationRowProps {
  notif: NotificationItem;
  currentUsername?: string | undefined;
  selected?: boolean | undefined;
  onSelect?: ((notif: NotificationItem) => void) | undefined;
  onMarkRead?: ((id: string | number) => void) | undefined;
  onToggleStar?: ((notif: NotificationItem) => void) | undefined;
  onToggleArchive?: ((notif: NotificationItem) => void) | undefined;
}

const MAX_VISIBLE_AVATARS = 8;

export const SocialNotificationRow: React.FC<SocialNotificationRowProps> = ({
  notif,
  currentUsername,
  selected,
  onSelect,
  onMarkRead,
  onToggleStar,
  onToggleArchive,
}) => {
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

  const isFollowEvent = notif.type === "follow" || notif.type === "follow_request" || notif.type === "follow_accepted";

  const handleRowClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest("a, button, .interactive-element")) return;
    if (!notif.read) {
      onMarkRead?.(notif.id);
    }
    if (onSelect) {
      onSelect(notif);
      return;
    }
    const postAuthor = notif.post_author || notif.author_username || currentUsername || primaryActor.username;
    const url =
      isFollowEvent || !notif.post_id
        ? primaryActor.username
          ? `/@${primaryActor.username}`
          : "/home"
        : `/@${postAuthor}/status/${notif.post_id}`;
    navigate(url);
  };

  const relativeTime = formatRelativeTime(notif.created_at || new Date().toISOString());
  const visibleActors = notif.actors?.slice(0, MAX_VISIBLE_AVATARS) || [];
  const overflowCount = Math.max(0, (notif.actors?.length || 0) - MAX_VISIBLE_AVATARS);

  const renderTriageButtons = () => (
    <>
      {onToggleStar && (
        <QuickActionIconButton
          type="button"
          $active={Boolean(notif.starred || notif.isBookmark)}
          title={notif.isBookmark ? "Remove bookmark" : notif.starred ? "Remove from Saved (S)" : "Save for later (S)"}
          aria-label={notif.isBookmark ? "Remove bookmark" : notif.starred ? "Remove from Saved" : "Save for later"}
          onClick={(e) => {
            e.stopPropagation();
            onToggleStar(notif);
          }}
        >
          {notif.isBookmark ? (
            <BookmarkFillIcon size={14} />
          ) : notif.starred ? (
            <StarFillIcon size={14} />
          ) : (
            <StarIcon size={14} />
          )}
        </QuickActionIconButton>
      )}
      {onToggleArchive && !notif.isBookmark && (
        <QuickActionIconButton
          type="button"
          $active={Boolean(notif.archived)}
          title={notif.archived ? "Move back to Inbox (E)" : "Archive / Mark Done (E)"}
          aria-label={notif.archived ? "Move back to Inbox" : "Archive notification"}
          onClick={(e) => {
            e.stopPropagation();
            onToggleArchive(notif);
          }}
        >
          <ArchiveIcon size={14} />
        </QuickActionIconButton>
      )}
      {!notif.read && (
        <UnreadDotButton
          type="button"
          title="Mark as read"
          aria-label="Mark notification as read"
          onClick={(e) => {
            e.stopPropagation();
            onMarkRead?.(notif.id);
          }}
        />
      )}
    </>
  );

  return (
    <NotificationWrapper
      key={notif.id}
      $unread={!notif.read}
      $selected={selected}
      data-notification-id={String(notif.id)}
      data-unread={!notif.read ? "true" : "false"}
      onClick={handleRowClick}
    >
      {notif.type === "mention" || notif.type === "reply" || notif.type === "bookmark" ? (
        <>
          <Box width={36} display="flex" justifyContent="flex-end" pt={1}>
            <ProfileHoverCard username={primaryActor.username || ""}>
              <Link
                to={primaryActor.username ? `/@${primaryActor.username}` : "/home"}
                style={{ textDecoration: "none" }}
                onClick={(e) => e.stopPropagation()}
              >
                <Avatar
                  $url={primaryActor.avatar_url}
                  $letter={((primaryActor?.display_name || primaryActor?.username || "?")[0] || "?").toUpperCase()}
                  style={{ width: 36, height: 36 }}
                />
              </Link>
            </ProfileHoverCard>
          </Box>
          <Box flex={1} display="flex" flexDirection="row" style={{ minWidth: 0 }}>
            <Box flex={1} style={{ minWidth: 0 }}>
              <Box
                display="flex"
                alignItems="center"
                justifyContent="space-between"
                gap="8px"
                mb="4px"
                style={{ fontSize: "14px", lineHeight: "20px" }}
              >
                <Box display="flex" alignItems="center" gap="4px" flexWrap="wrap">
                  <ProfileHoverCard username={primaryActor.username || ""}>
                    <Link
                      to={`/@${primaryActor.username}`}
                      style={{
                        fontWeight: 700,
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
                  <span style={{ color: "var(--color-fg-muted)", fontSize: "12px" }}>{relativeTime}</span>
                </Box>
                <Box display="flex" alignItems="center" gap="4px" flexShrink={0}>
                  {renderTriageButtons()}
                </Box>
              </Box>
              {notif.post_content && (
                <Box style={{ fontSize: "14px", lineHeight: "20px" }} color="var(--color-fg-muted)">
                  {formatPostContent(notif.post_content)}
                </Box>
              )}
            </Box>
            {thumbnail && (
              <Box width="56px" height="56px" borderRadius="8px" overflow="hidden" ml={2} flexShrink={0}>
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
          <Box width={28} display="flex" justifyContent="center" pt={1}>
            {getIconForType(notif.type)}
          </Box>
          <Box flex={1} style={{ minWidth: 0 }}>
            <Box display="flex" alignItems="center" justifyContent="space-between" gap="8px">
              <AvatarsRow>
                {visibleActors.map((a) => {
                  const avatarEl = (
                    <Avatar
                      key={a.username || a.display_name}
                      $url={a.avatar_url}
                      $letter={((a?.display_name || a?.username || "?")[0] || "?").toUpperCase()}
                      title={a.display_name || a.username || ""}
                    />
                  );
                  if (!a.username) return avatarEl;
                  return (
                    <ProfileHoverCard key={a.username} username={a.username}>
                      <Link
                        to={`/@${a.username}`}
                        style={{ textDecoration: "none" }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        {avatarEl}
                      </Link>
                    </ProfileHoverCard>
                  );
                })}
                {overflowCount > 0 && <AvatarOverflowPill>+{overflowCount}</AvatarOverflowPill>}
              </AvatarsRow>
              <Box display="flex" alignItems="center" gap="4px" flexShrink={0}>
                <span style={{ fontSize: "12px", lineHeight: "16px", color: "var(--color-fg-muted)" }}>
                  {relativeTime}
                </span>
                {renderTriageButtons()}
              </Box>
            </Box>
            <Box mt={1} style={{ fontSize: "14px", lineHeight: "20px" }}>
              {getMessageForType(notif.type, notif.actors, currentUsername)}
            </Box>
            {notif.post_content && (
              <Box mt={1} color="var(--color-fg-muted)" style={{ fontSize: "14px", lineHeight: "20px" }}>
                {formatPostContent(notif.post_content)}
              </Box>
            )}
          </Box>
        </>
      )}
    </NotificationWrapper>
  );
};
