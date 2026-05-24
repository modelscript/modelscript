/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import { Spinner } from "@primer/react";
import React, { useEffect, useState } from "react";
import styled from "styled-components";
import { useAuth } from "../AuthContext";
import { ComposeContext } from "../components/AppShell";
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

const ComposePrompt = styled.div`
  display: flex;
  gap: 12px;
  padding: 16px;
  border-bottom: 1px solid var(--color-border-default);
  cursor: text;
`;

const Avatar = styled.div<{ $url?: string }>`
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background-color: var(--color-accent-emphasis);
  background-image: ${(props) => (props.$url ? `url(${props.$url})` : "none")};
  background-size: cover;
  flex-shrink: 0;
`;

const ComposeInput = styled.div`
  flex: 1;
  font-size: 20px;
  color: var(--color-fg-muted);
  padding-top: 8px;
`;

const HomeFeedPage: React.FC = () => {
  const { user, token } = useAuth();
  const [posts, setPosts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const { openCompose } = React.useContext(ComposeContext);

  useEffect(() => {
    if (!token) {
      setLoading(false);
      return;
    }
    async function fetchTimeline() {
      try {
        const res = await fetch(`${API_BASE_URL}/social/timeline`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const data = await res.json();
          setPosts(data.posts || []);
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    fetchTimeline();
  }, [token]);

  return (
    <Box>
      <TabBar>
        <Tab $active>For you</Tab>
        <Tab>Following</Tab>
      </TabBar>

      {user && (
        <ComposePrompt onClick={openCompose}>
          <Avatar $url={user.avatar_url} />
          <Box flex={1} display="flex" flexDirection="column">
            <ComposeInput>What is happening?!</ComposeInput>
            <Box display="flex" justifyContent="flex-end" mt={2}>
              <button
                style={{
                  borderRadius: "9999px",
                  backgroundColor: "#1f1f1f",
                  color: "white",
                  border: "none",
                  padding: "8px 16px",
                  fontWeight: "bold",
                  cursor: "pointer",
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  openCompose();
                }}
              >
                Post
              </button>
            </Box>
          </Box>
        </ComposePrompt>
      )}

      {loading ? (
        <Box p={4} display="flex" justifyContent="center">
          <Spinner size="large" />
        </Box>
      ) : (
        <Box>
          {posts.map((post) => (
            <Post key={post.id} post={post} />
          ))}
          {posts.length === 0 && (
            <Box p={6} textAlign="center" color="var(--color-fg-muted)">
              Welcome to ModelScript! No posts to show yet. Follow some people to see their posts here!
            </Box>
          )}
        </Box>
      )}
    </Box>
  );
};

export default HomeFeedPage;
