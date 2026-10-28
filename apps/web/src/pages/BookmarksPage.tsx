// SPDX-License-Identifier: AGPL-3.0-or-later

import { BookmarkIcon, SearchIcon, XIcon } from "@primer/octicons-react";
import { Spinner } from "@primer/react";
import React, { useEffect, useMemo, useState } from "react";
import styled from "styled-components";
import { getBookmarks } from "../api";
import { useAuth } from "../AuthContext";
import Box from "../components/Box";
import EmptyState from "../components/EmptyState";
import PageHeader from "../components/PageHeader";
import Post from "../components/Post";
import type { PostItem } from "../types/api";
import { usePageTitle } from "../util/title";

const SearchInputWrapper = styled.div`
  position: relative;
  display: flex;
  align-items: center;

  & > svg {
    position: absolute;
    left: 14px;
    color: var(--color-text-muted);
    pointer-events: none;
  }

  input {
    width: 100%;
    padding: 10px 36px 10px 40px;
    border-radius: 9999px;
    background-color: var(--color-search-bg);
    border: 1px solid var(--color-search-border);
    font-size: 15px;
    outline: none;
    box-sizing: border-box;
    color: var(--color-text-primary);
    transition: all 0.2s ease;

    &:focus {
      background-color: var(--color-search-bg);
      border-color: var(--color-accent-cyan);
      box-shadow: 0 0 12px var(--color-search-focus);
    }

    &::placeholder {
      color: var(--color-text-muted);
      opacity: 0.7;
    }
  }
`;

const ClearButton = styled.button`
  position: absolute;
  right: 10px;
  background: none;
  border: none;
  padding: 4px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--color-text-muted);
  cursor: pointer;
  border-radius: 50%;

  &:hover {
    color: var(--color-text-primary);
    background-color: var(--surface-row-hover);
  }
`;

const BookmarksPage: React.FC = () => {
  usePageTitle("Bookmarks");
  const { token } = useAuth();
  const [posts, setPosts] = useState<PostItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    if (!token) {
      setLoading(false);
      return;
    }
    async function fetchBookmarks() {
      try {
        const data = await getBookmarks();
        setPosts(data.posts || []);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    fetchBookmarks();
  }, [token]);

  useEffect(() => {
    const handleBookmarkToggled = (e: Event) => {
      const detail = (e as CustomEvent<{ postId: number | string; bookmarked: boolean }>).detail;
      if (!detail || detail.bookmarked) return;
      setPosts((prev) =>
        prev.filter(
          (post) =>
            String(post.id) !== String(detail.postId) &&
            String((post as any).repost_post?.id) !== String(detail.postId),
        ),
      );
    };
    window.addEventListener("modelscript:bookmark-toggled", handleBookmarkToggled);
    return () => window.removeEventListener("modelscript:bookmark-toggled", handleBookmarkToggled);
  }, []);

  const filteredPosts = useMemo(() => {
    if (!searchQuery.trim()) return posts;
    const lowerQuery = searchQuery.toLowerCase();
    return posts.filter(
      (post) =>
        post.content?.toLowerCase().includes(lowerQuery) ||
        post.username?.toLowerCase().includes(lowerQuery) ||
        post.display_name?.toLowerCase().includes(lowerQuery),
    );
  }, [posts, searchQuery]);

  return (
    <Box>
      <PageHeader back title="Bookmarks">
        <SearchInputWrapper>
          <SearchIcon size={16} />
          <input placeholder="Search Bookmarks" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
          {searchQuery && (
            <ClearButton type="button" onClick={() => setSearchQuery("")} aria-label="Clear search">
              <XIcon size={14} />
            </ClearButton>
          )}
        </SearchInputWrapper>
      </PageHeader>

      {loading ? (
        <Box p={4} display="flex" justifyContent="center">
          <Spinner size="large" />
        </Box>
      ) : (
        <Box>
          {filteredPosts.map((post) => (
            <Post key={post.id} post={post} />
          ))}
          {filteredPosts.length === 0 && posts.length > 0 && token && (
            <EmptyState
              icon={<SearchIcon size={24} />}
              title="No bookmarks match your search."
              body="Try searching for a different keyword or author."
              compact
            />
          )}
          {posts.length === 0 && token && (
            <EmptyState
              icon={<BookmarkIcon size={24} />}
              title="You haven't bookmarked any posts yet."
              body="Save posts, simulations, and engineering tutorials for quick reference later."
            />
          )}
          {!token && (
            <EmptyState
              icon={<BookmarkIcon size={24} />}
              title="Please log in to view your bookmarks."
              body="Sign in to access your saved posts and engineering artifacts."
            />
          )}
        </Box>
      )}
    </Box>
  );
};

export default BookmarksPage;
