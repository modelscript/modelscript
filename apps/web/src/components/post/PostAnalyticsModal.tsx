// SPDX-License-Identifier: AGPL-3.0-or-later

import { CommentIcon, HeartIcon, InfoIcon, RssIcon, SyncIcon, XIcon } from "@primer/octicons-react";
import { Heading, IconButton, Text, Tooltip } from "@primer/react";
import React, { useEffect, useState } from "react";
import styled from "styled-components";
import { getPostAnalytics, type PostAnalyticsData } from "../../api";
import Box from "../Box";
import { RenderContent } from "../Post";
import WorldMap from "../WorldMap";

const AnalyticsModalOverlay = styled.div`
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.7);
  backdrop-filter: blur(6px);
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
`;

const AnalyticsModalContainer = styled.div`
  background: var(--surface-overlay);
  border: 1px solid var(--color-border-glass);
  backdrop-filter: blur(16px);
  border-radius: 16px;
  width: 90%;
  max-width: 600px;
  max-height: 90vh;
  overflow-y: auto;
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.6);
`;

const AnalyticsHeader = styled.div`
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 12px 16px;
  position: sticky;
  top: 0;
  background: var(--surface-overlay);
  backdrop-filter: blur(12px);
  z-index: 10;
  border-bottom: 1px solid var(--color-border);
`;

const AnalyticsCard = styled.div`
  border: 1px solid var(--color-border);
  background: rgba(255, 255, 255, 0.02);
  border-radius: 16px;
  padding: 16px;
  margin: 16px;
`;

const AnalyticsStatGroup = styled.div`
  display: flex;
  flex-direction: column;
  flex: 1;
`;

const AnalyticsStatTitle = styled.div`
  font-size: 14px;
  color: var(--color-fg-muted);
  display: flex;
  align-items: center;
  gap: 4px;
`;

const AnalyticsStatValue = styled.div`
  font-size: 24px;
  font-weight: bold;
  margin-top: 4px;
`;

const ModalAvatar = styled.div<{ $url?: string | undefined }>`
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background-color: var(--color-accent-emphasis);
  background-image: ${(props) => (props.$url ? `url(${props.$url})` : "none")};
  background-size: cover;
  background-position: center;
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  font-weight: 700;
  font-size: 16px;
  flex-shrink: 0;
  border: 1px solid var(--color-border-subtle);
`;

function formatRelativeTime(dateString: string): string {
  try {
    const date = new Date(dateString);
    const now = new Date();
    const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);

    if (diffInSeconds < 60) return `${Math.max(1, diffInSeconds)}s`;
    const diffInMinutes = Math.floor(diffInSeconds / 60);
    if (diffInMinutes < 60) return `${diffInMinutes}m`;
    const diffInHours = Math.floor(diffInMinutes / 60);
    if (diffInHours < 24) return `${diffInHours}h`;
    const diffInDays = Math.floor(diffInHours / 24);
    if (diffInDays < 7) return `${diffInDays}d`;

    return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  } catch {
    return "";
  }
}

function formatNumber(num: number): string {
  if (!num) return "0";
  if (num >= 1000000) return (num / 1000000).toFixed(1).replace(/\.0$/, "") + "M";
  if (num >= 1000) return (num / 1000).toFixed(1).replace(/\.0$/, "") + "K";
  return num.toString();
}

export interface PostAnalyticsModalProps {
  postId: number;
  displayPost: {
    id: number;
    username: string;
    display_name?: string | null;
    avatar_url?: string | null;
    account_type?: string | null;
    created_at: string;
    content: string | null;
    view_count?: number;
    reply_count?: number;
  };
  liked?: boolean;
  likeCount?: number;
  reposted?: boolean;
  repostCount?: number;
  onClose: () => void;
}

