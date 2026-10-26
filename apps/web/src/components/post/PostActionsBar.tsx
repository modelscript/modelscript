// SPDX-License-Identifier: AGPL-3.0-or-later

/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  BookmarkFillIcon,
  BookmarkIcon,
  CommentIcon,
  DownloadIcon,
  GraphBarHorizontalIcon,
  HeartFillIcon,
  HeartIcon,
  LinkIcon,
  PaperclipIcon,
  QuoteIcon,
  ShareIcon,
  SyncIcon,
} from "@primer/octicons-react";
import { Text } from "@primer/react";
import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import AnimatedCount from "../AnimatedCount";
import Box from "../Box";
import { ActionButton, EngActionButton, MenuButton, ViewsLink, formatNumber } from "./styles";

export interface PostActionsBarProps {
  displayPost: any;
  reposted: boolean;
  repostCount: number;
  liked: boolean;
  likeCount: number;
  bookmarked: boolean;
  impressions: number;
  hasAttachment: boolean;
  token: string | null;
  onLike: (e: React.MouseEvent) => void;
  onRepost: (e: React.MouseEvent) => void;
  onBookmark: (e: React.MouseEvent) => void;
  onOpenReply: () => void;
  onOpenQuote: () => void;
  onOpenAnalytics: () => void;
  onOpenLogin: () => void;
  onCopyLink: (e: React.MouseEvent) => void;
  onDownload: (e: React.MouseEvent) => void;
  onPostAsAttachment: (e: React.MouseEvent) => void;
  isDetail?: boolean;
}

