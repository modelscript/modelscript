/* eslint-disable @typescript-eslint/no-explicit-any */
import { ArrowLeftIcon, SearchIcon } from "@primer/octicons-react";
import { Heading, Spinner } from "@primer/react";
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import styled from "styled-components";
import { useAuth } from "../AuthContext";
import Box from "../components/Box";
import Post from "../components/Post";
import { API_BASE_URL } from "../config";

import { CircleIconButton, StickyHeader } from "../components/SharedStyles";

const HeaderTop = styled.div`
  display: flex;
  align-items: center;
  gap: 24px;
`;

const SearchInputWrapper = styled.div`
  position: relative;
  display: flex;
  align-items: center;
  margin-top: 16px;

  svg {
    position: absolute;
    left: 14px;
    color: var(--color-fg-muted);
  }

  input {
    width: 100%;
    padding: 10px 16px 10px 40px;
    border-radius: 9999px;
    background-color: var(--color-canvas-subtle);
    border: 1px solid var(--color-border-default);
    font-size: 15px;
    outline: none;
    box-sizing: border-box;
    color: var(--color-fg-default);

    &:focus {
      background-color: var(--color-canvas-default);
      border-color: #1d9bf0;
    }
  }
`;

const BookmarksPage: React.FC = () => {
  const navigate = useNavigate();
  const { token } = useAuth();
  const [posts, setPosts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    if (!token) {
      setLoading(false);
      return;
    }
    async function fetchBookmarks() {
      try {
        const res = await fetch(`${API_BASE_URL}/social/bookmarks`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const data = await res.json();
          setPosts(data.posts);
        }
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
      <StickyHeader style={{ flexDirection: "column", alignItems: "stretch" }}>
        <HeaderTop>
          <CircleIconButton onClick={() => navigate(-1)}>
            <ArrowLeftIcon size={20} />
          </CircleIconButton>
          <Heading as="h2" style={{ fontSize: "20px", margin: 0 }}>
            Bookmarks
          </Heading>
        </HeaderTop>
        <SearchInputWrapper>
          <SearchIcon size={16} />
          <input placeholder="Search Bookmarks" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
        </SearchInputWrapper>
      </StickyHeader>

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
            <Box p={6} textAlign="center" color="var(--color-fg-muted)">
              No bookmarks match your search.
            </Box>
          )}
          {posts.length === 0 && token && (
            <Box p={6} textAlign="center" color="var(--color-fg-muted)">
              You haven't bookmarked any posts yet.
            </Box>
          )}
          {!token && (
            <Box p={6} textAlign="center" color="var(--color-fg-muted)">
              Please log in to view your bookmarks.
            </Box>
          )}
        </Box>
      )}
    </Box>
  );
};

export default BookmarksPage;
