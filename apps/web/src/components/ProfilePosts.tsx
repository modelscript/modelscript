// SPDX-License-Identifier: AGPL-3.0-or-later

import { Text } from "@primer/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "../AuthContext";
import { getUserPosts, updatePost } from "../api";
import type { PostItem } from "../types/api";
import Box from "./Box";
import Post from "./Post";
import Spinner from "./Spinner";
import VirtualPostList from "./VirtualPostList";

function getStoredPinnedIds(username: string): { pinned: string[]; unpinned: string[] } {
  if (typeof window === "undefined" || !username) {
    return { pinned: [], unpinned: [] };
  }
  try {
    const raw = window.localStorage.getItem(`modelscript:pinned-posts:${username}`);
    if (!raw) return { pinned: [], unpinned: [] };
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return { pinned: parsed.map(String).filter(Boolean), unpinned: [] };
    }
    return {
      pinned: Array.isArray(parsed?.pinned) ? parsed.pinned.map(String).filter(Boolean) : [],
      unpinned: Array.isArray(parsed?.unpinned) ? parsed.unpinned.map(String).filter(Boolean) : [],
    };
  } catch {
    return { pinned: [], unpinned: [] };
  }
}

function saveStoredPinnedIds(username: string, pinned: Set<string>, unpinned: Set<string>) {
  if (typeof window === "undefined" || !username) return;
  try {
    window.localStorage.setItem(
      `modelscript:pinned-posts:${username}`,
      JSON.stringify({
        pinned: Array.from(pinned),
        unpinned: Array.from(unpinned),
      }),
    );
  } catch {
    // Ignore storage quota errors
  }
}

export interface ProfilePostsProps {
  username: string;
  type?: "posts" | "replies" | "artifacts" | undefined;
  isOwnProfile?: boolean | undefined;
  pinnedPostId?: number | string | null | undefined;
  onPinChange?: ((postId: number | string, pinned: boolean) => void) | undefined;
}

export default function ProfilePosts({
  username,
  type = "posts",
  isOwnProfile = false,
  pinnedPostId,
  onPinChange,
}: ProfilePostsProps) {
  const { user, token } = useAuth();
  const canManagePins = isOwnProfile || Boolean(user?.username && user.username === username);
  const [posts, setPosts] = useState<PostItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(() => new Set(getStoredPinnedIds(username).pinned));
  const [unpinnedIds, setUnpinnedIds] = useState<Set<string>>(() => new Set(getStoredPinnedIds(username).unpinned));

  useEffect(() => {
    const stored = getStoredPinnedIds(username);
    const initialPinned = new Set(stored.pinned);
    if (pinnedPostId != null && String(pinnedPostId).trim() !== "" && !stored.unpinned.includes(String(pinnedPostId))) {
      initialPinned.add(String(pinnedPostId));
    }
    setPinnedIds(initialPinned);
    setUnpinnedIds(new Set(stored.unpinned));
  }, [username, pinnedPostId]);

  useEffect(() => {
    let cancelled = false;
    async function fetchPosts() {
      setLoading(true);
      try {
        const data = await getUserPosts(username, type);
        if (!cancelled) {
          setPosts(data.posts || []);
        }
      } catch (err) {
        console.error(err);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }
    fetchPosts();
    return () => {
      cancelled = true;
    };
  }, [username, token, type]);

  const isPostPinned = useCallback(
    (post: PostItem): boolean => {
      const id = String(post.id);
      if (unpinnedIds.has(id)) return false;
      if (pinnedIds.has(id)) return true;
      if (pinnedPostId != null && String(pinnedPostId) === id) return true;
      const anyPost = post as Record<string, any>;
      return Boolean(anyPost.is_pinned || anyPost.pinned || post.metadata?.is_pinned || post.metadata?.pinned);
    },
    [pinnedIds, unpinnedIds, pinnedPostId],
  );

  const handleTogglePin = useCallback(
    async (post: PostItem) => {
      const id = String(post.id);
      const currentlyPinned = isPostPinned(post);
      const nextPinned = !currentlyPinned;

      const nextPinnedSet = new Set(pinnedIds);
      const nextUnpinnedSet = new Set(unpinnedIds);

      if (nextPinned) {
        nextPinnedSet.add(id);
        nextUnpinnedSet.delete(id);
      } else {
        nextPinnedSet.delete(id);
        nextUnpinnedSet.add(id);
      }

      setPinnedIds(nextPinnedSet);
      setUnpinnedIds(nextUnpinnedSet);
      saveStoredPinnedIds(username, nextPinnedSet, nextUnpinnedSet);

      setPosts((prev) =>
        prev.map((p) =>
          String(p.id) === id
            ? ({
                ...p,
                is_pinned: nextPinned,
                metadata: { ...(p.metadata || {}), is_pinned: nextPinned },
              } as PostItem)
            : p,
        ),
      );

      onPinChange?.(id, nextPinned);

      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("modelscript:post-pin-toggled", {
            detail: { username, postId: id, pinned: nextPinned },
          }),
        );
      }

      if (token && canManagePins) {
        try {
          await updatePost(id, {
            content: post.content,
            is_pinned: nextPinned,
            metadata: { ...(post.metadata || {}), is_pinned: nextPinned },
          });
        } catch {
          // Local pin state remains active even if backend does not persist is_pinned on update
        }
      }
    },
    [isPostPinned, pinnedIds, unpinnedIds, username, onPinChange, token, canManagePins],
  );

  useEffect(() => {
    const onExternalPinEvent = (e: Event) => {
      const detail = (e as CustomEvent)?.detail;
      if (!detail || (detail.username && detail.username !== username)) return;
      const postId = String(detail.postId || "");
      if (!postId) return;
      const targetPost = posts.find((p) => String(p.id) === postId);
      if (targetPost && typeof detail.pinned === "boolean" && isPostPinned(targetPost) !== detail.pinned) {
        void handleTogglePin(targetPost);
      }
    };
    window.addEventListener("modelscript:toggle-pin-post", onExternalPinEvent);
    return () => window.removeEventListener("modelscript:toggle-pin-post", onExternalPinEvent);
  }, [username, posts, isPostPinned, handleTogglePin]);

  const sortedPosts = useMemo(() => {
    if (type !== "posts") return posts;
    const pinned: PostItem[] = [];
    const regular: PostItem[] = [];
    for (const post of posts) {
      if (isPostPinned(post)) {
        pinned.push(post);
      } else {
        regular.push(post);
      }
    }
    return [...pinned, ...regular];
  }, [posts, type, isPostPinned]);

  if (loading) {
    return (
      <Box p={4} display="flex" justifyContent="center">
        <Spinner />
      </Box>
    );
  }

  if (sortedPosts.length === 0) {
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
    <VirtualPostList
      posts={sortedPosts}
      isPinnedEvaluator={(post) => type === "posts" && isPostPinned(post)}
      renderItem={(post, _index, pinned) => <Post post={post} isPinned={pinned} />}
    />
  );
}
