/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import {
  BlockedIcon,
  BookmarkFillIcon,
  BookmarkIcon,
  CommentIcon,
  GraphIcon,
  HeartFillIcon,
  HeartIcon,
  KebabHorizontalIcon,
  MuteIcon,
  PersonAddIcon,
  QuoteIcon,
  ReportIcon,
  ShareIcon,
  SyncIcon,
} from "@primer/octicons-react";
import { Text } from "@primer/react";
import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import styled from "styled-components";
import { useAuth } from "../AuthContext";
import { API_BASE_URL } from "../config";
import ArtifactViewCard from "./artifacts/ArtifactViewCard";
import Box from "./Box";
import ComposeModal from "./ComposeModal";

const PostWrapper = styled.div<{ $isDetail?: boolean }>`
  display: flex;
  flex-direction: ${(props) => (props.$isDetail ? "column" : "row")};
  gap: 12px;
  padding: 16px;
  border-bottom: 1px solid var(--color-border);
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
  background-image: ${(props) => (props.$url ? `url(${props.$url})` : "none")};
  background-size: cover;
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  font-weight: bold;
  flex-shrink: 0;
`;

const ActionButton = styled.button<{ $active?: boolean; $color?: string }>`
  display: flex;
  align-items: center;
  gap: 6px;
  background: none;
  border: none;
  color: ${(props) => (props.$active ? props.$color : "var(--color-fg-muted)")};
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 9999px;
  transition: all 0.2s;

  &:hover {
    color: ${(props) => props.$color || "var(--color-accent-emphasis)"};
    background-color: ${(props) => (props.$color ? `${props.$color}22` : "var(--color-accent-subtle)")};
  }
`;

const MenuButton = styled.button`
  padding: 12px 16px;
  background: none;
  border: none;
  text-align: left;
  cursor: pointer;
  font-size: 15px;
  font-weight: 500;
  color: var(--color-fg-default);
  border-radius: 8px;
  display: flex;
  align-items: center;
  gap: 12px;
  transition: background-color 0.2s;

  &:hover {
    background-color: var(--color-canvas-subtle);
  }
`;

interface PostProps {
  post: any;
  isDetail?: boolean;
}

