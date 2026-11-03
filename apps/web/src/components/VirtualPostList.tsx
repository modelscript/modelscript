// SPDX-License-Identifier: AGPL-3.0-or-later

import { Spinner } from "@primer/react";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import React, { useEffect, useRef, useState } from "react";
import { estimatePostHeight } from "../util/post-layout";
import Box from "./Box";
import Post from "./Post";

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
  }, [headerRef, posts.length]);

  const rowVirtualizer = useWindowVirtualizer({
    count: posts.length,
    estimateSize: (index) => estimatePostHeight(posts[index]),
    overscan: 5,
    scrollMargin,
  });

  useEffect(() => {
    const sentinel = loadMoreSentinelRef.current;
    if (!sentinel || loadingMore || !hasMore || posts.length === 0 || !onLoadMore) return;
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
  }, [loadingMore, hasMore, posts.length, onLoadMore]);

  if (posts.length === 0) {
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
          const post = posts[virtualItem.index];
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
