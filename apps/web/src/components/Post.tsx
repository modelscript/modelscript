// SPDX-License-Identifier: AGPL-3.0-or-later

import { SyncIcon } from "@primer/octicons-react";
import { Text } from "@primer/react";
import React, { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useNavigate } from "react-router-dom";
import { bookmarkPost, likePost, recordPostView, repostPost } from "../api";
import { useAuth } from "../AuthContext";
import { parseFederatedHandle } from "../util/federation";
import {
  estimateReadingTimeMinutes,
  extractNotebookHeadings,
  isNotebookPost,
  parseNotebookFromContent,
} from "../util/notebook";
import { setupPostDwellObservation } from "../util/post-dwell";
import type { SpatialPin } from "./artifacts/spatial-pin";
import Box from "./Box";
import ErrorBoundary from "./ErrorBoundary";
import { LoginPromptModal } from "./post/LoginPromptModal";
import { PostActionsBar } from "./post/PostActionsBar";
import { PostAnalyticsModal } from "./post/PostAnalyticsModal";
import { PostAuthorHeader } from "./post/PostAuthorHeader";
import { PostBodyContent } from "./post/PostBodyContent";
import { PostQuotedPost } from "./post/PostQuotedPost";
import { PostSignatureModal } from "./post/PostSignatureModal";
import type { PostProps } from "./post/styles";
import { HoverAvatar, PostWrapper, ProfileNameLink } from "./post/styles";
import ProfileHoverCard from "./ProfileHoverCard";
import { useToast } from "./ToastContext";

export { PostMarkdownContent as RenderContent } from "./post/PostMarkdownContent";
export type { PostProps } from "./post/styles";

const ComposeModal = React.lazy(() => import("./ComposeModal"));

