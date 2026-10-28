// SPDX-License-Identifier: AGPL-3.0-or-later

import { Heading, Spinner } from "@primer/react";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { getPost, getPostParents, getPostReplies } from "../api";
import { useAuth } from "../AuthContext";
import Box from "../components/Box";
import PageHeader from "../components/PageHeader";
import type { PostItem } from "../types/api";
import {
  estimateReadingTimeMinutes,
  extractNotebookHeadings,
  isNotebookPost,
  parseNotebookFromContent,
} from "../util/notebook";
import { useOembedDiscovery, usePageTitle } from "../util/title";
import type { ActiveBotTypingState } from "./post-detail";
import { PostDetailThreadView, SplitContainer, TutorialGuideDockPane } from "./post-detail";

const PostDetailPage: React.FC = () => {
  const { id } = useParams();
  const { token, user } = useAuth();
  const [post, setPost] = useState<PostItem | null>(null);
  const isNotebook = useMemo(() => (post ? isNotebookPost(post) : false), [post]);
  const notebookData = useMemo(
    () =>
      post && isNotebook
        ? parseNotebookFromContent(post.content, post.artifact_view_id, post.metadata?.notebook)
        : null,
    [post, isNotebook],
  );
  const notebookHeadings = useMemo(
    () => (notebookData ? extractNotebookHeadings(notebookData.cells) : []),
    [notebookData],
  );
  const readTimeMinutes = useMemo(
    () => (notebookData ? notebookData.estimatedReadMinutes || estimateReadingTimeMinutes(notebookData.cells) : 1),
    [notebookData],
  );
  const [activeHeadingSlug, setActiveHeadingSlug] = useState<string>("");

  usePageTitle(
    notebookData?.title
      ? `${notebookData.title} — ModelScript Tutorial`
      : post?.username
        ? `Post by @${post.username}`
        : "Post",
  );
  useOembedDiscovery(
    typeof window !== "undefined" ? window.location.href : undefined,
    notebookData?.title || post?.title || (post?.content ? post.content.slice(0, 60) : undefined),
  );
  const [parents, setParents] = useState<PostItem[]>([]);
  const [replies, setReplies] = useState<PostItem[]>([]);
  const repliesRef = useRef<PostItem[]>(replies);
  useEffect(() => {
    repliesRef.current = replies;
  }, [replies]);

  const [loading, setLoading] = useState(true);
  const [activeBotTyping, setActiveBotTyping] = useState<ActiveBotTypingState | null>(null);

  useEffect(() => {
    if (typeof window === "undefined" || typeof WebSocket === "undefined") return;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const endpoint = `${protocol}//${window.location.host}/api/v1/collab/stream`;
    let ws: WebSocket | null = null;
    let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
    let isDisposed = false;

    function connect() {
      if (isDisposed) return;
      try {
        ws = new WebSocket(endpoint);
        ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(String(event.data));
            if (msg.type === "bot_typing") {
              const currentPostId = post?.id ?? Number(id);
              const isRelevant = msg.postId === currentPostId || repliesRef.current.some((r) => r.id === msg.postId);

              if (isRelevant) {
                if (msg.status === "thinking" || msg.status === "simulating") {
                  setActiveBotTyping({
                    botId: msg.botId,
                    botUsername: msg.botUsername,
                    status: msg.status,
                    postId: msg.postId,
                    timestamp: Date.now(),
                  });
                } else if (msg.status === "done") {
                  setActiveBotTyping(null);
                  if (id) {
                    getPostReplies(id)
                      .then((res) => {
                        if (res?.posts) setReplies(res.posts);
                      })
                      .catch(() => {});
                  }
                } else if (msg.status === "failed") {
                  setActiveBotTyping(null);
                }
              }
            }
          } catch {
            // Ignore malformed WS message
          }
        };

        ws.onclose = () => {
          if (!isDisposed) {
            reconnectTimeout = setTimeout(connect, 3000);
          }
        };

        ws.onerror = () => {
          try {
            ws?.close();
          } catch {}
        };
      } catch {
        if (!isDisposed) {
          reconnectTimeout = setTimeout(connect, 5000);
        }
      }
    }

    connect();

    return () => {
      isDisposed = true;
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      try {
        ws?.close();
      } catch {}
    };
  }, [id, post?.id]);

  useEffect(() => {
    if (!activeBotTyping) return;
    const timer = setTimeout(() => {
      setActiveBotTyping(null);
    }, 45000);
    return () => clearTimeout(timer);
  }, [activeBotTyping]);

  useEffect(() => {
    if (notebookHeadings.length === 0) return;
    setActiveHeadingSlug(notebookHeadings[0]?.id || "");
    const handleScroll = () => {
      let current = notebookHeadings[0]?.id || "";
      for (const h of notebookHeadings) {
        const el = document.getElementById(h.id);
        if (el) {
          const rect = el.getBoundingClientRect();
          if (rect.top <= 140) {
            current = h.id;
          }
        }
      }
      setActiveHeadingSlug(current);
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, [notebookHeadings]);

  const mainPostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!loading && post && parents.length > 0 && mainPostRef.current) {
      setTimeout(() => {
        if (mainPostRef.current) {
          const y = mainPostRef.current.getBoundingClientRect().top + window.scrollY - 53;
          window.scrollTo({ top: y, behavior: "smooth" });
        }
      }, 50);
    }
  }, [loading, post, parents.length]);

  useEffect(() => {
    async function fetchPost() {
      if (!id) return;
      try {
        const [postData, repliesData, parentsData] = await Promise.all([
          getPost(id),
          getPostReplies(id),
          getPostParents(id),
        ]);

        setPost(postData.post);
        setReplies(repliesData.posts || []);
        setParents(parentsData.posts || []);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    fetchPost();
  }, [id, token]);

  if (loading) {
    return (
      <Box p={4} display="flex" justifyContent="center">
        <Spinner size="large" />
      </Box>
    );
  }

  if (!post) {
    return (
      <Box p={4}>
        <Heading as="h2">Post not found</Heading>
      </Box>
    );
  }

  const threadContent = (
    <PostDetailThreadView
      post={post}
      parents={parents}
      replies={replies}
      user={user}
      mainPostRef={mainPostRef}
      activeBotTyping={activeBotTyping}
      onReplyCreated={(reply) => setReplies((prev) => [...prev, reply])}
    />
  );

  return (
    <Box minHeight="100vh" style={{ paddingBottom: "200px" }}>
      <PageHeader back title={isNotebook ? "Engineering Tutorial" : "Post"} />

      {isNotebook && notebookData ? (
        <SplitContainer>
          <Box display="flex" flexDirection="column">
            {threadContent}
          </Box>

          <Box
            display="flex"
            flexDirection="column"
            gap={2}
            style={{ position: "sticky", top: "70px", height: "fit-content" }}
          >
            <TutorialGuideDockPane
              post={post}
              notebookData={notebookData}
              notebookHeadings={notebookHeadings}
              readTimeMinutes={readTimeMinutes}
              activeHeadingSlug={activeHeadingSlug}
              setActiveHeadingSlug={setActiveHeadingSlug}
            />
          </Box>
        </SplitContainer>
      ) : (
        threadContent
      )}
    </Box>
  );
};

export default PostDetailPage;
