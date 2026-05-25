/* eslint-disable @typescript-eslint/no-explicit-any */
import { ArrowLeftIcon, ImageIcon, LocationIcon, PaperclipIcon, SmileyIcon } from "@primer/octicons-react";
import { Heading, Spinner, Text } from "@primer/react";
import React, { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import styled from "styled-components";
import { useAuth } from "../AuthContext";
import Box from "../components/Box";
import Post from "../components/Post";
import { API_BASE_URL } from "../config";

const ReplyInputContainer = styled.div`
  display: flex;
  flex-direction: column;
  padding: 12px 16px;
  border-bottom: 1px solid var(--color-border);
`;

const ReplyRow = styled.div`
  display: flex;
  gap: 12px;
`;

const ReplyContentCol = styled.div`
  display: flex;
  flex-direction: column;
  flex: 1;
`;

const ReplyInput = styled.input`
  color: var(--color-fg-default);
  font-size: 20px;
  flex: 1;
  border: none;
  background: transparent;
  outline: none;
  padding-top: 8px;
  padding-bottom: 8px;
  &::placeholder {
    color: var(--color-fg-muted);
  }
`;

const ReplyButton = styled.button<{ $disabled?: boolean }>`
  background-color: var(--color-btn-primary-bg, #0969da);
  color: white;
  border: none;
  border-radius: 9999px;
  padding: 8px 16px;
  font-weight: bold;
  font-size: 15px;
  cursor: ${(props) => (props.$disabled ? "default" : "pointer")};
  opacity: ${(props) => (props.$disabled ? 0.5 : 1)};
  transition: opacity 0.2s;
`;

const IconButton = styled.button`
  background: none;
  border: none;
  cursor: pointer;
  padding: 8px;
  border-radius: 50%;
  color: var(--color-accent-fg);
  display: flex;
  align-items: center;
  justify-content: center;
  &:hover {
    background-color: var(--color-accent-subtle);
  }
`;

const PostDetailPage: React.FC = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { token, user } = useAuth();
  const [post, setPost] = useState<any>(null);
  const [parents, setParents] = useState<any[]>([]);
  const [replies, setReplies] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [replyContent, setReplyContent] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const viewTrackedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    async function fetchPost() {
      try {
        // Fire and forget view increment (prevent duplicate in Strict Mode)
        if (id && !viewTrackedRef.current.has(id)) {
          viewTrackedRef.current.add(id);
          fetch(`${API_BASE_URL}/social/posts/${id}/view`, {
            method: "POST",
            headers: token ? { Authorization: `Bearer ${token}` } : {},
          }).catch(console.error);
        }

        const res = await fetch(`${API_BASE_URL}/social/posts/${id}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (res.ok) {
          const data = await res.json();
          setPost(data.post);
        }

        const repliesRes = await fetch(`${API_BASE_URL}/social/posts/${id}/replies`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (repliesRes.ok) {
          const repliesData = await repliesRes.json();
          setReplies(repliesData.posts);
        }

        const parentsRes = await fetch(`${API_BASE_URL}/social/posts/${id}/parents`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (parentsRes.ok) {
          const parentsData = await parentsRes.json();
          setParents(parentsData.posts);
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    fetchPost();
  }, [id, token]);

  const handleReply = async () => {
    if (!replyContent.trim() || isSubmitting) return;
    setIsSubmitting(true);
    try {
      const res = await fetch(`${API_BASE_URL}/social/posts`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          content: replyContent,
          reply_to_id: post.id,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setReplies((prev) => [data.post, ...prev]);
        setReplyContent("");
        setIsFocused(false);
        if (inputRef.current) inputRef.current.blur();
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (loading) {
    return (
      <Box p={4} display="flex" justifyContent="center">
        <Spinner size="large" />
      </Box>
    );
  }

  if (!post) {
    return (
      <Box p={4}>
        <Heading as="h2">Post not found</Heading>
      </Box>
    );
  }

  const showToolbar = isFocused || replyContent.length > 0;

  return (
    <Box minHeight="100vh">
      <Box p={3} borderBottom="1px solid var(--color-border)" display="flex" alignItems="center" gap={4}>
        <div style={{ cursor: "pointer", display: "flex" }} onClick={() => navigate(-1)}>
          <ArrowLeftIcon size={20} />
        </div>
        <Heading as="h2" style={{ fontSize: "20px" }}>
          Post
        </Heading>
      </Box>

      {parents.map((parent) => (
        <Post key={parent.id} post={parent} />
      ))}

      <Post post={post} isDetail={true} />

      {user && (
        <ReplyInputContainer>
          {showToolbar && (
            <Box pl="60px" pb={2}>
              <Text color="var(--color-fg-muted)" style={{ fontSize: "15px" }}>
                Replying to <span style={{ color: "var(--color-accent-fg)" }}>@{post.username}</span>
              </Text>
            </Box>
          )}
          <ReplyRow>
            {user.avatar_url ? (
              <img
                src={user.avatar_url}
                alt="avatar"
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: "50%",
                  flexShrink: 0,
                  objectFit: "cover",
                  backgroundColor: "var(--color-canvas-subtle)",
                }}
              />
            ) : (
              <div
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: "50%",
                  backgroundColor: "var(--color-accent-emphasis)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "white",
                  fontWeight: "bold",
                  flexShrink: 0,
                  fontSize: 20,
                }}
              >
                {user.username?.charAt(0).toUpperCase()}
              </div>
            )}
            <ReplyContentCol>
              <Box display="flex" alignItems="center" gap={2}>
                <ReplyInput
                  ref={inputRef}
                  placeholder="Post your reply"
                  value={replyContent}
                  onChange={(e) => setReplyContent(e.target.value)}
                  onFocus={() => setIsFocused(true)}
                  onBlur={() => setTimeout(() => setIsFocused(false), 200)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleReply();
                  }}
                  disabled={isSubmitting}
                />
                {!showToolbar && (
                  <ReplyButton
                    $disabled={!replyContent.trim() || isSubmitting}
                    disabled={!replyContent.trim() || isSubmitting}
                    onClick={handleReply}
                  >
                    Reply
                  </ReplyButton>
                )}
              </Box>

              {showToolbar && (
                <Box display="flex" justifyContent="space-between" alignItems="center" mt={2}>
                  <Box display="flex" gap={1}>
                    <IconButton>
                      <ImageIcon size={18} />
                    </IconButton>
                    <IconButton>
                      <PaperclipIcon size={18} />
                    </IconButton>
                    <IconButton>
                      <SmileyIcon size={18} />
                    </IconButton>
                    <IconButton>
                      <LocationIcon size={18} />
                    </IconButton>
                  </Box>
                  <ReplyButton
                    $disabled={!replyContent.trim() || isSubmitting}
                    disabled={!replyContent.trim() || isSubmitting}
                    onClick={handleReply}
                  >
                    Reply
                  </ReplyButton>
                </Box>
              )}
            </ReplyContentCol>
          </ReplyRow>
        </ReplyInputContainer>
      )}

      {replies.length > 0 ? (
        <Box>
          {replies.map((reply) => (
            <Post key={reply.id} post={reply} />
          ))}
        </Box>
      ) : (
        <Box p={4} textAlign="center">
          <Text color="var(--color-fg-muted)">No replies yet.</Text>
        </Box>
      )}
    </Box>
  );
};

export default PostDetailPage;