export const PostActionsBar: React.FC<PostActionsBarProps> = ({
  displayPost,
  reposted,
  repostCount,
  liked,
  likeCount,
  bookmarked,
  impressions,
  hasAttachment,
  token,
  onLike,
  onRepost,
  onBookmark,
  onOpenReply,
  onOpenQuote,
  onOpenAnalytics,
  onOpenLogin,
  onCopyLink,
  onDownload,
  onPostAsAttachment,
  isDetail,
}) => {
  const navigate = useNavigate();
  const [showRepostMenu, setShowRepostMenu] = useState(false);
  const [showShareMenu, setShowShareMenu] = useState(false);

  const replyButton = (
    <ActionButton
      $color="var(--color-accent-cyan)"
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        if (!token) {
          onOpenLogin();
          return;
        }
        onOpenReply();
      }}
    >
      <div className="icon-wrapper">
        <CommentIcon size={18} />
      </div>
      <Text
        style={{
          position: "absolute",
          left: "36px",
          fontSize: isDetail ? "14px" : "13px",
          paddingRight: isDetail ? "8px" : undefined,
          minWidth: "20px",
          textAlign: "left",
          color: "inherit",
        }}
      >
        <AnimatedCount count={displayPost.reply_count || 0} />
      </Text>
    </ActionButton>
  );

  const repostButtonAndMenu = (
    <Box position="relative">
      <ActionButton
        $active={reposted}
        $color="#00ba7c"
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          if (!token) {
            onOpenLogin();
            return;
          }
          setShowRepostMenu(!showRepostMenu);
        }}
      >
        <div className="icon-wrapper">
          <SyncIcon size={18} />
        </div>
        <Text
          style={{
            position: "absolute",
            left: "36px",
            fontSize: isDetail ? "14px" : "13px",
            paddingRight: isDetail ? "8px" : undefined,
            minWidth: "20px",
            textAlign: "left",
            color: "inherit",
          }}
        >
          <AnimatedCount count={repostCount || 0} />
        </Text>
      </ActionButton>

      {showRepostMenu && (
        <>
          <div
            style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, zIndex: 99 }}
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              setShowRepostMenu(false);
            }}
          />
          <Box
            position="absolute"
            top="100%"
            left="0"
            bg="var(--surface-overlay)"
            border="1px solid var(--color-border)"
            borderRadius="12px"
            boxShadow="0 8px 24px rgba(0, 0, 0, 0.5)"
            style={{ backdropFilter: "blur(12px)" }}
            p={1}
            zIndex={100}
            minWidth="120px"
            display="flex"
            flexDirection="column"
          >
            <button
              onClick={(e) => {
                setShowRepostMenu(false);
                onRepost(e);
              }}
              style={{
                padding: "8px 12px",
                background: "none",
                border: "none",
                textAlign: "left",
                cursor: "pointer",
                fontSize: "14px",
                fontWeight: "500",
                color: "var(--color-fg-default)",
                borderRadius: "8px",
                display: "flex",
                alignItems: "center",
                gap: "8px",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "rgba(255, 255, 255, 0.06)")}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
            >
              <SyncIcon size={14} />
              {reposted ? "Undo Repost" : "Repost"}
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                setShowRepostMenu(false);
                onOpenQuote();
              }}
              style={{
                padding: "8px 12px",
                background: "none",
                border: "none",
                textAlign: "left",
                cursor: "pointer",
                fontSize: "14px",
                fontWeight: "500",
                color: "var(--color-fg-default)",
                borderRadius: "8px",
                display: "flex",
                alignItems: "center",
                gap: "8px",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "rgba(255, 255, 255, 0.06)")}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
            >
              <QuoteIcon size={14} />
              Quote
            </button>
          </Box>
        </>
      )}
    </Box>
  );

  const likeButton = (
    <ActionButton $active={liked} $color="#f91880" onClick={onLike}>
      <div className="icon-wrapper">{liked ? <HeartFillIcon size={18} /> : <HeartIcon size={18} />}</div>
      <Text
        style={{
          position: "absolute",
          left: "36px",
          fontSize: isDetail ? "14px" : "13px",
          paddingRight: isDetail ? "8px" : undefined,
          minWidth: "20px",
          textAlign: "left",
          color: "inherit",
        }}
      >
        <AnimatedCount count={likeCount || 0} />
      </Text>
    </ActionButton>
  );

  const bookmarkAndShareButtons = (
    <Box display="flex" gap={0}>
      <ActionButton $active={bookmarked} $color="var(--color-accent-cyan)" onClick={onBookmark}>
        <div className="icon-wrapper">{bookmarked ? <BookmarkFillIcon size={18} /> : <BookmarkIcon size={18} />}</div>
      </ActionButton>

      <Box position="relative">
        <ActionButton
          $color="var(--color-accent-cyan)"
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
            setShowShareMenu(!showShareMenu);
          }}
        >
          <div className="icon-wrapper">
            <ShareIcon size={18} />
          </div>
        </ActionButton>

        {showShareMenu && (
          <>
            <div
              style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, zIndex: 99 }}
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                setShowShareMenu(false);
              }}
            />
            <Box
              position="absolute"
              top="100%"
              right="0"
              bg="var(--surface-overlay)"
              border="1px solid var(--color-border)"
              borderRadius="12px"
              boxShadow="0 8px 24px rgba(0, 0, 0, 0.5)"
              style={{ backdropFilter: "blur(12px)" }}
              p={1}
              zIndex={100}
              minWidth="200px"
              display="flex"
              flexDirection="column"
            >
              <MenuButton
                onClick={(e) => {
                  setShowShareMenu(false);
                  onCopyLink(e);
                }}
              >
                <LinkIcon size={16} /> Copy link to post
              </MenuButton>
              {hasAttachment && (
                <>
                  <MenuButton
                    onClick={(e) => {
                      setShowShareMenu(false);
                      onDownload(e);
                    }}
                  >
                    <DownloadIcon size={16} /> Download content
                  </MenuButton>
                  <MenuButton
                    onClick={(e) => {
                      setShowShareMenu(false);
                      onPostAsAttachment(e);
                    }}
                  >
                    <PaperclipIcon size={16} /> Post as attachment
                  </MenuButton>
                </>
              )}
            </Box>
          </>
        )}
      </Box>
    </Box>
  );

  if (isDetail) {
    return (
      <>
        <Box display="flex" alignItems="center" fontSize="15px" mb={2} mt={3}>
          <span className="handle-text">
            {new Date(displayPost.created_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
          </span>
          <span className="handle-text" style={{ margin: "0 4px" }}>
            ·
          </span>
          <span className="handle-text">
            {new Date(displayPost.created_at).toLocaleDateString([], {
              month: "short",
              day: "numeric",
              year: "numeric",
            })}
          </span>
          <span className="handle-text" style={{ margin: "0 4px" }}>
            ·
          </span>
          <ViewsLink
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              if (!token) {
                onOpenLogin();
                return;
              }
              onOpenAnalytics();
            }}
            style={{ color: "var(--color-fg-muted)" }}
          >
            <span style={{ fontWeight: "bold", color: "var(--color-fg-default)" }}>
              {formatNumber(displayPost.view_count || 0)}
            </span>{" "}
            <span className="handle-text">Views</span>
          </ViewsLink>
        </Box>

        <Box
          borderTop="1px solid var(--color-border)"
          borderBottom="1px solid var(--color-border)"
          py={2}
          display="flex"
          justifyContent="space-between"
          alignItems="center"
          width="100%"
          style={{ color: "var(--color-fg-muted)" }}
          onClick={(e) => e.preventDefault()}
        >
          {replyButton}
          {repostButtonAndMenu}
          {likeButton}
          {bookmarkAndShareButtons}
        </Box>
      </>
    );
  }

  return (
    <Box
      style={{ marginTop: "10px" }}
      display="flex"
      justifyContent="space-between"
      alignItems="center"
      width="100%"
      maxWidth="100%"
      onClick={(e) => e.preventDefault()}
    >
      {displayPost.artifact_view_id && (
        <EngActionButton
          onClick={(e) => {
            e.stopPropagation();
            navigate(`/${displayPost.username}/status/${displayPost.id}`);
          }}
          style={{ marginRight: "8px" }}
        >
          ▶ Sandbox
        </EngActionButton>
      )}

      {replyButton}
      {repostButtonAndMenu}
      {likeButton}

      {/* Impressions / Analytics */}
      <ActionButton
        $color="var(--color-accent-cyan)"
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          onOpenAnalytics();
        }}
      >
        <div className="icon-wrapper">
          <GraphBarHorizontalIcon size={18} />
        </div>
        <Text
          style={{
            position: "absolute",
            left: "36px",
            fontSize: "13px",
            minWidth: "20px",
            textAlign: "left",
            color: "inherit",
          }}
        >
          <AnimatedCount count={impressions} />
        </Text>
      </ActionButton>

      {bookmarkAndShareButtons}
    </Box>
  );
};
