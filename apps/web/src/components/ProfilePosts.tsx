/* eslint-disable @typescript-eslint/no-explicit-any */
import { Spinner, Text } from "@primer/react";
import { useEffect, useState } from "react";
import { useAuth } from "../AuthContext";
import { API_BASE_URL } from "../config";
import Box from "./Box";
import Post from "./Post";

export default function ProfilePosts({ username }: { username: string }) {
  const { token } = useAuth();
  const [posts, setPosts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchPosts() {
      try {
        const res = await fetch(`${API_BASE_URL}/social/users/${username}/posts`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
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
    fetchPosts();
  }, [username, token]);

  if (loading) {
    return (
      <Box p={4} display="flex" justifyContent="center">
        <Spinner />
      </Box>
    );
  }

  if (posts.length === 0) {
    return (
      <Box p={4} textAlign="center">
        <Text as="h2" style={{ fontSize: "20px", fontWeight: "bold", marginBottom: "8px" }}>
          No posts yet
        </Text>
        <Text color="var(--color-fg-muted)">When @{username} posts, they will show up here.</Text>
      </Box>
    );
  }

  return (
    <Box>
      {posts.map((post) => (
        <Post key={post.id} post={post} />
      ))}
    </Box>
  );
}
