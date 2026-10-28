// SPDX-License-Identifier: AGPL-3.0-or-later

import { Spinner, Text } from "@primer/react";
import React, { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import styled from "styled-components";
import { getPostQuotes, getPostReposts } from "../api";
import { useAuth } from "../AuthContext";
import Box from "../components/Box";
import PageHeader from "../components/PageHeader";
import Post from "../components/Post";
import type { PostItem } from "../types/api";
import { usePageTitle } from "../util/title";

const TabBar = styled.div`
  display: flex;
  border-bottom: 1px solid var(--color-border);
  position: sticky;
  top: calc(var(--dev-header-height, 0px) + 53px);
  background: var(--surface-hud, rgba(6, 8, 15, 0.85));
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  z-index: 9;
`;

const Tab = styled.button<{ $active?: boolean | undefined }>`
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
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
    background-color: var(--surface-row-hover);
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

const PostActivityPage: React.FC = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { token } = useAuth();

  const [activeTab, setActiveTab] = useState<"quotes" | "reposts">("quotes");
  usePageTitle("Post Activity");
  const [quotes, setQuotes] = useState<PostItem[]>([]);
  const [reposts, setReposts] = useState<PostItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchActivity() {
      if (!id) return;
      setLoading(true);
      try {
        const [quotesData, repostsData] = await Promise.all([getPostQuotes(id), getPostReposts(id)]);

        setQuotes(quotesData.quotes || []);
        setReposts(repostsData.reposts || []);
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
      <PageHeader
        back={() => navigate(-1)}
        title="Post Activity"
        subtitle="Quotes and reposts across the network"
        divider={false}
      />

      <TabBar>
        <Tab $active={activeTab === "quotes"} onClick={() => setActiveTab("quotes")}>
          Quotes ({quotes.length})
        </Tab>
        <Tab $active={activeTab === "reposts"} onClick={() => setActiveTab("reposts")}>
          Reposts ({reposts.length})
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
