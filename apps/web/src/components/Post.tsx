/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import {
  BlockedIcon,
  BookmarkFillIcon,
  BookmarkIcon,
  CommentIcon,
  DownloadIcon,
  GraphBarHorizontalIcon,
  GraphIcon,
  HeartFillIcon,
  HeartIcon,
  HubotIcon,
  InfoIcon,
  KebabHorizontalIcon,
  LinkIcon,
  MarkGithubIcon,
  MuteIcon,
  PaperclipIcon,
  PersonAddIcon,
  QuoteIcon,
  ReportIcon,
  RssIcon,
  ShareIcon,
  SyncIcon,
  XIcon,
} from "@primer/octicons-react";
import { Heading, IconButton, Text, Tooltip } from "@primer/react";
import DOMPurify from "dompurify";
import { marked } from "marked";
import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useNavigate } from "react-router-dom";
import styled from "styled-components";
import { useAuth } from "../AuthContext";
import { API_BASE_URL } from "../config";
import AnimatedCount from "./AnimatedCount";
import ArtifactViewCard from "./artifacts/ArtifactViewCard";
import type { SpatialPin } from "./artifacts/spatial-pin";
import Box from "./Box";
import ComposeModal from "./ComposeModal";
import ProfileHoverCard from "./ProfileHoverCard";
import type { LocationStat } from "./WorldMap";
import WorldMap from "./WorldMap";