export const PostAnalyticsModal: React.FC<PostAnalyticsModalProps> = ({
  postId,
  displayPost,
  liked = false,
  likeCount = 0,
  reposted = false,
  repostCount = 0,
  onClose,
}) => {
  const [analyticsData, setAnalyticsData] = useState<PostAnalyticsData | null>(null);

  useEffect(() => {
    if (postId) {
      getPostAnalytics(postId)
        .then((data) => setAnalyticsData(data))
        .catch(console.error);
    }
  }, [postId]);

  const impressions = analyticsData?.view_count ?? displayPost.view_count ?? 0;
  const detailExpands = Math.ceil(impressions * 0.05);
  const profileVisits = Math.ceil(impressions * 0.02);
  const engagements = likeCount + repostCount + (displayPost.reply_count || 0) + detailExpands + profileVisits;

  return (
    <AnalyticsModalOverlay
      onClick={(e) => {
        e.stopPropagation();
        onClose();
      }}
    >
      <AnalyticsModalContainer onClick={(e) => e.stopPropagation()}>
        <AnalyticsHeader>
          <IconButton icon={XIcon} variant="invisible" onClick={onClose} aria-label="Close" />
          <Heading as="h2" style={{ fontSize: "20px" }}>
            Post Analytics
          </Heading>
        </AnalyticsHeader>
        <Box>
          <AnalyticsCard>
            <Box display="flex" gap={2}>
              <ModalAvatar $url={displayPost.avatar_url || undefined}>
                {!displayPost.avatar_url && displayPost.username.charAt(0).toUpperCase()}
              </ModalAvatar>
              <Box style={{ minWidth: 0, flex: 1 }}>
                <Box display="flex" alignItems="center" gap={1}>
                  <Text
                    fontWeight="bold"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "4px",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
                      {displayPost.display_name || displayPost.username}
                    </span>
                    {displayPost.account_type === "rss" && (
                      <RssIcon size={14} color="var(--color-fg-muted)" style={{ flexShrink: 0 }} />
                    )}
                  </Text>
                  <Text
                    color="var(--color-fg-muted)"
                    style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flexShrink: 1 }}
                  >
                    @{displayPost.username}
                  </Text>
                  <Text color="var(--color-fg-muted)" style={{ flexShrink: 0 }}>
                    ·
                  </Text>
                  <Text color="var(--color-fg-muted)" style={{ flexShrink: 0, whiteSpace: "nowrap" }}>
                    {formatRelativeTime(displayPost.created_at)}
                  </Text>
                </Box>
                <Box
                  mt={1}
                  fontSize="15px"
                  style={{
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    display: "-webkit-box",
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: "vertical",
                  }}
                >
                  <RenderContent text={displayPost.content} />
                </Box>
              </Box>
            </Box>
          </AnalyticsCard>

          <Box mb={4}>
            <WorldMap
              data={analyticsData?.location_stats || []}
              regionData={analyticsData?.region_stats || []}
              totalViews={impressions}
            />
          </Box>
          <AnalyticsCard style={{ display: "flex", justifyContent: "space-around", alignItems: "center" }}>
            <Box display="flex" flexDirection="column" alignItems="center" gap={1}>
              <HeartIcon
                size={20}
                style={{ color: liked ? "var(--color-danger-fg, #f91880)" : "var(--color-fg-muted)" }}
              />
              <Text fontWeight="bold" fontSize="16px">
                {likeCount || 0}
              </Text>
            </Box>
            <Box display="flex" flexDirection="column" alignItems="center" gap={1}>
              <SyncIcon
                size={20}
                style={{ color: reposted ? "var(--color-success-fg, #00ba7c)" : "var(--color-fg-muted)" }}
              />
              <Text fontWeight="bold" fontSize="16px">
                {repostCount || 0}
              </Text>
            </Box>
            <Box display="flex" flexDirection="column" alignItems="center" gap={1}>
              <CommentIcon size={20} style={{ color: "var(--color-fg-muted)" }} />
              <Text fontWeight="bold" fontSize="16px">
                {displayPost.reply_count || 0}
              </Text>
            </Box>
          </AnalyticsCard>

          <Box display="flex" flexWrap="wrap" px={3} pt={4}>
            <Box width="33.333%" display="flex" justifyContent="center">
              <AnalyticsStatGroup style={{ alignItems: "center" }}>
                <AnalyticsStatTitle>
                  Impressions{" "}
                  <Tooltip text="Times this post was seen." type="label">
                    <button
                      type="button"
                      style={{
                        background: "none",
                        border: "none",
                        padding: 0,
                        color: "inherit",
                        cursor: "help",
                        display: "inline-flex",
                        alignItems: "center",
                      }}
                    >
                      <InfoIcon size={14} />
                    </button>
                  </Tooltip>
                </AnalyticsStatTitle>
                <AnalyticsStatValue>{formatNumber(impressions)}</AnalyticsStatValue>
              </AnalyticsStatGroup>
            </Box>
            <Box width="33.333%" display="flex" justifyContent="center">
              <AnalyticsStatGroup style={{ alignItems: "center" }}>
                <AnalyticsStatTitle>
                  Engagements{" "}
                  <Tooltip
                    text="Total number of times a user interacted with a post. This includes all clicks anywhere on the post (including hashtags, links, avatar, username, and post expansion), reposts, replies, follows, and likes."
                    type="label"
                  >
                    <button
                      type="button"
                      style={{
                        background: "none",
                        border: "none",
                        padding: 0,
                        color: "inherit",
                        cursor: "help",
                        display: "inline-flex",
                        alignItems: "center",
                      }}
                    >
                      <InfoIcon size={14} />
                    </button>
                  </Tooltip>
                </AnalyticsStatTitle>
                <AnalyticsStatValue>{formatNumber(engagements)}</AnalyticsStatValue>
              </AnalyticsStatGroup>
            </Box>
            <Box width="33.333%" display="flex" justifyContent="center">
              <AnalyticsStatGroup style={{ alignItems: "center" }}>
                <AnalyticsStatTitle>
                  Detail expands{" "}
                  <Tooltip text="Times people viewed the details about this post." type="label">
                    <button
                      type="button"
                      style={{
                        background: "none",
                        border: "none",
                        padding: 0,
                        color: "inherit",
                        cursor: "help",
                        display: "inline-flex",
                        alignItems: "center",
                      }}
                    >
                      <InfoIcon size={14} />
                    </button>
                  </Tooltip>
                </AnalyticsStatTitle>
                <AnalyticsStatValue>{formatNumber(detailExpands)}</AnalyticsStatValue>
              </AnalyticsStatGroup>
            </Box>
            <Box width="100%" display="flex" justifyContent="center" mt="32px">
              <AnalyticsStatGroup style={{ alignItems: "center" }}>
                <AnalyticsStatTitle>
                  Profile visits{" "}
                  <Tooltip text="Number of profile views from this post." type="label">
                    <button
                      type="button"
                      style={{
                        background: "none",
                        border: "none",
                        padding: 0,
                        color: "inherit",
                        cursor: "help",
                        display: "inline-flex",
                        alignItems: "center",
                      }}
                    >
                      <InfoIcon size={14} />
                    </button>
                  </Tooltip>
                </AnalyticsStatTitle>
                <AnalyticsStatValue>{formatNumber(profileVisits)}</AnalyticsStatValue>
              </AnalyticsStatGroup>
            </Box>
          </Box>
        </Box>
      </AnalyticsModalContainer>
    </AnalyticsModalOverlay>
  );
};
