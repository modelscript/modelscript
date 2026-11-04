// SPDX-License-Identifier: AGPL-3.0-or-later

import { useWindowVirtualizer } from "@tanstack/react-virtual";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useLanguageEnabled } from "../FeatureFlagContext";
import { estimatePostHeight } from "../util/post-layout";
import Box from "./Box";
import Post from "./Post";
import Spinner from "./Spinner";

export interface PostListItem {
  id?: string | number | undefined;
  is_pinned?: boolean | undefined;
  pinned?: boolean | undefined;
  [key: string]: unknown;
}

export interface VirtualPostListProps<T extends PostListItem = PostListItem> {
  posts: T[];
  isPinnedEvaluator?: ((post: T) => boolean) | undefined;
  renderItem?: ((post: T, index: number, isPinned: boolean) => React.ReactNode) | undefined;
  hasMore?: boolean | undefined;
  loadingMore?: boolean | undefined;
  onLoadMore?: (() => void) | undefined;
  emptyState?: React.ReactNode | undefined;
  loadMoreAction?: React.ReactNode | undefined;
  headerRef?: React.RefObject<HTMLElement | null> | undefined;
}

/**
 * Universal window-virtualized post feed list.
 * Prevents DOM bloat and memory leaks across Home, Profile, Explore, and Bookmarks feeds.
 */
export const VirtualPostList = <T extends PostListItem = PostListItem>({
  posts,
  isPinnedEvaluator,
  renderItem,
  hasMore = false,
  loadingMore = false,
  onLoadMore,
  emptyState,
  loadMoreAction,
  headerRef,
}: VirtualPostListProps<T>): React.ReactElement => {
  const isModelScriptEnabled = useLanguageEnabled("modelscript");

  const visiblePosts = useMemo(() => {
    if (isModelScriptEnabled) return posts;
    return posts.filter((post) => {
      const p = post as unknown as Record<string, unknown>;
      const meta =
        p["metadata"] && typeof p["metadata"] === "object" ? (p["metadata"] as Record<string, unknown>) : undefined;
      const artifactView = p["artifact_view"] as Record<string, unknown> | undefined;
      const metaLang = String(meta?.["language"] || p["language"] || "")
        .trim()
        .toLowerCase();
      const metaDialect = String(meta?.["dialect"] || "")
        .trim()
        .toLowerCase();
      const viewType = String(artifactView?.["view_type"] || p["view_type"] || "")
        .trim()
        .toLowerCase();
      const filename = String(meta?.["filename"] || artifactView?.["name"] || artifactView?.["title"] || "")
        .trim()
        .toLowerCase();
      const title = String(meta?.["artifactTitle"] || artifactView?.["title"] || p["title"] || "")
        .trim()
        .toLowerCase();
      const content = String(p["content"] || "").toLowerCase();

      const isMsx =
        metaLang === "modelscript" ||
        metaLang === "msx" ||
        metaDialect === "modelscript" ||
        metaDialect === "msx" ||
        viewType === "modelscript" ||
        viewType === "msx" ||
        filename.endsWith(".msx") ||
        filename.endsWith(".modelscript") ||
        title.includes(".msx") ||
        content.includes("tiltrotortransitioncontroller.msx") ||
        (content.includes("#modelscript") && (content.includes(".msx") || viewType === "modelscript"));

      return !isMsx;
    });
  }, [posts, isModelScriptEnabled]);

  const [scrollMargin, setScrollMargin] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const loadMoreSentinelRef = useRef<HTMLDivElement>(null);

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

    if (headerRef?.current) {
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
  }, [headerRef, visiblePosts.length]);

  const rowVirtualizer = useWindowVirtualizer({
    count: visiblePosts.length,
    estimateSize: (index) => estimatePostHeight(visiblePosts[index]),
    overscan: 10,
    scrollMargin,
  });

  useEffect(() => {
    const sentinel = loadMoreSentinelRef.current;
    if (!sentinel || loadingMore || !hasMore || visiblePosts.length === 0 || !onLoadMore) return;
    if (typeof IntersectionObserver === "undefined") return;

    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          void onLoadMore();
        }
      },
      { rootMargin: "300px 0px" },
    );
    io.observe(sentinel);
    return () => io.disconnect();
  }, [loadingMore, hasMore, visiblePosts.length, onLoadMore]);

  if (visiblePosts.length === 0) {
    return <>{emptyState ?? null}</>;
  }

  return (
    <Box ref={listRef} style={{ width: "100%", position: "relative" }}>
      <div
        style={{
          position: "relative",
          width: "100%",
          height: `${rowVirtualizer.getTotalSize()}px`,
        }}
      >
        {rowVirtualizer.getVirtualItems().map((virtualItem) => {
          const post = visiblePosts[virtualItem.index];
          if (!post) return null;
          const isPinned = isPinnedEvaluator ? isPinnedEvaluator(post) : Boolean(post.is_pinned || post.pinned);
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
              {renderItem ? (
                renderItem(post, virtualItem.index, isPinned)
              ) : (
                <Post post={post as unknown as React.ComponentProps<typeof Post>["post"]} isPinned={isPinned} />
              )}
            </div>
          );
        })}
      </div>

      {hasMore && (
        <Box ref={loadMoreSentinelRef} p={3} display="flex" justifyContent="center">
          {loadMoreAction ? (
            loadMoreAction
          ) : (
            <button
              type="button"
              onClick={onLoadMore}
              disabled={loadingMore}
              style={{
                padding: "8px 16px",
                borderRadius: "8px",
                border: "1px solid var(--color-border-default)",
                background: "var(--color-btn-secondary-bg)",
                color: "var(--color-text-primary)",
                fontSize: "13px",
                fontWeight: 600,
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: "8px",
              }}
            >
              {loadingMore ? <Spinner size="small" /> : "Load more posts"}
            </button>
          )}
        </Box>
      )}
    </Box>
  );
};

export default VirtualPostList;
