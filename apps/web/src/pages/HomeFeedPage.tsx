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
  z-index: 10;
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);

  &::before {
    content: "";
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background-color: var(--color-canvas-default);
    opacity: 0.85;
    z-index: -1;
  }
`;

const Tab = styled.button<{ $active?: boolean }>`
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 53px;
  background: none;
  border: none;
  color: ${(props) => (props.$active ? "var(--color-fg-default)" : "var(--color-fg-muted)")};
  font-weight: ${(props) => (props.$active ? "bold" : "normal")};
  cursor: pointer;
  transition: background-color 0.2s;
  position: relative;

  &:hover {
    background-color: rgba(128, 128, 128, 0.15);
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
    height: 4px;
    background-color: #1f1f1f;
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
  background-color: var(--color-canvas-default);
  border: 1px solid var(--color-border-subtle);
  border-radius: 16px;
  box-shadow: 0 0 15px rgba(0, 0, 0, 0.2);
  padding: 12px 0;
  z-index: 100;

  button {
    width: 100%;
    padding: 12px 16px;
    background: none;
    border: none;
    text-align: left;
    font-size: 15px;
    font-weight: bold;
    color: var(--color-fg-default);
    cursor: pointer;
    display: flex;
    justify-content: space-between;
    align-items: center;

    &:hover {
      background-color: var(--color-canvas-subtle);
    }
  }

  .menu-header {
    padding: 0 16px 8px 16px;
    font-size: 13px;
    font-weight: bold;
    color: var(--color-fg-muted);
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
                      Popular{" "}
                      {followingSort === "popular" && <CheckIcon size={16} color="var(--color-accent-emphasis)" />}
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setFollowingSort("recent");
                        setShowSortMenu(false);
                      }}
                    >
                      Recent{" "}
                      {followingSort === "recent" && <CheckIcon size={16} color="var(--color-accent-emphasis)" />}
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
