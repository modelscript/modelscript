/* eslint-disable @typescript-eslint/no-explicit-any */
import { ArrowLeftIcon } from "@primer/octicons-react";
import { Heading, Spinner, Text } from "@primer/react";
import React, { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import styled from "styled-components";
import { useAuth } from "../AuthContext";
import Box from "../components/Box";
import ComposeBox from "../components/ComposeBox";
import Post from "../components/Post";
import { CircleIconButton, StickyHeader } from "../components/SharedStyles";
import { API_BASE_URL } from "../config";

const ReplyInputContainer = styled.div`
  display: flex;
  flex-direction: column;
  padding: 4px 16px 12px 16px;
  border-bottom: 1px solid var(--color-border);
`;

const PostDetailPage: React.FC = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { token, user } = useAuth();
  const [post, setPost] = useState<any>(null);
  const [parents, setParents] = useState<any[]>([]);
  const [replies, setReplies] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const viewTrackedRef = useRef<Set<string>>(new Set());
  const mainPostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!loading && post) {
      setTimeout(() => {
        if (mainPostRef.current) {
          const y = mainPostRef.current.getBoundingClientRect().top + window.scrollY - 53;
          window.scrollTo({ top: y, behavior: "smooth" });
        }
      }, 50);
    }
  }, [loading, post]);

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

  return (
    <Box minHeight="100vh" style={{ paddingBottom: "200px" }}>
      <StickyHeader style={{ gap: "24px", padding: "12px 16px" }}>
        <CircleIconButton onClick={() => navigate(-1)}>
          <ArrowLeftIcon size={20} />
        </CircleIconButton>
        <Heading as="h2" style={{ fontSize: "20px", margin: 0 }}>
          Post
        </Heading>
      </StickyHeader>

      {parents.map((parent) => (
        <Post key={parent.id} post={parent} isThread={true} />
      ))}

      <div ref={mainPostRef}>
        <Post post={post} isDetail={true} />
      </div>

      {user && (
        <ReplyInputContainer>
          <ComposeBox
            replyToPost={post}
            onPostCreated={(reply) => navigate(`/${reply.author?.username || reply.username}/status/${reply.id}`)}
          />
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
