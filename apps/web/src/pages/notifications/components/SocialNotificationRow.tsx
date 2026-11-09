// SPDX-License-Identifier: AGPL-3.0-or-later

import { ArchiveIcon, BookmarkFillIcon, StarFillIcon, StarIcon } from "@primer/octicons-react";
import React from "react";
import { Link, useNavigate } from "react-router-dom";
import Box from "../../../components/Box";
import ProfileHoverCard from "../../../components/ProfileHoverCard";
import { safeJsonParse } from "../../../util/json";
import { formatPostContent, formatRelativeTime, getActionVerbForType, getMicroBadgeConfig } from "../formatters";
import {
  Avatar,
  AvatarContainer,
  CompactAvatarsGroup,
  MicroReactionBadge,
  NotificationWrapper,
  QuickActionIconButton,
  UnreadDotButton,
} from "../styles";
import type { InboxDensity, NotificationItem } from "../types";

export interface SocialNotificationRowProps {
  notif: NotificationItem;
  currentUsername?: string | undefined;
  selected?: boolean | undefined;
  density?: InboxDensity | undefined;
  onSelect?: ((notif: NotificationItem) => void) | undefined;
  onMarkRead?: ((id: string | number) => void) | undefined;
  onToggleStar?: ((notif: NotificationItem) => void) | undefined;
  onToggleArchive?: ((notif: NotificationItem) => void) | undefined;
}

export const SocialNotificationRow: React.FC<SocialNotificationRowProps> = ({
  notif,
  currentUsername,
  selected,
  density = "compact",
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
  const actorsCount = notif.actors?.length || 1;
  const secondaryActor = notif.actors?.[1];

  let actorNamesText = primaryActor.display_name || primaryActor.username || "Someone";
  if (actorsCount === 2 && secondaryActor) {
    actorNamesText = `${primaryActor.display_name || primaryActor.username} and ${secondaryActor.display_name || secondaryActor.username}`;
  } else if (actorsCount > 2) {
    actorNamesText = `${primaryActor.display_name || primaryActor.username} + ${actorsCount - 1} others`;
  }

  const actionVerb = getActionVerbForType(notif.type);
  const microBadge = getMicroBadgeConfig(notif.type);

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
            <BookmarkFillIcon size={13} />
          ) : notif.starred ? (
            <StarFillIcon size={13} />
          ) : (
            <StarIcon size={13} />
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
          <ArchiveIcon size={13} />
        </QuickActionIconButton>
      )}
      {!notif.read && (
        <UnreadDotButton
          type="button"
          title="Mark as read (U)"
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
      $density={density}
      data-notification-id={String(notif.id)}
      data-unread={!notif.read ? "true" : "false"}
      onClick={handleRowClick}
    >
      {/* ── Left Indicator / Micro Avatars Group ── */}
      {actorsCount >= 2 && secondaryActor ? (
        <CompactAvatarsGroup>
          <Avatar
            $size={20}
            $url={primaryActor.avatar_url}
            $letter={((primaryActor?.display_name || primaryActor?.username || "?")[0] || "?").toUpperCase()}
          />
          <Avatar
            $size={20}
            $url={secondaryActor.avatar_url}
            $letter={((secondaryActor?.display_name || secondaryActor?.username || "?")[0] || "?").toUpperCase()}
          />
          {microBadge && (
            <MicroReactionBadge $bg={microBadge.bg} $color={microBadge.color}>
              {microBadge.icon}
            </MicroReactionBadge>
          )}
        </CompactAvatarsGroup>
      ) : (
        <AvatarContainer>
          <ProfileHoverCard username={primaryActor.username || ""}>
            <Link
              to={primaryActor.username ? `/@${primaryActor.username}` : "/home"}
              style={{ textDecoration: "none" }}
              onClick={(e) => e.stopPropagation()}
            >
              <Avatar
                $size={28}
                $url={primaryActor.avatar_url}
                $letter={((primaryActor?.display_name || primaryActor?.username || "?")[0] || "?").toUpperCase()}
              />
            </Link>
          </ProfileHoverCard>
          {microBadge && (
            <MicroReactionBadge $bg={microBadge.bg} $color={microBadge.color}>
              {microBadge.icon}
            </MicroReactionBadge>
          )}
        </AvatarContainer>
      )}

      {/* ── Right Content: 3-Tier Outlook Hierarchy ── */}
      <Box flex={1} style={{ minWidth: 0 }}>
        {/* Line 1: Actors & Time / Hover Triage */}
        <Box
          display="flex"
          alignItems="center"
          justifyContent="space-between"
          gap="6px"
          style={{ height: "18px", minHeight: "18px", maxHeight: "18px" }}
        >
          <Box
            style={{
              fontWeight: notif.read ? 600 : 700,
              fontSize: "13px",
              lineHeight: "18px",
              color: "var(--color-fg-default)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {primaryActor.username ? (
              <ProfileHoverCard username={primaryActor.username}>
                <Link
                  to={`/@${primaryActor.username}`}
                  style={{
                    color: "inherit",
                    textDecoration: "none",
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  {actorNamesText}
                </Link>
              </ProfileHoverCard>
            ) : (
              actorNamesText
            )}
          </Box>

          <Box
            display="flex"
            alignItems="center"
            gap="4px"
            flexShrink={0}
            style={{ height: "18px", minHeight: "18px", maxHeight: "18px" }}
          >
            <span
              className="notif-row-time"
              style={{
                fontSize: "11.5px",
                lineHeight: "18px",
                color: notif.read ? "var(--color-fg-muted)" : "var(--color-accent-fg)",
                fontWeight: notif.read ? 400 : 600,
                whiteSpace: "nowrap",
              }}
            >
              {relativeTime}
            </span>
            <div className="notif-hover-actions">{renderTriageButtons()}</div>
          </Box>
        </Box>

        {/* Line 2: Subject / Action Verb */}
        <Box
          mt="2px"
          style={{
            height: "16px",
            minHeight: "16px",
            maxHeight: "16px",
            fontSize: "12px",
            lineHeight: "16px",
            fontWeight: notif.read ? 500 : 600,
            color: notif.read ? "var(--color-fg-muted)" : "var(--color-fg-default)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {actionVerb}
        </Box>

        {/* Line 3: Snippet Preview */}
        {notif.post_content && (
          <Box
            mt="2px"
            color="var(--color-fg-muted)"
            style={{
              height: density === "comfortable" ? undefined : "15px",
              minHeight: density === "comfortable" ? undefined : "15px",
              maxHeight: density === "comfortable" ? undefined : "15px",
              fontSize: "11.5px",
              lineHeight: "15px",
              whiteSpace: density === "comfortable" ? "normal" : "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              display: density === "comfortable" ? "-webkit-box" : "block",
              WebkitLineClamp: density === "comfortable" ? 2 : 1,
              WebkitBoxOrient: "vertical",
            }}
          >
            {formatPostContent(notif.post_content)}
          </Box>
        )}
      </Box>

      {/* Thumbnail preview if present */}
      {thumbnail && (
        <Box width="36px" height="36px" borderRadius="6px" overflow="hidden" ml={1} flexShrink={0} mt="2px">
          <img src={thumbnail} style={{ width: "100%", height: "100%", objectFit: "cover" }} alt="attachment preview" />
        </Box>
      )}
    </NotificationWrapper>
  );
};