const Post: React.FC<PostProps> = ({ post, isDetail }) => {
  const navigate = useNavigate();
  const { token } = useAuth();
  const [liked, setLiked] = useState(post.liked);
  const [likeCount, setLikeCount] = useState(post.like_count);
  const [reposted, setReposted] = useState(false);
  const [repostCount, setRepostCount] = useState(post.repost_count);
  const [bookmarked, setBookmarked] = useState(post.bookmarked);
  const [bookmarkCount, setBookmarkCount] = useState(post.bookmark_count);
  const [showRepostMenu, setShowRepostMenu] = useState(false);
  const [showPostMenu, setShowPostMenu] = useState(false);
  const [showQuoteModal, setShowQuoteModal] = useState(false);
  const [showReplyModal, setShowReplyModal] = useState(false);

  const displayPost = post.repost_post || post;

  const formatNumber = (num: number) => {
    if (!num) return "0";
    if (num >= 1000000) return (num / 1000000).toFixed(1).replace(/\.0$/, "") + "M";
    if (num >= 1000) return (num / 1000).toFixed(1).replace(/\.0$/, "") + "K";
    return num.toString();
  };

  const handleLike = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (!token) return;

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
    if (!token) return;

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
    if (!token) return;

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
    <PostWrapper $isDetail={isDetail}>
      {isDetail ? (
        <>
          <Box display="flex" alignItems="center" gap={3}>
            <Link
              to={`/${displayPost.username}`}
              style={{ color: "inherit", textDecoration: "none" }}
              onClick={(e) => e.stopPropagation()}
            >
              <Avatar $url={displayPost.avatar_url} style={{ width: "48px", height: "48px", fontSize: "20px" }}>
                {!displayPost.avatar_url && displayPost.username.charAt(0).toUpperCase()}
              </Avatar>
            </Link>
            <Box display="flex" flexDirection="column" flex={1}>
              <Link
                to={`/${displayPost.username}`}
                style={{ color: "inherit", textDecoration: "none" }}
                onClick={(e) => e.stopPropagation()}
              >
                <Text style={{ fontWeight: "bold", fontSize: "15px" }}>
                  {displayPost.display_name || displayPost.username}
                </Text>
              </Link>
              <Text color="var(--color-fg-muted)" style={{ fontSize: "15px" }}>
                @{displayPost.username}
              </Text>
            </Box>
            <Box position="relative">
              <ActionButton
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  setShowPostMenu(!showPostMenu);
                }}
              >
                <KebabHorizontalIcon size={16} />
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
                    top="100%"
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
                      onClick={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
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

          <Box mt={2} mb={2}>
            <Text style={{ fontSize: "17px", lineHeight: "1.5" }}>{displayPost.content}</Text>
          </Box>

          {displayPost.artifact_view_id && (
            <Box mt={2} mb={2}>
              <ArtifactViewCard artifactId={displayPost.artifact_view_id} />
            </Box>
          )}

          {displayPost.quote_post && (
            <Box
              mb={2}
              p={3}
              border="1px solid var(--color-border-default)"
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
                <Text style={{ fontWeight: "bold", fontSize: "15px" }}>
                  {displayPost.quote_post.display_name || displayPost.quote_post.username}
                </Text>
                <Text color="var(--color-fg-muted)" style={{ fontSize: "15px" }}>
                  @{displayPost.quote_post.username}
                </Text>
              </Box>
              <Text style={{ fontSize: "15px" }}>{displayPost.quote_post.content}</Text>
              {displayPost.quote_post.artifact_view_id && (
                <Box mt={2}>
                  <ArtifactViewCard artifactId={displayPost.quote_post.artifact_view_id} />
                </Box>
              )}
            </Box>
          )}

          <Box color="var(--color-fg-muted)" fontSize="15px" mb={2}>
            <Text>
              {new Date(displayPost.created_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
            </Text>
            <Text style={{ margin: "0 4px" }}>·</Text>
            <Text>
              {new Date(displayPost.created_at).toLocaleDateString([], {
                month: "short",
                day: "numeric",
                year: "numeric",
              })}
            </Text>
            <Text style={{ margin: "0 4px" }}>·</Text>
            <Text style={{ fontWeight: "bold", color: "var(--color-text-primary)" }}>
              {formatNumber(displayPost.view_count || 0)}
            </Text>{" "}
            Views
          </Box>

          <Box
            borderTop="1px solid var(--color-border-default)"
            borderBottom="1px solid var(--color-border-default)"
            py={2}
            display="flex"
            justifyContent="space-around"
          >
            <ActionButton
              $color="var(--color-accent-emphasis)"
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                setShowReplyModal(true);
              }}
            >
              <CommentIcon size={18} />
              <Text style={{ fontSize: "14px", marginLeft: "4px", minWidth: "20px", textAlign: "left" }}>
                {displayPost.reply_count > 0 ? displayPost.reply_count : ""}
              </Text>
            </ActionButton>

            <Box position="relative">
              <ActionButton
                $active={reposted}
                $color="var(--color-success)"
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  setShowRepostMenu(!showRepostMenu);
                }}
              >
                <SyncIcon size={18} />
                <Text style={{ fontSize: "14px", marginLeft: "4px", minWidth: "20px", textAlign: "left" }}>
                  {repostCount > 0 ? repostCount : ""}
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
              {liked ? <HeartFillIcon size={18} /> : <HeartIcon size={18} />}
              <Text style={{ fontSize: "14px", marginLeft: "4px", minWidth: "20px", textAlign: "left" }}>
                {likeCount > 0 ? likeCount : ""}
              </Text>
            </ActionButton>

            <ActionButton
              $color="var(--color-accent-emphasis)"
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
              }}
            >
              <GraphIcon size={18} />
              <Text style={{ fontSize: "14px", marginLeft: "4px", minWidth: "20px", textAlign: "left" }}>
                {displayPost.view_count > 0 ? displayPost.view_count : ""}
              </Text>
            </ActionButton>

            <ActionButton $active={bookmarked} $color="#1d9bf0" onClick={handleBookmark}>
              {bookmarked ? <BookmarkFillIcon size={18} /> : <BookmarkIcon size={18} />}
              <Text style={{ fontSize: "14px", marginLeft: "4px", minWidth: "20px", textAlign: "left" }}>
                {bookmarkCount > 0 ? bookmarkCount : ""}
              </Text>
            </ActionButton>

            <ActionButton
              $color="var(--color-accent-emphasis)"
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
              }}
            >
              <ShareIcon size={18} />
              <Text style={{ fontSize: "14px", marginLeft: "4px", minWidth: "20px", textAlign: "left" }}></Text>
            </ActionButton>
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
                color="var(--color-fg-muted)"
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
              <Avatar $url={displayPost.avatar_url}>
                {!displayPost.avatar_url && displayPost.username.charAt(0).toUpperCase()}
              </Avatar>
              <Box flex={1}>
                <Box display="flex" alignItems="center" gap={1}>
                  <Text style={{ fontWeight: "bold" }}>{displayPost.display_name || displayPost.username}</Text>
                  <Link
                    to={`/${displayPost.username}`}
                    style={{ color: "var(--color-fg-muted)", textDecoration: "none" }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    @{displayPost.username}
                  </Link>
                  <Text color="var(--color-fg-muted)">·</Text>
                  <Text color="var(--color-fg-muted)">
                    {new Date(displayPost.created_at).toLocaleDateString([], { month: "short", day: "numeric" })}
                  </Text>
                  <Box flex={1} />
                  <Box position="relative">
                    <ActionButton
                      onClick={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        setShowPostMenu(!showPostMenu);
                      }}
                    >
                      <KebabHorizontalIcon size={16} />
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
                          top="100%"
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
                            onClick={(e) => {
                              e.stopPropagation();
                              e.preventDefault();
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
                <Box mt={1}>
                  <Text>{displayPost.content}</Text>
                </Box>

                {displayPost.artifact_view_id && <ArtifactViewCard artifactId={displayPost.artifact_view_id} />}

                {displayPost.quote_post && (
                  <Box
                    mt={2}
                    p={3}
                    border="1px solid var(--color-border-default)"
                    borderRadius="12px"
                    sx={{ "&:hover": { backgroundColor: "var(--color-canvas-subtle)" } }}
                  >
                    <Box display="flex" alignItems="center" gap={1} mb={1}>
                      <Avatar
                        $url={displayPost.quote_post.avatar_url}
                        style={{ width: "20px", height: "20px", fontSize: "10px" }}
                      >
                        {!displayPost.quote_post.avatar_url && displayPost.quote_post.username.charAt(0).toUpperCase()}
                      </Avatar>
                      <Text style={{ fontWeight: "bold", fontSize: "13px" }}>
                        {displayPost.quote_post.display_name || displayPost.quote_post.username}
                      </Text>
                      <Text color="var(--color-fg-muted)" style={{ fontSize: "13px" }}>
                        @{displayPost.quote_post.username}
                      </Text>
                    </Box>
                    <Text style={{ fontSize: "14px" }}>{displayPost.quote_post.content}</Text>
                    {displayPost.quote_post.artifact_view_id && (
                      <Box mt={2}>
                        <ArtifactViewCard artifactId={displayPost.quote_post.artifact_view_id} />
                      </Box>
                    )}
                  </Box>
                )}

                <Box
                  mt={2}
                  display="flex"
                  justifyContent="space-between"
                  maxWidth="425px"
                  onClick={(e) => e.preventDefault()}
                >
                  <ActionButton
                    $color="var(--color-accent-emphasis)"
                    onClick={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      setShowReplyModal(true);
                    }}
                  >
                    <CommentIcon size={18} />
                    <Text style={{ fontSize: "13px", minWidth: "20px", textAlign: "left" }}>
                      {displayPost.reply_count || ""}
                    </Text>
                  </ActionButton>

                  <Box position="relative">
                    <ActionButton
                      $active={reposted}
                      $color="var(--color-success)"
                      onClick={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        setShowRepostMenu(!showRepostMenu);
                      }}
                    >
                      <SyncIcon size={18} />
                      <Text style={{ fontSize: "13px", minWidth: "20px", textAlign: "left" }}>{repostCount || ""}</Text>
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
                    {liked ? <HeartFillIcon size={18} /> : <HeartIcon size={18} />}
                    <Text style={{ fontSize: "13px", minWidth: "20px", textAlign: "left" }}>{likeCount || ""}</Text>
                  </ActionButton>

                  <ActionButton
                    $color="#1d9bf0"
                    onClick={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                    }}
                  >
                    <GraphIcon size={18} />
                    <Text style={{ fontSize: "13px", minWidth: "20px", textAlign: "left" }}>
                      {displayPost.view_count > 0 ? displayPost.view_count : ""}
                    </Text>
                  </ActionButton>

                  <ActionButton $active={bookmarked} $color="#1d9bf0" onClick={handleBookmark}>
                    {bookmarked ? <BookmarkFillIcon size={18} /> : <BookmarkIcon size={18} />}
                    <Text style={{ fontSize: "13px", minWidth: "20px", textAlign: "left" }}>{bookmarkCount || ""}</Text>
                  </ActionButton>

                  <ActionButton
                    $color="var(--color-accent-emphasis)"
                    onClick={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                    }}
                  >
                    <ShareIcon size={18} />
                    <Text style={{ fontSize: "13px", minWidth: "20px", textAlign: "left" }}></Text>
                  </ActionButton>
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
      {showQuoteModal && (
        <ComposeModal
          quotePost={displayPost}
          onClose={() => setShowQuoteModal(false)}
          onPostCreated={() => window.location.reload()}
        />
      )}
      {showReplyModal && (
        <ComposeModal
          replyToPost={displayPost}
          onClose={() => setShowReplyModal(false)}
          onPostCreated={() => window.location.reload()}
        />
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
