/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import { ArrowLeftIcon } from "@primer/octicons-react";
import { Spinner, Text } from "@primer/react";
import React, { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import styled from "styled-components";
import { useAuth } from "../AuthContext";
import Box from "../components/Box";
import Post from "../components/Post";
import { API_BASE_URL } from "../config";

const TabBar = styled.div`
  display: flex;
  border-bottom: 1px solid var(--color-border-default);
  position: sticky;
  top: 0;
  background-color: transparent;
  backdrop-filter: blur(12px);
  z-index: 10;
`;

const Tab = styled.button<{ $active?: boolean }>`
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: none;
  border: none;
  color: ${(props) => (props.$active ? "var(--color-fg-default)" : "var(--color-fg-muted)")};
  font-weight: ${(props) => (props.$active ? "bold" : "normal")};
  cursor: pointer;
  transition: background-color 0.2s;
  position: relative;

  &:hover {
    background-color: var(--color-canvas-subtle);
  }

  &::after {
    content: "";
    position: absolute;
    bottom: 0;
    height: 4px;
    width: 56px;
    background-color: #1f1f1f;
    border-radius: 9999px;
    display: ${(props) => (props.$active ? "block" : "none")};
  }
`;

const IconButton = styled.button`
  background: none;
  border: none;
  cursor: pointer;
  padding: 8px;
  border-radius: 50%;
  color: var(--color-fg-default);
  display: flex;
  align-items: center;
  justify-content: center;
  &:hover {
    background-color: var(--color-canvas-subtle);
  }
`;

const PostActivityPage: React.FC = () => {
  const { username, id } = useParams();
  const navigate = useNavigate();
  const { token } = useAuth();

  const [activeTab, setActiveTab] = useState<"quotes" | "reposts">("quotes");
  const [quotes, setQuotes] = useState<any[]>([]);
  const [reposts, setReposts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchActivity() {
      setLoading(true);
      try {
        // Ideally these would be specialized endpoints
        // For now, we simulate by fetching replies and filtering or just fetching a timeline
        // Real implementation should be fetching GET /posts/:id/quotes and GET /posts/:id/reposts

        // Since we don't have dedicated endpoints yet, let's fetch generic replies as a fallback or if we have them:
        const quotesRes = await fetch(`${API_BASE_URL}/social/posts/${id}/replies`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });

        if (quotesRes.ok) {
          const data = await quotesRes.json();
          // Filter out true quotes if possible, or just show them
          setQuotes(data.posts.filter((p: any) => p.quote_post_id === Number(id)) || []);
          setReposts(data.posts.filter((p: any) => p.repost_of_id === Number(id)) || []);
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    fetchActivity();
  }, [id, token]);

  const displayPosts = activeTab === "quotes" ? quotes : reposts;

  return (
    <Box display="flex" flexDirection="column" minHeight="100vh">
      <Box
        display="flex"
        alignItems="center"
        p={3}
        borderBottom="1px solid var(--color-border-default)"
        position="sticky"
        top={0}
        bg="var(--color-canvas-default)"
        zIndex={10}
      >
        <IconButton onClick={() => navigate(`/${username}/status/${id}`)}>
          <ArrowLeftIcon size={20} />
        </IconButton>
        <Box ml={3}>
          <Text fontWeight="bold" fontSize="18px">
            Post activity
          </Text>
        </Box>
      </Box>

      <TabBar>
        <Tab $active={activeTab === "quotes"} onClick={() => setActiveTab("quotes")}>
          Quotes
        </Tab>
        <Tab $active={activeTab === "reposts"} onClick={() => setActiveTab("reposts")}>
          Reposts
        </Tab>
      </TabBar>

      {loading ? (
        <Box p={4} display="flex" justifyContent="center">
          <Spinner size="large" />
        </Box>
      ) : (
        <Box>
          {displayPosts.map((post) => (
            <Post key={post.id} post={post} />
          ))}
          {displayPosts.length === 0 && (
            <Box p={6} textAlign="center" color="var(--color-fg-muted)">
              <Text fontSize="16px" fontWeight="bold" display="block" mb={2}>
                No {activeTab} yet
              </Text>
              <Text fontSize="14px">
                When someone {activeTab === "quotes" ? "quotes" : "reposts"} this post, it will show up here.
              </Text>
            </Box>
          )}
        </Box>
      )}
    </Box>
  );
};

export default PostActivityPage;
