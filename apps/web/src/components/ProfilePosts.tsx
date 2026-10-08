// SPDX-License-Identifier: AGPL-3.0-or-later

import { Spinner, Text } from "@primer/react";
import { useEffect, useState } from "react";
import { useAuth } from "../AuthContext";
import { getUserPosts } from "../api";
import type { PostItem } from "../types/api";
import Box from "./Box";
import Post from "./Post";

export default function ProfilePosts({
  username,
  type = "posts",
}: {
  username: string;
  type?: "posts" | "replies" | "artifacts";
}) {
  const { token } = useAuth();
  const [posts, setPosts] = useState<PostItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchPosts() {
      try {
        const data = await getUserPosts(username, type);
        setPosts(data.posts || []);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    fetchPosts();
  }, [username, token, type]);

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
          No {type === "replies" ? "replies" : type === "artifacts" ? "artifacts" : "posts"} yet
        </Text>
        <Text color="var(--color-fg-muted)">
          When @{username} has {type === "replies" ? "replies" : type === "artifacts" ? "model artifacts" : "posts"},
          they will show up here.
        </Text>
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
