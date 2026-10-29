// SPDX-License-Identifier: AGPL-3.0-or-later

import { Spinner } from "@primer/react";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { followUser, getTimeline, getTrending, unfollowUser } from "../api";
import { useAuth } from "../AuthContext";
import Box from "../components/Box";
import ComposeBox from "../components/ComposeBox";
import { ComposeContext } from "../components/ComposeContext";
import Post from "../components/Post";
import PostSkeleton from "../components/PostSkeleton";
import { cacheTimelinePosts, getCachedTimelinePosts } from "../util/offline-storage";
import { usePageTitle } from "../util/title";
import type { FilterChip, TopicItem } from "./feed";
import {
  ComposePrompt,
  DEFAULT_CURATED_HASHTAGS,
  FeedEmptyState,
  FeedFilterToolbar,
  FeedTabBar,
  SecondaryActionButton,
} from "./feed";

export type { FilterChip };

const HomeFeedPage: React.FC = () => {
  usePageTitle("Home");
  const { user, token } = useAuth();
  const [posts, setPosts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"forYou" | "following" | "federated">("forYou");
  const [followingSort, setFollowingSort] = useState<"popular" | "recent">("recent");
  const [showSortMenu, setShowSortMenu] = useState(false);
  const [activeFilter, setActiveFilter] = useState<string>("all");
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [trendingTopics, setTrendingTopics] = useState<TopicItem[]>(DEFAULT_CURATED_HASHTAGS);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [scrollMargin, setScrollMargin] = useState(0);
  const headerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const loadMoreSentinelRef = useRef<HTMLDivElement>(null);
  const { openCompose } = React.useContext(ComposeContext);
  const [followedHandles, setFollowedHandles] = useState<Record<string, boolean>>({});

  const handleToggleFollow = async (handle: string) => {
    const isNowFollowing = !followedHandles[handle];
    setFollowedHandles((prev) => ({ ...prev, [handle]: isNowFollowing }));
    if (token) {
      try {
        if (isNowFollowing) {
          await followUser(handle);
        } else {
          await unfollowUser(handle);
        }
      } catch {
        // Fallback gracefully
      }
    }
  };

  useEffect(() => {
    const updateScrollMargin = () => {
      if (listRef.current) {
        setScrollMargin(listRef.current.offsetTop);
      }
    };
    updateScrollMargin();

    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      updateScrollMargin();
    });
    if (headerRef.current) {
      ro.observe(headerRef.current);
    }
    const prevSibling = listRef.current?.previousElementSibling;
    if (prevSibling) {
      ro.observe(prevSibling);
    }
    if (listRef.current?.parentElement) {
      ro.observe(listRef.current.parentElement);
    }
    window.addEventListener("resize", updateScrollMargin);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", updateScrollMargin);
    };
  }, [loading, activeFilter, activeTag, user]);

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
    async function fetchTrending() {
      try {
        const data = await getTrending(10);
        if (data?.topics && data.topics.length > 0) {
          const mapped: TopicItem[] = data.topics.map((t: any) => ({
            concept: t.concept,
            displayName: t.display_name || t.concept,
            postCount: t.post_count,
          }));
          setTrendingTopics(mapped);
        }
      } catch (err) {
        console.error("Failed to fetch trending engineering topics", err);
      }
    }
    fetchTrending();
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
          federated: activeTab === "federated",
          sort: followingSort,
          limit: 20,
          artifactType: activeFilter !== "all" ? activeFilter : undefined,
          tag: activeTag || undefined,
        });
        const fetchedPosts = data.posts || [];
        setPosts(fetchedPosts);
        cacheTimelinePosts(fetchedPosts);
        if (fetchedPosts.length < 20) {
          setHasMore(false);
        }
      } catch (err) {
        console.warn("[HomeFeedPage] Network fetch failed, reading from offline cache:", err);
        const cached = await getCachedTimelinePosts();
        if (cached && cached.length > 0) {
          setPosts(cached);
          setHasMore(false);
        }
      } finally {
        setLoading(false);
      }
    }
    fetchTimeline();
  }, [token, activeTab, followingSort, activeFilter, activeTag]);

  const handleLoadMore = useCallback(async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const data = await getTimeline({
        following: activeTab === "following",
        federated: activeTab === "federated",
        sort: followingSort,
        limit: 20,
        offset: posts.length,
        artifactType: activeFilter !== "all" ? activeFilter : undefined,
        tag: activeTag || undefined,
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
  }, [loadingMore, hasMore, activeTab, followingSort, posts.length, activeFilter, activeTag]);

  useEffect(() => {
    const sentinel = loadMoreSentinelRef.current;
    if (!sentinel || loading || loadingMore || !hasMore || posts.length === 0) return;
    if (typeof IntersectionObserver === "undefined") return;

    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          void handleLoadMore();
        }
      },
      { rootMargin: "300px 0px" },
    );
    io.observe(sentinel);
    return () => io.disconnect();
  }, [loading, loadingMore, hasMore, posts.length, handleLoadMore]);

  useEffect(() => {
    const handlePostCreated = (e: any) => {
      const newPost = e.detail;
      if (newPost) {
        if (newPost.reply_to_id) return;
        setPosts((prev) => (prev.some((p) => p.id === newPost.id) ? prev : [newPost, ...prev]));
      }
    };
    window.addEventListener("modelscript:post-created", handlePostCreated);
    return () => window.removeEventListener("modelscript:post-created", handlePostCreated);
  }, []);

  const isFiltering = activeFilter !== "all" || activeTag !== null;

  return (
    <Box style={{ display: "flex", flexDirection: "column", flex: 1, marginBottom: "-80px" }}>
      <FeedTabBar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        followingSort={followingSort}
        setFollowingSort={setFollowingSort}
        showSortMenu={showSortMenu}
        setShowSortMenu={setShowSortMenu}
      />

      <FeedFilterToolbar
        activeFilter={activeFilter}
        setActiveFilter={setActiveFilter}
        activeTag={activeTag}
        setActiveTag={setActiveTag}
        trendingTopics={trendingTopics}
        postsCount={posts.length}
      />

      <div
        style={{
          background: "var(--color-bg-primary)",
          flex: 1,
          minHeight: "100vh",
          paddingBottom: "200px",
        }}
      >
        <div ref={headerRef}>
          {user && (
            <ComposePrompt>
              <ComposeBox
                onPostCreated={(post) =>
                  setPosts((prev) => (prev.some((p) => p.id === post.id) ? prev : [post, ...prev]))
                }
              />
            </ComposePrompt>
          )}
        </div>

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
                          top: `${virtualItem.start - (rowVirtualizer.options.scrollMargin ?? 0)}px`,
                          left: 0,
                          width: "100%",
                        }}
                      >
                        <Post post={post} />
                      </div>
                    );
                  })}
                </div>
              )}
              {posts.length > 0 && hasMore && (
                <Box ref={loadMoreSentinelRef} p={3} display="flex" justifyContent="center">
                  <SecondaryActionButton onClick={handleLoadMore} disabled={loadingMore}>
                    {loadingMore ? <Spinner size="small" /> : "Load more posts"}
                  </SecondaryActionButton>
                </Box>
              )}
              {posts.length === 0 && (
                <FeedEmptyState
                  isFiltering={isFiltering}
                  activeFilter={activeFilter}
                  activeTag={activeTag}
                  onClearFilters={() => {
                    setActiveFilter("all");
                    setActiveTag(null);
                  }}
                  openCompose={openCompose}
                  followedHandles={followedHandles}
                  onToggleFollow={handleToggleFollow}
                />
              )}
            </Box>
          )}
        </div>
      </div>
    </Box>
  );
};

export default HomeFeedPage;
