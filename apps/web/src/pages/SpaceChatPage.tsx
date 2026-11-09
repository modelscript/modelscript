// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  BookIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CodeIcon,
  CommentDiscussionIcon,
  CommentIcon,
  CopyIcon,
  CpuIcon,
  FileDiffIcon,
  HubotIcon,
  KebabHorizontalIcon,
  LinkExternalIcon,
  PaperAirplaneIcon,
  PlayIcon,
  PlusIcon,
  SearchIcon,
  SmileyIcon,
  StarFillIcon,
  StarIcon,
  XIcon,
} from "@primer/octicons-react";
import katex from "katex";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import styled from "styled-components";
import {
  getMySpacesAndChatTree,
  getSpaceChannelMessages,
  listSpaces,
  promoteSpaceMessage,
  sendSpaceChannelMessage,
  toggleSpaceMessageReaction,
  type SpaceChannelRecord,
  type SpaceChatSidebarItem,
  type SpaceMessageRecord,
} from "../api";
import { useAuth } from "../AuthContext";
import CreateSpaceModal from "../components/spaces/CreateSpaceModal";
import Spinner from "../components/Spinner";
import { useToast } from "../components/ToastContext";
import { usePageTitle } from "../util/title";

/**
 * Horizontal SpaceTabsNav with hidden native scrollbars, smooth mouse-wheel scroll,
 * and high-density square space tabs.
 */
const SpaceTabsNav = styled.nav`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  box-sizing: border-box;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: none;
  -ms-overflow-style: none;
  scroll-behavior: smooth;
  flex: 1;
  min-width: 0;

  &::-webkit-scrollbar {
    display: none;
  }
`;

/**
 * High-density square Space tab button, matching vertical mode's compact icons
 * in a sleek horizontal top rail.
 */
const SpaceTabButton = styled.button<{ $active?: boolean }>`
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 38px;
  height: 38px;
  min-width: 38px;
  border-radius: 9px;
  border: ${(props) => (props.$active ? "none" : "1px solid var(--color-border)")};
  background: ${(props) =>
    props.$active ? "var(--ms-brand, #2563eb)" : "color-mix(in srgb, var(--ms-bg, #ffffff) 65%, transparent)"};
  color: ${(props) => (props.$active ? "#ffffff" : "var(--ms-text-2)")};
  font-weight: 700;
  font-size: 13px;
  line-height: 1;
  cursor: pointer;
  white-space: nowrap;
  box-sizing: border-box;
  flex-shrink: 0;
  box-shadow: ${(props) =>
    props.$active ? "0 2px 8px color-mix(in srgb, var(--ms-brand, #2563eb) 35%, transparent)" : "none"};
  transition: all 0.15s cubic-bezier(0.2, 0, 0, 1);

  &:hover {
    border-radius: 9px;
    background: ${(props) => (props.$active ? "var(--ms-brand, #2563eb)" : "var(--ms-surface-hover)")};
    color: ${(props) => (props.$active ? "#ffffff" : "var(--ms-text-1)")};
    border-color: ${(props) => (props.$active ? "transparent" : "var(--ms-brand)")};
  }

  &:focus-visible {
    outline: 2px solid var(--ms-brand, #3b82f6);
    outline-offset: 2px;
  }
`;

/**
 * Deterministic color gradient generator for engineering member avatars.
 */
function getAvatarGradient(name: string): { bg: string; fg: string } {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const gradients = [
    { bg: "linear-gradient(135deg, #6366f1 0%, #a855f7 100%)", fg: "#ffffff" },
    { bg: "linear-gradient(135deg, #3b82f6 0%, #06b6d4 100%)", fg: "#ffffff" },
    { bg: "linear-gradient(135deg, #10b981 0%, #059669 100%)", fg: "#ffffff" },
    { bg: "linear-gradient(135deg, #f59e0b 0%, #ea580c 100%)", fg: "#ffffff" },
    { bg: "linear-gradient(135deg, #ec4899 0%, #8b5cf6 100%)", fg: "#ffffff" },
    { bg: "linear-gradient(135deg, #0284c7 0%, #2563eb 100%)", fg: "#ffffff" },
    { bg: "linear-gradient(135deg, #14b8a6 0%, #0d9488 100%)", fg: "#ffffff" },
  ];
  return gradients[Math.abs(hash) % gradients.length]!;
}

/**
 * Extracts author initials for high-contrast avatar display.
 */
function getInitials(name: string): string {
  const clean = name.replace(/^@/, "").trim();
  const parts = clean.split(/[\s_.-]+/);
  if (parts.length >= 2 && parts[0] && parts[1]) {
    return (parts[0][0]! + parts[1][0]!).toUpperCase();
  }
  return clean.slice(0, 2).toUpperCase() || "EN";
}

/**
 * Safe KaTeX LaTeX formula renderer with plain text fallback.
 */
function renderLatex(expr: string, displayMode = false): string {
  try {
    return katex.renderToString(expr.trim(), {
      throwOnError: false,
      displayMode,
    });
  } catch {
    return expr;
  }
}

/**
 * Formats a message timestamp into a clean, human-readable Slack/Ansatz friendly time string.
 */
function formatMessageTime(isoString: string): string {
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return isoString;
    const now = new Date();
    const isToday =
      d.getDate() === now.getDate() && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    const timeStr = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    if (isToday) return `Today at ${timeStr}`;
    return `${d.toLocaleDateString([], { month: "short", day: "numeric" })} at ${timeStr}`;
  } catch {
    return isoString;
  }
}

/**
 * Modern Syntax-Highlighted Code Block with instant 1-click clipboard copy.
 */
const CodeSnippetBlock: React.FC<{ language?: string; code: string }> = ({ language = "modelica", code }) => {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    void navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div
      style={{
        margin: "8px 0",
        borderRadius: "8px",
        border: "1px solid var(--color-border)",
        overflow: "hidden",
        background: "var(--ms-bg-alt)",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "5px 12px",
          background: "var(--ms-surface-hover)",
          borderBottom: "1px solid var(--color-border)",
          fontSize: "11px",
          color: "var(--ms-text-3)",
          fontFamily: "var(--ms-font-mono)",
        }}
      >
        <span style={{ textTransform: "uppercase", fontWeight: 700 }}>{language}</span>
        <button
          type="button"
          onClick={handleCopy}
          style={{
            background: "none",
            border: "none",
            color: "inherit",
            cursor: "pointer",
            display: "inline-flex",
            alignItems: "center",
            gap: "4px",
            fontSize: "11px",
          }}
        >
          <CopyIcon size={12} />
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>
      <pre
        style={{
          margin: 0,
          padding: "10px 14px",
          overflowX: "auto",
          fontFamily: "var(--ms-font-mono)",
          fontSize: "12.5px",
          lineHeight: 1.5,
          color: "var(--ms-text-1)",
        }}
      >
        <code>{code}</code>
      </pre>
    </div>
  );
};

/**
 * Dedicated Executive Telemetry Card for ModelScript Simulation Runner benchmark results.
 */
interface SimulationTelemetryData {
  model: string;
  solver: string;
  tolerance?: string;
  states?: string;
  equations?: string;
  excursion?: string;
  requirement?: string;
  wallClock?: string;
}

function parseSimulationResult(content: string): SimulationTelemetryData | null {
  if (!content.includes("[Simulation Runner]")) return null;

  const modelMatch = content.match(/`([^`]+\.[^`]+)`\s+completed/i) || content.match(/`([^`]+)`/);
  const model = modelMatch ? modelMatch[1]! : "Modelica Simulation";

  const solverMatch = content.match(/Solver:\s*'([^']+)'/i);
  const solver = solverMatch ? solverMatch[1]! : "CVODE BDF";

  const tolMatch = content.match(/relative tolerance\s*\\?\(([^)]+)\\?\)/i);
  const tolerance = tolMatch ? tolMatch[1] : undefined;

  const statesMatch = content.match(/(\d+)\s+DAE states/i);
  const states = statesMatch ? statesMatch[1] : undefined;

  const eqMatch = content.match(/(\d+)\s+algebraic equations/i);
  const equations = eqMatch ? eqMatch[1] : undefined;

  const excursionMatch = content.match(/Maximum pitch excursion:\s*\*\*([^*]+)\*\*/i);
  const excursion = excursionMatch ? excursionMatch[1] : undefined;

  const reqMatch = content.match(/\*\((Requirement[^)]+)\)\*/i);
  const requirement = reqMatch ? reqMatch[1] : undefined;

  const wallClockMatch = content.match(/Wall clock time:\s*`([^`]+)`/i);
  const wallClock = wallClockMatch ? wallClockMatch[1] : undefined;

  return {
    model,
    solver,
    tolerance,
    states,
    equations,
    excursion,
    requirement,
    wallClock,
  };
}

const SimulationTelemetryCard: React.FC<{ data: SimulationTelemetryData }> = ({ data }) => {
  return (
    <div
      style={{
        marginTop: "8px",
        padding: "12px 14px",
        borderRadius: "10px",
        background: "var(--ms-bg-alt)",
        border: "1px solid var(--color-border)",
        borderLeft: "4px solid #10b981",
        display: "flex",
        flexDirection: "column",
        gap: "10px",
      }}
    >
      <div
        style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "6px" }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "4px",
              background: "rgba(16, 185, 129, 0.15)",
              color: "#10b981",
              fontSize: "10.5px",
              fontWeight: 800,
              padding: "2px 7px",
              borderRadius: "999px",
            }}
          >
            <CheckIcon size={12} /> SIMULATION PASSED
          </span>
          <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--ms-text-2)" }}>
            Solver: <strong>{data.solver}</strong>
            {data.tolerance && (
              <span style={{ marginLeft: "4px" }}>
                (tol: <span dangerouslySetInnerHTML={{ __html: renderLatex(data.tolerance) }} />)
              </span>
            )}
          </span>
        </div>
        {data.wallClock && (
          <span
            style={{
              fontSize: "11px",
              fontFamily: "var(--ms-font-mono)",
              color: "var(--ms-text-3)",
              background: "var(--ms-surface-hover)",
              padding: "2px 6px",
              borderRadius: "4px",
            }}
          >
            ⏱ {data.wallClock}
          </span>
        )}
      </div>

      <div
        style={{
          fontFamily: "var(--ms-font-mono)",
          fontSize: "12.5px",
          fontWeight: 600,
          color: "var(--ms-brand, #3b82f6)",
        }}
      >
        📦 {data.model}
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(105px, 1fr))",
          gap: "8px",
        }}
      >
        {data.states && (
          <div
            style={{
              background: "var(--ms-bg)",
              padding: "6px 10px",
              borderRadius: "6px",
              border: "1px solid var(--color-border)",
            }}
          >
            <div style={{ fontSize: "10px", color: "var(--ms-text-3)", textTransform: "uppercase", fontWeight: 700 }}>
              DAE States
            </div>
            <div style={{ fontSize: "14px", fontWeight: 800, color: "var(--ms-text-1)" }}>{data.states}</div>
          </div>
        )}
        {data.equations && (
          <div
            style={{
              background: "var(--ms-bg)",
              padding: "6px 10px",
              borderRadius: "6px",
              border: "1px solid var(--color-border)",
            }}
          >
            <div style={{ fontSize: "10px", color: "var(--ms-text-3)", textTransform: "uppercase", fontWeight: 700 }}>
              Equations
            </div>
            <div style={{ fontSize: "14px", fontWeight: 800, color: "var(--ms-text-1)" }}>{data.equations}</div>
          </div>
        )}
        {data.excursion && (
          <div
            style={{
              background: "var(--ms-bg)",
              padding: "6px 10px",
              borderRadius: "6px",
              border: "1px solid var(--color-border)",
            }}
          >
            <div style={{ fontSize: "10px", color: "var(--ms-text-3)", textTransform: "uppercase", fontWeight: 700 }}>
              Max Excursion
            </div>
            <div style={{ fontSize: "14px", fontWeight: 800, color: "#10b981" }}>{data.excursion}</div>
          </div>
        )}
      </div>

      {data.requirement && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "6px",
            fontSize: "12px",
            color: "#10b981",
            background: "rgba(16, 185, 129, 0.08)",
            padding: "6px 10px",
            borderRadius: "6px",
            fontWeight: 600,
          }}
        >
          <CheckIcon size={14} />
          <span>{data.requirement}</span>
        </div>
      )}
    </div>
  );
};