const Post: React.FC<PostProps> = ({ post, isDetail, isThread }) => {
  const navigate = useNavigate();
  const { token, user } = useAuth();
  const toast = useToast();
  const basePost = post.repost_post || post;
  const [editedOverrides, setEditedOverrides] = useState<Record<string, any>>({});
  useEffect(() => {
    setEditedOverrides({});
  }, [basePost.id, basePost.content]);
  const displayPost = useMemo(() => ({ ...basePost, ...editedOverrides }), [basePost, editedOverrides]);
  const canEditPost = Boolean(
    token && user && (user.username === displayPost.username || (user as any)?.role === "admin"),
  );

  const [liked, setLiked] = useState(Boolean(displayPost.liked));
  const [likeCount, setLikeCount] = useState(displayPost.like_count);
  const [reposted, setReposted] = useState(Boolean(displayPost.reposted));
  const [repostCount, setRepostCount] = useState(displayPost.repost_count);
  const [bookmarked, setBookmarked] = useState(Boolean(displayPost.bookmarked));
  const [bookmarkCount, setBookmarkCount] = useState(displayPost.bookmark_count || 0);
  const [impressions, setImpressions] = useState<number>(
    displayPost.view_count ?? (displayPost as any).views_count ?? 0,
  );
  const [isDeleted, setIsDeleted] = useState(false);

  useEffect(() => {
    setLiked(Boolean(displayPost.liked));
    setLikeCount(displayPost.like_count);
    setReposted(Boolean(displayPost.reposted));
    setRepostCount(displayPost.repost_count);
    setBookmarked(Boolean(displayPost.bookmarked));
    setBookmarkCount(displayPost.bookmark_count || 0);
    setImpressions(displayPost.view_count ?? (displayPost as any).views_count ?? 0);
  }, [
    displayPost.id,
    displayPost.liked,
    displayPost.like_count,
    displayPost.reposted,
    displayPost.repost_count,
    displayPost.bookmarked,
    displayPost.bookmark_count,
    displayPost.view_count,
  ]);

  const [showPostMenu, setShowPostMenu] = useState(false);
  const [showQuoteModal, setShowQuoteModal] = useState(false);
  const [showReplyModal, setShowReplyModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showAnalyticsModal, setShowAnalyticsModal] = useState(false);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [pendingPin, setPendingPin] = useState<SpatialPin | undefined>(undefined);
  const [showAiDetails, setShowAiDetails] = useState(false);
  const [showSignatureModal, setShowSignatureModal] = useState(false);

  const parsedAuthor = useMemo(() => parseFederatedHandle(displayPost.username), [displayPost.username]);
  const parsedQuoteAuthor = useMemo(
    () => (displayPost.quote_post ? parseFederatedHandle(displayPost.quote_post.username) : null),
    [displayPost.quote_post],
  );

  const remoteOriginUrl = useMemo(() => {
    const target = displayPost.url || displayPost.ap_id;
    if (!target || typeof target !== "string") return null;
    if (!target.startsWith("http://") && !target.startsWith("https://")) return null;
    try {
      const urlObj = new URL(target);
      if (urlObj.hostname !== window.location.hostname && !urlObj.hostname.includes("localhost")) {
        return target;
      }
    } catch {}
    return null;
  }, [displayPost.url, displayPost.ap_id]);

  const signatureDigest =
    (displayPost as any).signature ||
    displayPost.client_signature ||
    displayPost.metadata?.client_signature ||
    displayPost.metadata?.clientSignature ||
    displayPost.metadata?.proof?.proofValue ||
    displayPost.metadata?.proof?.signature ||
    displayPost.metadata?.signature ||
    "";

  const hasSignature = Boolean(signatureDigest);

  const signatureScheme = displayPost.metadata?.proof?.cryptosuite
    ? `Data Integrity (${displayPost.metadata.proof.cryptosuite})`
    : displayPost.client_signature || displayPost.metadata?.client_signature || displayPost.metadata?.clientSignature
      ? "WebCrypto RSASSA-PKCS1-v1_5 / SHA-256"
      : "ActivityPub RFC 9421 / Cavage HTTP Signatures";

  const keyIdentifier =
    displayPost.key_id_string ||
    displayPost.metadata?.key_id_string ||
    displayPost.metadata?.keyIdString ||
    displayPost.metadata?.proof?.verificationMethod ||
    (displayPost.ap_id ? `${displayPost.ap_id}#main-key` : `@${displayPost.username} device-key`);

  const postContainerRef = useRef<HTMLDivElement | null>(null);

  // Record view once per post per session when dwelling in viewport (or immediately on detail view)
  useEffect(() => {
    const postId = displayPost?.id;
    if (!postId) return;

    return setupPostDwellObservation(postContainerRef.current, {
      postId,
      isDetail,
      onView: () => {
        void recordPostView(postId).then((res) => {
          if (res?.counted) {
            setImpressions((prev) => prev + 1);
          }
        });
      },
    });
  }, [displayPost?.id, isDetail, token]);

  const isNotebook = isNotebookPost(displayPost);
  const notebookData = useMemo(
    () =>
      isNotebook
        ? parseNotebookFromContent(displayPost.content, displayPost.artifact_view_id, displayPost.metadata?.notebook)
        : null,
    [isNotebook, displayPost.content, displayPost.artifact_view_id, displayPost.metadata?.notebook],
  );
  const notebookHeadings = useMemo(
    () => (notebookData ? extractNotebookHeadings(notebookData.cells) : []),
    [notebookData],
  );
  const readTimeMinutes = useMemo(
    () => (notebookData ? notebookData.estimatedReadMinutes || estimateReadingTimeMinutes(notebookData.cells) : 1),
    [notebookData],
  );

  const hasAttachment = Boolean(displayPost.artifact_view_id || isNotebookPost(displayPost));

  const handleCopyLink = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    navigator.clipboard.writeText(`${window.location.origin}/${displayPost.username}/status/${displayPost.id}`);
    toast.success("Link copied to clipboard");
  };

  const handleDownload = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const content = displayPost.content || "";
    const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `post-${displayPost.id}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handlePostAsAttachment = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setShowQuoteModal(true);
  };

  const handleLike = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (!token) {
      setShowLoginModal(true);
      return;
    }

    try {
      const data = await likePost(displayPost.id);
      setLiked(data.liked);
      setLikeCount((prev: number) => prev + (data.liked ? 1 : -1));
    } catch (err) {
      console.error(err);
    }
  };

  const handleRepost = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (!token) {
      setShowLoginModal(true);
      return;
    }

    try {
      const data = await repostPost(displayPost.id);
      setReposted(data.reposted);
      setRepostCount((prev: number) => prev + (data.reposted ? 1 : -1));
    } catch (err) {
      console.error(err);
    }
  };

  const handleBookmark = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (!token) {
      setShowLoginModal(true);
      return;
    }

    try {
      const data = await bookmarkPost(displayPost.id);
      setBookmarked(data.bookmarked);
      setBookmarkCount((prev: number) => prev + (data.bookmarked ? 1 : -1));
      window.dispatchEvent(
        new CustomEvent("modelscript:bookmark-toggled", {
          detail: { postId: displayPost.id, bookmarked: data.bookmarked },
        }),
      );
    } catch (err) {
      console.error(err);
    }
  };

  const authorHeaderProps = {
    displayPost,
    isDetail: Boolean(isDetail),
    parsedAuthor,
    hasSignature,
    isNotebook,
    notebookData,
    showPostMenu,
    setShowPostMenu,
    canEditPost,
    onOpenEditModal: () => setShowEditModal(true),
    onOpenSignatureModal: () => setShowSignatureModal(true),
    onOpenLoginModal: () => setShowLoginModal(true),
    onPostDeleted: () => {
      if (isDetail) {
        navigate("/");
      } else {
        setIsDeleted(true);
      }
    },
    token,
    remoteOriginUrl,
  };

  const bodyContentProps = {
    displayPost,
    isDetailView: Boolean(isDetail),
    isNotebook,
    notebookData,
    notebookHeadings,
    readTimeMinutes,
    canEditPost,
    onOpenEditModal: () => setShowEditModal(true),
    onPinCreated: (pin: SpatialPin) => {
      setPendingPin(pin);
      setShowReplyModal(true);
    },
    showAiDetails,
    setShowAiDetails,
  };

  const actionsBarProps = {
    displayPost,
    reposted,
    repostCount,
    liked,
    likeCount,
    bookmarked,
    impressions,
    hasAttachment,
    token,
    onLike: handleLike,
    onRepost: handleRepost,
    onBookmark: handleBookmark,
    onOpenReply: () => setShowReplyModal(true),
    onOpenQuote: () => setShowQuoteModal(true),
    onOpenAnalytics: () => setShowAnalyticsModal(true),
    onOpenLogin: () => setShowLoginModal(true),
    onCopyLink: handleCopyLink,
    onDownload: handleDownload,
    onPostAsAttachment: handlePostAsAttachment,
    isDetail: Boolean(isDetail),
  };

  if (isDeleted) {
    return null;
  }

  const hasActiveModal =
    showLoginModal || showQuoteModal || showReplyModal || showEditModal || showAnalyticsModal || showSignatureModal;

  const modalsContent = hasActiveModal ? (
    <Suspense fallback={null}>
      {showLoginModal && <LoginPromptModal onClose={() => setShowLoginModal(false)} />}
      {showQuoteModal && (
        <ComposeModal
          quotePost={displayPost}
          onClose={() => setShowQuoteModal(false)}
          onPostCreated={(reply) => navigate(`/${reply.author?.username || reply.username}/status/${reply.id}`)}
        />
      )}
      {showReplyModal && (
        <ComposeModal
          replyToPost={displayPost}
          pendingPin={pendingPin}
          onClose={() => {
            setShowReplyModal(false);
            setPendingPin(undefined);
          }}
          onPostCreated={(reply) => navigate(`/${reply.author?.username || reply.username}/status/${reply.id}`)}
        />
      )}
      {showEditModal && (
        <ComposeModal
          initialState={{
            editPostId: displayPost.id,
            content: displayPost.content,
            initialContent: displayPost.content,
            artifactId: displayPost.artifact_view_id,
            notebookMode: isNotebook,
            notebookTitle: notebookData?.title || "",
            notebookSummary: notebookData?.summary || "",
            notebookDifficulty: notebookData?.difficulty,
            notebookSeries: notebookData?.series || "",
            notebookDialect: notebookData?.dialect || "",
            notebookCompanionRepo: notebookData?.companionRepo || "",
            notebookCells: notebookData?.cells,
          }}
          onClose={() => setShowEditModal(false)}
          onPostCreated={(updatedPost) => {
            setShowEditModal(false);
            if (updatedPost && typeof updatedPost === "object") {
              setEditedOverrides((prev) => ({
                ...prev,
                ...updatedPost,
                content: updatedPost.content ?? prev.content ?? displayPost.content,
              }));
            }
          }}
        />
      )}
      {showAnalyticsModal && (
        <PostAnalyticsModal
          postId={displayPost.id}
          displayPost={{ ...displayPost, view_count: impressions }}
          liked={liked}
          likeCount={likeCount}
          reposted={reposted}
          repostCount={repostCount}
          bookmarkCount={bookmarkCount}
          onClose={() => setShowAnalyticsModal(false)}
        />
      )}
      {showSignatureModal && (
        <PostSignatureModal
          displayPost={displayPost}
          signatureScheme={signatureScheme}
          keyIdentifier={keyIdentifier}
          signatureDigest={signatureDigest}
          onClose={() => setShowSignatureModal(false)}
        />
      )}
    </Suspense>
  ) : null;

  const modals =
    modalsContent && typeof document !== "undefined" ? createPortal(modalsContent, document.body) : modalsContent;

  if (isDetail) {
    return (
      <>
        <PostWrapper $isDetail={true} $isThread={isThread}>
          <PostAuthorHeader {...authorHeaderProps} />
          <PostBodyContent {...bodyContentProps} />
          {displayPost.quote_post && (
            <PostQuotedPost quotePost={displayPost.quote_post} parsedQuoteAuthor={parsedQuoteAuthor as any} />
          )}
          <PostActionsBar {...actionsBarProps} />
        </PostWrapper>
        {modals}
      </>
    );
  }

  return (
    <>
      <div
        ref={postContainerRef}
        onClick={(e) => {
          if ((e.target as HTMLElement).closest("a, button")) return;
          navigate(`/${displayPost.username}/status/${displayPost.id}`);
        }}
        style={{ textDecoration: "none", color: "inherit", display: "block" }}
      >
        <PostWrapper $isDetail={false} $isThread={isThread}>
          <Box
            display="flex"
            flexDirection="column"
            gap={1}
            flex={1}
            style={{ minWidth: 0, maxWidth: "100%", width: "100%" }}
          >
            {post.repost_post && (
              <Box
                display="flex"
                alignItems="center"
                gap={3}
                style={{ color: "var(--color-fg-muted)", lineHeight: "16px", fontWeight: 700 }}
                fontSize="13px"
                mb={0.5}
              >
                <Box
                  display="flex"
                  justifyContent="flex-end"
                  alignItems="center"
                  style={{ width: "40px", flexShrink: 0 }}
                >
                  <SyncIcon size={15} />
                </Box>
                <Box flex={1} style={{ minWidth: 0 }}>
                  <Link
                    to={`/${post.username}`}
                    style={{ color: "inherit", textDecoration: "none", fontWeight: 700 }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {post.display_name || post.username} reposted
                  </Link>
                </Box>
              </Box>
            )}
            <Box display="flex" gap={3} style={{ minWidth: 0, maxWidth: "100%", width: "100%" }}>
              <Box display="flex" flexDirection="column" alignItems="center" position="relative">
                <ProfileHoverCard username={displayPost.username}>
                  <ProfileNameLink to={`/${displayPost.username}`} onClick={(e) => e.stopPropagation()}>
                    <HoverAvatar $url={displayPost.avatar_url}>
                      {!displayPost.avatar_url && displayPost.username.charAt(0).toUpperCase()}
                    </HoverAvatar>
                  </ProfileNameLink>
                </ProfileHoverCard>
                {isThread && (
                  <div
                    style={{
                      position: "absolute",
                      top: "44px",
                      bottom: "-24px",
                      width: "3px",
                      backgroundColor: "var(--color-border-strong)",
                      borderRadius: "2px",
                    }}
                  />
                )}
              </Box>
              <Box flex={1} style={{ minWidth: 0, maxWidth: "100%" }}>
                <PostAuthorHeader {...authorHeaderProps} />
                <PostBodyContent {...bodyContentProps} />
                {displayPost.quote_post && (
                  <PostQuotedPost quotePost={displayPost.quote_post} parsedQuoteAuthor={parsedQuoteAuthor as any} />
                )}
                <PostActionsBar {...actionsBarProps} />
              </Box>
            </Box>
          </Box>
        </PostWrapper>
      </div>
      {modals}
    </>
  );
};

const PostWithErrorBoundary: React.FC<PostProps> = (props) => (
  <ErrorBoundary
    fallback={
      <Box
        p={3}
        style={{
          borderBottom: "1px solid var(--color-border-default)",
          color: "var(--color-fg-muted)",
          fontSize: "13px",
        }}
      >
        <Text>Unable to display this post.</Text>
      </Box>
    }
  >
    <Post {...props} />
  </ErrorBoundary>
);

export default PostWithErrorBoundary;
