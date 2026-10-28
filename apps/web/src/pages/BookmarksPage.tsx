// SPDX-License-Identifier: AGPL-3.0-or-later

import { SearchIcon } from "@primer/octicons-react";
import { Spinner } from "@primer/react";
import React, { useEffect, useMemo, useState } from "react";
import styled from "styled-components";
import { getBookmarks } from "../api";
import { useAuth } from "../AuthContext";
import Box from "../components/Box";
import Post from "../components/Post";
import type { PostItem } from "../types/api";
import { usePageTitle } from "../util/title";

import PageHeader from "../components/PageHeader";

const SearchInputWrapper = styled.div`
  position: relative;
  display: flex;
  align-items: center;

  svg {
    position: absolute;
    left: 14px;
    color: var(--color-text-muted);
  }

  input {
    width: 100%;
    padding: 10px 16px 10px 40px;
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
            <Box p={6} textAlign="center" color="var(--color-text-muted)">
              No bookmarks match your search.
            </Box>
          )}
          {posts.length === 0 && token && (
            <Box p={6} textAlign="center" color="var(--color-text-muted)">
              You haven't bookmarked any posts yet.
            </Box>
          )}
          {!token && (
            <Box p={6} textAlign="center" color="var(--color-text-muted)">
              Please log in to view your bookmarks.
            </Box>
          )}
        </Box>
      )}
    </Box>
  );
};

export default BookmarksPage;
