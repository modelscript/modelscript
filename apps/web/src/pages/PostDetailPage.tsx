// SPDX-License-Identifier: AGPL-3.0-or-later

import { ArrowLeftIcon } from "@primer/octicons-react";
import { Heading, Spinner } from "@primer/react";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { getArtifactView, getPost, getPostParents, getPostReplies, recordPostView } from "../api";
import { useAuth } from "../AuthContext";
import Box from "../components/Box";
import { CircleIconButton, StickyHeader } from "../components/SharedStyles";
import type { ArtifactViewDTO, PostItem } from "../types/api";
import {
  estimateReadingTimeMinutes,
  extractNotebookHeadings,
  isNotebookPost,
  parseNotebookFromContent,
} from "../util/notebook";
import { useOembedDiscovery, usePageTitle } from "../util/title";
import type { ActiveBotTypingState, MoldSimulationPoint, MoldSimulationResult } from "./post-detail";
import {
  InjectionMoldDockPane,
  OscillatorSandboxDockPane,
  PostDetailThreadView,
  runMoldSimulation,
  runWasmSimulation,
  SplitContainer,
  TutorialGuideDockPane,
} from "./post-detail";

export type { MoldSimulationPoint, MoldSimulationResult };

const PostDetailPage: React.FC = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { token, user } = useAuth();
  const [post, setPost] = useState<PostItem | null>(null);
  const [artifactView, setArtifactView] = useState<ArtifactViewDTO | null>(null);
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
  const [rightDockTab, setRightDockTab] = useState<"guide" | "solver">("guide");

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
  const [loading, setLoading] = useState(true);
  const [activeBotTyping, setActiveBotTyping] = useState<ActiveBotTypingState | null>(null);

  useEffect(() => {
    if (typeof window === "undefined" || typeof WebSocket === "undefined") return;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const endpoint = `${protocol}//${window.location.host}/api/v1/collab/stream`;
    let ws: WebSocket | null = null;
    let reconnectTimeout: any = null;
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
              const isRelevant = msg.postId === currentPostId || replies.some((r) => r.id === msg.postId);

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
  }, [id, post?.id, replies]);

  useEffect(() => {
    if (!activeBotTyping) return;
    const timer = setTimeout(() => {
      setActiveBotTyping(null);
    }, 45000);
    return () => clearTimeout(timer);
  }, [activeBotTyping]);

  useEffect(() => {
    if (notebookHeadings.length === 0) return;
    setActiveHeadingSlug(notebookHeadings[0]?.slug || "");
    const handleScroll = () => {
      let current = notebookHeadings[0]?.slug || "";
      for (const h of notebookHeadings) {
        const el = document.getElementById(h.slug);
        if (el) {
          const rect = el.getBoundingClientRect();
          if (rect.top <= 140) {
            current = h.slug;
          }
        }
      }
      setActiveHeadingSlug(current);
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, [notebookHeadings]);

  // General Oscillator parameters
  const [dampingVal, setDampingVal] = useState("0.18");
  const [stiffnessVal, setStiffnessVal] = useState("64");
  const [tolVal, setTolVal] = useState("6");

  // Injection Molding CFD parameters (ABS cavity fill)
  const [meltTempVal, setMeltTempVal] = useState("235");
  const [injPressureVal, setInjPressureVal] = useState("85");
  const [gateVelVal, setGateVelVal] = useState("0.75");

  const [isSimulating, setIsSimulating] = useState(false);

  // Determine domain context from post content and artifact metadata
  const isInjectionMoldingOrCfd = useMemo(() => {
    const content = (post?.content || "").toLowerCase();
    const title = (artifactView?.title || "").toLowerCase();
    const viewType = (artifactView?.view_type || "").toLowerCase();
    return (
      viewType === "cfd-animation" ||
      viewType === "cfd" ||
      content.includes("injection") ||
      content.includes("mold") ||
      content.includes("melt front") ||
      title.includes("mold") ||
      title.includes("injection") ||
      title.includes("cfd")
    );
  }, [post?.content, artifactView?.title, artifactView?.view_type]);

  const simResult = useMemo(
    () => runWasmSimulation(dampingVal, stiffnessVal, tolVal),
    [dampingVal, stiffnessVal, tolVal],
  );

  const moldSimResult = useMemo(
    () => runMoldSimulation(meltTempVal, injPressureVal, gateVelVal),
    [meltTempVal, injPressureVal, gateVelVal],
  );

  const viewTrackedRef = useRef<Set<string>>(new Set());
  const mainPostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!loading && post) {
      setTimeout(() => {
        if (mainPostRef.current) {
          const y = mainPostRef.current.getBoundingClientRect().top + window.scrollY - 53;
          window.scrollTo({ top: y, behavior: "smooth" });
        }
      }, 50);
    }
  }, [loading, post]);

  useEffect(() => {
    async function fetchPost() {
      if (!id) return;
      try {
        if (!viewTrackedRef.current.has(id)) {
          viewTrackedRef.current.add(id);
          recordPostView(id);
        }

        const [postData, repliesData, parentsData] = await Promise.all([
          getPost(id),
          getPostReplies(id),
          getPostParents(id),
        ]);

        setPost(postData.post);
        setReplies(repliesData.posts || []);
        setParents(parentsData.posts || []);

        if (postData.post?.artifact_view_id) {
          getArtifactView(postData.post.artifact_view_id)
            .then((art) => {
              if (art?.artifactView) {
                setArtifactView(art.artifactView);
              }
            })
            .catch((err) => {
              console.warn("[PostDetailPage] Could not load artifactView metadata:", err);
            });
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    fetchPost();
  }, [id, token]);

  const handleReSimulate = () => {
    setIsSimulating(true);
    setTimeout(() => {
      setIsSimulating(false);
    }, 280);
  };

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
      <StickyHeader style={{ gap: "24px", padding: "12px 16px" }}>
        <CircleIconButton onClick={() => navigate(-1)} aria-label="Go back">
          <ArrowLeftIcon size={20} />
        </CircleIconButton>
        <Heading as="h2" style={{ fontSize: "18px", margin: 0, fontWeight: 700, color: "var(--color-text-heading)" }}>
          {isNotebook ? "Engineering Tutorial" : post.artifact_view_id ? "Engineering Inspector" : "Thread"}
        </Heading>
      </StickyHeader>

      {isNotebook || post.artifact_view_id ? (
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
            {isNotebook && post.artifact_view_id && (
              <div
                style={{
                  display: "flex",
                  gap: "6px",
                  padding: "4px",
                  borderRadius: "12px",
                  background: "var(--color-bg-card, rgba(15, 23, 42, 0.65))",
                  border: "1px solid var(--color-border-glass, rgba(255, 255, 255, 0.12))",
                }}
              >
                <button
                  type="button"
                  onClick={() => setRightDockTab("guide")}
                  style={{
                    flex: 1,
                    padding: "7px 12px",
                    borderRadius: "8px",
                    border: rightDockTab === "guide" ? "1px solid rgba(6, 182, 212, 0.45)" : "1px solid transparent",
                    background:
                      rightDockTab === "guide"
                        ? "linear-gradient(135deg, rgba(6, 182, 212, 0.16), rgba(139, 92, 246, 0.14))"
                        : "transparent",
                    color: rightDockTab === "guide" ? "var(--color-accent-cyan)" : "var(--color-text-muted)",
                    fontFamily: "var(--font-mono, monospace)",
                    fontSize: "11.5px",
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  📚 Tutorial Guide &amp; TOC
                </button>
                <button
                  type="button"
                  onClick={() => setRightDockTab("solver")}
                  style={{
                    flex: 1,
                    padding: "7px 12px",
                    borderRadius: "8px",
                    border: rightDockTab === "solver" ? "1px solid rgba(139, 92, 246, 0.45)" : "1px solid transparent",
                    background: rightDockTab === "solver" ? "rgba(139, 92, 246, 0.18)" : "transparent",
                    color: rightDockTab === "solver" ? "var(--color-text-heading)" : "var(--color-text-muted)",
                    fontFamily: "var(--font-mono, monospace)",
                    fontSize: "11.5px",
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  ⚡ Live Solver
                </button>
              </div>
            )}

            {isNotebook && notebookData && (!post.artifact_view_id || rightDockTab === "guide") ? (
              <TutorialGuideDockPane
                post={post}
                notebookData={notebookData}
                notebookHeadings={notebookHeadings}
                readTimeMinutes={readTimeMinutes}
                activeHeadingSlug={activeHeadingSlug}
                setActiveHeadingSlug={setActiveHeadingSlug}
              />
            ) : isInjectionMoldingOrCfd ? (
              <InjectionMoldDockPane
                moldSimResult={moldSimResult}
                meltTempVal={meltTempVal}
                setMeltTempVal={setMeltTempVal}
                injPressureVal={injPressureVal}
                setInjPressureVal={setInjPressureVal}
                gateVelVal={gateVelVal}
                setGateVelVal={setGateVelVal}
                isSimulating={isSimulating}
                onReSimulate={handleReSimulate}
              />
            ) : (
              <OscillatorSandboxDockPane
                simResult={simResult}
                dampingVal={dampingVal}
                setDampingVal={setDampingVal}
                stiffnessVal={stiffnessVal}
                setStiffnessVal={setStiffnessVal}
                tolVal={tolVal}
                setTolVal={setTolVal}
                isSimulating={isSimulating}
                onReSimulate={handleReSimulate}
              />
            )}
          </Box>
        </SplitContainer>
      ) : (
        threadContent
      )}
    </Box>
  );
};

export default PostDetailPage;
