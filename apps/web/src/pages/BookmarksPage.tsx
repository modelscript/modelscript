/* eslint-disable @typescript-eslint/no-explicit-any */
import { Heading, Spinner, Text } from "@primer/react";
import React, { useEffect, useState } from "react";
import styled from "styled-components";
import { useAuth } from "../AuthContext";
import Box from "../components/Box";
import Post from "../components/Post";
import { API_BASE_URL } from "../config";

const Header = styled.div`
  padding: 16px;
  border-bottom: 1px solid var(--color-border-default);
  position: sticky;
  top: 0;
  z-index: 10;
  backdrop-filter: blur(12px);
  background-color: transparent;
`;

const BookmarksPage: React.FC = () => {
  const { token } = useAuth();
  const [posts, setPosts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

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

  return (
    <Box>
      <Header>
        <Heading as="h2" style={{ fontSize: "20px" }}>
          Bookmarks
        </Heading>
        <Text color="var(--color-fg-muted)" fontSize="13px">
          @{useAuth().user?.username}
        </Text>
      </Header>

      {loading ? (
        <Box p={4} display="flex" justifyContent="center">
          <Spinner size="large" />
        </Box>
      ) : (
        <Box>
          {posts.map((post) => (
            <Post key={post.id} post={post} />
          ))}
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