/**
 * World-Class Message Text Renderer: LaTeX Math, Code Blocks, Mentions, and /run chips.
 */
const FormattedMessageContent: React.FC<{
  content: string;
  onInsertCommand?: (cmd: string) => void;
}> = ({ content, onInsertCommand }) => {
  const simTelemetry = useMemo(() => parseSimulationResult(content), [content]);
  if (simTelemetry) {
    return <SimulationTelemetryCard data={simTelemetry} />;
  }

  if (content.includes("```")) {
    const parts = content.split(/(```[\s\S]*?```)/g);
    return (
      <div style={{ fontSize: "13.5px", lineHeight: 1.5, color: "var(--ms-text-1)" }}>
        {parts.map((part, idx) => {
          if (part.startsWith("```") && part.endsWith("```")) {
            const inner = part.slice(3, -3);
            const firstNewline = inner.indexOf("\n");
            const lang = firstNewline >= 0 ? inner.slice(0, firstNewline).trim() : "text";
            const code = firstNewline >= 0 ? inner.slice(firstNewline + 1) : inner;
            return <CodeSnippetBlock key={idx} language={lang || "modelica"} code={code.trim()} />;
          }
          return <InlineRichText key={idx} text={part} onInsertCommand={onInsertCommand} />;
        })}
      </div>
    );
  }

  return (
    <div style={{ fontSize: "13.5px", lineHeight: 1.5, color: "var(--ms-text-1)" }}>
      <InlineRichText text={content} onInsertCommand={onInsertCommand} />
    </div>
  );
};

/**
 * Inline text parser with LaTeX math, inline code, /run chips, @mentions, and formatting.
 */
