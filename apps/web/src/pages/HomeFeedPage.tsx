// SPDX-License-Identifier: AGPL-3.0-or-later

/* eslint-disable @typescript-eslint/no-explicit-any */
import { CheckIcon, ChevronDownIcon, PlusIcon, RocketIcon, SearchIcon } from "@primer/octicons-react";
import { Spinner } from "@primer/react";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import styled from "styled-components";
import { getTimeline } from "../api";
import { useAuth } from "../AuthContext";
import Box from "../components/Box";
import ComposeBox from "../components/ComposeBox";
import { ComposeContext } from "../components/ComposeContext";
import Post from "../components/Post";
import PostSkeleton from "../components/PostSkeleton";
import { usePageTitle } from "../util/title";

const TabBar = styled.div`
  display: flex;
  border-bottom: 1px solid var(--color-border);
  position: sticky;
  top: var(--dev-header-height, 0px);
  z-index: 20;
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  background: var(--surface-hud);
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
  outline: none;

  &:hover {
    background-color: var(--surface-row-hover);
  }

  &:focus-visible {
    box-shadow: inset 0 0 0 2px var(--color-accent-cyan);
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
    border-radius: var(--radius-pill);
    display: ${(props) => (props.$active ? "block" : "none")};
  }
`;

const SortMenu = styled.div`
  position: absolute;
  top: 30px;
  left: 50%;
  transform: translateX(-50%);
  width: 160px;
  background-color: var(--surface-overlay);
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
      background-color: var(--surface-row-hover);
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

const EmptyStateContainer = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 56px 24px;
  max-width: 440px;
  margin: 0 auto;
`;

const EmptyStateIconOrb = styled.div`
  width: 64px;
  height: 64px;
  border-radius: var(--radius-lg);
  background: var(--gradient-ai-subtle);
  border: 1px solid var(--color-accent-purple-border);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-accent-cyan);
  box-shadow: var(--glow-ai-sm);
  margin-bottom: 20px;
`;

const EmptyStateTitle = styled.h2`
  font-size: 20px;
  font-weight: 700;
  color: var(--color-text-heading);
  margin: 0 0 8px 0;
  letter-spacing: -0.3px;
`;

const EmptyStateSubtitle = styled.p`
  font-size: 14px;
  color: var(--color-text-muted);
  line-height: 1.5;
  margin: 0 0 24px 0;
`;

const EmptyStateActions = styled.div`
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  justify-content: center;
`;

const PrimaryActionButton = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 8px;
  background: var(--gradient-cta);
  color: white;
  border: none;
  border-radius: var(--radius-md);
  padding: 10px 18px;
  font-size: 13.5px;
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
  box-shadow: 0 0 14px rgba(139, 92, 246, 0.35);
  transition: all 0.2s ease;

  &:hover {
    box-shadow: 0 0 20px rgba(6, 182, 212, 0.5);
    transform: translateY(-1px);
  }
`;

const SecondaryActionButton = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 8px;
  background: var(--color-btn-secondary-bg);
  border: 1px solid var(--color-btn-secondary-border);
  color: var(--color-btn-secondary-text);
  border-radius: var(--radius-md);
  padding: 10px 18px;
  font-size: 13.5px;
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
  transition: all 0.2s ease;

  &:hover {
    background: var(--surface-row-hover);
    border-color: rgba(255, 255, 255, 0.2);
  }
`;

