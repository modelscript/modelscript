// SPDX-License-Identifier: AGPL-3.0-or-later

/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import { CheckIcon, ChevronDownIcon } from "@primer/octicons-react";
import { Spinner } from "@primer/react";
import React, { useEffect, useState } from "react";
import styled from "styled-components";
import { useAuth } from "../AuthContext";
import Box from "../components/Box";
import ComposeBox from "../components/ComposeBox";
import { ComposeContext } from "../components/ComposeContext";
import Post from "../components/Post";
import { API_BASE_URL } from "../config";

const TabBar = styled.div`
  display: flex;
  border-bottom: 1px solid var(--color-border);
  position: sticky;
  top: var(--dev-header-height, 0px);
  z-index: 20;
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  background: rgba(6, 8, 15, 0.85);
`;

const Tab = styled.button<{ $active?: boolean }>`
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 53px;
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
`;

const TabText = styled.div<{ $active?: boolean }>`
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;

  &::after {
    content: "";
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    height: 3px;
    background: var(--gradient-cta);
    box-shadow: 0 0 10px rgba(139, 92, 246, 0.5);
    border-radius: 9999px;
    display: ${(props) => (props.$active ? "block" : "none")};
  }
`;

const SortMenu = styled.div`
  position: absolute;
  top: 30px;
  left: 50%;
  transform: translateX(-50%);
  width: 160px;
  background-color: rgba(14, 20, 36, 0.95);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border: 1px solid var(--color-border-glass);
  border-radius: 16px;
  box-shadow: var(--glow-card);
  padding: 12px 0;
  z-index: 100;

  button {
    width: 100%;
    padding: 12px 16px;
    background: none;
    border: none;
    text-align: left;
    font-size: 14px;
    font-weight: 600;
    color: var(--color-text-primary);
    cursor: pointer;
    display: flex;
    justify-content: space-between;
    align-items: center;

    &:hover {
      background-color: rgba(255, 255, 255, 0.06);
    }
  }

  .menu-header {
    padding: 0 16px 8px 16px;
    font-size: 12px;
    font-weight: 600;
    color: var(--color-text-muted);
    border-bottom: 1px solid var(--color-border);
    margin-bottom: 8px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
`;

const ComposePrompt = styled.div`
  display: flex;
  gap: 12px;
  padding: 16px;
  border-bottom: 1px solid var(--color-border);
  cursor: text;
`;

const HomeFeedPage: React.FC = () => {
  const { user, token } = useAuth();
  const [posts, setPosts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"forYou" | "following">("forYou");
  const [followingSort, setFollowingSort] = useState<"popular" | "recent">("recent");
  const [showSortMenu, setShowSortMenu] = useState(false);
  const { openCompose } = React.useContext(ComposeContext);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest(".sort-menu-container")) {
        setShowSortMenu(false);
      }
    };
    document.addEventListener("click", handleClickOutside);
    return () => document.removeEventListener("click", handleClickOutside);
  }, []);

  useEffect(() => {
    if (!token) {
      setLoading(false);
      return;
    }
    async function fetchTimeline() {
      setLoading(true);
      try {
        const endpoint =
          activeTab === "following" ? `/social/timeline/following?sort=${followingSort}` : "/social/timeline";
        const res = await fetch(`${API_BASE_URL}${endpoint}`, {
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
  }, [token, activeTab, followingSort]);

  useEffect(() => {
    const handlePostCreated = (e: any) => {
      const newPost = e.detail;
      if (newPost) {
        setPosts((prev) => [newPost, ...prev]);
      }
    };
    window.addEventListener("modelscript:post-created", handlePostCreated);
    return () => window.removeEventListener("modelscript:post-created", handlePostCreated);
  }, []);

  return (
    <Box style={{ paddingBottom: "200px" }}>
      <TabBar>
        <Tab onClick={() => setActiveTab("forYou")}>
          <TabText $active={activeTab === "forYou"}>For you</TabText>
        </Tab>
        <Tab
          className="sort-menu-container"
          onClick={() => {
            if (activeTab === "following") {
              setShowSortMenu(!showSortMenu);
            } else {
              setActiveTab("following");
            }
          }}
        >
          <TabText $active={activeTab === "following"}>
            Following
            {activeTab === "following" && (
              <div style={{ position: "relative" }}>
                <span style={{ marginLeft: "4px", padding: "2px", display: "inline-flex", alignItems: "center" }}>
                  <ChevronDownIcon size={16} />
                </span>
                {showSortMenu && (
                  <SortMenu>
                    <div className="menu-header">Sort by</div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setFollowingSort("popular");
                        setShowSortMenu(false);
                      }}
                    >
                      Popular {followingSort === "popular" && <CheckIcon size={16} color="var(--color-accent-cyan)" />}
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setFollowingSort("recent");
                        setShowSortMenu(false);
                      }}
                    >
                      Recent {followingSort === "recent" && <CheckIcon size={16} color="var(--color-accent-cyan)" />}
                    </button>
                  </SortMenu>
                )}
              </div>
            )}
          </TabText>
        </Tab>
      </TabBar>

      {user && (
        <ComposePrompt>
          <ComposeBox onPostCreated={(post) => setPosts([post, ...posts])} />
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
            <Box p={6} textAlign="center" color="var(--color-text-muted)">
              Welcome to ModelScript! No posts to show yet. Follow some people to see their posts here!
            </Box>
          )}
        </Box>
      )}
    </Box>
  );
};

export default HomeFeedPage;
