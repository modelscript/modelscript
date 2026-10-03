// SPDX-License-Identifier: AGPL-3.0-or-later

/* eslint-disable @typescript-eslint/no-explicit-any */
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
  border-bottom: 1px solid var(--color-border);
  position: sticky;
  top: 0;
  background: rgba(6, 8, 15, 0.85);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
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
  color: ${(props) => (props.$active ? "var(--color-text-heading)" : "var(--color-text-muted)")};
  font-weight: ${(props) => (props.$active ? "700" : "500")};
  cursor: pointer;
  transition:
    background-color 0.2s,
    color 0.2s;
  position: relative;

  &:hover {
    background-color: rgba(255, 255, 255, 0.04);
  }

  &::after {
    content: "";
    position: absolute;
    bottom: 0;
    height: 4px;
    width: 56px;
    background: var(--gradient-cta);
    border-radius: 9999px;
    display: ${(props) => (props.$active ? "block" : "none")};
    box-shadow: var(--glow-purple-sm);
  }
`;

const IconButton = styled.button`
  background: none;
  border: none;
  cursor: pointer;
  padding: 8px;
  border-radius: 50%;
  color: var(--color-text-primary);
  display: flex;
  align-items: center;
  justify-content: center;
  &:hover {
    background-color: rgba(255, 255, 255, 0.06);
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
        const headers = token ? { Authorization: `Bearer ${token}` } : {};
        const [quotesRes, repostsRes] = await Promise.all([
          fetch(`${API_BASE_URL}/social/posts/${id}/quotes`, { headers }),
          fetch(`${API_BASE_URL}/social/posts/${id}/reposts`, { headers }),
        ]);

        if (quotesRes.ok) {
          const data = await quotesRes.json();
          setQuotes(data.quotes || []);
        }
        if (repostsRes.ok) {
          const data = await repostsRes.json();
          setReposts(data.reposts || []);
        }
      } catch (err) {
        console.error("Failed to fetch post activity:", err);
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
            <Box p={6} textAlign="center" color="var(--color-text-muted)">
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