const HomeFeedPage: React.FC = () => {
  usePageTitle("Home");
  const navigate = useNavigate();
  const { user, token } = useAuth();
  const [posts, setPosts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"forYou" | "following">("forYou");
  const [followingSort, setFollowingSort] = useState<"popular" | "recent">("recent");
  const [showSortMenu, setShowSortMenu] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [scrollMargin, setScrollMargin] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const { openCompose } = React.useContext(ComposeContext);

  useEffect(() => {
    if (listRef.current) {
      setScrollMargin(listRef.current.offsetTop);
    }
  }, []);

  const rowVirtualizer = useWindowVirtualizer({
    count: posts.length,
    estimateSize: () => 180,
    overscan: 5,
    scrollMargin,
  });

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
      setHasMore(true);
      try {
        const data = await getTimeline({
          following: activeTab === "following",
          sort: followingSort,
          limit: 20,
        });
        const fetchedPosts = data.posts || [];
        setPosts(fetchedPosts);
        if (fetchedPosts.length < 20) {
          setHasMore(false);
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    fetchTimeline();
  }, [token, activeTab, followingSort]);

  const handleLoadMore = async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const data = await getTimeline({
        following: activeTab === "following",
        sort: followingSort,
        limit: 20,
        offset: posts.length,
      });
      const newPosts = data.posts || [];
      if (newPosts.length === 0) {
        setHasMore(false);
      } else {
        setPosts((prev) => [...prev, ...newPosts]);
        if (newPosts.length < 20) {
          setHasMore(false);
        }
      }
    } catch (err) {
      console.error("Failed to load more posts", err);
    } finally {
      setLoadingMore(false);
    }
  };

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

  const handleKeyDownTab = (e: React.KeyboardEvent, currentTab: "forYou" | "following") => {
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      const nextTab = currentTab === "forYou" ? "following" : "forYou";
      setActiveTab(nextTab);
      const nextElement = document.getElementById(`feed-tab-${nextTab}`);
      nextElement?.focus();
    }
  };

  return (
    <Box style={{ paddingBottom: "200px" }}>
      <TabBar role="tablist" aria-label="Feed sections">
        <Tab
          id="feed-tab-forYou"
          role="tab"
          aria-selected={activeTab === "forYou"}
          aria-controls="feed-tabpanel"
          tabIndex={activeTab === "forYou" ? 0 : -1}
          $active={activeTab === "forYou"}
          onClick={() => setActiveTab("forYou")}
          onKeyDown={(e) => handleKeyDownTab(e, "forYou")}
        >
          <TabText $active={activeTab === "forYou"}>For you</TabText>
        </Tab>
        <Tab
          id="feed-tab-following"
          role="tab"
          aria-selected={activeTab === "following"}
          aria-controls="feed-tabpanel"
          tabIndex={activeTab === "following" ? 0 : -1}
          $active={activeTab === "following"}
          className="sort-menu-container"
          onClick={() => {
            if (activeTab === "following") {
              setShowSortMenu(!showSortMenu);
            } else {
              setActiveTab("following");
            }
          }}
          onKeyDown={(e) => handleKeyDownTab(e, "following")}
        >
          <TabText $active={activeTab === "following"}>
            Following
            {activeTab === "following" && (
              <div style={{ position: "relative" }}>
                <span style={{ marginLeft: "4px", padding: "2px", display: "inline-flex", alignItems: "center" }}>
                  <ChevronDownIcon size={16} />
                </span>
                {showSortMenu && (
                  <SortMenu role="menu" aria-label="Sort following feed">
                    <div className="menu-header">Sort by</div>
                    <button
                      role="menuitem"
                      onClick={(e) => {
                        e.stopPropagation();
                        setFollowingSort("popular");
                        setShowSortMenu(false);
                      }}
                    >
                      Popular {followingSort === "popular" && <CheckIcon size={16} fill="var(--color-accent-cyan)" />}
                    </button>
                    <button
                      role="menuitem"
                      onClick={(e) => {
                        e.stopPropagation();
                        setFollowingSort("recent");
                        setShowSortMenu(false);
                      }}
                    >
                      Recent {followingSort === "recent" && <CheckIcon size={16} fill="var(--color-accent-cyan)" />}
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

      <div id="feed-tabpanel" role="tabpanel" aria-labelledby={`feed-tab-${activeTab}`}>
        {loading ? (
          <Box>
            <PostSkeleton />
            <PostSkeleton hasArtifact />
            <PostSkeleton />
          </Box>
        ) : (
          <Box ref={listRef}>
            {posts.length > 0 && (
              <div
                style={{
                  position: "relative",
                  width: "100%",
                  height: `${rowVirtualizer.getTotalSize()}px`,
                }}
              >
                {rowVirtualizer.getVirtualItems().map((virtualItem) => {
                  const post = posts[virtualItem.index];
                  return (
                    <div
                      key={post.id || virtualItem.key}
                      data-index={virtualItem.index}
                      ref={rowVirtualizer.measureElement}
                      style={{
                        position: "absolute",
                        top: 0,
                        left: 0,
                        width: "100%",
                        transform: `translateY(${virtualItem.start - (rowVirtualizer.options.scrollMargin ?? 0)}px)`,
                      }}
                    >
                      <Post post={post} />
                    </div>
                  );
                })}
              </div>
            )}
            {posts.length > 0 && hasMore && (
              <Box p={3} display="flex" justifyContent="center">
                <SecondaryActionButton onClick={handleLoadMore} disabled={loadingMore}>
                  {loadingMore ? <Spinner size="small" /> : "Load more posts"}
                </SecondaryActionButton>
              </Box>
            )}
            {posts.length === 0 && (
              <EmptyStateContainer>
                <EmptyStateIconOrb>
                  <RocketIcon size={28} />
                </EmptyStateIconOrb>
                <EmptyStateTitle>Engineering Timeline Ready</EmptyStateTitle>
                <EmptyStateSubtitle>
                  Follow physical modeling engineers, explore Modelica &amp; SysML packages, or publish your first
                  simulation artifact.
                </EmptyStateSubtitle>
                <EmptyStateActions>
                  <PrimaryActionButton onClick={() => navigate("/explore")}>
                    <SearchIcon size={16} />
                    <span>Explore Models</span>
                  </PrimaryActionButton>
                  {openCompose && (
                    <SecondaryActionButton onClick={() => openCompose()}>
                      <PlusIcon size={16} />
                      <span>Create First Post</span>
                    </SecondaryActionButton>
                  )}
                </EmptyStateActions>
              </EmptyStateContainer>
            )}
          </Box>
        )}
      </div>
    </Box>
  );
};

export default HomeFeedPage;
