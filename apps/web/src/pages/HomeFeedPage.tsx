// SPDX-License-Identifier: AGPL-3.0-or-later

import { PlayIcon } from "@primer/octicons-react";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { getTimeline } from "../api";
import { useAuth } from "../AuthContext";
import { AnsatzMark } from "../components/AnsatzLogo";
import Box from "../components/Box";
import ComposeBox from "../components/ComposeBox";
import { ComposeContext } from "../components/ComposeContext";
import PostSkeleton from "../components/PostSkeleton";
import { scrollToTop } from "../components/ScrollToTop";
import Spinner from "../components/Spinner";
import { VirtualPostList } from "../components/VirtualPostList";
import { useInstanceBranding } from "../InstanceBrandingContext";
import { useTheme } from "../theme";
import { cacheTimelinePosts, getCachedTimelinePosts } from "../util/offline-storage";
import { usePageTitle } from "../util/title";
import type { FilterChip } from "./feed";
import {
  ComposePrompt,
  FeedEmptyState,
  FeedTabBar,
  MobileComposePromptBar,
  MobileFeedTopBar,
  SecondaryActionButton,
} from "./feed";

export type { FilterChip };

const HomeFeedPage: React.FC = () => {
  usePageTitle("Home");
  const { user, token } = useAuth();
  const { theme } = useTheme();
  const branding = useInstanceBranding();
  const brandName = branding.instanceName || "Ansatz";
  const customLogoSrc = theme === "dark" ? branding.brandLogoDarkUrl || branding.brandLogoUrl : branding.brandLogoUrl;
  const [posts, setPosts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"forYou" | "following" | "federated">("forYou");
  const [followingSort, setFollowingSort] = useState<"popular" | "recent">("recent");
  const [showSortMenu, setShowSortMenu] = useState(false);
  const [activeFilter, setActiveFilter] = useState<string>("all");
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const headerRef = useRef<HTMLDivElement>(null);
  const { openCompose } = React.useContext(ComposeContext);

  useEffect(() => {
    if (!showSortMenu) return;
    const handlePointerDown = (e: MouseEvent | TouchEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && !target.closest(".sort-menu-container")) {
        setShowSortMenu(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setShowSortMenu(false);
      }
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [showSortMenu]);

  useEffect(() => {
    if (!token) {
      setPosts([]);
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
      <MobileFeedTopBar>
        {user ? (
          <Link
            to={`/${user.username}`}
            aria-label="Your profile"
            style={{
              width: 30,
              height: 30,
              borderRadius: "50%",
              backgroundColor: "var(--ms-brand-soft)",
              backgroundImage: user.avatar_url ? `url(${user.avatar_url})` : "none",
              backgroundSize: "cover",
              backgroundPosition: "center",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 12,
              fontWeight: 700,
              color: "var(--ms-brand)",
              textDecoration: "none",
              flexShrink: 0,
            }}
          >
            {user.avatar_url ? null : user.username.charAt(0).toUpperCase()}
          </Link>
        ) : (
          <span style={{ width: 30 }} />
        )}
        <button
          type="button"
          onClick={() => scrollToTop({ smooth: true })}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            background: "none",
            border: "none",
            color: "var(--color-text-heading)",
            fontWeight: 750,
            fontSize: 16,
            cursor: "pointer",
            padding: "4px 8px",
          }}
          aria-label={`${brandName} — scroll to top`}
        >
          <AnsatzMark size={24} logoUrl={customLogoSrc} alt={brandName} accentColor={branding.brandAccentColor} />
          <span>{brandName}</span>
        </button>
        <Link
          to="/playground"
          title="Open Playground"
          aria-label="Open Playground"
          style={{
            width: 30,
            height: 30,
            borderRadius: "50%",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--ms-brand)",
            background: "var(--ms-brand-soft)",
            textDecoration: "none",
            flexShrink: 0,
          }}
        >
          <PlayIcon size={14} />
        </Link>
      </MobileFeedTopBar>

      <FeedTabBar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        followingSort={followingSort}
        setFollowingSort={setFollowingSort}
        showSortMenu={showSortMenu}
        setShowSortMenu={setShowSortMenu}
      />

      <div
        style={{
          background: "var(--color-bg-primary)",
          flex: 1,
          minHeight: "100dvh",
          paddingBottom: "200px",
        }}
      >
        <div ref={headerRef} data-tour-id="tour-timeline">
          {user && (
            <>
              <ComposePrompt>
                <ComposeBox
                  onPostCreated={(post) =>
                    setPosts((prev) => (prev.some((p) => p.id === post.id) ? prev : [post, ...prev]))
                  }
                />
              </ComposePrompt>
              <MobileComposePromptBar type="button" onClick={() => openCompose()}>
                <div
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: "50%",
                    backgroundColor: "var(--ms-brand-soft)",
                    backgroundImage: user.avatar_url ? `url(${user.avatar_url})` : "none",
                    backgroundSize: "cover",
                    backgroundPosition: "center",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 12,
                    fontWeight: 700,
                    color: "var(--ms-brand)",
                    flexShrink: 0,
                  }}
                >
                  {user.avatar_url ? null : user.username.charAt(0).toUpperCase()}
                </div>
                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  Share a model, simulation, or note…
                </span>
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 650,
                    padding: "4px 12px",
                    borderRadius: 999,
                    background: "var(--ms-brand)",
                    color: "var(--ms-brand-contrast, #fff)",
                    flexShrink: 0,
                  }}
                >
                  Post
                </span>
              </MobileComposePromptBar>
            </>
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
            <VirtualPostList
              posts={posts}
              hasMore={hasMore}
              loadingMore={loadingMore}
              onLoadMore={handleLoadMore}
              headerRef={headerRef}
              loadMoreAction={
                <SecondaryActionButton onClick={handleLoadMore} disabled={loadingMore}>
                  {loadingMore ? <Spinner size="small" /> : "Load more posts"}
                </SecondaryActionButton>
              }
              emptyState={
                <FeedEmptyState
                  isFiltering={isFiltering}
                  activeFilter={activeFilter}
                  activeTag={activeTag}
                  onClearFilters={() => {
                    setActiveFilter("all");
                    setActiveTag(null);
                  }}
                  openCompose={openCompose}
                />
              }
            />
          )}
        </div>
      </div>
    </Box>
  );
};

export default HomeFeedPage;