function formatRelativeTime(dateString: string): string {
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

const PostWrapper = styled.div<{ $isDetail?: boolean; $isThread?: boolean }>`
  display: flex;
  flex-direction: ${(props) => (props.$isDetail ? "column" : "row")};
  gap: 12px;
  padding: 16px;
  border-bottom: ${(props) => (props.$isDetail || props.$isThread ? "none" : "1px solid var(--color-border)")};
  transition: background-color 0.2s;
  cursor: ${(props) => (props.$isDetail ? "default" : "pointer")};

  &:hover {
    background-color: ${(props) => (props.$isDetail ? "transparent" : "var(--color-canvas-subtle)")};
  }
`;

const Avatar = styled.div<{ $url?: string }>`
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background-color: var(--color-accent-emphasis);
  background-image: ${(props) => (props.$url ? `url("${props.$url}")` : "none")};
  background-size: cover;
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  font-weight: bold;
  flex-shrink: 0;
`;

const HoverAvatar = styled(Avatar)`
  &:hover {
    filter: brightness(0.85);
  }
`;

const ProfileNameLink = styled(Link)`
  color: inherit;
  text-decoration: none;
  &:hover {
    text-decoration: underline;
  }
`;

const QuoteWrapper = styled.div`
  margin-top: 8px;
  padding: 12px;
  border: 1px solid var(--color-border-subtle);
  border-radius: 12px;
  &:hover {
    background-color: var(--color-canvas-subtle);
  }
`;

const ViewsLink = styled.span`
  cursor: pointer;
  &:hover {
    text-decoration: underline;
  }
`;

const ActionButton = styled.button<{ $active?: boolean; $color?: string; $noHoverColor?: boolean }>`
  display: flex;
  align-items: center;
  background: none;
  border: none;
  color: ${(props) => (props.$active ? props.$color : "#536471 !important")};
  cursor: pointer;
  padding: 0;
  position: relative;
  transition: color 0.2s;
  margin-left: -8px;

  &:hover {
    color: ${(props) =>
      props.$noHoverColor ? "var(--color-fg-default)" : props.$color || "var(--color-accent-emphasis)"};
  }

  .icon-wrapper {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border-radius: 50%;
    transition: background-color 0.2s;
  }

  &:hover .icon-wrapper {
    background-color: ${(props) =>
      props.$noHoverColor
        ? "rgba(128, 128, 128, 0.15)"
        : props.$color
          ? `${props.$color}22`
          : "rgba(128, 128, 128, 0.15)"};
  }

  .icon-wrapper svg {
    fill: ${(props) => (props.$active ? props.$color : "#536471")} !important;
    color: ${(props) => (props.$active ? props.$color : "#536471")} !important;
    transition:
      fill 0.2s,
      color 0.2s;
  }

  &:hover .icon-wrapper svg {
    fill: ${(props) =>
      props.$noHoverColor ? "var(--color-fg-default)" : props.$color || "var(--color-accent-emphasis)"} !important;
    color: ${(props) =>
      props.$noHoverColor ? "var(--color-fg-default)" : props.$color || "var(--color-accent-emphasis)"} !important;
  }
`;

const MenuButton = styled.button`
  padding: 12px 16px;
  background: none;
  border: none;
  text-align: left;
  cursor: pointer;
  font-size: 15px;
  font-weight: bold;
  color: var(--color-fg-default);
  border-radius: 8px;
  display: flex;
  align-items: center;
  gap: 12px;
  transition: background-color 0.2s;

  &:hover {
    background-color: var(--color-action-list-item-default-hover-bg, rgba(128, 128, 128, 0.15));
  }
`;

const AnalyticsModalOverlay = styled.div`
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.4);
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
`;

const AnalyticsModalContainer = styled.div`
  background: var(--color-bg-primary, #ffffff);
  border-radius: 16px;
  width: 90%;
  max-width: 600px;
  max-height: 90vh;
  overflow-y: auto;
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.15);
  display: flex;
  flex-direction: column;
  padding-bottom: 32px;
`;

const AnalyticsHeader = styled.div`
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 12px 16px;
  position: sticky;
  top: 0;
  background: var(--color-bg-primary, #ffffff);
  z-index: 10;
  border-bottom: 1px solid var(--color-border-subtle);
`;

const AnalyticsCard = styled.div`
  border: 1px solid var(--color-border);
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

interface PostProps {
  post: any;
  isDetail?: boolean;
  isThread?: boolean;
}

const MarkdownContainer = styled.div`
  margin: 0;
  p {
    margin-top: 0;
    margin-bottom: 0;
  }
`;

const GitLabIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path
      d="M15.82 7.42L14.07 2.05C13.98 1.77 13.58 1.77 13.49 2.05L11.83 7.15H4.17L2.51 2.05C2.42 1.77 2.02 1.77 1.93 2.05L0.18 7.42C0.09 7.69 0.19 8.01 0.43 8.18L8 13.68L15.57 8.18C15.81 8.01 15.91 7.69 15.82 7.42Z"
      fill="#FC6D26"
    />
    <path d="M8 13.68L4.17 7.15H11.83L8 13.68Z" fill="#E24329" />
    <path
      d="M8 13.68L11.83 7.15H15.57C15.81 8.01 15.91 7.69 15.82 7.42L14.07 2.05C13.98 1.77 13.58 1.77 13.49 2.05L11.83 7.15Z"
      fill="#FCA326"
    />
    <path
      d="M8 13.68L4.17 7.15H0.43C0.19 8.01 0.09 7.69 0.18 7.42L1.93 2.05C2.02 1.77 2.42 1.77 2.51 2.05L4.17 7.15Z"
      fill="#FCA326"
    />
  </svg>
);

const TwitterXIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
  </svg>
);

const ProviderButton = styled.button`
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  height: 40px;
  background: var(--color-canvas-default);
  color: var(--color-fg-default);
  border: 1px solid var(--color-border);
  border-radius: 9999px;
  font-size: 15px;
  font-weight: bold;
  cursor: pointer;
  transition: background-color 0.2s;
  width: 100%;

  &:hover {
    background: var(--color-canvas-subtle);
  }
`;

const LoginPromptModal = ({ onClose }: { onClose: () => void }) => {
  const navigate = useNavigate();
  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: "rgba(0, 0, 0, 0.5)",
        zIndex: 10000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
      onClick={(e) => {
        e.stopPropagation();
        onClose();
      }}
    >
      <div
        style={{
          position: "relative",
          backgroundColor: "var(--color-bg-primary)",
          borderRadius: "16px",
          padding: "32px",
          width: "90%",
          maxWidth: "400px",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 4px 20px rgba(0,0,0,0.2)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          style={{
            position: "absolute",
            top: "16px",
            right: "16px",
            background: "transparent",
            border: "none",
            color: "var(--color-fg-default)",
            cursor: "pointer",
            padding: "8px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: "50%",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "var(--color-canvas-subtle)")}
          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
        >
          <XIcon size={16} />
        </button>

        <Heading as="h2" style={{ fontSize: "24px", marginBottom: "8px", fontWeight: 800 }}>
          New to ModelScript?
        </Heading>
        <Text as="p" color="var(--color-fg-muted)" style={{ fontSize: "14px", marginBottom: "24px", lineHeight: 1.4 }}>
          Sign up now to get your own personalized timeline!
        </Text>
        <Box display="flex" flexDirection="column" gap={2}>
          <ProviderButton onClick={() => (window.location.href = "/api/v1/auth/login/github")}>
            <MarkGithubIcon size={16} />
            Sign up with GitHub
          </ProviderButton>
          <ProviderButton onClick={() => (window.location.href = "/api/v1/auth/login/gitlab")}>
            <GitLabIcon />
            Sign up with GitLab
          </ProviderButton>
          <ProviderButton onClick={() => (window.location.href = "/api/v1/auth/login/twitter")}>
            <TwitterXIcon />
            Sign up with X
          </ProviderButton>
          <div style={{ display: "flex", alignItems: "center", margin: "4px 0", color: "#536471" }}>
            <div style={{ flex: 1, borderBottom: "1px solid #536471", opacity: 0.5 }}></div>
            <span style={{ margin: "0 8px", fontSize: "13px", color: "#536471" }}>or</span>
            <div style={{ flex: 1, borderBottom: "1px solid #536471", opacity: 0.5 }}></div>
          </div>
          <button
            onClick={() => navigate("/signup")}
            style={{
              height: 40,
              backgroundColor: "#1f1f1f",
              color: "#fff",
              border: "none",
              borderRadius: 9999,
              fontSize: 15,
              fontWeight: "bold",
              cursor: "pointer",
              width: "100%",
            }}
          >
            Create account
          </button>
        </Box>
        <Text as="p" color="var(--color-fg-muted)" style={{ fontSize: "12px", marginTop: "24px", lineHeight: 1.4 }}>
          By signing up, you agree to the{" "}
          <a href="#" style={{ color: "#1d9bf0", textDecoration: "none" }}>
            Terms of Service
          </a>{" "}
          and{" "}
          <a href="#" style={{ color: "#1d9bf0", textDecoration: "none" }}>
            Privacy Policy
          </a>
          , including{" "}
          <a href="#" style={{ color: "#1d9bf0", textDecoration: "none" }}>
            Cookie Use
          </a>
          .
        </Text>

        <Box mt={4} pt={3} style={{ width: "100%", display: "flex", flexDirection: "column", gap: "16px" }}>
          <Text style={{ fontSize: "15px", fontWeight: "bold", color: "var(--color-fg-default)" }}>
            Already have an account?
          </Text>
          <button
            onClick={() => navigate("/login")}
            style={{
              height: 40,
              backgroundColor: "transparent",
              color: "#1d9bf0",
              border: "1px solid var(--color-border)",
              borderRadius: 9999,
              fontSize: 15,
              fontWeight: "bold",
              cursor: "pointer",
              width: "100%",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "rgba(29, 155, 240, 0.1)")}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
          >
            Sign in
          </button>
        </Box>
      </div>
    </div>
  );
};

const RenderContent = ({ text }: { text: string | null }) => {
  const navigate = useNavigate();
  const containerRef = useRef<HTMLDivElement>(null);
  const [portals, setPortals] = useState<React.ReactPortal[]>([]);

  useEffect(() => {
    if (!text || !containerRef.current) return;

    let processedText = text.replace(/(^|\s)#(\w+)/g, "$1[#$2](/explore?q=$2)");
    processedText = processedText.replace(/(^|\s)@(\w+)/g, "$1[@$2](/@$2)");

    const rawHtml = marked.parse(processedText, { breaks: true, gfm: true }) as string;
    const sanitizedHtml = DOMPurify.sanitize(rawHtml);

    containerRef.current.innerHTML = sanitizedHtml;

    const links = containerRef.current.querySelectorAll("a");
    const newPortals: React.ReactPortal[] = [];
    links.forEach((link) => {
      const href = link.getAttribute("href");
      if (href && href.startsWith("/@")) {
        const username = href.substring(2);
        const textContent = link.textContent;
        const container = document.createElement("span");
        link.parentNode?.replaceChild(container, link);
        newPortals.push(
          createPortal(
            <ProfileHoverCard username={username}>
              <Link
                to={`/${username}`}
                style={{ color: "#1d9bf0", textDecoration: "none", fontWeight: "bold" }}
                onMouseOver={(e) => ((e.target as any).style.textDecoration = "underline")}
                onMouseOut={(e) => ((e.target as any).style.textDecoration = "none")}
              >
                {textContent}
              </Link>
            </ProfileHoverCard>,
            container,
          ),
        );
      } else if (href && href.startsWith("/explore?q=")) {
        link.style.color = "#1d9bf0";
        link.style.textDecoration = "none";
        link.style.fontWeight = "bold";
        link.onmouseover = () => (link.style.textDecoration = "underline");
        link.onmouseout = () => (link.style.textDecoration = "none");
        link.onclick = (e) => {
          e.preventDefault();
          e.stopPropagation();
          navigate(href);
        };
      } else {
        link.onclick = (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (href?.startsWith("/")) {
            navigate(href);
          } else if (href) {
            window.open(href, "_blank", "noopener,noreferrer");
          }
        };
      }
    });

    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPortals(newPortals);
    return () => setPortals([]);
  }, [text, navigate]);

  return (
    <>
      <MarkdownContainer className="markdown-body" ref={containerRef} />
      {portals}
    </>
  );
};

// Mock locations for WorldMap
const mockLocationStats: LocationStat[] = [
  { country: "US", views: Math.floor(Math.random() * 500) + 100 },
  { country: "GB", views: Math.floor(Math.random() * 200) + 50 },
  { country: "DE", views: Math.floor(Math.random() * 300) + 50 },
  { country: "FR", views: Math.floor(Math.random() * 150) + 20 },
  { country: "IN", views: Math.floor(Math.random() * 400) + 50 },
  { country: "AU", views: Math.floor(Math.random() * 100) + 10 },
  { country: "BR", views: Math.floor(Math.random() * 100) + 10 },
  { country: "JP", views: Math.floor(Math.random() * 200) + 30 },
];

const Post: React.FC<PostProps> = ({ post, isDetail, isThread }) => {
  const navigate = useNavigate();
  const { token } = useAuth();
  const displayPost = post.repost_post || post;

  const [liked, setLiked] = useState(Boolean(displayPost.liked));
  const [likeCount, setLikeCount] = useState(displayPost.like_count);
  const [reposted, setReposted] = useState(Boolean(displayPost.reposted));
  const [repostCount, setRepostCount] = useState(displayPost.repost_count);
  const [bookmarked, setBookmarked] = useState(Boolean(displayPost.bookmarked));
  const [bookmarkCount, setBookmarkCount] = useState(displayPost.bookmark_count);
  const [showRepostMenu, setShowRepostMenu] = useState(false);
  const [showPostMenu, setShowPostMenu] = useState(false);
  const [showQuoteModal, setShowQuoteModal] = useState(false);
  const [showReplyModal, setShowReplyModal] = useState(false);
  const [showShareMenu, setShowShareMenu] = useState(false);
  const [showAnalyticsModal, setShowAnalyticsModal] = useState(false);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [analyticsData, setAnalyticsData] = useState<any>(null);
  const [pendingPin, setPendingPin] = useState<SpatialPin | undefined>(undefined);

  useEffect(() => {
    if (showAnalyticsModal) {
      fetch(`${API_BASE_URL}/social/posts/${displayPost.id}/analytics`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
        .then((res) => res.json())
        .then((data) => setAnalyticsData(data))
        .catch(console.error);
    }
  }, [showAnalyticsModal, displayPost.id, token]);

  const impressions = analyticsData?.view_count ?? displayPost.view_count ?? 0;
  const detailExpands = Math.ceil(impressions * 0.05);
  const profileVisits = Math.ceil(impressions * 0.02);
  const engagements =
    (likeCount || 0) + (repostCount || 0) + (displayPost.reply_count || 0) + detailExpands + profileVisits;

  const formatNumber = (num: number) => {
    if (!num) return "0";
    if (num >= 1000000) return (num / 1000000).toFixed(1).replace(/\.0$/, "") + "M";
    if (num >= 1000) return (num / 1000).toFixed(1).replace(/\.0$/, "") + "K";
    return num.toString();
  };

  const hasAttachment = !!displayPost.artifact_view_id;

  const handleCopyLink = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setShowShareMenu(false);
    navigator.clipboard.writeText(`${window.location.origin}/${displayPost.username}/status/${displayPost.id}`);
  };

  const handleDownload = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setShowShareMenu(false);
    alert("Downloading content...");
  };

  const handlePostAsAttachment = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setShowShareMenu(false);
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
      const res = await fetch(`${API_BASE_URL}/social/posts/${post.id}/like`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setLiked(data.liked);
        setLikeCount((prev: number) => prev + (data.liked ? 1 : -1));
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleRepost = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setShowRepostMenu(false);
    if (!token) {
      setShowLoginModal(true);
      return;
    }

    try {
      const res = await fetch(`${API_BASE_URL}/social/posts/${displayPost.id}/repost`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setReposted(data.reposted);
        setRepostCount((prev: number) => prev + (data.reposted ? 1 : -1));
      }
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
      const res = await fetch(`${API_BASE_URL}/social/posts/${displayPost.id}/bookmark`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setBookmarked(data.bookmarked);
        setBookmarkCount((prev: number) => prev + (data.bookmarked ? 1 : -1));
      }
    } catch (err) {
      console.error(err);
    }
  };

  const content = (
    <PostWrapper $isDetail={isDetail} $isThread={isThread}>
      {isDetail ? (
        <>
          <Box display="flex" alignItems="center" gap={3}>
            <ProfileHoverCard username={displayPost.username}>
              <ProfileNameLink to={`/${displayPost.username}`} onClick={(e) => e.stopPropagation()}>
                <HoverAvatar
                  $url={displayPost.avatar_url}
                  style={{ width: "48px", height: "48px", fontSize: "20px", marginLeft: "-4px" }}
                >
                  {!displayPost.avatar_url && displayPost.username.charAt(0).toUpperCase()}
                </HoverAvatar>
              </ProfileNameLink>
            </ProfileHoverCard>
            <Box display="flex" flexDirection="column" flex={1} style={{ minWidth: 0 }}>
              <div style={{ width: "fit-content", maxWidth: "100%", display: "flex" }}>
                <ProfileHoverCard username={displayPost.username}>
                  <ProfileNameLink
                    to={`/${displayPost.username}`}
                    onClick={(e) => e.stopPropagation()}
                    style={{ minWidth: 0, overflow: "hidden", display: "flex", maxWidth: "100%" }}
                  >
                    <Text
                      style={{
                        fontWeight: "bold",
                        fontSize: "15px",
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
                      {displayPost.account_type === "bot" && (
                        <HubotIcon size={14} color="var(--color-fg-muted)" style={{ flexShrink: 0 }} />
                      )}
                    </Text>
                  </ProfileNameLink>
                </ProfileHoverCard>
              </div>
              <Text
                className="handle-text"
                style={{
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  display: "block",
                  width: "100%",
                }}
              >
                @{displayPost.username}
              </Text>
            </Box>
            <Box position="relative" mr={1}>
              <ActionButton
                $noHoverColor
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  setShowPostMenu(!showPostMenu);
                }}
              >
                <div className="icon-wrapper">
                  <KebabHorizontalIcon size={16} />
                </div>
              </ActionButton>
              {showPostMenu && (
                <>
                  <div
                    style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, zIndex: 99 }}
                    onClick={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      setShowPostMenu(false);
                    }}
                  />
                  <Box
                    position="absolute"
                    top="0"
                    right="0"
                    bg="var(--color-bg-primary)"
                    border="1px solid var(--color-border-subtle)"
                    borderRadius="12px"
                    boxShadow="0 4px 12px rgba(0,0,0,0.15)"
                    p={1}
                    zIndex={100}
                    minWidth="250px"
                    display="flex"
                    flexDirection="column"
                  >
                    <MenuButton
                      onClick={async (e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        if (token) {
                          try {
                            await fetch(`${API_BASE_URL}/users/${displayPost.username}/follow`, {
                              method: "POST",
                              headers: { Authorization: `Bearer ${token}` },
                            });
                          } catch (err) {
                            console.error(err);
                          }
                        }
                        setShowPostMenu(false);
                      }}
                    >
                      <PersonAddIcon size={16} /> Follow @{displayPost.username}
                    </MenuButton>
                    <MenuButton
                      onClick={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        setShowPostMenu(false);
                      }}
                    >
                      <MuteIcon size={16} /> Mute
                    </MenuButton>
                    <MenuButton
                      onClick={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        setShowPostMenu(false);
                      }}
                    >
                      <MuteIcon size={16} /> Mute this conversation
                    </MenuButton>
                    <MenuButton
                      onClick={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        setShowPostMenu(false);
                      }}
                    >
                      <BlockedIcon size={16} /> Block @{displayPost.username}
                    </MenuButton>
                    <MenuButton
                      onClick={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        setShowPostMenu(false);
                        navigate(`/${displayPost.username}/status/${displayPost.id}/activity`);
                      }}
                    >
                      <GraphIcon size={16} /> View post activity
                    </MenuButton>
                    <MenuButton
                      onClick={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        setShowPostMenu(false);
                      }}
                    >
                      <ReportIcon size={16} /> Report post
                    </MenuButton>
                  </Box>
                </>
              )}
            </Box>
          </Box>

          <Box
            style={{
              wordBreak: "break-word",
              lineHeight: 1.5,
              fontSize: "17px",
            }}
          >
            <RenderContent text={displayPost.content} />
          </Box>

          {displayPost.metadata?.spatialPin && (
            <Box
              mt={2}
              p={2}
              border="1px solid var(--color-border-subtle)"
              borderRadius="8px"
              backgroundColor="var(--color-canvas-subtle)"
              style={{ cursor: "pointer", display: "inline-block" }}
              onClick={(e) => {
                e.stopPropagation();
                window.dispatchEvent(new CustomEvent("focus-spatial-pin", { detail: displayPost.metadata.spatialPin }));
              }}
            >
              <span style={{ fontSize: "13px", color: "var(--color-fg-muted)" }}>
                📍 View Pin on <b>{displayPost.metadata.spatialPin.fieldName}</b> (Value:{" "}
                {displayPost.metadata.spatialPin.scalarValue.toFixed(2)})
              </span>
            </Box>
          )}

          {displayPost.artifact_view_id && (
            <Box>
              <ArtifactViewCard
                artifactId={displayPost.artifact_view_id}
                onPinCreated={(pin) => {
                  setPendingPin(pin);
                  setShowReplyModal(true);
                }}
              />
            </Box>
          )}

          {displayPost.quote_post && (
            <Box
              mb={2}
              p={3}
              border="1px solid var(--color-border)"
              borderRadius="12px"
              sx={{ cursor: "pointer", "&:hover": { backgroundColor: "var(--color-canvas-subtle)" } }}
            >
              <Box display="flex" alignItems="center" gap={2} mb={1}>
                <Avatar
                  $url={displayPost.quote_post.avatar_url}
                  style={{ width: "20px", height: "20px", fontSize: "10px" }}
                >
                  {!displayPost.quote_post.avatar_url && displayPost.quote_post.username.charAt(0).toUpperCase()}
                </Avatar>
                <Text
                  style={{ fontWeight: "bold", fontSize: "15px", display: "flex", alignItems: "center", gap: "4px" }}
                >
                  {displayPost.quote_post.display_name || displayPost.quote_post.username}
                  {displayPost.quote_post.account_type === "rss" && <RssIcon size={14} color="var(--color-fg-muted)" />}
                  {displayPost.quote_post.account_type === "bot" && (
                    <HubotIcon size={14} color="var(--color-fg-muted)" />
                  )}
                </Text>
                <Text className="handle-text">@{displayPost.quote_post.username}</Text>
              </Box>
              <Box style={{ fontSize: "15px", wordBreak: "break-word" }}>
                <RenderContent text={displayPost.quote_post.content} />
              </Box>
              {displayPost.quote_post.artifact_view_id && (
                <Box>
                  <ArtifactViewCard artifactId={displayPost.quote_post.artifact_view_id} />
                </Box>
              )}
            </Box>
          )}

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
                  setShowLoginModal(true);
                  return;
                }
                setShowAnalyticsModal(true);
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
          >
            <ActionButton
              $color="#1d9bf0"
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                if (!token) {
                  setShowLoginModal(true);
                  return;
                }
                setShowReplyModal(true);
              }}
            >
              <div className="icon-wrapper">
                <CommentIcon size={18} />
              </div>
              <Text
                style={{
                  position: "absolute",
                  left: "36px",
                  fontSize: "14px",
                  paddingRight: "8px",
                  minWidth: "20px",
                  textAlign: "left",
                  color: "inherit",
                }}
              >
                <AnimatedCount count={displayPost.reply_count || 0} />
              </Text>
            </ActionButton>

            <Box position="relative">
              <ActionButton
                $active={reposted}
                $color="#00ba7c"
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  if (!token) {
                    setShowLoginModal(true);
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
                    fontSize: "14px",
                    paddingRight: "8px",
                    minWidth: "20px",
                    textAlign: "left",
                    color: "inherit",
                  }}
                >
                  <AnimatedCount count={repostCount || 0} />
                </Text>
              </ActionButton>
              {/* Same repost menu as below, omitting for brevity or reusing state */}
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
                    bg="var(--color-bg-primary)"
                    border="1px solid var(--color-border-subtle)"
                    borderRadius="12px"
                    boxShadow="0 4px 12px rgba(0,0,0,0.15)"
                    p={1}
                    zIndex={100}
                    minWidth="120px"
                    display="flex"
                    flexDirection="column"
                  >
                    <button
                      onClick={handleRepost}
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
                      onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "var(--color-canvas-subtle)")}
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
                        setShowQuoteModal(true);
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
                      onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "var(--color-canvas-subtle)")}
                      onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
                    >
                      <QuoteIcon size={14} /> Quote
                    </button>
                  </Box>
                </>
              )}
            </Box>

            <ActionButton $active={liked} $color="#f91880" onClick={handleLike}>
              <div className="icon-wrapper">{liked ? <HeartFillIcon size={18} /> : <HeartIcon size={18} />}</div>
              <Text
                style={{
                  position: "absolute",
                  left: "36px",
                  fontSize: "14px",
                  paddingRight: "8px",
                  minWidth: "20px",
                  textAlign: "left",
                  color: "inherit",
                }}
              >
                <AnimatedCount count={likeCount || 0} />
              </Text>
            </ActionButton>

            <ActionButton $active={bookmarked} $color="#1d9bf0" onClick={handleBookmark}>
              <div className="icon-wrapper">
                {bookmarked ? <BookmarkFillIcon size={18} /> : <BookmarkIcon size={18} />}
              </div>
            </ActionButton>

            <Box position="relative">
              <ActionButton
                $color="#1d9bf0"
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
                    bg="var(--color-bg-primary)"
                    border="1px solid var(--color-border-subtle)"
                    borderRadius="12px"
                    boxShadow="0 4px 12px rgba(0,0,0,0.15)"
                    p={1}
                    zIndex={100}
                    minWidth="200px"
                    display="flex"
                    flexDirection="column"
                  >
                    <MenuButton onClick={handleCopyLink}>
                      <LinkIcon size={16} /> Copy link to post
                    </MenuButton>
                    {hasAttachment && (
                      <>
                        <MenuButton onClick={handleDownload}>
                          <DownloadIcon size={16} /> Download content
                        </MenuButton>
                        <MenuButton onClick={handlePostAsAttachment}>
                          <PaperclipIcon size={16} /> Post as attachment
                        </MenuButton>
                      </>
                    )}
                  </Box>
                </>
              )}
            </Box>
          </Box>
        </>
      ) : (
        <>
          <Box display="flex" flexDirection="column" gap={1} flex={1}>
            {post.repost_post && (
              <Box
                display="flex"
                alignItems="center"
                gap={2}
                style={{ color: "var(--color-fg-muted)" }}
                fontSize="13px"
                mb={1}
                ml={5}
              >
                <SyncIcon size={12} />
                <Link
                  to={`/${post.username}`}
                  style={{ color: "inherit", textDecoration: "none" }}
                  onClick={(e) => e.stopPropagation()}
                >
                  {post.display_name || post.username} reposted
                </Link>
              </Box>
            )}
            <Box display="flex" gap={3}>
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
              <Box flex={1} style={{ minWidth: 0 }}>
                <Box display="flex" alignItems="center" gap={1} style={{ minWidth: 0, marginTop: "-3px" }}>
                  <ProfileHoverCard username={displayPost.username}>
                    <ProfileNameLink
                      to={`/${displayPost.username}`}
                      onClick={(e) => e.stopPropagation()}
                      style={{ minWidth: 0, overflow: "hidden" }}
                    >
                      <Text
                        style={{
                          fontWeight: "bold",
                          fontSize: "15px",
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
                        {displayPost.account_type === "bot" && (
                          <HubotIcon size={14} color="var(--color-fg-muted)" style={{ flexShrink: 0 }} />
                        )}
                      </Text>
                    </ProfileNameLink>
                  </ProfileHoverCard>
                  <Link
                    to={`/${displayPost.username}`}
                    className="handle-text"
                    style={{
                      textDecoration: "none",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      flexShrink: 1,
                    }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    @{displayPost.username}
                  </Link>
                  <Text className="handle-text" style={{ flexShrink: 0 }}>
                    ·
                  </Text>
                  <Tooltip
                    text={`${new Date(displayPost.created_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} · ${new Date(displayPost.created_at).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })}`}
                    direction="s"
                  >
                    <button
                      type="button"
                      style={{
                        background: "none",
                        border: "none",
                        padding: 0,
                        color: "inherit",
                        cursor: "pointer",
                      }}
                    >
                      <Text
                        className="handle-text"
                        sx={{ "&:hover": { textDecoration: "underline" } }}
                        style={{ flexShrink: 0, whiteSpace: "nowrap" }}
                      >
                        {formatRelativeTime(displayPost.created_at)}
                      </Text>
                    </button>
                  </Tooltip>
                  <Box flex={1} />
                  <Box position="relative" mr={1}>
                    <ActionButton
                      $noHoverColor
                      onClick={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        setShowPostMenu(!showPostMenu);
                      }}
                    >
                      <div className="icon-wrapper">
                        <KebabHorizontalIcon size={16} />
                      </div>
                    </ActionButton>
                    {showPostMenu && (
                      <>
                        <div
                          style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, zIndex: 99 }}
                          onClick={(e) => {
                            e.stopPropagation();
                            e.preventDefault();
                            setShowPostMenu(false);
                          }}
                        />
                        <Box
                          position="absolute"
                          top="0"
                          right="0"
                          bg="var(--color-bg-primary)"
                          border="1px solid var(--color-border-subtle)"
                          borderRadius="12px"
                          boxShadow="0 4px 12px rgba(0,0,0,0.15)"
                          p={1}
                          zIndex={100}
                          minWidth="250px"
                          display="flex"
                          flexDirection="column"
                        >
                          <MenuButton
                            onClick={async (e) => {
                              e.stopPropagation();
                              e.preventDefault();
                              if (token) {
                                try {
                                  await fetch(`${API_BASE_URL}/users/${displayPost.username}/follow`, {
                                    method: "POST",
                                    headers: { Authorization: `Bearer ${token}` },
                                  });
                                } catch (err) {
                                  console.error(err);
                                }
                              }
                              setShowPostMenu(false);
                            }}
                          >
                            <PersonAddIcon size={16} /> Follow @{displayPost.username}
                          </MenuButton>
                          <MenuButton
                            onClick={(e) => {
                              e.stopPropagation();
                              e.preventDefault();
                              setShowPostMenu(false);
                            }}
                          >
                            <MuteIcon size={16} /> Mute
                          </MenuButton>
                          <MenuButton
                            onClick={(e) => {
                              e.stopPropagation();
                              e.preventDefault();
                              setShowPostMenu(false);
                            }}
                          >
                            <MuteIcon size={16} /> Mute this conversation
                          </MenuButton>
                          <MenuButton
                            onClick={(e) => {
                              e.stopPropagation();
                              e.preventDefault();
                              setShowPostMenu(false);
                            }}
                          >
                            <BlockedIcon size={16} /> Block @{displayPost.username}
                          </MenuButton>
                          <MenuButton
                            onClick={(e) => {
                              e.stopPropagation();
                              e.preventDefault();
                              setShowPostMenu(false);
                              navigate(`/${displayPost.username}/status/${displayPost.id}/activity`);
                            }}
                          >
                            <GraphIcon size={16} /> View post activity
                          </MenuButton>
                          <MenuButton
                            onClick={(e) => {
                              e.stopPropagation();
                              e.preventDefault();
                              setShowPostMenu(false);
                            }}
                          >
                            <ReportIcon size={16} /> Report post
                          </MenuButton>
                        </Box>
                      </>
                    )}
                  </Box>
                </Box>
                <Box mt={0} style={{ fontSize: "15px", wordBreak: "break-word" }}>
                  <RenderContent text={displayPost.content} />
                </Box>

                {displayPost.metadata?.spatialPin && (
                  <Box
                    mt={2}
                    p={2}
                    border="1px solid var(--color-border-subtle)"
                    borderRadius="8px"
                    backgroundColor="var(--color-canvas-subtle)"
                    style={{ cursor: "pointer", display: "inline-block" }}
                    onClick={(e) => {
                      e.stopPropagation();
                      window.dispatchEvent(
                        new CustomEvent("focus-spatial-pin", { detail: displayPost.metadata.spatialPin }),
                      );
                    }}
                  >
                    <span style={{ fontSize: "13px", color: "var(--color-fg-muted)" }}>
                      📍 View Pin on <b>{displayPost.metadata.spatialPin.fieldName}</b> (Value:{" "}
                      {displayPost.metadata.spatialPin.scalarValue.toFixed(2)})
                    </span>
                  </Box>
                )}

                {displayPost.artifact_view_id && (
                  <Box>
                    <ArtifactViewCard artifactId={displayPost.artifact_view_id} />
                  </Box>
                )}

                {displayPost.quote_post && (
                  <QuoteWrapper>
                    <Box display="flex" alignItems="center" gap={1} mb={1}>
                      <Avatar
                        $url={displayPost.quote_post.avatar_url}
                        style={{ width: "20px", height: "20px", fontSize: "10px" }}
                      >
                        {!displayPost.quote_post.avatar_url && displayPost.quote_post.username.charAt(0).toUpperCase()}
                      </Avatar>
                      <Text
                        style={{
                          fontWeight: "bold",
                          fontSize: "15px",
                          display: "flex",
                          alignItems: "center",
                          gap: "4px",
                        }}
                      >
                        {displayPost.quote_post.display_name || displayPost.quote_post.username}
                        {displayPost.quote_post.account_type === "rss" && (
                          <RssIcon size={14} color="var(--color-fg-muted)" />
                        )}
                      </Text>
                      <Text className="handle-text">@{displayPost.quote_post.username}</Text>
                    </Box>
                    <Box style={{ fontSize: "15px", wordBreak: "break-word" }}>
                      <RenderContent text={displayPost.quote_post.content} />
                    </Box>
                    {displayPost.quote_post.artifact_view_id && (
                      <Box>
                        <ArtifactViewCard artifactId={displayPost.quote_post.artifact_view_id} />
                      </Box>
                    )}
                  </QuoteWrapper>
                )}

                <Box
                  style={{ marginTop: "10px" }}
                  display="flex"
                  justifyContent="space-between"
                  alignItems="flex-end"
                  width="100%"
                  height="32px"
                  onClick={(e) => e.preventDefault()}
                >
                  <ActionButton
                    $color="#1d9bf0"
                    onClick={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      if (!token) {
                        setShowLoginModal(true);
                        return;
                      }
                      setShowReplyModal(true);
                    }}
                  >
                    <div className="icon-wrapper">
                      <CommentIcon size={18} />
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
                      <AnimatedCount count={displayPost.reply_count || 0} />
                    </Text>
                  </ActionButton>

                  <Box position="relative">
                    <ActionButton
                      $active={reposted}
                      $color="#00ba7c"
                      onClick={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        if (!token) {
                          setShowLoginModal(true);
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
                          fontSize: "13px",
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
                          bg="var(--color-bg-primary)"
                          border="1px solid var(--color-border-subtle)"
                          borderRadius="12px"
                          boxShadow="0 4px 12px rgba(0,0,0,0.15)"
                          p={1}
                          zIndex={100}
                          minWidth="120px"
                          display="flex"
                          flexDirection="column"
                        >
                          <button
                            onClick={handleRepost}
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
                            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "var(--color-canvas-subtle)")}
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
                              setShowQuoteModal(true);
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
                            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "var(--color-canvas-subtle)")}
                            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
                          >
                            <QuoteIcon size={14} />
                            Quote
                          </button>
                        </Box>
                      </>
                    )}
                  </Box>

                  <ActionButton $active={liked} $color="#f91880" onClick={handleLike}>
                    <div className="icon-wrapper">{liked ? <HeartFillIcon size={18} /> : <HeartIcon size={18} />}</div>
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
                      <AnimatedCount count={likeCount || 0} />
                    </Text>
                  </ActionButton>

                  <ActionButton
                    $color="#1d9bf0"
                    onClick={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      setShowAnalyticsModal(true);
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

                  <Box display="flex" gap={0}>
                    <ActionButton $active={bookmarked} $color="#1d9bf0" onClick={handleBookmark}>
                      <div className="icon-wrapper">
                        {bookmarked ? <BookmarkFillIcon size={18} /> : <BookmarkIcon size={18} />}
                      </div>
                    </ActionButton>

                    <Box position="relative">
                      <ActionButton
                        $color="#1d9bf0"
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
                            bg="var(--color-bg-primary)"
                            border="1px solid var(--color-border-subtle)"
                            borderRadius="12px"
                            boxShadow="0 4px 12px rgba(0,0,0,0.15)"
                            p={1}
                            zIndex={100}
                            minWidth="200px"
                            display="flex"
                            flexDirection="column"
                          >
                            <MenuButton onClick={handleCopyLink}>
                              <LinkIcon size={16} /> Copy link to post
                            </MenuButton>
                            {hasAttachment && (
                              <>
                                <MenuButton onClick={handleDownload}>
                                  <DownloadIcon size={16} /> Download content
                                </MenuButton>
                                <MenuButton onClick={handlePostAsAttachment}>
                                  <PaperclipIcon size={16} /> Post as attachment
                                </MenuButton>
                              </>
                            )}
                          </Box>
                        </>
                      )}
                    </Box>
                  </Box>
                </Box>
              </Box>
            </Box>
          </Box>
        </>
      )}
    </PostWrapper>
  );

  const modals = (
    <>
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
      {showAnalyticsModal && (
        <AnalyticsModalOverlay
          onClick={(e) => {
            e.stopPropagation();
            setShowAnalyticsModal(false);
          }}
        >
          <AnalyticsModalContainer onClick={(e) => e.stopPropagation()}>
            <AnalyticsHeader>
              <IconButton
                icon={XIcon}
                variant="invisible"
                onClick={() => setShowAnalyticsModal(false)}
                aria-label="Close"
              />
              <Heading as="h2" style={{ fontSize: "20px" }}>
                Post Analytics
              </Heading>
            </AnalyticsHeader>
            <Box>
              <AnalyticsCard>
                <Box display="flex" gap={2}>
                  <Avatar $url={displayPost.avatar_url} style={{ width: 40, height: 40 }}>
                    {!displayPost.avatar_url && displayPost.username.charAt(0).toUpperCase()}
                  </Avatar>
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
                  data={analyticsData?.location_stats?.length > 0 ? analyticsData.location_stats : mockLocationStats}
                />
              </Box>
              <AnalyticsCard style={{ display: "flex", justifyContent: "space-around", alignItems: "center" }}>
                <Box display="flex" flexDirection="column" alignItems="center" gap={1}>
                  <HeartIcon size={20} style={{ color: liked ? "#f91880" : "var(--color-fg-muted)" }} />
                  <Text fontWeight="bold" fontSize="16px">
                    {likeCount || 0}
                  </Text>
                </Box>
                <Box display="flex" flexDirection="column" alignItems="center" gap={1}>
                  <SyncIcon size={20} style={{ color: reposted ? "#00ba7c" : "var(--color-fg-muted)" }} />
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
      )}
    </>
  );

  if (isDetail) {
    return (
      <>
        {content}
        {modals}
      </>
    );
  }

  return (
    <>
      <div
        onClick={(e) => {
          if ((e.target as HTMLElement).closest("a, button")) return;
          navigate(`/${displayPost.username}/status/${displayPost.id}`);
        }}
        style={{ textDecoration: "none", color: "inherit", display: "block" }}
      >
        {content}
      </div>
      {modals}
    </>
  );
};

export default Post;
