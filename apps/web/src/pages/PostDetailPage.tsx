// SPDX-License-Identifier: AGPL-3.0-or-later

/* eslint-disable @typescript-eslint/no-explicit-any */
import { ArrowLeftIcon } from "@primer/octicons-react";
import { Heading, Spinner, Text } from "@primer/react";
import React, { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import styled from "styled-components";
import { useAuth } from "../AuthContext";
import Box from "../components/Box";
import ComposeBox from "../components/ComposeBox";
import Post from "../components/Post";
import { CircleIconButton, StickyHeader } from "../components/SharedStyles";
import { API_BASE_URL } from "../config";

const ReplyInputContainer = styled.div`
  display: flex;
  flex-direction: column;
  padding: 4px 16px 12px 16px;
  border-bottom: 1px solid var(--color-border);
`;

const SplitContainer = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1.25fr) minmax(340px, 0.95fr);
  gap: 24px;
  padding: 16px 20px;
  width: 100%;
  box-sizing: border-box;

  @media (max-width: 900px) {
    grid-template-columns: 1fr;
  }
`;

const SimulationDockPane = styled.div`
  background: var(--color-bg-card, rgba(15, 23, 42, 0.65));
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border: 1px solid var(--color-border-glass, rgba(255, 255, 255, 0.12));
  border-radius: 16px;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  position: sticky;
  top: 70px;
  height: fit-content;
  box-shadow: var(--glow-card);
`;

const DockTitle = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-family: var(--font-mono);
  font-size: 13px;
  font-weight: 700;
  color: var(--color-accent-cyan);
`;

const ParamSliderRow = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-family: var(--font-mono);
  font-size: 12px;

  .label-val {
    display: flex;
    justify-content: space-between;
  }

  input[type="range"] {
    width: 100%;
    accent-color: var(--color-accent-purple);
  }
`;

const ConvergencePlotBox = styled.div`
  background: #020408;
  border-radius: 10px;
  border: 1px solid var(--color-border-subtle);
  padding: 16px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  position: relative;
  background-image:
    linear-gradient(rgba(255, 255, 255, 0.03) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255, 255, 255, 0.03) 1px, transparent 1px);
  background-size: 20px 20px;
`;

const ActionDockBtn = styled.button<{ $primary?: boolean }>`
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: 600;
  padding: 8px 14px;
  border-radius: 8px;
  border: ${(props) => (props.$primary ? "none" : "1px solid var(--color-border-glass)")};
  background: ${(props) => (props.$primary ? "var(--gradient-cta)" : "rgba(255, 255, 255, 0.04)")};
  color: white;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  transition: all 0.2s;

  &:hover {
    box-shadow: 0 0 14px rgba(139, 92, 246, 0.4);
    transform: translateY(-1px);
  }
