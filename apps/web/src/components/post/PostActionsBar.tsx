// SPDX-License-Identifier: AGPL-3.0-or-later

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
import { Tooltip } from "@primer/react";
import React, { useMemo, useRef, useState } from "react";
import { useClickOutside } from "../../hooks/useClickOutside";
import { buildCitationFromPost } from "../../util/citations";
import AnimatedCount from "../AnimatedCount";
import Box from "../Box";
import { CitationModal } from "../citations/CitationModal";
import { ActionButton, MenuButton, ViewsLink, formatNumber } from "./styles";

export interface PostActionsBarProps {
  displayPost: any;
  reposted: boolean;
  repostCount: number;
  liked: boolean;
  likeCount: number;
  bookmarked: boolean;
  bookmarkCount?: number;
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
  bookmarkCount,
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
  const [showRepostMenu, setShowRepostMenu] = useState(false);
  const [showShareMenu, setShowShareMenu] = useState(false);
  const [showCitationModal, setShowCitationModal] = useState(false);
  const repostContainerRef = useRef<HTMLDivElement>(null);
  const shareContainerRef = useRef<HTMLDivElement>(null);

  const isLiked = Boolean(token && liked);
  const isReposted = Boolean(token && reposted);
  const isBookmarked = Boolean(token && bookmarked);

  const citationTarget = useMemo(
    () =>
      buildCitationFromPost({
        id: displayPost?.id || 0,
        content: displayPost?.content,
        author_username: displayPost?.username || displayPost?.author_username,
        author_display_name: displayPost?.display_name || displayPost?.author_display_name,
        created_at: displayPost?.created_at,
        metadata: displayPost?.metadata,
      }),
    [
      displayPost?.id,
      displayPost?.content,
      displayPost?.username,
      displayPost?.author_username,
      displayPost?.display_name,
      displayPost?.author_display_name,
      displayPost?.created_at,
      displayPost?.metadata,
    ],
  );

  useClickOutside(repostContainerRef, () => setShowRepostMenu(false), showRepostMenu);
  useClickOutside(shareContainerRef, () => setShowShareMenu(false), showShareMenu);

  const replyButton = (
    <Tooltip text="Reply" direction="n">
      <ActionButton
        aria-label="Reply"
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
        <span className="action-count">
          <AnimatedCount count={displayPost.reply_count || 0} />
        </span>
      </ActionButton>
    </Tooltip>
  );