const InlineRichText: React.FC<{
  text: string;
  onInsertCommand?: ((cmd: string) => void) | undefined;
}> = ({ text, onInsertCommand }) => {
  const tokens = useMemo(() => {
    const segments: Array<{ type: "text" | "math_inline" | "code" | "run" | "mention"; value: string }> = [];
    const pattern = /(\\\[[\s\S]+?\\\]|\\\([^\n]+?\\\)|`[^`\n]+`|\/run\s+[a-zA-Z0-9_.]+|@[a-zA-Z0-9_.-]+)/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = pattern.exec(text)) !== null) {
      if (match.index > lastIndex) {
        segments.push({ type: "text", value: text.slice(lastIndex, match.index) });
      }
      const raw = match[0]!;
      if (raw.startsWith("\\[") && raw.endsWith("\\]")) {
        segments.push({ type: "math_inline", value: raw.slice(2, -2) });
      } else if (raw.startsWith("\\(") && raw.endsWith("\\)")) {
        segments.push({ type: "math_inline", value: raw.slice(2, -2) });
      } else if (raw.startsWith("`") && raw.endsWith("`")) {
        segments.push({ type: "code", value: raw.slice(1, -1) });
      } else if (raw.startsWith("/run ")) {
        segments.push({ type: "run", value: raw.slice(5).trim() });
      } else if (raw.startsWith("@")) {
        segments.push({ type: "mention", value: raw });
      }
      lastIndex = pattern.lastIndex;
    }

    if (lastIndex < text.length) {
      segments.push({ type: "text", value: text.slice(lastIndex) });
    }

    return segments;
  }, [text]);

  return (
    <>
      {tokens.map((token, idx) => {
        if (token.type === "math_inline") {
          return (
            <span
              key={idx}
              style={{ margin: "0 2px" }}
              dangerouslySetInnerHTML={{ __html: renderLatex(token.value, false) }}
            />
          );
        }
        if (token.type === "code") {
          return (
            <code
              key={idx}
              style={{
                fontFamily: "var(--ms-font-mono)",
                fontSize: "13.5px",
                padding: "2px 6px",
                borderRadius: "4px",
                background: "var(--ms-surface-hover)",
                color: "var(--ms-brand, #3b82f6)",
                border: "1px solid var(--color-border)",
              }}
            >
              {token.value}
            </code>
          );
        }
        if (token.type === "run") {
          return (
            <button
              key={idx}
              type="button"
              onClick={() => onInsertCommand?.(`/run ${token.value}`)}
              title="Click to insert command into chat composer"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "4px",
                margin: "0 4px",
                padding: "2px 8px",
                borderRadius: "6px",
                border: "1px solid color-mix(in srgb, var(--ms-brand, #3b82f6) 35%, transparent)",
                background: "var(--ms-brand-soft, rgba(59, 130, 246, 0.1))",
                color: "var(--ms-brand, #3b82f6)",
                fontFamily: "var(--ms-font-mono)",
                fontSize: "13px",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              <PlayIcon size={12} />
              /run {token.value}
            </button>
          );
        }
        if (token.type === "mention") {
          return (
            <span
              key={idx}
              style={{
                color: "var(--ms-brand, #3b82f6)",
                fontWeight: 700,
                fontSize: "14.5px",
                background: "var(--ms-brand-soft, rgba(59, 130, 246, 0.08))",
                padding: "1px 5px",
                borderRadius: "4px",
              }}
            >
              {token.value}
            </span>
          );
        }

        return <FormattedPlainText key={idx} text={token.value} />;
      })}
    </>
  );
};

const FormattedPlainText: React.FC<{ text: string }> = ({ text }) => {
  const parts = text.split(/(\*\*[^*]+?\*\*|\*[^*]+?\*)/g);
  return (
    <>
      {parts.map((p, i) => {
        if (p.startsWith("**") && p.endsWith("**")) {
          return <strong key={i}>{p.slice(2, -2)}</strong>;
        }
        if (p.startsWith("*") && p.endsWith("*")) {
          return <em key={i}>{p.slice(1, -1)}</em>;
        }
        return p;
      })}
    </>
  );
};

/**
 * Primary Slack / Discord-style Engineering Chat Workspace (`/chat`).
 * Spaces are organized into a high-density horizontal square tab rail across the top
 * with smooth scrollbar-free scrolling (mouse wheel and chevron navigation).
 */
export const SpaceChatPage: React.FC = () => {
  usePageTitle("Spaces Chat — Real-Time Engineering Channels");
  const { user } = useAuth();
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  const [sidebarSpaces, setSidebarSpaces] = useState<SpaceChatSidebarItem[]>([]);
  const [activeSpace, setActiveSpace] = useState<SpaceChatSidebarItem | null>(null);
  const [activeChannel, setActiveChannel] = useState<SpaceChannelRecord | null>(null);
  const [messages, setMessages] = useState<SpaceMessageRecord[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [hoveredMessageId, setHoveredMessageId] = useState<string | null>(null);
  const [isScrolledUp, setIsScrolledUp] = useState(false);
  const [filterQuery, setFilterQuery] = useState("");
  const [showSearchInput, setShowSearchInput] = useState(false);
  const [channelFilterQuery, setChannelFilterQuery] = useState("");
  const [isComposerFocused, setIsComposerFocused] = useState(false);
  const [starredChannels, setStarredChannels] = useState<Set<string>>(() => new Set(["general"]));

  const toggleStar = useCallback((slug: string) => {
    setStarredChannels((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  }, []);

  const [activeThreadMessage, setActiveThreadMessage] = useState<SpaceMessageRecord | null>(null);
  const [threadReplies, setThreadReplies] = useState<SpaceMessageRecord[]>([]);
  const [threadInput, setThreadInput] = useState("");
  const [threadLoading, setThreadLoading] = useState(false);
  const [alsoSendToChannel, setAlsoSendToChannel] = useState(false);
  const [isThreadComposerFocused, setIsThreadComposerFocused] = useState(false);
  const threadTextareaRef = useRef<HTMLTextAreaElement>(null);
  const threadEndRef = useRef<HTMLDivElement>(null);

  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const streamContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const tabsNavRef = useRef<HTMLElement | null>(null);

  const updateScrollState = useCallback(() => {
    if (!tabsNavRef.current) return;
    const { scrollLeft, scrollWidth, clientWidth } = tabsNavRef.current;
    setCanScrollLeft(scrollLeft > 2);
    setCanScrollRight(scrollLeft + clientWidth < scrollWidth - 2);
  }, []);

  const scrollTabs = (dir: "left" | "right") => {
    if (!tabsNavRef.current) return;
    const delta = dir === "left" ? -200 : 200;
    tabsNavRef.current.scrollBy({ left: delta, behavior: "smooth" });
    setTimeout(updateScrollState, 200);
  };

  const scrollToBottom = useCallback((smooth = true) => {
    messagesEndRef.current?.scrollIntoView({ behavior: smooth ? "smooth" : "auto" });
    setIsScrolledUp(false);
  }, []);

  const handleScroll = () => {
    if (!streamContainerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = streamContainerRef.current;
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
    setIsScrolledUp(distanceFromBottom > 120);
  };

  const loadSidebar = useCallback(async () => {
    setLoading(true);
    try {
      let items: SpaceChatSidebarItem[] = [];
      if (user) {
        const res = await getMySpacesAndChatTree();
        items = res.spaces;
      }
      if (items.length === 0) {
        const publicSpaces = await listSpaces({ limit: 20 });
        items = publicSpaces.map((sp) => ({
          ...sp,
          member_role: "viewer",
          channels: [
            {
              id: `${sp.id}_gen`,
              space_id: sp.id,
              slug: "general",
              name: "general",
              topic: sp.tagline,
              kind: "text",
              position: 0,
              is_private: false,
              created_at: sp.created_at,
            },
          ],
          total_unread: 0,
          total_mentions: 0,
        }));
      }
      setSidebarSpaces(items);

      const requestedSpaceKey = searchParams.get("space");
      const found =
        (requestedSpaceKey &&
          items.find((s) => `${s.owner_namespace}/${s.slug}`.toLowerCase() === requestedSpaceKey.toLowerCase())) ||
        items[0] ||
        null;

      setActiveSpace(found);
      if (found && found.channels.length > 0) {
        const gen = found.channels.find((c) => c.slug === "general") || found.channels[0]!;
        setActiveChannel(gen);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void loadSidebar();
  }, [loadSidebar]);

  useEffect(() => {
    updateScrollState();
    window.addEventListener("resize", updateScrollState);
    return () => window.removeEventListener("resize", updateScrollState);
  }, [updateScrollState, sidebarSpaces.length]);

  useEffect(() => {
    if (!activeSpace || !activeChannel) return;
    setActiveThreadMessage(null);
    setThreadReplies([]);
    void getSpaceChannelMessages(activeSpace.owner_namespace, activeSpace.slug, activeChannel.slug)
      .then((res) => {
        setMessages(res.messages);
        setActiveChannel(res.channel);
        setTimeout(() => scrollToBottom(false), 50);
      })
      .catch(() => {});
  }, [activeSpace?.id, activeChannel?.slug, scrollToBottom]);

  // Fetch thread replies whenever activeThreadMessage changes
  useEffect(() => {
    if (!activeSpace || !activeChannel || !activeThreadMessage) {
      setThreadReplies([]);
      return;
    }
    let isMounted = true;
    setThreadLoading(true);
    getSpaceChannelMessages(activeSpace.owner_namespace, activeSpace.slug, activeChannel.slug, activeThreadMessage.id)
      .then((res) => {
        if (!isMounted) return;
        const replies = (res.messages || []).filter((m) => m.id !== activeThreadMessage.id);
        setThreadReplies(replies);
        setTimeout(() => {
          threadEndRef.current?.scrollIntoView({ behavior: "smooth" });
        }, 50);
      })
      .catch(() => {
        if (!isMounted) return;
        const localReplies = messages.filter((m) => m.reply_to_id === activeThreadMessage.id);
        setThreadReplies(localReplies);
      })
      .finally(() => {
        if (isMounted) setThreadLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [activeSpace?.owner_namespace, activeSpace?.slug, activeChannel?.slug, activeThreadMessage?.id]);

  // Real-time WebSocket connection
  useEffect(() => {
    if (!activeSpace || !activeChannel || typeof window === "undefined" || typeof WebSocket === "undefined") {
      return;
    }
    try {
      const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(`${proto}//${window.location.host}/api/v1/collab/stream`);
      wsRef.current = ws;
      ws.onopen = () => {
        ws.send(
          JSON.stringify({
            type: "chat:subscribe",
            channelIds: [activeChannel.id, activeSpace.id],
          }),
        );
      };
      ws.onmessage = (ev) => {
        try {
          const data = JSON.parse(String(ev.data));
          if (data.type === "chat:message" && data.channelId === activeChannel.id && data.message) {
            const incomingMsg = data.message as SpaceMessageRecord;
            setMessages((prev) => {
              if (prev.some((m) => m.id === incomingMsg.id)) return prev;
              let next = [...prev, incomingMsg];
              if (incomingMsg.reply_to_id) {
                next = next.map((m) =>
                  m.id === incomingMsg.reply_to_id ? { ...m, thread_reply_count: (m.thread_reply_count || 0) + 1 } : m,
                );
              }
              if (!isScrolledUp) {
                setTimeout(() => scrollToBottom(true), 50);
              }
              return next;
            });

            if (
              activeThreadMessage &&
              (incomingMsg.reply_to_id === activeThreadMessage.id || incomingMsg.id === activeThreadMessage.id)
            ) {
              setThreadReplies((prev) => (prev.some((m) => m.id === incomingMsg.id) ? prev : [...prev, incomingMsg]));
            }
          }
        } catch {}
      };
      return () => ws.close();
    } catch {
      return undefined;
    }
  }, [activeSpace?.id, activeChannel?.id, isScrolledUp, scrollToBottom, activeThreadMessage]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeSpace || !activeChannel || !chatInput.trim()) return;
    const contentToSend = chatInput.trim();
    try {
      setChatInput("");
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
      }
      const res = await sendSpaceChannelMessage(activeSpace.owner_namespace, activeSpace.slug, activeChannel.slug, {
        content: contentToSend,
      });
      setMessages((prev) => {
        const next = prev.some((m) => m.id === res.message.id) ? [...prev] : [...prev, res.message];
        if (res.botReply && !next.some((m) => m.id === res.botReply!.id)) {
          next.push(res.botReply);
        }
        return next;
      });
      setTimeout(() => scrollToBottom(true), 50);
    } catch (err: any) {
      toast.error(err?.response?.data?.error || "Failed to send message");
    }
  };

  const handleReaction = async (messageId: string, emoji: string) => {
    if (!activeSpace || !activeChannel) return;
    try {
      const updated = await toggleSpaceMessageReaction(
        activeSpace.owner_namespace,
        activeSpace.slug,
        activeChannel.slug,
        messageId,
        emoji,
      );
      setMessages((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
    } catch {
      toast.error("Failed to toggle reaction");
    }
  };

  const handlePromote = async (messageId: string, targetType: "doc" | "eco") => {
    if (!activeSpace || !activeChannel) return;
    try {
      await promoteSpaceMessage(
        activeSpace.owner_namespace,
        activeSpace.slug,
        activeChannel.slug,
        messageId,
        targetType,
      );
      toast.success(
        targetType === "doc" ? "Promoted message to Space Living Doc!" : "Promoted message to Change Order (ECO)!",
      );
      setMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, promoted_target_type: targetType } : m)));
    } catch (err: any) {
      toast.error(err?.response?.data?.error || "Promotion failed");
    }
  };

  const handleSendThreadReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeSpace || !activeChannel || !activeThreadMessage || !threadInput.trim()) return;
    const contentToSend = threadInput.trim();
    try {
      setThreadInput("");
      if (threadTextareaRef.current) {
        threadTextareaRef.current.style.height = "auto";
      }
      const res = await sendSpaceChannelMessage(activeSpace.owner_namespace, activeSpace.slug, activeChannel.slug, {
        content: contentToSend,
        replyToId: activeThreadMessage.id,
      });

      setThreadReplies((prev) => (prev.some((m) => m.id === res.message.id) ? prev : [...prev, res.message]));

      setMessages((prev) => {
        let updated = prev.map((m) =>
          m.id === activeThreadMessage.id ? { ...m, thread_reply_count: (m.thread_reply_count || 0) + 1 } : m,
        );
        if (alsoSendToChannel && !updated.some((m) => m.id === res.message.id)) {
          updated = [...updated, res.message];
        }
        if (res.botReply && alsoSendToChannel && !updated.some((m) => m.id === res.botReply!.id)) {
          updated = [...updated, res.botReply!];
        }
        return updated;
      });

      if (res.botReply) {
        setThreadReplies((prev) => [...prev, res.botReply!]);
      }

      setTimeout(() => {
        threadEndRef.current?.scrollIntoView({ behavior: "smooth" });
      }, 50);
    } catch (err: any) {
      toast.error(err?.response?.data?.error || "Failed to send thread reply");
    }
  };

  const handleThreadReaction = async (messageId: string, emoji: string) => {
    if (!activeSpace || !activeChannel) return;
    try {
      const updated = await toggleSpaceMessageReaction(
        activeSpace.owner_namespace,
        activeSpace.slug,
        activeChannel.slug,
        messageId,
        emoji,
      );
      setThreadReplies((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
      setMessages((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
      if (activeThreadMessage && activeThreadMessage.id === updated.id) {
        setActiveThreadMessage(updated);
      }
    } catch {
      toast.error("Failed to toggle reaction");
    }
  };

  if (loading) {
    return (
      <div style={{ padding: "48px", display: "flex", justifyContent: "center", alignItems: "center", height: "100%" }}>
        <Spinner />
      </div>
    );
  }

  const channelMessages = messages.filter((m) => !m.reply_to_id);

  const filteredMessages = filterQuery.trim()
    ? messages.filter((m) => m.content.toLowerCase().includes(filterQuery.toLowerCase()))
    : channelMessages;

  const filteredChannels = activeSpace
    ? activeSpace.channels.filter((c) =>
        channelFilterQuery ? c.name.toLowerCase().includes(channelFilterQuery.toLowerCase()) : true,
      )
    : [];

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        maxHeight: "100%",
        width: "100%",
        overflow: "hidden",
        background: "var(--ms-bg)",
        color: "var(--color-text-primary)",
        boxSizing: "border-box",
      }}
    >
      {/* 1. Horizontal High-Density Square Space Tabs Rail with Zero-Scrollbar Wheel & Arrow Scrolling */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          width: "100%",
          background: "color-mix(in srgb, var(--ms-bg-alt, #f8fafc) 75%, transparent)",
          backdropFilter: "blur(16px)",
          WebkitBackdropFilter: "blur(16px)",
          borderBottom: "1px solid var(--color-border)",
          position: "relative",
          flexShrink: 0,
        }}
      >
        {/* Left Scroll Arrow Button */}
        {canScrollLeft && (
          <button
            type="button"
            onClick={() => scrollTabs("left")}
            title="Scroll spaces left"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: "28px",
              height: "44px",
              border: "none",
              background:
                "linear-gradient(to right, color-mix(in srgb, var(--ms-bg-alt, #f8fafc) 85%, transparent) 75%, transparent)",
              color: "var(--ms-text-2)",
              cursor: "pointer",
              padding: "0 4px",
              position: "absolute",
              left: 0,
              zIndex: 5,
            }}
          >
            <ChevronLeftIcon size={16} />
          </button>
        )}

        {/* Scrollable Square Tabs Track */}
        <SpaceTabsNav
          ref={tabsNavRef}
          onScroll={updateScrollState}
          onWheel={(e) => {
            if (tabsNavRef.current && Math.abs(e.deltaY) > 0) {
              tabsNavRef.current.scrollLeft += e.deltaY;
            }
          }}
        >
          {sidebarSpaces.map((sp) => {
            const isSelected = activeSpace?.id === sp.id;
            return (
              <SpaceTabButton
                key={sp.id}
                type="button"
                $active={isSelected}
                title={`@${sp.owner_namespace}/${sp.slug} — ${sp.name}`}
                onClick={() => {
                  setActiveSpace(sp);
                  if (sp.channels[0]) setActiveChannel(sp.channels[0]);
                  setSearchParams({ space: `${sp.owner_namespace}/${sp.slug}` });
                }}
              >
                <span>{sp.name.slice(0, 2).toUpperCase()}</span>
                {sp.total_unread > 0 && (
                  <span
                    style={{
                      position: "absolute",
                      top: "-3px",
                      right: "-3px",
                      background: "#ef4444",
                      color: "#ffffff",
                      fontSize: "9.5px",
                      fontWeight: 800,
                      padding: "1px 5px",
                      borderRadius: "999px",
                      lineHeight: "1.2",
                      border: "2px solid var(--ms-bg-alt, #f8fafc)",
                    }}
                  >
                    {sp.total_unread}
                  </span>
                )}
              </SpaceTabButton>
            );
          })}
        </SpaceTabsNav>

        {/* Right Scroll Arrow Button */}
        {canScrollRight && (
          <button
            type="button"
            onClick={() => scrollTabs("right")}
            title="Scroll spaces right"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: "28px",
              height: "44px",
              border: "none",
              background:
                "linear-gradient(to left, color-mix(in srgb, var(--ms-bg-alt, #f8fafc) 85%, transparent) 75%, transparent)",
              color: "var(--ms-text-2)",
              cursor: "pointer",
              padding: "0 4px",
              position: "absolute",
              right: "88px",
              zIndex: 5,
            }}
          >
            <ChevronRightIcon size={16} />
          </button>
        )}

        {/* Action Buttons docked at right of tab bar */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "6px",
            paddingRight: "12px",
            marginLeft: "auto",
            flexShrink: 0,
          }}
        >
          <button
            type="button"
            title="Create New Space"
            onClick={() => setIsCreateModalOpen(true)}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: "36px",
              height: "36px",
              borderRadius: "9px",
              border: "1.5px dashed var(--color-border)",
              background: "transparent",
              color: "var(--ms-brand, #2563eb)",
              cursor: "pointer",
              transition: "all 0.15s ease",
            }}
          >
            <PlusIcon size={15} />
          </button>

          <Link
            to="/spaces"
            title="Browse All Spaces"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: "36px",
              height: "36px",
              borderRadius: "9px",
              border: "1px solid var(--color-border)",
              background: "transparent",
              color: "var(--ms-text-3)",
              textDecoration: "none",
              transition: "all 0.15s ease",
            }}
          >
            <SearchIcon size={14} />
          </Link>
        </div>
      </div>

      {/* 2. Workspace Body: 2-Column Channels Sidebar + Chat Stream (+ Thread Side Panel) */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: activeThreadMessage ? "240px minmax(360px, 1fr) 420px" : "240px 1fr",
          flex: 1,
          minHeight: 0,
          overflow: "hidden",
        }}
      >
        {/* Left: Space Channels & Contextual Links Sidenav (Slack-style mini sidenav) */}
        <div
          style={{
            background: "color-mix(in srgb, var(--ms-bg-alt, #f8fafc) 75%, transparent)",
            backdropFilter: "blur(16px)",
            WebkitBackdropFilter: "blur(16px)",
            borderRight: "1px solid var(--color-border)",
            display: "flex",
            flexDirection: "column",
            height: "100%",
            overflow: "hidden",
          }}
        >
          {activeSpace ? (
            <>
              {/* Space Header Info (Slack-style workspace header) */}
              <div
                style={{
                  padding: "10px 14px",
                  borderBottom: "1px solid var(--color-border)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  flexShrink: 0,
                  background: "color-mix(in srgb, var(--ms-bg-alt, #f8fafc) 80%, transparent)",
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    <span
                      style={{
                        fontWeight: 800,
                        fontSize: "13.5px",
                        color: "var(--ms-text-1)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                      title={activeSpace.name}
                    >
                      {activeSpace.name}
                    </span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "5px", marginTop: "2px" }}>
                    <span
                      style={{
                        fontSize: "9.5px",
                        fontWeight: 700,
                        textTransform: "uppercase",
                        letterSpacing: "0.04em",
                        color: activeSpace.owner_type === "organization" ? "var(--ms-brand, #2563eb)" : "#a855f7",
                        background:
                          activeSpace.owner_type === "organization"
                            ? "var(--ms-brand-soft, rgba(59, 130, 246, 0.1))"
                            : "rgba(168, 85, 247, 0.1)",
                        padding: "1px 5px",
                        borderRadius: "4px",
                      }}
                    >
                      {activeSpace.owner_type === "organization" ? "ORG" : "PERSONAL"}
                    </span>
                    <span style={{ fontSize: "11px", color: "var(--ms-text-3)" }}>@{activeSpace.owner_namespace}</span>
                  </div>
                </div>

                <Link
                  to={`/@${activeSpace.owner_namespace}/${activeSpace.slug}`}
                  title="Open Full Space Hub"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: "28px",
                    height: "28px",
                    borderRadius: "6px",
                    color: "var(--ms-text-3)",
                    border: "1px solid var(--color-border)",
                    background: "var(--ms-surface-hover)",
                    textDecoration: "none",
                    flexShrink: 0,
                    transition: "all 0.12s ease",
                  }}
                >
                  <LinkExternalIcon size={12} />
                </Link>
              </div>

              {/* Channels List & Navigation */}
              <div
                style={{
                  flex: 1,
                  overflowY: "auto",
                  padding: "8px 8px 12px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "12px",
                }}
              >
                {/* Channel Filter Input (Slack-style 'Find a channel...') */}
                <div style={{ padding: "0 2px" }}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "6px",
                      padding: "5px 8px",
                      borderRadius: "6px",
                      background: "var(--ms-bg)",
                      border: "1px solid var(--color-border)",
                    }}
                  >
                    <SearchIcon size={12} style={{ color: "var(--ms-text-3)", flexShrink: 0 }} />
                    <input
                      type="text"
                      placeholder="Find a channel..."
                      value={channelFilterQuery}
                      onChange={(e) => setChannelFilterQuery(e.target.value)}
                      style={{
                        width: "100%",
                        border: "none",
                        outline: "none",
                        background: "transparent",
                        color: "var(--ms-text-1)",
                        fontSize: "11.5px",
                        padding: 0,
                      }}
                    />
                  </div>
                </div>

                {/* Channels Section */}
                <div>
                  <div
                    style={{
                      fontSize: "11px",
                      fontWeight: 700,
                      color: "var(--ms-text-3)",
                      padding: "0 8px 6px",
                      textTransform: "uppercase",
                      letterSpacing: "0.04em",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}
                  >
                    <span>Channels</span>
                    <span style={{ fontSize: "10px", color: "var(--ms-text-3)" }}>{filteredChannels.length}</span>
                  </div>
                  {filteredChannels.map((ch) => {
                    const isSelected = activeChannel?.slug === ch.slug;
                    return (
                      <button
                        key={ch.id}
                        type="button"
                        onClick={() => setActiveChannel(ch)}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "7px",
                          width: "100%",
                          padding: "6px 10px",
                          borderRadius: "6px",
                          border: "none",
                          background: isSelected
                            ? "var(--ms-surface-selected, rgba(59, 130, 246, 0.12))"
                            : "transparent",
                          color: isSelected ? "var(--ms-brand, #2563eb)" : "var(--ms-text-2)",
                          fontWeight: isSelected ? 700 : 500,
                          fontSize: "13px",
                          textAlign: "left",
                          cursor: "pointer",
                          transition: "all 0.12s ease",
                        }}
                      >
                        <span
                          style={{ fontFamily: "var(--ms-font-mono)", opacity: isSelected ? 1 : 0.6, fontSize: "13px" }}
                        >
                          #
                        </span>
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {ch.name}
                        </span>
                      </button>
                    );
                  })}
                </div>

                {/* Space Shortcuts / Jump Links Section */}
                <div>
                  <div
                    style={{
                      fontSize: "11px",
                      fontWeight: 700,
                      color: "var(--ms-text-3)",
                      padding: "0 8px 6px",
                      textTransform: "uppercase",
                      letterSpacing: "0.04em",
                    }}
                  >
                    Space Shortcuts
                  </div>
                  <Link
                    to={`/@${activeSpace.owner_namespace}/${activeSpace.slug}?tab=docs`}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      padding: "6px 10px",
                      borderRadius: "6px",
                      color: "var(--ms-text-2)",
                      textDecoration: "none",
                      fontSize: "12.5px",
                      transition: "background 0.12s ease",
                    }}
                  >
                    <BookIcon size={14} style={{ opacity: 0.7 }} />
                    <span>Living Docs (CMS)</span>
                  </Link>
                  <Link
                    to={`/@${activeSpace.owner_namespace}/${activeSpace.slug}?tab=changes`}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      padding: "6px 10px",
                      borderRadius: "6px",
                      color: "var(--ms-text-2)",
                      textDecoration: "none",
                      fontSize: "12.5px",
                      transition: "background 0.12s ease",
                    }}
                  >
                    <FileDiffIcon size={14} style={{ opacity: 0.7 }} />
                    <span>Change Control & ECOs</span>
                  </Link>
                  <Link
                    to={`/@${activeSpace.owner_namespace}/${activeSpace.slug}?tab=repos`}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      padding: "6px 10px",
                      borderRadius: "6px",
                      color: "var(--ms-text-2)",
                      textDecoration: "none",
                      fontSize: "12.5px",
                      transition: "background 0.12s ease",
                    }}
                  >
                    <CpuIcon size={14} style={{ opacity: 0.7 }} />
                    <span>Git Vault & PDM</span>
                  </Link>
                </div>
              </div>
            </>
          ) : (
            <div style={{ padding: "16px", fontSize: "13px", color: "var(--ms-text-3)" }}>No Spaces joined yet.</div>
          )}
        </div>

        {/* Right: Primary Fast Chat Stream */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            height: "100%",
            minHeight: 0,
            overflow: "hidden",
            background: "var(--ms-bg)",
          }}
        >
          {activeSpace && activeChannel ? (
            <>
              {/* Channel Header Bar (Slack-style top toolbar) */}
              <div
                style={{
                  height: "48px",
                  padding: "0 18px",
                  borderBottom: "1px solid var(--color-border)",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  flexShrink: 0,
                  background: "color-mix(in srgb, var(--ms-bg, #ffffff) 80%, transparent)",
                  backdropFilter: "blur(16px)",
                  WebkitBackdropFilter: "blur(16px)",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0 }}>
                  <button
                    type="button"
                    title={starredChannels.has(activeChannel.slug) ? "Unstar channel" : "Star channel"}
                    onClick={() => toggleStar(activeChannel.slug)}
                    style={{
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      padding: "4px",
                      color: starredChannels.has(activeChannel.slug) ? "#eab308" : "var(--ms-text-3)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      borderRadius: "4px",
                    }}
                  >
                    {starredChannels.has(activeChannel.slug) ? (
                      <StarFillIcon size={15} fill="#eab308" />
                    ) : (
                      <StarIcon size={15} />
                    )}
                  </button>

                  <span style={{ fontWeight: 800, fontSize: "15px", color: "var(--ms-text-1)" }}>
                    #{activeChannel.name}
                  </span>
                  <span style={{ color: "var(--color-border)", margin: "0 2px" }}>•</span>
                  <span
                    style={{
                      fontSize: "12px",
                      color: "var(--ms-text-3)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      maxWidth: "420px",
                    }}
                    title={activeChannel.topic || activeSpace.tagline || ""}
                  >
                    {activeChannel.topic || activeSpace.tagline || "Real-time engineering collaboration"}
                  </span>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: "10px", flexShrink: 0 }}>
                  {showSearchInput ? (
                    <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                      <input
                        type="text"
                        autoFocus
                        placeholder="Search messages..."
                        value={filterQuery}
                        onChange={(e) => setFilterQuery(e.target.value)}
                        style={{
                          padding: "4px 8px",
                          borderRadius: "6px",
                          border: "1px solid var(--color-border)",
                          background: "var(--ms-bg)",
                          color: "var(--ms-text-1)",
                          fontSize: "12px",
                          outline: "none",
                          width: "150px",
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => {
                          setShowSearchInput(false);
                          setFilterQuery("");
                        }}
                        style={{
                          background: "none",
                          border: "none",
                          color: "var(--ms-text-3)",
                          cursor: "pointer",
                          fontSize: "12px",
                        }}
                      >
                        ✕
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      title="Search messages in channel"
                      onClick={() => setShowSearchInput(true)}
                      style={{
                        background: "none",
                        border: "none",
                        color: "var(--ms-text-3)",
                        cursor: "pointer",
                        padding: "6px",
                        borderRadius: "6px",
                        display: "flex",
                        alignItems: "center",
                      }}
                    >
                      <SearchIcon size={15} />
                    </button>
                  )}

                  <div
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "5px",
                      fontSize: "11px",
                      fontWeight: 700,
                      color: "#10b981",
                      background: "rgba(16, 185, 129, 0.1)",
                      padding: "2px 7px",
                      borderRadius: "999px",
                    }}
                  >
                    <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: "#10b981" }} />
                    <span>Live</span>
                  </div>

                  <Link
                    to={`/@${activeSpace.owner_namespace}/${activeSpace.slug}`}
                    style={{
                      padding: "5px 10px",
                      borderRadius: "6px",
                      background: "var(--ms-surface-hover)",
                      border: "1px solid var(--color-border)",
                      color: "var(--ms-text-2)",
                      textDecoration: "none",
                      fontSize: "12px",
                      fontWeight: 600,
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "4px",
                      transition: "all 0.12s ease",
                    }}
                  >
                    <span>Go to Space</span>
                    <LinkExternalIcon size={12} />
                  </Link>
                </div>
              </div>

              {/* Scrollable Messages Stream */}
              <div
                ref={streamContainerRef}
                onScroll={handleScroll}
                style={{
                  flex: 1,
                  minHeight: 0,
                  overflowY: "auto",
                  padding: "16px 20px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "4px",
                  position: "relative",
                }}
              >
                {/* Channel Welcome Banner (Slack-style clean header) */}
                <div
                  style={{
                    padding: "24px 16px 18px",
                    borderBottom: "1px solid var(--color-border)",
                    marginBottom: "12px",
                  }}
                >
                  <h2
                    style={{
                      fontSize: "26px",
                      fontWeight: 800,
                      color: "var(--ms-text-1)",
                      margin: "0 0 8px 0",
                      display: "flex",
                      alignItems: "center",
                      gap: "6px",
                    }}
                  >
                    <span style={{ opacity: 0.6, fontWeight: 700 }}>#</span>
                    <span>{activeChannel.name}</span>
                  </h2>
                  <div style={{ fontSize: "14.5px", color: "var(--ms-text-2)", maxWidth: "660px", lineHeight: 1.55 }}>
                    This is the start of the <strong>#{activeChannel.name}</strong> channel in @
                    {activeSpace.owner_namespace}/{activeSpace.slug}. Collaborate in real time on CAD models, simulation
                    runs, and requirements verification.
                  </div>
                </div>

                {/* Slack-style Date Separator */}
                <div style={{ display: "flex", alignItems: "center", margin: "16px 0", position: "relative" }}>
                  <div style={{ flex: 1, height: "1px", background: "var(--color-border)" }} />
                  <span
                    style={{
                      padding: "4px 14px",
                      borderRadius: "999px",
                      border: "1px solid var(--color-border)",
                      background: "var(--ms-bg)",
                      fontSize: "12px",
                      fontWeight: 700,
                      color: "var(--ms-text-2)",
                      boxShadow: "0 1px 3px rgba(0,0,0,0.03)",
                    }}
                  >
                    Today
                  </span>
                  <div style={{ flex: 1, height: "1px", background: "var(--color-border)" }} />
                </div>

                {/* Message List */}
                {filteredMessages.map((m) => {
                  const isBot =
                    m.sender_type === "bot" ||
                    m.sender_type === "ci_runner" ||
                    m.sender_name?.includes("Bot") ||
                    m.sender_name?.includes("Runner") ||
                    m.author_username?.includes("bot");

                  const authorName = m.sender_name || (m.author_username ? `@${m.author_username}` : "Engineer");
                  const avatarGrad = getAvatarGradient(authorName);
                  const initials = getInitials(authorName);
                  const isHovered = hoveredMessageId === m.id;
                  const isThreadActive = activeThreadMessage?.id === m.id;
                  const threadRepliesCount =
                    m.thread_reply_count || messages.filter((x) => x.reply_to_id === m.id).length;
                  const formattedTime = formatMessageTime(m.created_at);

                  return (
                    <div
                      key={m.id}
                      onMouseEnter={() => setHoveredMessageId(m.id)}
                      onMouseLeave={() => setHoveredMessageId(null)}
                      style={{
                        position: "relative",
                        display: "flex",
                        gap: "14px",
                        padding: "8px 20px",
                        borderRadius: "8px",
                        background: isThreadActive
                          ? "var(--ms-thread-active-bg, color-mix(in srgb, #fef08a 25%, var(--ms-surface-hover, transparent)))"
                          : isHovered
                            ? "var(--ms-surface-hover)"
                            : "transparent",
                        transition: "background 0.12s ease",
                      }}
                    >
                      {/* Left: Avatar (Slack-style squircle) */}
                      <div style={{ flexShrink: 0, marginTop: "2px" }}>
                        {m.author_avatar_url ? (
                          <img
                            src={m.author_avatar_url}
                            alt={authorName}
                            style={{ width: "36px", height: "36px", borderRadius: "8px", objectFit: "cover" }}
                          />
                        ) : isBot ? (
                          <div
                            style={{
                              width: "36px",
                              height: "36px",
                              borderRadius: "8px",
                              background: "linear-gradient(135deg, #0284c7 0%, #2563eb 100%)",
                              color: "#ffffff",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                            }}
                          >
                            <HubotIcon size={18} />
                          </div>
                        ) : (
                          <div
                            style={{
                              width: "36px",
                              height: "36px",
                              borderRadius: "8px",
                              background: avatarGrad.bg,
                              color: avatarGrad.fg,
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              fontWeight: 800,
                              fontSize: "14px",
                              boxShadow: "0 1px 4px rgba(0,0,0,0.1)",
                            }}
                          >
                            {initials}
                          </div>
                        )}
                      </div>

                      {/* Right: Author line + Content + Reactions */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: "6px" }}>
                          <strong style={{ fontSize: "15px", color: "var(--ms-text-1)", fontWeight: 700 }}>
                            {authorName}
                          </strong>
                          {isBot && (
                            <span
                              style={{
                                fontSize: "10.5px",
                                fontWeight: 800,
                                textTransform: "uppercase",
                                background: "var(--ms-brand-soft, rgba(59, 130, 246, 0.12))",
                                color: "var(--ms-brand, #2563eb)",
                                padding: "1px 5px",
                                borderRadius: "4px",
                              }}
                            >
                              BOT
                            </span>
                          )}
                          <span
                            title={m.created_at}
                            style={{ fontSize: "12px", color: "var(--ms-text-3)", marginLeft: "4px" }}
                          >
                            {formattedTime}
                          </span>
                          {m.promoted_target_type === "doc" && (
                            <span
                              style={{
                                fontSize: "11px",
                                color: "var(--ms-brand, #2563eb)",
                                background: "var(--ms-brand-soft, rgba(59, 130, 246, 0.1))",
                                padding: "2px 7px",
                                borderRadius: "4px",
                                fontWeight: 600,
                              }}
                            >
                              📄 Living Doc
                            </span>
                          )}
                          {m.promoted_target_type === "eco" && (
                            <span
                              style={{
                                fontSize: "11px",
                                color: "#f59e0b",
                                background: "rgba(245, 158, 11, 0.1)",
                                padding: "2px 7px",
                                borderRadius: "4px",
                                fontWeight: 600,
                              }}
                            >
                              🔗 Change Order
                            </span>
                          )}
                        </div>

                        {/* Rich Formatted Message Content (Slack-matching 15px / 1.467 line-height) */}
                        <div
                          style={{
                            marginTop: "4px",
                            fontSize: "15px",
                            lineHeight: "1.46667",
                            color: "var(--color-text-primary, var(--ms-text-1))",
                            wordBreak: "break-word",
                          }}
                        >
                          <FormattedMessageContent
                            content={m.content}
                            onInsertCommand={(cmd) => {
                              setChatInput(cmd);
                              textareaRef.current?.focus();
                            }}
                          />
                        </div>

                        {/* Active Reaction Pills */}
                        {Object.entries(m.reactions || {}).some(([_, users]) => users && users.length > 0) && (
                          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginTop: "8px" }}>
                            {Object.entries(m.reactions || {})
                              .filter(([_, users]) => users && users.length > 0)
                              .map(([emoji, users]) => {
                                const hasReacted = user && users.includes(String(user.id));
                                return (
                                  <button
                                    key={emoji}
                                    type="button"
                                    onClick={() => handleReaction(m.id, emoji)}
                                    style={{
                                      padding: "3px 9px",
                                      borderRadius: "999px",
                                      border: hasReacted
                                        ? "1px solid var(--ms-brand, #2563eb)"
                                        : "1px solid var(--color-border)",
                                      background: hasReacted
                                        ? "var(--ms-brand-soft, rgba(59, 130, 246, 0.14))"
                                        : "var(--ms-surface-hover)",
                                      color: hasReacted ? "var(--ms-brand, #2563eb)" : "var(--ms-text-1)",
                                      fontSize: "13px",
                                      fontWeight: hasReacted ? 700 : 500,
                                      cursor: "pointer",
                                      display: "inline-flex",
                                      alignItems: "center",
                                      gap: "5px",
                                      transition: "all 0.12s ease",
                                    }}
                                  >
                                    <span style={{ fontSize: "14px" }}>{emoji}</span>
                                    <span style={{ fontSize: "12px", fontWeight: 600 }}>{users.length}</span>
                                  </button>
                                );
                              })}
                          </div>
                        )}

                        {/* Slack-Style Thread Replies Badge / Button */}
                        {threadRepliesCount > 0 && (
                          <div style={{ marginTop: "8px" }}>
                            <button
                              type="button"
                              onClick={() => setActiveThreadMessage(m)}
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: "6px",
                                padding: "4px 10px",
                                borderRadius: "6px",
                                border: "1px solid color-mix(in srgb, var(--ms-brand, #2563eb) 20%, transparent)",
                                background: "color-mix(in srgb, var(--ms-brand, #2563eb) 8%, transparent)",
                                color: "var(--ms-brand, #2563eb)",
                                fontSize: "12.5px",
                                fontWeight: 700,
                                cursor: "pointer",
                                transition: "all 0.12s ease",
                              }}
                              onMouseEnter={(e) => {
                                e.currentTarget.style.background = "var(--ms-brand-soft, rgba(59, 130, 246, 0.16))";
                              }}
                              onMouseLeave={(e) => {
                                e.currentTarget.style.background =
                                  "color-mix(in srgb, var(--ms-brand, #2563eb) 8%, transparent)";
                              }}
                            >
                              <CommentDiscussionIcon size={14} />
                              <span>
                                {threadRepliesCount} {threadRepliesCount === 1 ? "reply" : "replies"}
                              </span>
                              <span
                                style={{
                                  fontSize: "11px",
                                  color: "var(--ms-text-3)",
                                  fontWeight: 500,
                                  marginLeft: "3px",
                                }}
                              >
                                View thread
                              </span>
                            </button>
                          </div>
                        )}
                      </div>

                      {/* Floating Message Hover Action Bar (Slack-aligned) */}
                      {isHovered && (
                        <div
                          style={{
                            position: "absolute",
                            top: "-18px",
                            right: "20px",
                            display: "flex",
                            alignItems: "center",
                            gap: "3px",
                            background: "var(--ms-bg-elv, var(--ms-bg, #ffffff))",
                            border: "1px solid var(--color-border)",
                            borderRadius: "8px",
                            padding: "3px 6px",
                            boxShadow: "0 2px 8px rgba(0,0,0,0.12), 0 1px 3px rgba(0,0,0,0.06)",
                            zIndex: 10,
                          }}
                        >
                          {["✅", "👀", "🙌"].map((emoji) => (
                            <button
                              key={emoji}
                              type="button"
                              title={`React with ${emoji}`}
                              onClick={() => handleReaction(m.id, emoji)}
                              style={{
                                background: "transparent",
                                border: "none",
                                cursor: "pointer",
                                fontSize: "16px",
                                padding: "4px 6px",
                                borderRadius: "6px",
                                lineHeight: 1,
                                display: "inline-flex",
                                alignItems: "center",
                                justifyContent: "center",
                                transition: "background 0.1s ease",
                              }}
                              onMouseEnter={(e) => {
                                e.currentTarget.style.background = "var(--ms-surface-hover)";
                              }}
                              onMouseLeave={(e) => {
                                e.currentTarget.style.background = "transparent";
                              }}
                            >
                              {emoji}
                            </button>
                          ))}
                          <button
                            type="button"
                            title="Add reaction"
                            onClick={() => handleReaction(m.id, "👍")}
                            style={{
                              background: "transparent",
                              border: "none",
                              cursor: "pointer",
                              display: "inline-flex",
                              alignItems: "center",
                              gap: "5px",
                              fontSize: "13px",
                              fontWeight: 500,
                              color: "var(--ms-text-2)",
                              padding: "4px 8px",
                              borderRadius: "6px",
                              transition: "background 0.1s ease",
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.background = "var(--ms-surface-hover)";
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.background = "transparent";
                            }}
                          >
                            <SmileyIcon size={15} />
                            <span>React</span>
                          </button>
                          <button
                            type="button"
                            title="Reply in thread"
                            onClick={() => {
                              setActiveThreadMessage(m);
                            }}
                            style={{
                              background: "transparent",
                              border: "none",
                              cursor: "pointer",
                              display: "inline-flex",
                              alignItems: "center",
                              gap: "5px",
                              fontSize: "13px",
                              fontWeight: 500,
                              color: "var(--ms-text-2)",
                              padding: "4px 8px",
                              borderRadius: "6px",
                              transition: "background 0.1s ease",
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.background = "var(--ms-surface-hover)";
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.background = "transparent";
                            }}
                          >
                            <CommentIcon size={15} />
                            <span>Reply</span>
                          </button>
                          <div
                            style={{ width: "1px", height: "18px", background: "var(--color-border)", margin: "0 2px" }}
                          />
                          {user && (
                            <>
                              <button
                                type="button"
                                title="Promote to Space Living Doc"
                                onClick={() => handlePromote(m.id, "doc")}
                                style={{
                                  background: "transparent",
                                  border: "none",
                                  cursor: "pointer",
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: "5px",
                                  fontSize: "13px",
                                  fontWeight: 500,
                                  color: "var(--ms-text-2)",
                                  padding: "4px 8px",
                                  borderRadius: "6px",
                                  transition: "background 0.1s ease",
                                }}
                                onMouseEnter={(e) => {
                                  e.currentTarget.style.background = "var(--ms-surface-hover)";
                                }}
                                onMouseLeave={(e) => {
                                  e.currentTarget.style.background = "transparent";
                                }}
                              >
                                <BookIcon size={14} />
                                <span>Doc</span>
                              </button>
                              <button
                                type="button"
                                title="Promote to Change Order (ECO)"
                                onClick={() => handlePromote(m.id, "eco")}
                                style={{
                                  background: "transparent",
                                  border: "none",
                                  cursor: "pointer",
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: "5px",
                                  fontSize: "13px",
                                  fontWeight: 500,
                                  color: "var(--ms-text-2)",
                                  padding: "4px 8px",
                                  borderRadius: "6px",
                                  transition: "background 0.1s ease",
                                }}
                                onMouseEnter={(e) => {
                                  e.currentTarget.style.background = "var(--ms-surface-hover)";
                                }}
                                onMouseLeave={(e) => {
                                  e.currentTarget.style.background = "transparent";
                                }}
                              >
                                <FileDiffIcon size={14} />
                                <span>ECO</span>
                              </button>
                            </>
                          )}
                          <button
                            type="button"
                            title="Copy text"
                            onClick={() => {
                              void navigator.clipboard.writeText(m.content);
                              toast.success("Message copied to clipboard!");
                            }}
                            style={{
                              background: "transparent",
                              border: "none",
                              cursor: "pointer",
                              display: "inline-flex",
                              alignItems: "center",
                              justifyContent: "center",
                              color: "var(--ms-text-2)",
                              padding: "4px 7px",
                              borderRadius: "6px",
                              transition: "background 0.1s ease",
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.background = "var(--ms-surface-hover)";
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.background = "transparent";
                            }}
                          >
                            <CopyIcon size={14} />
                          </button>
                          <button
                            type="button"
                            title="More actions"
                            onClick={() => {
                              void navigator.clipboard.writeText(m.content);
                              toast.info("Message copied to clipboard");
                            }}
                            style={{
                              background: "transparent",
                              border: "none",
                              cursor: "pointer",
                              display: "inline-flex",
                              alignItems: "center",
                              justifyContent: "center",
                              color: "var(--ms-text-2)",
                              padding: "4px 7px",
                              borderRadius: "6px",
                              transition: "background 0.1s ease",
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.background = "var(--ms-surface-hover)";
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.background = "transparent";
                            }}
                          >
                            <KebabHorizontalIcon size={14} />
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
                <div ref={messagesEndRef} />
              </div>

              {/* Floating Jump to Latest Button */}
              {isScrolledUp && (
                <button
                  type="button"
                  onClick={() => scrollToBottom(true)}
                  style={{
                    position: "absolute",
                    bottom: "100px",
                    right: "32px",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "6px",
                    padding: "6px 14px",
                    borderRadius: "999px",
                    background: "var(--ms-brand, #2563eb)",
                    color: "#ffffff",
                    border: "none",
                    boxShadow: "0 4px 14px rgba(0,0,0,0.25)",
                    fontSize: "12px",
                    fontWeight: 700,
                    cursor: "pointer",
                    zIndex: 20,
                    transition: "transform 0.15s ease",
                  }}
                >
                  <span>↓ Jump to latest</span>
                </button>
              )}

              {/* Pinned Slack-Style Chat Composer */}
              <form
                onSubmit={handleSend}
                style={{
                  padding: "10px 18px 14px",
                  borderTop: "1px solid var(--color-border)",
                  background: "var(--ms-bg)",
                  display: "flex",
                  flexDirection: "column",
                  flexShrink: 0,
                }}
              >
                {/* Main Composer Box (Slack-style with top formatting, textarea, and bottom actions) */}
                <div
                  style={{
                    border: isComposerFocused ? "1px solid var(--ms-brand, #2563eb)" : "1px solid var(--color-border)",
                    boxShadow: isComposerFocused
                      ? "0 0 0 2px color-mix(in srgb, var(--ms-brand, #2563eb) 18%, transparent)"
                      : "0 1px 3px rgba(0,0,0,0.02)",
                    borderRadius: "8px",
                    background: "var(--ms-bg)",
                    display: "flex",
                    flexDirection: "column",
                    transition: "border-color 0.15s ease, box-shadow 0.15s ease",
                  }}
                >
                  {/* Top Rich Formatting Toolbar (Slack style) */}
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "2px",
                      padding: "5px 8px",
                      borderBottom: "1px solid var(--color-border)",
                      background: "color-mix(in srgb, var(--ms-bg-alt, #f8fafc) 60%, transparent)",
                      borderRadius: "7px 7px 0 0",
                    }}
                  >
                    <button
                      type="button"
                      title="Bold (**text**)"
                      onClick={() => {
                        setChatInput((p) => `${p}**bold**`);
                        textareaRef.current?.focus();
                      }}
                      style={{
                        background: "none",
                        border: "none",
                        color: "var(--ms-text-2)",
                        fontWeight: 800,
                        fontSize: "12px",
                        cursor: "pointer",
                        padding: "3px 6px",
                        borderRadius: "4px",
                        lineHeight: 1,
                      }}
                    >
                      B
                    </button>
                    <button
                      type="button"
                      title="Italic (*text*)"
                      onClick={() => {
                        setChatInput((p) => `${p}*italic*`);
                        textareaRef.current?.focus();
                      }}
                      style={{
                        background: "none",
                        border: "none",
                        color: "var(--ms-text-2)",
                        fontStyle: "italic",
                        fontSize: "12px",
                        cursor: "pointer",
                        padding: "3px 6px",
                        borderRadius: "4px",
                        lineHeight: 1,
                      }}
                    >
                      I
                    </button>
                    <button
                      type="button"
                      title="Strikethrough (~~text~~)"
                      onClick={() => {
                        setChatInput((p) => `${p}~~text~~`);
                        textareaRef.current?.focus();
                      }}
                      style={{
                        background: "none",
                        border: "none",
                        color: "var(--ms-text-2)",
                        textDecoration: "line-through",
                        fontSize: "12px",
                        cursor: "pointer",
                        padding: "3px 6px",
                        borderRadius: "4px",
                        lineHeight: 1,
                      }}
                    >
                      S
                    </button>
                    <div style={{ width: "1px", height: "14px", background: "var(--color-border)", margin: "0 4px" }} />
                    <button
                      type="button"
                      title="Inline Code (`code`)"
                      onClick={() => {
                        setChatInput((p) => `${p}\`code\``);
                        textareaRef.current?.focus();
                      }}
                      style={{
                        background: "none",
                        border: "none",
                        color: "var(--ms-text-2)",
                        fontSize: "11px",
                        fontFamily: "var(--ms-font-mono)",
                        cursor: "pointer",
                        padding: "3px 6px",
                        borderRadius: "4px",
                        lineHeight: 1,
                      }}
                    >
                      &lt;/&gt;
                    </button>
                    <button
                      type="button"
                      title="Code block"
                      onClick={() => {
                        setChatInput((p) => `${p}\`\`\`modelica\n\n\`\`\``);
                        textareaRef.current?.focus();
                      }}
                      style={{
                        background: "none",
                        border: "none",
                        color: "var(--ms-text-2)",
                        fontSize: "12px",
                        cursor: "pointer",
                        padding: "3px 5px",
                        borderRadius: "4px",
                        display: "flex",
                        alignItems: "center",
                      }}
                    >
                      <CodeIcon size={13} />
                    </button>
                    <button
                      type="button"
                      title="LaTeX Math (\( \))"
                      onClick={() => {
                        setChatInput((p) => `${p}\\( \\)`);
                        textareaRef.current?.focus();
                      }}
                      style={{
                        background: "none",
                        border: "none",
                        color: "var(--ms-text-2)",
                        fontSize: "11px",
                        fontWeight: 600,
                        cursor: "pointer",
                        padding: "3px 6px",
                        borderRadius: "4px",
                        lineHeight: 1,
                      }}
                    >
                      {"\\(\\sqrt{x}\\)"}
                    </button>
                  </div>

                  {/* Middle Textarea */}
                  <textarea
                    ref={textareaRef}
                    rows={1}
                    value={chatInput}
                    disabled={!user}
                    onFocus={() => setIsComposerFocused(true)}
                    onBlur={() => setIsComposerFocused(false)}
                    placeholder={
                      user
                        ? `Message #${activeChannel.name}... (Type /run to simulate, # to reference)`
                        : "Sign in to chat..."
                    }
                    onChange={(e) => {
                      setChatInput(e.target.value);
                      e.target.style.height = "auto";
                      e.target.style.height = `${Math.min(e.target.scrollHeight, 140)}px`;
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        void handleSend(e);
                      }
                    }}
                    style={{
                      width: "100%",
                      boxSizing: "border-box",
                      minHeight: "42px",
                      maxHeight: "140px",
                      padding: "8px 12px",
                      border: "none",
                      outline: "none",
                      background: "transparent",
                      color: "var(--color-text-primary)",
                      fontSize: "15px",
                      lineHeight: "1.46667",
                      resize: "none",
                      fontFamily: "inherit",
                    }}
                  />

                  {/* Bottom Action Bar (Quick action suggestion chips + Send button) */}
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      padding: "4px 8px 6px",
                    }}
                  >
                    {/* Left: Quick Action Suggestion Chips */}
                    <div style={{ display: "flex", alignItems: "center", gap: "5px", flexWrap: "wrap" }}>
                      <button
                        type="button"
                        onClick={() => {
                          setChatInput("/run Modelica.Mechanics.MultiBody.Examples.Rotational3D");
                          textareaRef.current?.focus();
                        }}
                        style={{
                          padding: "2px 7px",
                          borderRadius: "5px",
                          border: "1px solid var(--color-border)",
                          background: "var(--ms-surface-hover)",
                          color: "var(--ms-text-2)",
                          fontSize: "11px",
                          cursor: "pointer",
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "3px",
                        }}
                      >
                        <PlayIcon size={11} />
                        /run Rotational3D
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setChatInput((prev) => `${prev} #LivingDoc `);
                          textareaRef.current?.focus();
                        }}
                        style={{
                          padding: "2px 7px",
                          borderRadius: "5px",
                          border: "1px solid var(--color-border)",
                          background: "var(--ms-surface-hover)",
                          color: "var(--ms-text-2)",
                          fontSize: "11px",
                          cursor: "pointer",
                        }}
                      >
                        📄 #Doc
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setChatInput((prev) => `${prev} #ECO-1 `);
                          textareaRef.current?.focus();
                        }}
                        style={{
                          padding: "2px 7px",
                          borderRadius: "5px",
                          border: "1px solid var(--color-border)",
                          background: "var(--ms-surface-hover)",
                          color: "var(--ms-text-2)",
                          fontSize: "11px",
                          cursor: "pointer",
                        }}
                      >
                        🔗 #ECO
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setChatInput((prev) => `${prev}\\( \\)`);
                          textareaRef.current?.focus();
                        }}
                        style={{
                          padding: "2px 7px",
                          borderRadius: "5px",
                          border: "1px solid var(--color-border)",
                          background: "var(--ms-surface-hover)",
                          color: "var(--ms-text-2)",
                          fontSize: "11px",
                          cursor: "pointer",
                        }}
                      >
                        📐 \(LaTeX\)
                      </button>
                    </div>

                    {/* Right: Send button (Slack-style PaperAirplane icon button) */}
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", marginLeft: "auto" }}>
                      <button
                        type="submit"
                        disabled={!user || !chatInput.trim()}
                        title="Send message (Enter)"
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          width: "32px",
                          height: "32px",
                          borderRadius: "6px",
                          border: "none",
                          background: chatInput.trim() ? "var(--ms-brand, #2563eb)" : "transparent",
                          color: chatInput.trim() ? "#ffffff" : "var(--ms-text-3)",
                          cursor: chatInput.trim() ? "pointer" : "default",
                          transition: "all 0.15s ease",
                          boxShadow: chatInput.trim()
                            ? "0 2px 6px color-mix(in srgb, var(--ms-brand, #2563eb) 35%, transparent)"
                            : "none",
                        }}
                      >
                        <PaperAirplaneIcon size={14} />
                      </button>
                    </div>
                  </div>
                </div>
              </form>
            </>
          ) : (
            <div style={{ padding: "48px", textAlign: "center", color: "var(--color-text-muted)" }}>
              Select or create a Space from the tabs above to start chatting.
            </div>
          )}
        </div>

        {/* 3. Slack-Style Contextual Thread Side Panel */}
        {activeSpace && activeChannel && activeThreadMessage && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              height: "100%",
              background: "var(--ms-bg)",
              borderLeft: "1px solid var(--color-border)",
              width: "420px",
              minWidth: "360px",
              maxWidth: "460px",
              overflow: "hidden",
              position: "relative",
              zIndex: 5,
            }}
          >
            {/* Thread Header Bar */}
            <div
              style={{
                height: "48px",
                padding: "0 18px",
                borderBottom: "1px solid var(--color-border)",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                flexShrink: 0,
                background: "color-mix(in srgb, var(--ms-bg, #ffffff) 80%, transparent)",
                backdropFilter: "blur(16px)",
                WebkitBackdropFilter: "blur(16px)",
              }}
            >
              <div style={{ display: "flex", alignItems: "baseline", gap: "8px", minWidth: 0 }}>
                <span style={{ fontWeight: 800, fontSize: "16px", color: "var(--ms-text-1)" }}>Thread</span>
                <span
                  style={{
                    fontSize: "12px",
                    color: "var(--ms-text-3)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  #{activeChannel.name}
                </span>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <button
                  type="button"
                  title="Copy thread parent text"
                  onClick={() => {
                    void navigator.clipboard.writeText(activeThreadMessage.content);
                    toast.info("Parent message copied to clipboard");
                  }}
                  style={{
                    background: "none",
                    border: "none",
                    color: "var(--ms-text-3)",
                    cursor: "pointer",
                    padding: "6px",
                    borderRadius: "6px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <KebabHorizontalIcon size={16} />
                </button>

                <button
                  type="button"
                  title="Close thread"
                  onClick={() => setActiveThreadMessage(null)}
                  style={{
                    background: "none",
                    border: "none",
                    color: "var(--ms-text-3)",
                    cursor: "pointer",
                    padding: "6px",
                    borderRadius: "6px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    transition: "all 0.12s ease",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = "var(--ms-surface-hover)";
                    e.currentTarget.style.color = "var(--ms-text-1)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "none";
                    e.currentTarget.style.color = "var(--ms-text-3)";
                  }}
                >
                  <XIcon size={16} />
                </button>
              </div>
            </div>

            {/* Thread Scrollable Stream */}
            <div
              style={{
                flex: 1,
                minHeight: 0,
                overflowY: "auto",
                padding: "16px 18px",
                display: "flex",
                flexDirection: "column",
                gap: "12px",
              }}
            >
              {/* Root Parent Message Card */}
              <div
                style={{
                  display: "flex",
                  gap: "12px",
                  padding: "10px 14px",
                  borderRadius: "8px",
                  background: "color-mix(in srgb, var(--ms-surface-hover, #f1f5f9) 60%, transparent)",
                  border: "1px solid var(--color-border)",
                }}
              >
                {/* Avatar */}
                <div style={{ flexShrink: 0, marginTop: "2px" }}>
                  {activeThreadMessage.author_avatar_url ? (
                    <img
                      src={activeThreadMessage.author_avatar_url}
                      alt={activeThreadMessage.sender_name || activeThreadMessage.author_username || "Author"}
                      style={{ width: "36px", height: "36px", borderRadius: "8px", objectFit: "cover" }}
                    />
                  ) : (
                    <div
                      style={{
                        width: "36px",
                        height: "36px",
                        borderRadius: "8px",
                        background: getAvatarGradient(
                          activeThreadMessage.sender_name || activeThreadMessage.author_username || "Engineer",
                        ).bg,
                        color: "#ffffff",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontWeight: 800,
                        fontSize: "13px",
                      }}
                    >
                      {getInitials(
                        activeThreadMessage.sender_name || activeThreadMessage.author_username || "Engineer",
                      )}
                    </div>
                  )}
                </div>

                {/* Body */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    <strong style={{ fontSize: "14.5px", color: "var(--ms-text-1)", fontWeight: 700 }}>
                      {activeThreadMessage.sender_name ||
                        (activeThreadMessage.author_username ? `@${activeThreadMessage.author_username}` : "Engineer")}
                    </strong>
                    <span style={{ fontSize: "11.5px", color: "var(--ms-text-3)" }}>
                      {formatMessageTime(activeThreadMessage.created_at)}
                    </span>
                  </div>

                  <div
                    style={{
                      marginTop: "4px",
                      fontSize: "14.5px",
                      lineHeight: "1.46667",
                      color: "var(--color-text-primary, var(--ms-text-1))",
                      wordBreak: "break-word",
                    }}
                  >
                    <FormattedMessageContent
                      content={activeThreadMessage.content}
                      onInsertCommand={(cmd) => {
                        setThreadInput(cmd);
                        threadTextareaRef.current?.focus();
                      }}
                    />
                  </div>

                  {/* Reaction pills on parent */}
                  {Object.entries(activeThreadMessage.reactions || {}).some(
                    ([_, users]) => users && users.length > 0,
                  ) && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "5px", marginTop: "8px" }}>
                      {Object.entries(activeThreadMessage.reactions || {})
                        .filter(([_, users]) => users && users.length > 0)
                        .map(([emoji, users]) => (
                          <button
                            key={emoji}
                            type="button"
                            onClick={() => handleReaction(activeThreadMessage.id, emoji)}
                            style={{
                              padding: "2px 7px",
                              borderRadius: "999px",
                              border: "1px solid var(--color-border)",
                              background: "var(--ms-surface-hover)",
                              color: "var(--ms-text-1)",
                              fontSize: "12px",
                              cursor: "pointer",
                              display: "inline-flex",
                              alignItems: "center",
                              gap: "4px",
                            }}
                          >
                            <span>{emoji}</span>
                            <span style={{ fontSize: "11px", fontWeight: 600 }}>{users.length}</span>
                          </button>
                        ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Replies Divider Line */}
              <div style={{ display: "flex", alignItems: "center", margin: "10px 0 4px", gap: "10px" }}>
                <div style={{ flex: 1, height: "1px", background: "var(--color-border)" }} />
                <span
                  style={{
                    fontSize: "12px",
                    fontWeight: 600,
                    color: "var(--ms-text-3)",
                    whiteSpace: "nowrap",
                  }}
                >
                  {threadReplies.length} {threadReplies.length === 1 ? "reply" : "replies"}
                </span>
                <div style={{ flex: 1, height: "1px", background: "var(--color-border)" }} />
              </div>

              {/* Loading Spinner */}
              {threadLoading && (
                <div style={{ display: "flex", justifyContent: "center", padding: "16px" }}>
                  <Spinner />
                </div>
              )}

              {/* Empty state when no replies yet */}
              {!threadLoading && threadReplies.length === 0 && (
                <div
                  style={{
                    padding: "24px 12px",
                    textAlign: "center",
                    color: "var(--ms-text-3)",
                    fontSize: "13px",
                  }}
                >
                  No replies yet. Send a reply below to start the thread.
                </div>
              )}

              {/* Thread Replies List */}
              {threadReplies.map((r) => {
                const rAuthor = r.sender_name || (r.author_username ? `@${r.author_username}` : "Engineer");
                const rGrad = getAvatarGradient(rAuthor);
                const rInitials = getInitials(rAuthor);
                return (
                  <div
                    key={r.id}
                    style={{
                      display: "flex",
                      gap: "10px",
                      padding: "6px 8px",
                      borderRadius: "6px",
                      transition: "background 0.1s ease",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = "var(--ms-surface-hover)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = "transparent";
                    }}
                  >
                    <div style={{ flexShrink: 0, marginTop: "2px" }}>
                      {r.author_avatar_url ? (
                        <img
                          src={r.author_avatar_url}
                          alt={rAuthor}
                          style={{ width: "32px", height: "32px", borderRadius: "7px", objectFit: "cover" }}
                        />
                      ) : (
                        <div
                          style={{
                            width: "32px",
                            height: "32px",
                            borderRadius: "7px",
                            background: rGrad.bg,
                            color: "#ffffff",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontWeight: 800,
                            fontSize: "12px",
                          }}
                        >
                          {rInitials}
                        </div>
                      )}
                    </div>

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                        <strong style={{ fontSize: "14px", color: "var(--ms-text-1)", fontWeight: 700 }}>
                          {rAuthor}
                        </strong>
                        <span style={{ fontSize: "11px", color: "var(--ms-text-3)" }}>
                          {formatMessageTime(r.created_at)}
                        </span>
                      </div>

                      <div
                        style={{
                          marginTop: "3px",
                          fontSize: "14px",
                          lineHeight: "1.46667",
                          color: "var(--color-text-primary, var(--ms-text-1))",
                          wordBreak: "break-word",
                        }}
                      >
                        <FormattedMessageContent
                          content={r.content}
                          onInsertCommand={(cmd) => {
                            setThreadInput(cmd);
                            threadTextareaRef.current?.focus();
                          }}
                        />
                      </div>

                      {/* Reply Reactions */}
                      {Object.entries(r.reactions || {}).some(([_, users]) => users && users.length > 0) && (
                        <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", marginTop: "6px" }}>
                          {Object.entries(r.reactions || {})
                            .filter(([_, users]) => users && users.length > 0)
                            .map(([emoji, users]) => (
                              <button
                                key={emoji}
                                type="button"
                                onClick={() => handleThreadReaction(r.id, emoji)}
                                style={{
                                  padding: "2px 6px",
                                  borderRadius: "999px",
                                  border: "1px solid var(--color-border)",
                                  background: "var(--ms-surface-hover)",
                                  color: "var(--ms-text-1)",
                                  fontSize: "11.5px",
                                  cursor: "pointer",
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: "3px",
                                }}
                              >
                                <span>{emoji}</span>
                                <span style={{ fontSize: "10.5px", fontWeight: 600 }}>{users.length}</span>
                              </button>
                            ))}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
              <div ref={threadEndRef} />
            </div>

            {/* Pinned Thread Composer */}
            <form
              onSubmit={handleSendThreadReply}
              style={{
                padding: "10px 14px 12px",
                borderTop: "1px solid var(--color-border)",
                background: "var(--ms-bg)",
                display: "flex",
                flexDirection: "column",
                flexShrink: 0,
              }}
            >
              <div
                style={{
                  border: isThreadComposerFocused
                    ? "1px solid var(--ms-brand, #2563eb)"
                    : "1px solid var(--color-border)",
                  boxShadow: isThreadComposerFocused
                    ? "0 0 0 2px color-mix(in srgb, var(--ms-brand, #2563eb) 18%, transparent)"
                    : "0 1px 3px rgba(0,0,0,0.02)",
                  borderRadius: "8px",
                  background: "var(--ms-bg)",
                  overflow: "hidden",
                  display: "flex",
                  flexDirection: "column",
                }}
              >
                {/* Top Mini Formatting Bar */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "2px",
                    padding: "4px 8px",
                    borderBottom: "1px solid var(--color-border)",
                    background: "var(--ms-bg-alt)",
                  }}
                >
                  <button
                    type="button"
                    title="Bold (*text*)"
                    onClick={() => {
                      setThreadInput((p) => `${p}**bold**`);
                      threadTextareaRef.current?.focus();
                    }}
                    style={{
                      background: "none",
                      border: "none",
                      color: "var(--ms-text-2)",
                      fontWeight: 700,
                      fontSize: "12px",
                      cursor: "pointer",
                      padding: "2px 6px",
                      borderRadius: "4px",
                    }}
                  >
                    B
                  </button>
                  <button
                    type="button"
                    title="Italic (_text_)"
                    onClick={() => {
                      setThreadInput((p) => `${p}*italic*`);
                      threadTextareaRef.current?.focus();
                    }}
                    style={{
                      background: "none",
                      border: "none",
                      color: "var(--ms-text-2)",
                      fontStyle: "italic",
                      fontSize: "12px",
                      cursor: "pointer",
                      padding: "2px 6px",
                      borderRadius: "4px",
                    }}
                  >
                    I
                  </button>
                  <button
                    type="button"
                    title="Code (`code`)"
                    onClick={() => {
                      setThreadInput((p) => `${p}\`code\``);
                      threadTextareaRef.current?.focus();
                    }}
                    style={{
                      background: "none",
                      border: "none",
                      color: "var(--ms-text-2)",
                      fontSize: "11px",
                      fontFamily: "var(--ms-font-mono)",
                      cursor: "pointer",
                      padding: "2px 5px",
                      borderRadius: "4px",
                    }}
                  >
                    &lt;/&gt;
                  </button>
                  <button
                    type="button"
                    title="LaTeX Math (\( \))"
                    onClick={() => {
                      setThreadInput((p) => `${p}\\( \\)`);
                      threadTextareaRef.current?.focus();
                    }}
                    style={{
                      background: "none",
                      border: "none",
                      color: "var(--ms-text-2)",
                      fontSize: "11px",
                      fontWeight: 600,
                      cursor: "pointer",
                      padding: "2px 6px",
                      borderRadius: "4px",
                    }}
                  >
                    {"\\(\\sqrt{x}\\)"}
                  </button>
                </div>

                {/* Textarea */}
                <textarea
                  ref={threadTextareaRef}
                  rows={1}
                  value={threadInput}
                  disabled={!user}
                  onFocus={() => setIsThreadComposerFocused(true)}
                  onBlur={() => setIsThreadComposerFocused(false)}
                  placeholder={user ? "Reply..." : "Sign in to reply..."}
                  onChange={(e) => {
                    setThreadInput(e.target.value);
                    e.target.style.height = "auto";
                    e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void handleSendThreadReply(e);
                    }
                  }}
                  style={{
                    width: "100%",
                    boxSizing: "border-box",
                    minHeight: "40px",
                    maxHeight: "120px",
                    padding: "8px 12px",
                    border: "none",
                    outline: "none",
                    background: "transparent",
                    color: "var(--color-text-primary)",
                    fontSize: "14.5px",
                    lineHeight: "1.46667",
                    resize: "none",
                    fontFamily: "inherit",
                  }}
                />

                {/* Bottom Bar: Checkbox + Send Button */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "4px 8px 6px",
                  }}
                >
                  <label
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "6px",
                      fontSize: "12px",
                      color: "var(--ms-text-2)",
                      cursor: "pointer",
                      userSelect: "none",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={alsoSendToChannel}
                      onChange={(e) => setAlsoSendToChannel(e.target.checked)}
                      style={{ cursor: "pointer", accentColor: "var(--ms-brand, #2563eb)" }}
                    />
                    <span>Also send to #{activeChannel.name}</span>
                  </label>

                  <button
                    type="submit"
                    disabled={!user || !threadInput.trim()}
                    title="Send reply (Enter)"
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      width: "28px",
                      height: "28px",
                      borderRadius: "6px",
                      border: "none",
                      background: threadInput.trim() ? "var(--ms-brand, #2563eb)" : "transparent",
                      color: threadInput.trim() ? "#ffffff" : "var(--ms-text-3)",
                      cursor: threadInput.trim() ? "pointer" : "default",
                      transition: "all 0.15s ease",
                    }}
                  >
                    <PaperAirplaneIcon size={13} />
                  </button>
                </div>
              </div>
            </form>
          </div>
        )}
      </div>

      <CreateSpaceModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        onCreated={() => {
          void loadSidebar();
        }}
      />
    </div>
  );
};

export default SpaceChatPage;