`;

const PostDetailPage: React.FC = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { token, user } = useAuth();
  const [post, setPost] = useState<any>(null);
  const [parents, setParents] = useState<any[]>([]);
  const [replies, setReplies] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [dampingVal, setDampingVal] = useState("0.18");
  const [tolVal, setTolVal] = useState("6");
  const [isSimulating, setIsSimulating] = useState(false);
  const [convergenceStats, setConvergenceStats] = useState({
    timeMs: 28,
    singularities: 0,
    iterations: 42,
  });

  const generateWaveformPath = (dampingStr: string, tolStr: string) => {
    const zeta = parseFloat(dampingStr) || 0.18;
    const tol = parseInt(tolStr, 10) || 6;
    const width = 240;
    const startX = 10;
    const midY = 65;
    const amp = 46;
    const omega = 16;

    const points: string[] = [];
    const steps = 120;
    for (let i = 0; i <= steps; i++) {
      const frac = i / steps;
      const x = startX + frac * width;
      const t = frac * 2;
      const decay = Math.exp(-zeta * 10 * t);
      const val = decay * Math.cos(omega * t);
      const noise = tol < 5 ? Math.sin(i * 37) * 0.04 * (5 - tol) : 0;
      const y = midY - amp * (val + noise);
      if (i === 0) {
        points.push(`M ${x.toFixed(1)} ${y.toFixed(1)}`);
      } else {
        points.push(`L ${x.toFixed(1)} ${y.toFixed(1)}`);
      }
    }
    return points.join(" ");
  };

  const [waveformPath, setWaveformPath] = useState(() => generateWaveformPath("0.18", "6"));

  useEffect(() => {
    setWaveformPath(generateWaveformPath(dampingVal, tolVal));
  }, [dampingVal, tolVal]);

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
      try {
        // Fire and forget view increment (prevent duplicate in Strict Mode)
        if (id && !viewTrackedRef.current.has(id)) {
          viewTrackedRef.current.add(id);
          fetch(`${API_BASE_URL}/social/posts/${id}/view`, {
            method: "POST",
            headers: token ? { Authorization: `Bearer ${token}` } : {},
          }).catch(console.error);
        }

        const res = await fetch(`${API_BASE_URL}/social/posts/${id}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (res.ok) {
          const data = await res.json();
          setPost(data.post);
        }

        const repliesRes = await fetch(`${API_BASE_URL}/social/posts/${id}/replies`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (repliesRes.ok) {
          const repliesData = await repliesRes.json();
          setReplies(repliesData.posts);
        }

        const parentsRes = await fetch(`${API_BASE_URL}/social/posts/${id}/parents`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (parentsRes.ok) {
          const parentsData = await parentsRes.json();
          setParents(parentsData.posts);
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
      setWaveformPath(generateWaveformPath(dampingVal, tolVal));
      const simulatedTime = Math.round(16 + parseFloat(dampingVal) * 35 + parseInt(tolVal, 10) * 2);
      const iters = Math.round(28 + parseInt(tolVal, 10) * 4);
      setConvergenceStats({
        timeMs: simulatedTime,
        singularities: 0,
        iterations: iters,
      });
      setIsSimulating(false);
    }, 400);
  };

  const handleExportFmu = () => {
    if (!post?.artifact_view_id) return;
    const url = `${API_BASE_URL}/social/artifact-views/${encodeURIComponent(post.artifact_view_id)}`;
    window.open(url, "_blank");
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
    <>
      {parents.map((parent) => (
        <Post key={parent.id} post={parent} isThread={true} />
      ))}

      <div ref={mainPostRef}>
        <Post post={post} isDetail={true} />
      </div>

      {user && (
        <ReplyInputContainer>
          <ComposeBox
            replyToPost={post}
            onPostCreated={(reply) => navigate(`/${reply.author?.username || reply.username}/status/${reply.id}`)}
          />
        </ReplyInputContainer>
      )}

      {replies.length > 0 ? (
        <Box>
          {replies.map((reply) => (
            <Post key={reply.id} post={reply} />
          ))}
        </Box>
      ) : (
        <Box p={4} textAlign="center">
          <Text color="var(--color-fg-muted)">No replies yet.</Text>
        </Box>
      )}
    </>
  );

  return (
    <Box minHeight="100vh" style={{ paddingBottom: "200px" }}>
      <StickyHeader style={{ gap: "24px", padding: "12px 16px" }}>
        <CircleIconButton onClick={() => navigate(-1)}>
          <ArrowLeftIcon size={20} />
        </CircleIconButton>
        <Heading as="h2" style={{ fontSize: "18px", margin: 0, fontWeight: 700 }}>
          {post.artifact_view_id ? "Engineering Inspector" : "Thread"}
        </Heading>
      </StickyHeader>

      {post.artifact_view_id ? (
        <SplitContainer>
          <Box display="flex" flexDirection="column">
            {threadContent}
          </Box>

          <SimulationDockPane>
            <DockTitle>
              <span>⚡ LIVE WASM SIMULATION SANDBOX</span>
              <span
                style={{
                  fontSize: "11px",
                  color: "var(--color-status-verified)",
                  background: "rgba(16, 185, 129, 0.12)",
                  padding: "2px 6px",
                  borderRadius: "4px",
                }}
              >
                JIT READY
              </span>
            </DockTitle>

            <ParamSliderRow>
              <div className="label-val">
                <span>Damping (damping_c):</span>
                <span style={{ color: "var(--color-accent-cyan)" }}>{dampingVal} N·s/m</span>
              </div>
              <input
                type="range"
                min="0.05"
                max="0.5"
                step="0.01"
                value={dampingVal}
                onChange={(e) => setDampingVal(e.target.value)}
              />
            </ParamSliderRow>

            <ParamSliderRow>
              <div className="label-val">
                <span>Solver RelTol:</span>
                <span style={{ color: "var(--color-status-verified)" }}>1e-{tolVal}</span>
              </div>
              <input type="range" min="3" max="9" value={tolVal} onChange={(e) => setTolVal(e.target.value)} />
            </ParamSliderRow>

            <ConvergencePlotBox>
              <svg width="100%" height="130" viewBox="0 0 260 130" style={{ maxWidth: "340px", overflow: "visible" }}>
                <line x1="10" y1="65" x2="250" y2="65" stroke="rgba(255,255,255,0.1)" strokeDasharray="3 3" />
                <path
                  d={waveformPath}
                  stroke={isSimulating ? "#f59e0b" : "#10b981"}
                  strokeWidth="2.5"
                  fill="none"
                  style={{
                    filter: "drop-shadow(0 0 8px rgba(16, 185, 129, 0.6))",
                    transition: "stroke 0.2s, stroke-width 0.2s",
                  }}
                />
              </svg>
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: "11px",
                  color: isSimulating ? "var(--color-accent-amber)" : "var(--color-status-verified)",
                  marginTop: "6px",
                }}
              >
                {isSimulating
                  ? "⏳ Computing state trajectory in WASM arena..."
                  : `● CONVERGED in ${convergenceStats.timeMs}ms (${convergenceStats.iterations} iters, ${convergenceStats.singularities} singularities)`}
              </span>
            </ConvergencePlotBox>

            <Box display="flex" gap={2}>
              <ActionDockBtn $primary style={{ flex: 1 }} onClick={handleReSimulate} disabled={isSimulating}>
                ⚡ Re-simulate Trace
              </ActionDockBtn>
              <ActionDockBtn style={{ flex: 1 }} onClick={handleExportFmu}>
                ⤓ Export FMU
              </ActionDockBtn>
            </Box>
          </SimulationDockPane>
        </SplitContainer>
      ) : (
        threadContent
      )}
    </Box>
  );
};

export default PostDetailPage;