  const repostButtonAndMenu = (
    <Box ref={repostContainerRef} position="relative" style={{ zIndex: showRepostMenu ? 200 : undefined }}>
      <Tooltip text={isReposted ? "Undo repost" : "Repost"} direction="n">
        <ActionButton
          aria-label={isReposted ? "Undo repost" : "Repost"}
          $active={isReposted}
          $color="#00ba7c"
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
            if (!token) {
              onOpenLogin();
              return;
            }
            setShowShareMenu(false);
            setShowRepostMenu(!showRepostMenu);
          }}
        >
          <div className="icon-wrapper">
            <SyncIcon size={18} />
          </div>
          <span className="action-count">
            <AnimatedCount count={repostCount || 0} />
          </span>
        </ActionButton>
      </Tooltip>

      {showRepostMenu && (
        <Box
          data-post-menu-open="true"
          position="absolute"
          top="calc(100% + 4px)"
          left="0"
          bg="var(--surface-overlay)"
          border="1px solid var(--color-border)"
          borderRadius="12px"
          boxShadow="0 8px 24px rgba(0, 0, 0, 0.5)"
          style={{ backdropFilter: "blur(12px)" }}
          p={1}
          zIndex={1000}
          minWidth="140px"
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
            {isReposted ? "Undo Repost" : "Repost"}
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
      )}
    </Box>
  );

  const likeButton = (
    <Tooltip text={isLiked ? "Unlike" : "Like"} direction="n">
      <ActionButton
        aria-label={isLiked ? "Unlike" : "Like"}
        $active={isLiked}
        $color="#f91880"
        onClick={(e) => {
          if (!token) {
            e.stopPropagation();
            e.preventDefault();
            onOpenLogin();
            return;
          }
          onLike(e);
        }}
      >
        <div className="icon-wrapper">{isLiked ? <HeartFillIcon size={18} /> : <HeartIcon size={18} />}</div>
        <span className="action-count">
          <AnimatedCount count={likeCount || 0} />
        </span>
      </ActionButton>
    </Tooltip>
  );

  const bookmarkButton = (
    <Tooltip text={isBookmarked ? "Remove bookmark" : "Bookmark"} direction="n">
      <ActionButton
        aria-label={isBookmarked ? "Remove bookmark" : "Bookmark"}
        $active={isBookmarked}
        $color="var(--color-accent-cyan)"
        onClick={(e) => {
          if (!token) {
            e.stopPropagation();
            e.preventDefault();
            onOpenLogin();
            return;
          }
          onBookmark(e);
        }}
      >
        <div className="icon-wrapper">{isBookmarked ? <BookmarkFillIcon size={18} /> : <BookmarkIcon size={18} />}</div>
        {isDetail && (
          <span className="action-count">
            <AnimatedCount count={bookmarkCount ?? displayPost.bookmark_count ?? 0} />
          </span>
        )}
      </ActionButton>
    </Tooltip>
  );

  const shareButtonAndMenu = (
    <Box ref={shareContainerRef} position="relative" style={{ zIndex: showShareMenu ? 200 : undefined }}>
      <Tooltip text="Share" direction="n">
        <ActionButton
          aria-label="Share"
          $color="var(--color-accent-cyan)"
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
            setShowRepostMenu(false);
            setShowShareMenu(!showShareMenu);
          }}
        >
          <div className="icon-wrapper">
            <ShareIcon size={18} />
          </div>
        </ActionButton>
      </Tooltip>

      {showShareMenu && (
        <Box
          data-post-menu-open="true"
          position="absolute"
          top="calc(100% + 4px)"
          right="0"
          bg="var(--surface-overlay)"
          border="1px solid var(--color-border)"
          borderRadius="12px"
          boxShadow="0 8px 24px rgba(0, 0, 0, 0.5)"
          style={{ backdropFilter: "blur(12px)" }}
          p={1}
          zIndex={1000}
          minWidth="200px"
          display="flex"
          flexDirection="column"
        >
          {typeof navigator !== "undefined" && typeof navigator.share === "function" && (
            <MenuButton
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                setShowShareMenu(false);
                const postUrl = `${window.location.origin}/@${displayPost.username || "post"}/status/${displayPost.id}`;
                navigator
                  .share({
                    title: `Post by @${displayPost.username || "user"} on Ansatz`,
                    url: postUrl,
                  })
                  .catch(() => {});
              }}
            >
              <ShareIcon size={16} /> Share post via…
            </MenuButton>
          )}
          <MenuButton
            onClick={(e) => {
              setShowShareMenu(false);
              onCopyLink(e);
            }}
          >
            <LinkIcon size={16} /> Copy link to post
          </MenuButton>
          <MenuButton
            data-testid={`cite-post-menu-btn-${displayPost.id}`}
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              setShowShareMenu(false);
              setShowCitationModal(true);
            }}
          >
            <QuoteIcon size={16} /> Cite post (APA, BibTeX, RIS…)
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
      )}
    </Box>
  );

  const citeButton = (
    <Tooltip text="Cite post (APA, MLA, IEEE, BibTeX, RIS...)" direction="n">
      <ActionButton
        aria-label="Cite post"
        data-testid={`cite-post-btn-${displayPost.id}`}
        $color="var(--color-accent-cyan)"
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          setShowRepostMenu(false);
          setShowShareMenu(false);
          setShowCitationModal(true);
        }}
      >
        <div className="icon-wrapper">
          <QuoteIcon size={17} />
        </div>
      </ActionButton>
    </Tooltip>
  );

  const bookmarkAndShareButtons = (
    <Box display="flex" gap={0} alignItems="center">
      {citeButton}
      {bookmarkButton}
      {shareButtonAndMenu}
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
          <Tooltip text="View post analytics" direction="n">
            <ViewsLink
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                onOpenAnalytics();
              }}
              style={{ color: "var(--color-fg-muted)" }}
            >
              <span style={{ fontWeight: "bold", color: "var(--color-fg-default)" }}>
                {formatNumber(impressions || displayPost.view_count || 0)}
              </span>{" "}
              <span className="handle-text">Views</span>
            </ViewsLink>
          </Tooltip>
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
          {citeButton}
          {bookmarkButton}
          {shareButtonAndMenu}
        </Box>
        {showCitationModal && (
          <CitationModal
            isOpen={showCitationModal}
            onClose={() => setShowCitationModal(false)}
            target={citationTarget}
          />
        )}
      </>
    );
  }

  return (
    <>
      <Box
        style={{ marginTop: "10px" }}
        display="flex"
        justifyContent="space-between"
        alignItems="center"
        width="100%"
        maxWidth="100%"
        onClick={(e) => e.preventDefault()}
      >
        {replyButton}
        {repostButtonAndMenu}
        {likeButton}

        {/* Impressions / Analytics */}
        <Tooltip text="View post analytics" direction="n">
          <ActionButton
            aria-label="View post analytics"
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
            <span className="action-count">
              <AnimatedCount count={impressions} />
            </span>
          </ActionButton>
        </Tooltip>

        {bookmarkAndShareButtons}
      </Box>
      {showCitationModal && (
        <CitationModal isOpen={showCitationModal} onClose={() => setShowCitationModal(false)} target={citationTarget} />
      )}
    </>
  );
};
