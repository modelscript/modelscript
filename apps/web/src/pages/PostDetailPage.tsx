// SPDX-License-Identifier: AGPL-3.0-or-later

import { Heading } from "@primer/react";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { getPost, getPostParents, getPostReplies } from "../api";
import { useAuth } from "../AuthContext";
import Box from "../components/Box";
import PageHeader from "../components/PageHeader";
import { updateStickyScrollVars } from "../components/ScrollToTop";
import Spinner from "../components/Spinner";
import type { PostItem } from "../types/api";
import {
  estimateReadingTimeMinutes,
  extractNotebookHeadings,
  isNotebookPost,
  type NotebookMetadata,
  parseNotebookFromContent,
} from "../util/notebook";
import { useOembedDiscovery, usePageTitle } from "../util/title";
import type { ActiveBotTypingState } from "./post-detail";
import { PostDetailThreadView } from "./post-detail";

const useIsomorphicLayoutEffect = typeof window !== "undefined" ? React.useLayoutEffect : React.useEffect;

const PostDetailPage: React.FC = () => {
  const { id } = useParams();
  const { token, user } = useAuth();
  const [post, setPost] = useState<PostItem | null>(null);
  const isNotebook = useMemo(() => (post ? isNotebookPost(post) : false), [post]);
  const notebookData = useMemo(
    () =>
      post && isNotebook
        ? parseNotebookFromContent(
            post.content,
            post.artifact_view_id !== undefined && post.artifact_view_id !== null
              ? Number(post.artifact_view_id)
              : null,
            post.metadata?.notebook as Partial<NotebookMetadata> | undefined,
          )
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
  const [readingProgress, setReadingProgress] = useState<number>(0);
  const [showStickySubtitle, setShowStickySubtitle] = useState<boolean>(false);

  usePageTitle(notebookData?.title ? notebookData.title : post?.username ? `Post by @${post.username}` : "Post");
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

  const postIdRef = useRef<number>(post?.id ?? Number(id));
  useEffect(() => {
    postIdRef.current = post?.id ?? Number(id);
  }, [id, post?.id]);

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
              const currentPostId = postIdRef.current;
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
            if (ws && ws.readyState === WebSocket.OPEN) {
              ws.close();
            }
          } catch {}
        };
      } catch {
        if (!isDisposed) {
          reconnectTimeout = setTimeout(connect, 5000);
        }
      }
    }

    reconnectTimeout = setTimeout(connect, 20);

    return () => {
      isDisposed = true;
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      try {
        if (ws) {
          ws.onclose = null;
          ws.onerror = null;
          ws.onmessage = null;
          if (ws.readyState === WebSocket.CONNECTING) {
            const pendingWs = ws;
            pendingWs.onopen = () => {
              try {
                pendingWs.close();
              } catch {}
            };
          } else if (ws.readyState === WebSocket.OPEN) {
            ws.close();
          }
        }
      } catch {}
    };
  }, [id]);

  useEffect(() => {
    if (!activeBotTyping) return;
    const timer = setTimeout(() => {
      setActiveBotTyping(null);
    }, 45000);
    return () => clearTimeout(timer);
  }, [activeBotTyping]);

  const mainPostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isNotebook) {
      setReadingProgress(0);
      setShowStickySubtitle(false);
      return;
    }
    setActiveHeadingSlug(notebookHeadings[0]?.id || "");

    const handleScroll = () => {
      if (notebookHeadings.length > 0) {
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
      }

      setShowStickySubtitle(window.scrollY > 140);

      if (mainPostRef.current) {
        const rect = mainPostRef.current.getBoundingClientRect();
        const articleHeight = Math.max(1, rect.height - window.innerHeight * 0.55);
        const scrolled = Math.max(0, -rect.top + 60);
        const pct = window.scrollY <= 8 ? 0 : Math.min(100, Math.round((scrolled / articleHeight) * 100));
        setReadingProgress(pct);
      }
    };

    handleScroll();
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, [isNotebook, notebookHeadings]);

  useEffect(() => {
    const active = Boolean(isNotebook && notebookData && post);
    window.dispatchEvent(
      new CustomEvent("modelscript:notebook-inspector", {
        detail: active
          ? {
              active: true,
              post,
              notebookData,
              notebookHeadings,
              readTimeMinutes,
              activeHeadingSlug,
              setActiveHeadingSlug,
              readingProgress,
            }
          : { active: false },
      }),
    );
  }, [isNotebook, notebookData, post, notebookHeadings, readTimeMinutes, activeHeadingSlug, readingProgress]);

  useEffect(() => {
    return () => {
      window.dispatchEvent(new CustomEvent("modelscript:notebook-inspector", { detail: { active: false } }));
    };
  }, []);

  useEffect(() => {
    const handlePostUpdated = (e: Event) => {
      const updated = (e as CustomEvent<Partial<PostItem> | undefined>).detail;
      if (updated && post && String(updated.id ?? post.id) === String(post.id)) {
        setPost((prev) => (prev ? { ...prev, ...updated } : prev));
      }
    };
    window.addEventListener("modelscript:post-updated", handlePostUpdated);
    return () => window.removeEventListener("modelscript:post-updated", handlePostUpdated);
  }, [post]);

  const headerRef = useRef<HTMLElement>(null);
  const parentsContainerRef = useRef<HTMLDivElement>(null);
  const hasUserScrolledRef = useRef(false);
  const isAligningRef = useRef(false);

  const alignPostToTop = useCallback(() => {
    if (!mainPostRef.current) return;

    let headerBottom = 0;
    if (headerRef.current) {
      headerBottom = headerRef.current.getBoundingClientRect().bottom;
    } else {
      const headerEl = document.querySelector<HTMLElement>("header[data-page-header='true'], header");
      if (headerEl) {
        headerBottom = headerEl.getBoundingClientRect().bottom;
      } else {
        const devHeader =
          parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--dev-header-height") || "0") || 0;
        headerBottom = devHeader + 54;
      }
    }

    const postRect = mainPostRef.current.getBoundingClientRect();
    const currentScrollY = window.scrollY || document.documentElement.scrollTop || 0;
    const targetScrollY = Math.round(currentScrollY + postRect.top - headerBottom);

    if (Math.abs(currentScrollY - targetScrollY) > 0.5) {
      isAligningRef.current = true;
      window.scrollTo({ top: Math.max(0, targetScrollY), behavior: "instant" });
      updateStickyScrollVars(targetScrollY);
      requestAnimationFrame(() => {
        isAligningRef.current = false;
      });
    }
  }, []);

  useIsomorphicLayoutEffect(() => {
    if (loading || !post) return;

    hasUserScrolledRef.current = false;

    if (parents.length > 0) {
      alignPostToTop();
      const frame = requestAnimationFrame(() => {
        if (!hasUserScrolledRef.current) {
          alignPostToTop();
        }
      });
      return () => cancelAnimationFrame(frame);
    } else {
      window.scrollTo({ top: 0, behavior: "instant" });
      updateStickyScrollVars(0);
    }
  }, [loading, post, parents.length, alignPostToTop]);

  useEffect(() => {
    if (loading || !post || parents.length === 0) return;

    const onUserScrollGesture = () => {
      if (!isAligningRef.current) {
        hasUserScrolledRef.current = true;
      }
    };

    window.addEventListener("wheel", onUserScrollGesture, { passive: true });
    window.addEventListener("touchmove", onUserScrollGesture, { passive: true });
    const onKeyDown = (e: KeyboardEvent) => {
      if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(e.key)) {
        hasUserScrolledRef.current = true;
      }
    };
    window.addEventListener("keydown", onKeyDown, { passive: true });

    let resizeObserver: ResizeObserver | null = null;
    const parentsEl = parentsContainerRef.current;

    if (typeof ResizeObserver !== "undefined" && parentsEl) {
      resizeObserver = new ResizeObserver(() => {
        if (!hasUserScrolledRef.current) {
          alignPostToTop();
        }
      });
      resizeObserver.observe(parentsEl);
    }

    const handleImageLoad = () => {
      if (!hasUserScrolledRef.current) {
        alignPostToTop();
      }
    };
    if (parentsEl) {
      parentsEl.addEventListener("load", handleImageLoad, true);
    }

    return () => {
      window.removeEventListener("wheel", onUserScrollGesture);
      window.removeEventListener("touchmove", onUserScrollGesture);
      window.removeEventListener("keydown", onKeyDown);
      if (parentsEl) {
        parentsEl.removeEventListener("load", handleImageLoad, true);
      }
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
    };
  }, [loading, post, parents.length, alignPostToTop]);

  useEffect(() => {
    async function fetchPost() {
      if (!id) return;
      setLoading(true);
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

  return (
    <Box minHeight="100dvh" style={{ paddingBottom: "200px" }}>
      <PageHeader
        ref={headerRef}
        back
        title={isNotebook ? "Article" : "Post"}
        subtitle={
          isNotebook && showStickySubtitle && notebookData?.title
            ? `${notebookData.title} · ${readTimeMinutes} min read`
            : undefined
        }
        actions={
          isNotebook && showStickySubtitle && readingProgress > 0 ? (
            <span
              style={{
                fontSize: "11.5px",
                fontFamily: "var(--font-mono, monospace)",
                fontWeight: 600,
                color: "var(--color-text-muted)",
                padding: "2px 8px",
                borderRadius: "999px",
                background: "var(--color-canvas-subtle)",
                border: "1px solid var(--color-border-subtle)",
                whiteSpace: "nowrap",
              }}
            >
              {readingProgress >= 100
                ? "Done"
                : `${Math.max(1, Math.ceil(readTimeMinutes * (1 - readingProgress / 100)))}m left`}
            </span>
          ) : undefined
        }
        progress={isNotebook ? readingProgress : undefined}
      />

      <PostDetailThreadView
        post={post}
        parents={parents}
        replies={replies}
        user={user}
        mainPostRef={mainPostRef}
        parentsContainerRef={parentsContainerRef}
        activeBotTyping={activeBotTyping}
        onReplyCreated={(reply) => setReplies((prev) => [...prev, reply])}
      />
    </Box>
  );
};

export default PostDetailPage;
