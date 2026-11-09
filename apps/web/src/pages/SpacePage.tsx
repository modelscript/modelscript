// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  BookIcon,
  CheckIcon,
  CodeIcon,
  CommentDiscussionIcon,
  CopyIcon,
  FileCodeIcon,
  GearIcon,
  GitBranchIcon,
  GitPullRequestIcon,
  IssueOpenedIcon,
  LinkExternalIcon,
  PackageIcon,
  PlayIcon,
  PlusIcon,
  StarFillIcon,
  StarIcon,
} from "@primer/octicons-react";
import { Button, CounterLabel, Label } from "@primer/react";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import styled from "styled-components";
import {
  autocompleteSpaceEntities,
  createSpaceChannel,
  followSpace,
  getMyOrganizations,
  getSpaceChannelMessages,
  getSpaceDetail,
  promoteSpaceMessage,
  sendSpaceChannelMessage,
  toggleSpaceMessageReaction,
  unfollowSpace,
  upsertSpaceDoc,
  type Organization,
  type SpaceChannelRecord,
  type SpaceDetailResponse,
  type SpaceEcoProposalRecord,
  type SpaceMessageRecord,
  type SpacePageRecord,
} from "../api";
import { useAuth } from "../AuthContext";
import Box from "../components/Box";
import { PostMarkdownContent } from "../components/post/PostMarkdownContent";
import Spinner from "../components/Spinner";
import { useToast } from "../components/ToastContext";
import { usePageTitle } from "../util/title";
import { SpaceChangeControlTab } from "./space/SpaceChangeControlTab";
import { SpaceCodeTab } from "./space/SpaceCodeTab";
import { SpaceIssuesTab } from "./space/SpaceIssuesTab";
import { SpacePackagesTab } from "./space/SpacePackagesTab";
import { SpaceSettingsTab } from "./space/SpaceSettingsTab";

type SpaceTab = "overview" | "code" | "issues" | "chat" | "docs" | "changes" | "plm" | "repos" | "settings";

const SpaceCockpitGrid = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1fr) 320px;
  gap: 20px;
  align-items: start;
  width: 100%;
  box-sizing: border-box;

  @media (max-width: 900px) {
    grid-template-columns: 1fr;
  }
`;

const SpaceInspectorPanel = styled.aside`
  display: flex;
  flex-direction: column;
  gap: 16px;
  position: sticky;
  top: 24px;
`;

const SpaceCardPanel = styled.div`
  border-radius: 6px;
  border: 1px solid var(--color-border-default, var(--color-border));
  background: var(--color-canvas-default, var(--color-bg-primary));
  display: flex;
  flex-direction: column;
`;

const CockpitBox = styled.div`
  border-radius: 6px;
  border: 1px solid var(--color-border-default, var(--color-border));
  background: var(--color-canvas-default, var(--color-bg-primary));
  overflow: hidden;
`;

const CockpitBoxHeader = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 16px;
  background: var(--color-canvas-subtle, var(--ms-surface-hover));
  border-bottom: 1px solid var(--color-border-default, var(--color-border));
  font-size: 13px;
  font-weight: 600;
  color: var(--color-fg-default, var(--color-text-primary));
`;

const CockpitBoxBody = styled.div`
  padding: 16px;
`;

const SpaceTabsNav = styled.nav`
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 16px;
  width: 100%;
  padding: 0 24px;
  box-sizing: border-box;
  border-bottom: 1px solid var(--color-border-default, var(--color-border));
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: none;
  -ms-overflow-style: none;

  &::-webkit-scrollbar {
    display: none;
  }

  @media (max-width: 768px) {
    padding: 0 16px;
    gap: 4px;
  }
`;

const SpaceTabButton = styled.button<{ $active?: boolean; $accentColor?: string }>`
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 48px;
  padding: 0 16px;
  border: none;
  border-bottom: 2px solid
    ${(props) => (props.$active ? "var(--ms-brand, var(--color-accent-emphasis, #3b82f6))" : "transparent")};
  background: transparent;
  color: ${(props) =>
    props.$active
      ? "var(--color-fg-default, var(--color-text-primary))"
      : "var(--color-fg-muted, var(--color-text-muted))"};
  font-weight: ${(props) => (props.$active ? 600 : 500)};
  font-size: 14px;
  line-height: 20px;
  cursor: pointer;
  white-space: nowrap;
  box-sizing: border-box;
  flex-shrink: 0;
  transition:
    color 0.15s ease,
    background-color 0.15s ease,
    border-color 0.15s ease;
  margin-bottom: -1px;
  z-index: ${(props) => (props.$active ? 2 : 1)};
  border-radius: 6px 6px 0 0;

  &:hover {
    color: var(--color-fg-default, var(--color-text-primary));
    background: ${(props) => (props.$active ? "transparent" : "var(--color-canvas-subtle, var(--ms-surface-hover))")};
  }

  &:focus-visible {
    outline: 2px solid var(--ms-brand, #3b82f6);
    outline-offset: -2px;
  }

  @media (max-width: 768px) {
    padding: 0 12px;
    height: 44px;
    font-size: 13.5px;
    gap: 6px;
  }
`;

export const SpacePage: React.FC = () => {
  const params = useParams<{ namespace?: string; spaceSlug?: string; slug?: string }>();
  const rawNamespace = params.namespace || "";
  const namespace = rawNamespace.replace(/^@/, "");
  const spaceSlug = params.spaceSlug || params.slug || "";

  const { user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [detail, setDetail] = useState<SpaceDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const rawTabParam = (searchParams.get("tab") || "overview").toLowerCase();
  const tabParam: SpaceTab = rawTabParam === "plm" || rawTabParam === "pulls" ? "changes" : (rawTabParam as SpaceTab);
  const activeTab: SpaceTab = [
    "overview",
    "code",
    "issues",
    "chat",
    "docs",
    "changes",
    "plm",
    "repos",
    "settings",
  ].includes(tabParam)
    ? tabParam
    : "overview";

  const setActiveTab = (tab: SpaceTab, extra?: Record<string, string>) => {
    const next: Record<string, string> = tab === "overview" ? {} : { tab };
    if (extra) Object.assign(next, extra);
    setSearchParams(next);
  };

  usePageTitle(detail ? `${detail.space.name} (@${detail.space.owner_namespace}/${detail.space.slug})` : "Space");

  // Chat state
  const [activeChannelSlug, setActiveChannelSlug] = useState<string>("general");
  const [messages, setMessages] = useState<SpaceMessageRecord[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [sendingMsg, setSendingMsg] = useState(false);
  const [suggestions, setSuggestions] = useState<
    { kind: string; id: string; label: string; reference: string; subtitle: string }[]
  >([]);
  const [inspectorTarget, setInspectorTarget] = useState<
    | { type: "doc"; doc: SpacePageRecord }
    | { type: "eco"; eco: SpaceEcoProposalRecord }
    | { type: "code"; language: string; code: string }
    | null
  >(null);
  const [newChannelName, setNewChannelName] = useState("");
  const [showNewChannelInput, setShowNewChannelInput] = useState(false);

  // Living Docs state
  const [selectedDocSlug, setSelectedDocSlug] = useState<string>("overview");
  const [isEditingDoc, setIsEditingDoc] = useState(false);
  const [editDocSlug, setEditDocSlug] = useState("");
  const [editDocTitle, setEditDocTitle] = useState("");
  const [editDocSummary, setEditDocSummary] = useState("");
  const [editDocContent, setEditDocContent] = useState("");

  // Packages tab state
  const [packagesCount, setPackagesCount] = useState<number>(1);

  // Settings & Organizations state
  const [myOrgs, setMyOrgs] = useState<Organization[]>([]);
  const [showNewMenu, setShowNewMenu] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);

  const loadSpace = useCallback(async () => {
    if (!namespace || !spaceSlug) return;
    setLoading(true);
    setError(null);
    try {
      const data = await getSpaceDetail(namespace, spaceSlug);
      setDetail(data);
      const chParam = searchParams.get("channel");
      if (chParam && data.channels.some((c) => c.slug === chParam)) {
        setActiveChannelSlug(chParam);
      } else if (data.channels.length > 0) {
        const gen = data.channels.find((c) => c.slug === "general") || data.channels[0]!;
        setActiveChannelSlug(gen.slug);
      }
      const docParam = searchParams.get("doc");
      if (docParam && data.pages.some((p) => p.slug === docParam)) {
        setSelectedDocSlug(docParam);
      } else if (data.pages.length > 0) {
        setSelectedDocSlug(data.pages[0]!.slug);
      }
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || "Failed to load Space");
    } finally {
      setLoading(false);
    }
  }, [namespace, spaceSlug]);

  useEffect(() => {
    void loadSpace();
  }, [loadSpace]);

  useEffect(() => {
    if (user) {
      void getMyOrganizations()
        .then((orgs) => {
          setMyOrgs(orgs);
        })
        .catch(() => {});
    }
  }, [user]);

  // Load messages when active channel changes
  useEffect(() => {
    if (!detail || !activeChannelSlug) return;
    void getSpaceChannelMessages(detail.space.owner_namespace, detail.space.slug, activeChannelSlug)
      .then((res) => {
        setMessages(res.messages);
      })
      .catch(() => {});
  }, [detail?.space.id, activeChannelSlug]);

  // Real-time WebSocket subscription for instant Slack-speed chat
  useEffect(() => {
    if (!detail || typeof window === "undefined" || typeof WebSocket === "undefined") return;
    const activeChannel = detail.channels.find((c) => c.slug === activeChannelSlug);
    if (!activeChannel) return;

    try {
      const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
      const wsUrl = `${proto}//${window.location.host}/api/v1/collab/stream`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        ws.send(
          JSON.stringify({
            type: "chat:subscribe",
            channelIds: [activeChannel.id, detail.space.id],
          }),
        );
      };

      ws.onmessage = (ev) => {
        try {
          const data = JSON.parse(String(ev.data));
          if (data.type === "chat:message" && data.channelId === activeChannel.id && data.message) {
            setMessages((prev) => {
              if (prev.some((m) => m.id === data.message.id)) return prev;
              return [...prev, data.message as SpaceMessageRecord];
            });
          } else if (
            (data.type === "chat:reaction" || data.type === "chat:promoted") &&
            data.channelId === activeChannel.id &&
            data.message
          ) {
            setMessages((prev) =>
              prev.map((m) => (m.id === data.message.id ? (data.message as SpaceMessageRecord) : m)),
            );
          }
        } catch {
          // Ignore malformed frame
        }
      };

      return () => {
        ws.close();
      };
    } catch {
      return undefined;
    }
  }, [detail?.space.id, activeChannelSlug]);

  const handleFollowToggle = async () => {
    if (!detail || !user) {
      navigate("/login");
      return;
    }
    try {
      if (detail.viewerState.isFollowing) {
        const res = await unfollowSpace(detail.space.owner_namespace, detail.space.slug);
        setDetail((prev) =>
          prev
            ? {
                ...prev,
                space: { ...prev.space, follower_count: res.followerCount },
                viewerState: { ...prev.viewerState, isFollowing: false },
              }
            : prev,
        );
      } else {
        const res = await followSpace(detail.space.owner_namespace, detail.space.slug);
        setDetail((prev) =>
          prev
            ? {
                ...prev,
                space: { ...prev.space, follower_count: res.followerCount },
                viewerState: { ...prev.viewerState, isFollowing: true },
              }
            : prev,
        );
      }
    } catch (err: any) {
      toast.error(err?.message || "Failed to update follow status");
    }
  };

  const handleChatInputChange = async (val: string) => {
    setChatInput(val);
    if (!detail) return;
    const match = val.match(/(?:^|\s)([#@][a-zA-Z0-9_:-]*)$/);
    if (match) {
      const token = match[1]!.slice(1);
      try {
        const list = await autocompleteSpaceEntities(detail.space.owner_namespace, detail.space.slug, token);
        setSuggestions(list);
      } catch {
        setSuggestions([]);
      }
    } else {
      setSuggestions([]);
    }
  };

  const insertSuggestion = (refText: string) => {
    setChatInput((prev) => prev.replace(/([#@][a-zA-Z0-9_:-]*)$/, `${refText} `));
    setSuggestions([]);
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!detail || !chatInput.trim() || sendingMsg) return;
    try {
      setSendingMsg(true);
      const res = await sendSpaceChannelMessage(detail.space.owner_namespace, detail.space.slug, activeChannelSlug, {
        content: chatInput.trim(),
      });
      setChatInput("");
      setSuggestions([]);
      setMessages((prev) => {
        const next = prev.some((m) => m.id === res.message.id) ? [...prev] : [...prev, res.message];
        if (res.botReply && !next.some((m) => m.id === res.botReply!.id)) {
          next.push(res.botReply);
        }
        return next;
      });
    } catch (err: any) {
      toast.error(err?.response?.data?.error || "Failed to send message");
    } finally {
      setSendingMsg(false);
    }
  };

  const handleReaction = async (messageId: string, emoji: string) => {
    if (!detail || !user) return;
    try {
      const updated = await toggleSpaceMessageReaction(
        detail.space.owner_namespace,
        detail.space.slug,
        activeChannelSlug,
        messageId,
        emoji,
      );
      setMessages((prev) => prev.map((m) => (m.id === updated.id ? updated : m)));
    } catch {
      // ignore
    }
  };

  const handlePromoteMessage = async (messageId: string, targetType: "doc" | "eco") => {
    if (!detail || !user) return;
    try {
      const res = await promoteSpaceMessage(
        detail.space.owner_namespace,
        detail.space.slug,
        activeChannelSlug,
        messageId,
        targetType,
      );
      setMessages((prev) => prev.map((m) => (m.id === res.message.id ? res.message : m)));
      if (res.doc) {
        setDetail((prev) => (prev ? { ...prev, pages: [...prev.pages, res.doc!] } : prev));
        setInspectorTarget({ type: "doc", doc: res.doc });
        toast.success(`Promoted chat thread to Living Doc: ${res.doc.title}`);
      } else if (res.eco) {
        setDetail((prev) => (prev ? { ...prev, ecos: [res.eco!, ...prev.ecos] } : prev));
        setInspectorTarget({ type: "eco", eco: res.eco });
        toast.success(`Promoted chat thread to PLM Change Order ECO-${res.eco.eco_number}`);
      }
    } catch (err: any) {
      toast.error(err?.response?.data?.error || "Failed to promote message");
    }
  };

  const handleCreateChannel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!detail || !newChannelName.trim()) return;
    try {
      const res = await createSpaceChannel(detail.space.owner_namespace, detail.space.slug, {
        slug: newChannelName.trim(),
        name: newChannelName.trim(),
      });
      setDetail((prev) => (prev ? { ...prev, channels: res.channels } : prev));
      setActiveChannelSlug(res.channel.slug);
      setNewChannelName("");
      setShowNewChannelInput(false);
      toast.success(`Created channel #${res.channel.slug}`);
    } catch (err: any) {
      toast.error(err?.response?.data?.error || "Failed to create channel");
    }
  };

  const handleSaveDoc = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!detail || !editDocSlug.trim() || !editDocTitle.trim()) return;
    try {
      const res = await upsertSpaceDoc(detail.space.owner_namespace, detail.space.slug, {
        slug: editDocSlug.trim(),
        title: editDocTitle.trim(),
        summary: editDocSummary.trim() || undefined,
        contentMarkdown: editDocContent,
      });
      setDetail((prev) => (prev ? { ...prev, pages: res.pages } : prev));
      setSelectedDocSlug(res.page.slug);
      setIsEditingDoc(false);
      toast.success(`Committed Living Doc '${res.page.path_in_git}' to Space Git Vault`);
    } catch (err: any) {
      toast.error(err?.response?.data?.error || "Failed to save Living Doc");
    }
  };

  if (loading) {
    return (
      <div style={{ padding: "48px", display: "flex", justifyContent: "center" }}>
        <Spinner />
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div style={{ padding: "32px 24px", textAlign: "center" }}>
        <h2 style={{ marginBottom: "8px" }}>Space Not Found</h2>
        <p style={{ color: "var(--color-text-muted)", marginBottom: "16px" }}>
          {error || `Could not locate @${namespace}/${spaceSlug}`}
        </p>
        <Link
          to="/spaces"
          style={{
            padding: "8px 16px",
            borderRadius: "8px",
            background: "var(--ms-brand, #2563eb)",
            color: "#fff",
            textDecoration: "none",
            fontWeight: 600,
          }}
        >
          Browse Spaces →
        </Link>
      </div>
    );
  }

  const { space, preset, channels, pages, members, ecos, viewerState } = detail;
  const activeDoc = pages.find((p) => p.slug === selectedDocSlug) || pages[0];
  const activeChannel: SpaceChannelRecord | undefined =
    channels.find((c) => c.slug === activeChannelSlug) || channels[0];
  const gitCloneUrl = `${typeof window !== "undefined" ? window.location.origin : "https://ansatz.social"}/git/${space.owner_namespace}/${space.slug}.git`;

  return (
    <div style={{ display: "flex", flexDirection: "column", width: "100%", minHeight: "100vh" }}>
      {/* ── Space Header & Container Breadcrumb ── */}
      <div
        style={{
          background: "var(--color-canvas-default, var(--color-bg-primary))",
        }}
      >
        {/* Top Header Row: Identity Breadcrumb & Badges on Left, Actions on Right */}
        <div
          style={{
            padding: "16px 24px 0",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: "16px",
            minHeight: "36px",
          }}
        >
          {/* Left: Avatar + Namespace / Slug + Badges */}
          <div style={{ display: "flex", gap: "10px", alignItems: "center", minWidth: 0, flex: 1 }}>
            <div
              style={{
                width: "34px",
                height: "34px",
                borderRadius: "6px",
                background: "var(--color-canvas-subtle, var(--ms-surface-hover))",
                border: "1px solid var(--color-border-default, var(--color-border))",
                color: "var(--color-fg-default, var(--color-text-primary))",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontWeight: 700,
                fontSize: "13px",
                flexShrink: 0,
              }}
            >
              {space.name.slice(0, 2).toUpperCase()}
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap", minWidth: 0 }}>
              <Link
                to={`/@${space.owner_namespace}`}
                style={{
                  fontSize: "14px",
                  fontWeight: 500,
                  color: "var(--color-accent-fg, var(--ms-link))",
                  textDecoration: "none",
                }}
              >
                @{space.owner_namespace}
              </Link>
              <span style={{ color: "var(--color-fg-muted, var(--color-text-muted))" }}>/</span>
              <span
                style={{
                  fontSize: "15px",
                  fontFamily: "var(--font-mono, monospace)",
                  fontWeight: 600,
                  color: "var(--color-fg-default, var(--color-text-primary))",
                }}
              >
                {space.slug}
              </span>
              <Label variant="accent" sx={{ ml: 1 }}>
                {preset.shortLabel}
              </Label>
              <Label variant="secondary">{space.visibility === "public" ? "Public" : "Private"}</Label>
              <Label variant="secondary" sx={{ fontFamily: "var(--font-mono, monospace)" }}>
                <GitBranchIcon size={12} style={{ marginRight: 4, verticalAlign: "text-bottom" }} />
                main
              </Label>
            </div>
          </div>

          {/* Right: Unified Action Toolbar (Always docked top-right, aligned with breadcrumb) */}
          <div style={{ display: "flex", gap: "8px", alignItems: "center", flexShrink: 0 }}>
            {/* Follow Button */}
            <Button
              size="small"
              variant="default"
              onClick={handleFollowToggle}
              leadingVisual={() =>
                viewerState.isFollowing ? <StarFillIcon size={14} fill="#eab308" /> : <StarIcon size={14} />
              }
              trailingVisual={() => <CounterLabel>{space.follower_count}</CounterLabel>}
              style={{
                borderColor: viewerState.isFollowing ? "rgba(234, 179, 8, 0.4)" : undefined,
              }}
            >
              {viewerState.isFollowing ? "Following" : "Follow"}
            </Button>

            {/* Quick Clone Button */}
            <Button
              size="small"
              variant="default"
              leadingVisual={CopyIcon}
              onClick={() => {
                void navigator.clipboard?.writeText(`git clone ${gitCloneUrl}`);
                toast.info(`Copied clone command: git clone ${gitCloneUrl}`);
              }}
              title={`git clone @${space.owner_namespace}/${space.slug}.git`}
            >
              Clone
            </Button>

            {/* Direct Chat / Sidenav Link */}
            <Link
              to={`/chat?space=${encodeURIComponent(`${space.owner_namespace}/${space.slug}`)}`}
              title="⚡ Dock in Chat Sidenav"
              style={{ textDecoration: "none" }}
            >
              <Button size="small" variant="default" leadingVisual={CommentDiscussionIcon}>
                Chat
              </Button>
            </Link>

            {/* Direct VS Code Web Workbench / Studio Launcher */}
            <Button
              size="small"
              variant="default"
              leadingVisual={CodeIcon}
              onClick={() => {
                const branch = space.default_branch || "main";
                const url = `/vscode/workbench#${space.owner_namespace}/${space.slug}@${branch}`;
                window.open(url, "_blank", "noopener,noreferrer");
              }}
              title="Launch Studio workbench connected to this Space Git Vault"
            >
              Open Studio
            </Button>

            {/* Single Unified Primary + New Dropdown */}
            {viewerState.canWrite && (
              <div style={{ position: "relative" }}>
                <Button
                  size="small"
                  variant="primary"
                  leadingVisual={PlusIcon}
                  onClick={() => setShowNewMenu((prev) => !prev)}
                  title="+ New"
                  aria-label="+ New"
                >
                  <span>New</span>
                  <span style={{ fontSize: "10px", marginLeft: "4px" }}>▾</span>
                </Button>
                {showNewMenu && (
                  <div
                    style={{
                      position: "absolute",
                      top: "calc(100% + 4px)",
                      right: 0,
                      zIndex: 50,
                      minWidth: "185px",
                      padding: "4px",
                      borderRadius: "6px",
                      border: "1px solid var(--color-border-default, var(--color-border))",
                      background: "var(--color-canvas-overlay, var(--color-bg-primary))",
                      boxShadow: "var(--color-overlay-shadow, 0 4px 12px rgba(0, 0, 0, 0.15))",
                      display: "flex",
                      flexDirection: "column",
                      gap: "2px",
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setShowNewMenu(false);
                        setEditDocSlug("");
                        setEditDocTitle("");
                        setEditDocSummary("");
                        setEditDocContent("# New Specification\n\nWrite Markdown and embed live models here.");
                        setIsEditingDoc(true);
                        setActiveTab("docs");
                      }}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                        padding: "7px 10px",
                        borderRadius: "4px",
                        border: "none",
                        background: "transparent",
                        color: "var(--color-fg-default, var(--color-text-primary))",
                        fontSize: "12.5px",
                        fontWeight: 500,
                        cursor: "pointer",
                        textAlign: "left",
                        width: "100%",
                      }}
                      onMouseEnter={(e) =>
                        (e.currentTarget.style.background = "var(--color-canvas-subtle, var(--ms-surface-hover))")
                      }
                      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                    >
                      <FileCodeIcon size={14} />
                      <span>New Living Doc</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setShowNewMenu(false);
                        setActiveTab("issues");
                      }}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                        padding: "7px 10px",
                        borderRadius: "4px",
                        border: "none",
                        background: "transparent",
                        color: "var(--color-fg-default, var(--color-text-primary))",
                        fontSize: "12.5px",
                        fontWeight: 500,
                        cursor: "pointer",
                        textAlign: "left",
                        width: "100%",
                      }}
                      onMouseEnter={(e) =>
                        (e.currentTarget.style.background = "var(--color-canvas-subtle, var(--ms-surface-hover))")
                      }
                      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                    >
                      <IssueOpenedIcon size={14} />
                      <span>New Issue</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setShowNewMenu(false);
                        setActiveTab("changes");
                      }}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                        padding: "7px 10px",
                        borderRadius: "4px",
                        border: "none",
                        background: "transparent",
                        color: "var(--color-fg-default, var(--color-text-primary))",
                        fontSize: "12.5px",
                        fontWeight: 500,
                        cursor: "pointer",
                        textAlign: "left",
                        width: "100%",
                      }}
                      onMouseEnter={(e) =>
                        (e.currentTarget.style.background = "var(--color-canvas-subtle, var(--ms-surface-hover))")
                      }
                      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                    >
                      <GitPullRequestIcon size={14} />
                      <span>New Pull Request</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setShowNewMenu(false);
                        setShowNewChannelInput(true);
                        setActiveTab("chat");
                      }}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                        padding: "7px 10px",
                        borderRadius: "4px",
                        border: "none",
                        background: "transparent",
                        color: "var(--color-fg-default, var(--color-text-primary))",
                        fontSize: "12.5px",
                        fontWeight: 500,
                        cursor: "pointer",
                        textAlign: "left",
                        width: "100%",
                      }}
                      onMouseEnter={(e) =>
                        (e.currentTarget.style.background = "var(--color-canvas-subtle, var(--ms-surface-hover))")
                      }
                      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                    >
                      <CommentDiscussionIcon size={14} />
                      <span>New Channel</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setShowNewMenu(false);
                        setActiveTab("repos");
                      }}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                        padding: "7px 10px",
                        borderRadius: "4px",
                        border: "none",
                        background: "transparent",
                        color: "var(--color-fg-default, var(--color-text-primary))",
                        fontSize: "12.5px",
                        fontWeight: 500,
                        cursor: "pointer",
                        textAlign: "left",
                        width: "100%",
                      }}
                      onMouseEnter={(e) =>
                        (e.currentTarget.style.background = "var(--color-canvas-subtle, var(--ms-surface-hover))")
                      }
                      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                    >
                      <PackageIcon size={14} />
                      <span>Publish Package</span>
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Title and Tagline Row (cleanly positioned under breadcrumb) */}
        <div style={{ marginTop: "6px", marginBottom: "14px", padding: "0 24px 0 68px" }}>
          <h1
            style={{
              margin: "0 0 4px",
              fontSize: "18px",
              fontWeight: 600,
              letterSpacing: "-0.01em",
              color: "var(--color-fg-default, var(--color-text-primary))",
            }}
          >
            {space.name}
          </h1>
          {space.tagline && (
            <p
              style={{
                margin: 0,
                fontSize: "13px",
                color: "var(--color-fg-muted, var(--color-text-muted))",
                lineHeight: 1.45,
                maxWidth: "1000px",
              }}
            >
              {space.tagline}
            </p>
          )}
        </div>

        {/* Navigation Tabs */}
        <SpaceTabsNav>
          {(
            [
              { id: "overview", label: "Overview", icon: BookIcon },
              { id: "code", label: "Code", icon: CodeIcon },
              {
                id: "issues",
                label: "Issues",
                icon: IssueOpenedIcon,
                count: (detail?.issues || []).filter((i) => i.status === "open").length,
              },
              { id: "changes", label: "Pull Requests", icon: GitPullRequestIcon, count: ecos.length },
              { id: "chat", label: "Channels", icon: CommentDiscussionIcon, count: channels.length },
              { id: "docs", label: "Docs", icon: FileCodeIcon, count: pages.length },
              { id: "repos", label: "Packages", icon: PackageIcon, count: packagesCount },
              { id: "settings", label: "Settings", icon: GearIcon, count: members.length },
            ] as { id: SpaceTab; label: string; icon: React.ComponentType<{ size?: number }>; count?: number }[]
          ).map((t) => {
            const isActive = activeTab === t.id || (t.id === "changes" && activeTab === "plm");
            const Icon = t.icon;
            return (
              <SpaceTabButton key={t.id} type="button" onClick={() => setActiveTab(t.id)} $active={isActive}>
                <Icon size={16} />
                <span>{t.label}</span>
                {typeof t.count === "number" && <CounterLabel>{t.count}</CounterLabel>}
              </SpaceTabButton>
            );
          })}
        </SpaceTabsNav>
      </div>

      {/* ── Tab 1: Overview & Activity Stream ── */}
      {activeTab === "overview" && (
        <div
          style={{
            maxWidth: "1280px",
            margin: "0 auto",
            padding: "24px 20px 48px",
            width: "100%",
            boxSizing: "border-box",
          }}
        >
          <SpaceCockpitGrid>
            {/* Primary Left Cockpit Column */}
            <div style={{ display: "flex", flexDirection: "column", gap: "16px", minWidth: 0 }}>
              {/* Primary Living Specification / System Overview */}
              <CockpitBox>
                <CockpitBoxHeader>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0 }}>
                    <BookIcon size={16} />
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {activeDoc?.title || "Living Specification"}
                    </span>
                    {activeDoc?.slug && (
                      <span
                        style={{
                          fontSize: "11px",
                          color: "var(--color-fg-muted)",
                          fontFamily: "var(--font-mono)",
                          flexShrink: 0,
                        }}
                      >
                        ({activeDoc.slug})
                      </span>
                    )}
                  </div>
                  {activeDoc && (
                    <Button
                      size="small"
                      variant="invisible"
                      onClick={() => {
                        setSelectedDocSlug(activeDoc.slug);
                        setActiveTab("docs");
                      }}
                      trailingAction={LinkExternalIcon}
                    >
                      Open in Docs
                    </Button>
                  )}
                </CockpitBoxHeader>
                <CockpitBoxBody>
                  {activeDoc?.content_markdown ? (
                    <PostMarkdownContent text={activeDoc.content_markdown} />
                  ) : (
                    <div
                      style={{
                        padding: "20px 0",
                        color: "var(--color-fg-muted)",
                        textAlign: "center",
                        fontSize: "13px",
                      }}
                    >
                      <p style={{ margin: "0 0 10px" }}>No living specifications created for this Space yet.</p>
                      {viewerState.canWrite && (
                        <Button
                          size="small"
                          variant="default"
                          leadingVisual={PlusIcon}
                          onClick={() => {
                            setEditDocSlug("");
                            setEditDocTitle("");
                            setEditDocSummary("");
                            setEditDocContent("# New Specification\n\nWrite Markdown and embed live models here.");
                            setIsEditingDoc(true);
                            setActiveTab("docs");
                          }}
                        >
                          Create Specification
                        </Button>
                      )}
                    </div>
                  )}
                </CockpitBoxBody>
              </CockpitBox>

              {/* Baseline Verification Model Preview */}
              <CockpitBox>
                <CockpitBoxHeader>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                    <CodeIcon size={16} />
                    <span>Baseline Verification Model: {preset.sampleCodeSnippet.title}</span>
                    <Label variant="secondary" sx={{ fontFamily: "var(--font-mono)" }}>
                      {preset.sampleCodeSnippet.language}
                    </Label>
                  </div>
                  <Link
                    to={`/morsel?code=${encodeURIComponent(preset.sampleCodeSnippet.code)}`}
                    style={{ textDecoration: "none" }}
                  >
                    <Button size="small" variant="default" leadingVisual={PlayIcon}>
                      Simulate in Morsel
                    </Button>
                  </Link>
                </CockpitBoxHeader>
                <div style={{ padding: "12px 16px" }}>
                  <pre
                    style={{
                      margin: 0,
                      padding: "12px 14px",
                      borderRadius: "6px",
                      background: "var(--color-canvas-subtle, var(--color-code-bg))",
                      border: "1px solid var(--color-border-default)",
                      fontSize: "12px",
                      fontFamily: "var(--font-mono, monospace)",
                      overflowX: "auto",
                      color: "var(--color-fg-default)",
                      lineHeight: 1.5,
                    }}
                  >
                    {preset.sampleCodeSnippet.code}
                  </pre>
                </div>
              </CockpitBox>

              {/* Space Event Stream / Activity Timeline */}
              <CockpitBox>
                <CockpitBoxHeader>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <CommentDiscussionIcon size={16} />
                    <span>Recent Space Activity Stream</span>
                  </div>
                  <span style={{ fontSize: "11.5px", color: "var(--color-fg-muted)" }}>Live Real-Time Feed</span>
                </CockpitBoxHeader>
                <div>
                  {messages.slice(0, 3).map((m) => (
                    <div
                      key={`act-${m.id}`}
                      style={{
                        display: "flex",
                        alignItems: "flex-start",
                        gap: "12px",
                        padding: "12px 16px",
                        borderBottom: "1px solid var(--color-border-muted)",
                      }}
                    >
                      <div
                        style={{
                          width: "28px",
                          height: "28px",
                          borderRadius: "50%",
                          background: "var(--color-canvas-subtle)",
                          border: "1px solid var(--color-border-default)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: "12px",
                          flexShrink: 0,
                          color: "var(--color-fg-muted)",
                        }}
                      >
                        <CommentDiscussionIcon size={14} />
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "baseline",
                            gap: "8px",
                          }}
                        >
                          <div style={{ fontSize: "13px", color: "var(--color-fg-default)", lineHeight: 1.4 }}>
                            <strong>{m.sender_name || `@${m.author_username || "engineer"}`}</strong>{" "}
                            <span style={{ color: "var(--color-fg-muted)" }}>posted in</span>{" "}
                            <button
                              type="button"
                              onClick={() => {
                                setActiveChannelSlug(m.channel_slug || activeChannelSlug);
                                setActiveTab("chat");
                              }}
                              style={{
                                fontFamily: "var(--font-mono)",
                                color: "var(--color-accent-fg)",
                                fontWeight: 600,
                                background: "none",
                                border: "none",
                                padding: 0,
                                cursor: "pointer",
                                fontSize: "inherit",
                              }}
                            >
                              #{m.channel_slug || activeChannelSlug}
                            </button>
                            :{" "}
                            <span style={{ color: "var(--color-fg-muted)" }}>
                              "{m.content.slice(0, 75)}
                              {m.content.length > 75 ? "..." : ""}"
                            </span>
                          </div>
                          <span style={{ fontSize: "11px", color: "var(--color-fg-muted)", whiteSpace: "nowrap" }}>
                            {m.created_at}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}

                  {ecos.slice(0, 2).map((eco) => (
                    <div
                      key={`act-eco-${eco.id}`}
                      style={{
                        display: "flex",
                        alignItems: "flex-start",
                        gap: "12px",
                        padding: "12px 16px",
                        borderBottom: "1px solid var(--color-border-muted)",
                      }}
                    >
                      <div
                        style={{
                          width: "28px",
                          height: "28px",
                          borderRadius: "50%",
                          background: "var(--color-canvas-subtle)",
                          border: "1px solid var(--color-border-default)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: "12px",
                          flexShrink: 0,
                          color: "var(--color-success-fg)",
                        }}
                      >
                        <GitPullRequestIcon size={14} />
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "baseline",
                            gap: "8px",
                          }}
                        >
                          <div style={{ fontSize: "13px", color: "var(--color-fg-default)", lineHeight: 1.4 }}>
                            <button
                              type="button"
                              onClick={() => setActiveTab("changes")}
                              style={{
                                fontFamily: "var(--font-mono)",
                                color: "var(--color-accent-fg)",
                                fontWeight: 700,
                                background: "none",
                                border: "none",
                                padding: 0,
                                cursor: "pointer",
                                fontSize: "inherit",
                              }}
                            >
                              ECO-{eco.eco_number}
                            </button>{" "}
                            <span>{eco.title}</span>{" "}
                            <span style={{ fontSize: "11.5px", color: "var(--color-fg-muted)" }}>
                              (Gate: {eco.simulation_gate_status})
                            </span>
                          </div>
                          <Label
                            variant={
                              eco.status === "approved"
                                ? "success"
                                : eco.status === "in_review"
                                  ? "attention"
                                  : "secondary"
                            }
                            sx={{ textTransform: "uppercase" }}
                          >
                            {eco.status}
                          </Label>
                        </div>
                      </div>
                    </div>
                  ))}

                  {messages.length === 0 && ecos.length === 0 && (
                    <div
                      style={{
                        padding: "20px 16px",
                        textAlign: "center",
                        color: "var(--color-fg-muted)",
                        fontSize: "13px",
                      }}
                    >
                      No recent activity in this Space yet.
                    </div>
                  )}
                </div>
              </CockpitBox>
            </div>

            {/* Contextual Space Inspector Column */}
            <SpaceInspectorPanel>
              <SpaceCardPanel style={{ padding: 0, gap: 0, overflow: "hidden" }}>
                {/* Section 1: About Space & Blueprint */}
                <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--color-border-default)" }}>
                  <div
                    style={{
                      fontWeight: 600,
                      fontSize: "12px",
                      textTransform: "uppercase",
                      letterSpacing: "0.04em",
                      color: "var(--color-fg-muted)",
                      marginBottom: "6px",
                    }}
                  >
                    About Space
                  </div>
                  <p
                    style={{
                      margin: "0 0 10px",
                      fontSize: "12.5px",
                      color: "var(--color-fg-default)",
                      lineHeight: 1.5,
                    }}
                  >
                    {space.description || preset.description}
                  </p>
                  <div style={{ fontSize: "12px", color: "var(--color-fg-muted)", marginBottom: "8px" }}>
                    <span style={{ fontWeight: 600, color: "var(--color-fg-default)" }}>Blueprint: </span>
                    <span style={{ color: "var(--color-accent-fg)", fontWeight: 500 }}>{preset.name}</span>
                  </div>
                  <div style={{ display: "flex", gap: "4px", flexWrap: "wrap" }}>
                    {preset.complianceStandards.map((std) => (
                      <span
                        key={std}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "3px",
                          padding: "1px 7px",
                          borderRadius: "999px",
                          fontSize: "10.5px",
                          fontWeight: 500,
                          border: "1px solid var(--color-border-default)",
                          background: "var(--color-canvas-subtle)",
                          color: "var(--color-fg-muted)",
                        }}
                      >
                        ✓ {std}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Section 2: Space Git Vault */}
                <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--color-border-default)" }}>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      marginBottom: "10px",
                    }}
                  >
                    <span
                      style={{
                        fontWeight: 600,
                        fontSize: "12px",
                        textTransform: "uppercase",
                        letterSpacing: "0.04em",
                        color: "var(--color-fg-muted)",
                      }}
                    >
                      Space Git Vault
                    </span>
                    <Label variant="success">SYNCED</Label>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "6px", fontSize: "12.5px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ color: "var(--color-fg-muted)" }}>Default Branch:</span>
                      <strong style={{ fontFamily: "var(--font-mono)" }}>main</strong>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ color: "var(--color-fg-muted)" }}>Visibility:</span>
                      <span style={{ textTransform: "capitalize" }}>{space.visibility}</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ color: "var(--color-fg-muted)" }}>Protocols:</span>
                      <span style={{ fontFamily: "var(--font-mono)" }}>HTTPS, SSH</span>
                    </div>
                  </div>
                  <Box
                    display="flex"
                    alignItems="center"
                    style={{
                      border: "1px solid var(--color-border-default)",
                      borderRadius: "6px",
                      background: "var(--color-canvas-subtle)",
                      overflow: "hidden",
                      marginTop: "10px",
                    }}
                  >
                    <input
                      type="text"
                      readOnly
                      value={`git clone @${space.owner_namespace}/${space.slug}.git`}
                      aria-label="Git clone command"
                      onClick={(e) => (e.target as HTMLInputElement).select()}
                      style={{
                        flex: 1,
                        minWidth: 0,
                        background: "transparent",
                        border: "none",
                        padding: "5px 8px",
                        fontSize: "11px",
                        fontFamily: "var(--font-mono, monospace)",
                        color: "var(--color-fg-default)",
                        outline: "none",
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => {
                        void navigator.clipboard?.writeText(`git clone ${gitCloneUrl}`);
                        toast.info("Copied Git clone command");
                      }}
                      title="Copy clone command"
                      style={{
                        background: "transparent",
                        border: "none",
                        borderLeft: "1px solid var(--color-border-default)",
                        padding: "5px 8px",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        color: "var(--color-fg-muted)",
                      }}
                    >
                      <CopyIcon size={12} />
                    </button>
                  </Box>
                </div>

                {/* Section 3: Standards & Verification Gates */}
                <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--color-border-default)" }}>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      marginBottom: "10px",
                    }}
                  >
                    <span
                      style={{
                        fontWeight: 600,
                        fontSize: "12px",
                        textTransform: "uppercase",
                        letterSpacing: "0.04em",
                        color: "var(--color-fg-muted)",
                      }}
                    >
                      Compliance & Gates
                    </span>
                    <Label variant="accent">DAE ACTIVE</Label>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "8px", fontSize: "12px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <CheckIcon size={14} fill="var(--color-success-fg)" />
                      <span style={{ color: "var(--color-fg-default)" }}>Automated Simulation Verification Gate</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <CheckIcon size={14} fill="var(--color-success-fg)" />
                      <span style={{ color: "var(--color-fg-default)" }}>Ed25519 Cryptographic Signatures</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <CheckIcon size={14} fill="var(--color-success-fg)" />
                      <span style={{ color: "var(--color-fg-default)" }}>
                        {preset.complianceStandards.join(", ")} Enforcement
                      </span>
                    </div>
                  </div>
                </div>

                {/* Section 4: Space Team & Signatories */}
                <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--color-border-default)" }}>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      marginBottom: "10px",
                    }}
                  >
                    <span
                      style={{
                        fontWeight: 600,
                        fontSize: "12px",
                        textTransform: "uppercase",
                        letterSpacing: "0.04em",
                        color: "var(--color-fg-muted)",
                      }}
                    >
                      Team & Signatories ({members.length})
                    </span>
                    {viewerState.canManage && (
                      <button
                        type="button"
                        onClick={() => setActiveTab("settings")}
                        style={{
                          background: "transparent",
                          border: "none",
                          color: "var(--color-accent-fg)",
                          fontSize: "12px",
                          fontWeight: 600,
                          cursor: "pointer",
                          padding: 0,
                        }}
                      >
                        Manage
                      </button>
                    )}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                    {members.map((m) => (
                      <div
                        key={m.user_id}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          padding: "2px 0",
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                          <div
                            style={{
                              width: "22px",
                              height: "22px",
                              borderRadius: "50%",
                              background: "var(--color-canvas-subtle)",
                              border: "1px solid var(--color-border-default)",
                              color: "var(--color-fg-muted)",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              fontSize: "10px",
                              fontWeight: 700,
                            }}
                          >
                            {m.username.charAt(0).toUpperCase()}
                          </div>
                          <span style={{ fontSize: "12.5px", fontWeight: 500, color: "var(--color-fg-default)" }}>
                            @{m.username}
                          </span>
                        </div>
                        <Label
                          variant={
                            m.role === "owner"
                              ? "danger"
                              : m.role === "maintainer" || m.role === "lead_engineer"
                                ? "attention"
                                : "secondary"
                          }
                          sx={{ textTransform: "capitalize", fontSize: "10.5px" }}
                        >
                          {m.role.replace("_", " ")}
                        </Label>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Section 5: Quick Living Docs Shortcuts */}
                <div style={{ padding: "14px 16px" }}>
                  <div
                    style={{
                      fontWeight: 600,
                      fontSize: "12px",
                      textTransform: "uppercase",
                      letterSpacing: "0.04em",
                      color: "var(--color-fg-muted)",
                      marginBottom: "8px",
                    }}
                  >
                    Key Living Specs
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                    {pages.map((p) => (
                      <button
                        key={`shortcut-${p.id}`}
                        type="button"
                        onClick={() => {
                          setSelectedDocSlug(p.slug);
                          setActiveTab("docs");
                        }}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          padding: "6px 8px",
                          borderRadius: "6px",
                          border: "1px solid var(--color-border-default)",
                          background: "var(--color-canvas-subtle)",
                          color: "var(--color-fg-default)",
                          fontSize: "12px",
                          fontWeight: 500,
                          cursor: "pointer",
                          textAlign: "left",
                          gap: "8px",
                          transition: "background 0.12s ease",
                        }}
                        onMouseEnter={(e) =>
                          (e.currentTarget.style.background = "var(--surface-row-hover, rgba(125,125,125,0.1))")
                        }
                        onMouseLeave={(e) => (e.currentTarget.style.background = "var(--color-canvas-subtle)")}
                      >
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          <FileCodeIcon
                            size={13}
                            style={{ marginRight: 6, verticalAlign: "middle", color: "var(--color-fg-muted)" }}
                          />
                          {p.title}
                        </span>
                        <span
                          style={{
                            fontSize: "10.5px",
                            fontFamily: "var(--font-mono)",
                            color: "var(--color-fg-muted)",
                            flexShrink: 0,
                          }}
                        >
                          {p.slug}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              </SpaceCardPanel>
            </SpaceInspectorPanel>
          </SpaceCockpitGrid>
        </div>
      )}

      {/* ── Tab 2: Real-Time Slack/Discord Chat with Split Artifact Drawer ── */}
      {activeTab === "chat" && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: inspectorTarget ? "210px 1fr 300px" : "210px 1fr",
            minHeight: "620px",
            borderBottom: "1px solid var(--color-border)",
          }}
        >
          {/* Left Channel List */}
          <div
            style={{
              borderRight: "1px solid var(--color-border)",
              padding: "14px 10px",
              display: "flex",
              flexDirection: "column",
              justifyContent: "space-between",
              background: "var(--color-canvas-subtle, var(--ms-surface-hover))",
            }}
          >
            <div>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "0 6px 8px",
                  fontSize: "11px",
                  fontWeight: 700,
                  color: "var(--color-text-muted)",
                  textTransform: "uppercase",
                }}
              >
                <span>Space Channels</span>
                {viewerState.canWrite && (
                  <button
                    type="button"
                    onClick={() => setShowNewChannelInput((prev) => !prev)}
                    style={{
                      background: "transparent",
                      border: "none",
                      color: "var(--ms-brand, #3b82f6)",
                      fontWeight: 800,
                      cursor: "pointer",
                    }}
                  >
                    +
                  </button>
                )}
              </div>

              {showNewChannelInput && (
                <form onSubmit={handleCreateChannel} style={{ marginBottom: "8px", display: "flex", gap: "4px" }}>
                  <input
                    type="text"
                    placeholder="new-channel"
                    value={newChannelName}
                    onChange={(e) => setNewChannelName(e.target.value)}
                    style={{
                      flex: 1,
                      minWidth: 0,
                      padding: "5px 8px",
                      borderRadius: "6px",
                      border: "1px solid var(--color-border)",
                      background: "var(--ms-bg)",
                      color: "inherit",
                      fontSize: "12px",
                    }}
                  />
                  <button
                    type="submit"
                    style={{
                      padding: "5px 8px",
                      borderRadius: "6px",
                      border: "none",
                      background: "#2563eb",
                      color: "#fff",
                      fontSize: "11px",
                      cursor: "pointer",
                    }}
                  >
                    Add
                  </button>
                </form>
              )}

              <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
                {channels.map((ch) => {
                  const isSelected = ch.slug === activeChannelSlug;
                  const prefix =
                    ch.kind === "bot_feed"
                      ? "🤖 #"
                      : ch.kind === "telemetry"
                        ? "⚡ #"
                        : ch.kind === "ecr_review"
                          ? "🔍 #"
                          : ch.kind === "announcement"
                            ? "📢 #"
                            : "# ";
                  return (
                    <button
                      key={ch.id}
                      type="button"
                      onClick={() => setActiveChannelSlug(ch.slug)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        padding: "7px 10px",
                        borderRadius: "7px",
                        border: "none",
                        background: isSelected ? "rgba(59, 130, 246, 0.16)" : "transparent",
                        color: isSelected ? "var(--color-text-primary)" : "var(--color-text-secondary)",
                        fontWeight: isSelected ? 700 : 500,
                        fontSize: "13px",
                        textAlign: "left",
                        cursor: "pointer",
                      }}
                    >
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {prefix}
                        {ch.name}
                      </span>
                    </button>
                  );
                })}
              </div>

              <div
                style={{
                  marginTop: "18px",
                  padding: "0 6px 6px",
                  fontSize: "11px",
                  fontWeight: 700,
                  color: "var(--color-text-muted)",
                  textTransform: "uppercase",
                }}
              >
                Living Docs Shortcuts
              </div>
              {pages.map((doc) => (
                <button
                  key={doc.id}
                  type="button"
                  onClick={() => setInspectorTarget({ type: "doc", doc })}
                  style={{
                    display: "block",
                    width: "100%",
                    padding: "6px 10px",
                    borderRadius: "6px",
                    border: "none",
                    background: "transparent",
                    color: "var(--color-text-muted)",
                    fontSize: "12px",
                    textAlign: "left",
                    cursor: "pointer",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  📄 {doc.title}
                </button>
              ))}
            </div>

            <div style={{ fontSize: "11px", color: "var(--color-text-muted)", padding: "8px 6px 0" }}>
              Tip: Type <code>/run</code> to trigger the WASM solver bot, or <code>#</code> to cite docs & ECOs.
            </div>
          </div>

          {/* Center Chat Stream */}
          <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", minWidth: 0 }}>
            {activeChannel && (
              <div
                style={{
                  padding: "10px 16px",
                  borderBottom: "1px solid var(--color-border)",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <div>
                  <span style={{ fontWeight: 700, fontSize: "14px" }}>#{activeChannel.name}</span>
                  {activeChannel.topic && (
                    <span style={{ marginLeft: "10px", fontSize: "12px", color: "var(--color-text-muted)" }}>
                      {activeChannel.topic}
                    </span>
                  )}
                </div>
              </div>
            )}

            <div
              style={{
                flex: 1,
                padding: "16px",
                overflowY: "auto",
                display: "flex",
                flexDirection: "column",
                gap: "14px",
                maxHeight: "480px",
              }}
            >
              {messages.map((m) => {
                const isBot = m.sender_type !== "user";
                const codeMatch = m.content.match(/```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/);
                return (
                  <div
                    key={m.id}
                    style={{
                      padding: "10px 12px",
                      borderRadius: "10px",
                      background: isBot ? "rgba(59, 130, 246, 0.08)" : "rgba(30, 41, 59, 0.35)",
                      border: isBot ? "1px solid rgba(59, 130, 246, 0.3)" : "1px solid var(--color-border)",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <span style={{ fontWeight: 700, fontSize: "13px" }}>
                          {m.sender_name || (m.author_username ? `@${m.author_username}` : "Engineer")}
                        </span>
                        {isBot && (
                          <span
                            style={{
                              padding: "1px 6px",
                              borderRadius: "4px",
                              fontSize: "10px",
                              fontWeight: 700,
                              background: "#2563eb",
                              color: "#fff",
                            }}
                          >
                            BOT
                          </span>
                        )}
                        <span style={{ fontSize: "11px", color: "var(--color-text-muted)" }}>{m.created_at}</span>
                      </div>

                      {user && (
                        <div style={{ display: "flex", gap: "6px" }}>
                          <button
                            type="button"
                            onClick={() => handlePromoteMessage(m.id, "doc")}
                            title="Promote thread to Git-backed Living Doc (ADR)"
                            style={{
                              padding: "2px 7px",
                              borderRadius: "5px",
                              border: "1px solid var(--color-border)",
                              background: "transparent",
                              color: "var(--color-text-muted)",
                              fontSize: "11px",
                              cursor: "pointer",
                            }}
                          >
                            📄 → Living Doc
                          </button>
                          <button
                            type="button"
                            onClick={() => handlePromoteMessage(m.id, "eco")}
                            title="Promote thread to PLM Engineering Change Order (ECO)"
                            style={{
                              padding: "2px 7px",
                              borderRadius: "5px",
                              border: "1px solid var(--color-border)",
                              background: "transparent",
                              color: "var(--color-text-muted)",
                              fontSize: "11px",
                              cursor: "pointer",
                            }}
                          >
                            🔗 → PLM ECO
                          </button>
                        </div>
                      )}
                    </div>

                    <div
                      style={{
                        marginTop: "6px",
                        fontSize: "13.5px",
                        lineHeight: 1.5,
                        whiteSpace: "pre-wrap",
                      }}
                    >
                      {m.content}
                    </div>

                    {codeMatch && (
                      <div style={{ marginTop: "8px", display: "flex", gap: "8px" }}>
                        <button
                          type="button"
                          onClick={() =>
                            setInspectorTarget({
                              type: "code",
                              language: codeMatch[1] || "modelica",
                              code: codeMatch[2] || "",
                            })
                          }
                          style={{
                            padding: "4px 10px",
                            borderRadius: "6px",
                            border: "1px solid var(--color-accent-muted, rgba(59, 130, 246, 0.4))",
                            background: "var(--color-accent-subtle, rgba(59, 130, 246, 0.15))",
                            color: "var(--color-accent-fg, #0969da)",
                            fontSize: "11.5px",
                            fontWeight: 700,
                            cursor: "pointer",
                          }}
                        >
                          🔍 Inspect in Split Drawer
                        </button>
                        <Link
                          to={`/morsel?code=${encodeURIComponent(codeMatch[2] || "")}`}
                          style={{
                            padding: "4px 10px",
                            borderRadius: "6px",
                            background: "#2563eb",
                            color: "#fff",
                            textDecoration: "none",
                            fontSize: "11.5px",
                            fontWeight: 700,
                          }}
                        >
                          ▶ Run in Morsel
                        </Link>
                      </div>
                    )}

                    {m.promoted_target_type && (
                      <div
                        style={{
                          marginTop: "8px",
                          padding: "5px 10px",
                          borderRadius: "6px",
                          background: "var(--color-success-subtle, rgba(16, 185, 129, 0.12))",
                          border: "1px solid var(--color-success-muted, rgba(16, 185, 129, 0.35))",
                          color: "var(--color-success-fg, #1a7f37)",
                          fontSize: "12px",
                          fontWeight: 600,
                        }}
                      >
                        ✓ Promoted to{" "}
                        {m.promoted_target_type === "doc"
                          ? `Living Doc (docs/${m.promoted_target_id}.md)`
                          : `PLM Change Order (ECO-${m.promoted_target_id})`}
                      </div>
                    )}

                    {/* Reactions Bar */}
                    <div style={{ display: "flex", gap: "6px", marginTop: "8px", alignItems: "center" }}>
                      {["🚀", "✅", "🔥", "👀"].map((emoji) => {
                        const reactors = m.reactions?.[emoji] || [];
                        return (
                          <button
                            key={emoji}
                            type="button"
                            onClick={() => handleReaction(m.id, emoji)}
                            style={{
                              padding: "2px 7px",
                              borderRadius: "999px",
                              border: "1px solid var(--color-border)",
                              background: reactors.length > 0 ? "rgba(59, 130, 246, 0.16)" : "transparent",
                              color: "inherit",
                              fontSize: "11px",
                              cursor: "pointer",
                            }}
                          >
                            {emoji} {reactors.length > 0 ? reactors.length : ""}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Autocomplete Popup & Message Composer */}
            <div style={{ padding: "12px 16px", borderTop: "1px solid var(--color-border)", position: "relative" }}>
              {suggestions.length > 0 && (
                <div
                  style={{
                    position: "absolute",
                    bottom: "64px",
                    left: "16px",
                    right: "16px",
                    background: "var(--color-canvas-overlay, var(--color-canvas-default))",
                    border: "1px solid var(--color-border-default)",
                    borderRadius: "6px",
                    padding: "6px",
                    boxShadow: "var(--color-overlay-shadow, 0 4px 12px rgba(0,0,0,0.15))",
                    zIndex: 30,
                  }}
                >
                  {suggestions.map((s) => (
                    <button
                      key={`${s.kind}-${s.id}`}
                      type="button"
                      onClick={() => insertSuggestion(s.reference)}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        width: "100%",
                        padding: "6px 10px",
                        border: "none",
                        borderRadius: "6px",
                        background: "transparent",
                        color: "inherit",
                        fontSize: "12.5px",
                        textAlign: "left",
                        cursor: "pointer",
                      }}
                    >
                      <span>
                        <strong>{s.reference}</strong> — {s.label}
                      </span>
                      <span style={{ color: "var(--color-text-muted)", fontSize: "11px" }}>{s.subtitle}</span>
                    </button>
                  ))}
                </div>
              )}

              <form onSubmit={handleSendMessage} style={{ display: "flex", gap: "8px" }}>
                <input
                  type="text"
                  placeholder={
                    user
                      ? `Message #${activeChannel?.name || "general"}... (Type /run to simulate or # to cite docs/ECOs)`
                      : "Sign in to post in Space channels..."
                  }
                  disabled={!user}
                  value={chatInput}
                  onChange={(e) => handleChatInputChange(e.target.value)}
                  style={{
                    flex: 1,
                    padding: "10px 14px",
                    borderRadius: "8px",
                    border: "1px solid var(--color-border)",
                    background: "var(--ms-bg, #090d16)",
                    color: "inherit",
                    fontSize: "13.5px",
                  }}
                />
                <button
                  type="submit"
                  disabled={!user || sendingMsg}
                  style={{
                    padding: "10px 18px",
                    borderRadius: "8px",
                    border: "none",
                    background: "var(--ms-brand, #2563eb)",
                    color: "#fff",
                    fontWeight: 700,
                    fontSize: "13px",
                    cursor: user ? "pointer" : "not-allowed",
                  }}
                >
                  Send
                </button>
              </form>
            </div>
          </div>

          {/* Right Split Workspace / Artifact Inspector Drawer */}
          {inspectorTarget && (
            <div
              style={{
                borderLeft: "1px solid var(--color-border)",
                padding: "14px",
                background: "var(--color-canvas-subtle, var(--ms-surface-hover))",
                display: "flex",
                flexDirection: "column",
                gap: "10px",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span
                  style={{
                    fontWeight: 700,
                    fontSize: "12px",
                    textTransform: "uppercase",
                    color: "var(--color-text-muted)",
                  }}
                >
                  Split Space Inspector
                </span>
                <button
                  type="button"
                  onClick={() => setInspectorTarget(null)}
                  style={{
                    background: "transparent",
                    border: "none",
                    color: "var(--color-text-muted)",
                    cursor: "pointer",
                  }}
                >
                  ✕
                </button>
              </div>

              {inspectorTarget.type === "doc" && (
                <div>
                  <h4 style={{ margin: "0 0 4px" }}>{inspectorTarget.doc.title}</h4>
                  <div
                    style={{
                      fontSize: "11px",
                      fontFamily: "monospace",
                      color: "var(--color-text-muted)",
                      marginBottom: "8px",
                    }}
                  >
                    {inspectorTarget.doc.path_in_git}
                  </div>
                  <div style={{ fontSize: "12.5px", color: "var(--color-text-secondary)" }}>
                    <PostMarkdownContent text={inspectorTarget.doc.content_markdown} />
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedDocSlug(inspectorTarget.doc.slug);
                      setActiveTab("docs");
                    }}
                    style={{
                      marginTop: "12px",
                      padding: "6px 12px",
                      borderRadius: "6px",
                      border: "none",
                      background: "#2563eb",
                      color: "#fff",
                      fontSize: "12px",
                      fontWeight: 700,
                      cursor: "pointer",
                    }}
                  >
                    Open Full Living Doc ↗
                  </button>
                </div>
              )}

              {inspectorTarget.type === "eco" && (
                <div>
                  <h4 style={{ margin: "0 0 4px" }}>
                    ECO-{inspectorTarget.eco.eco_number}: {inspectorTarget.eco.title}
                  </h4>
                  <div style={{ fontSize: "12px", color: "var(--color-success-fg, #1a7f37)", marginBottom: "8px" }}>
                    Status: {inspectorTarget.eco.status.toUpperCase()} • Gate:{" "}
                    {inspectorTarget.eco.simulation_gate_status}
                  </div>
                  <div style={{ fontSize: "12.5px", whiteSpace: "pre-wrap", color: "var(--color-text-secondary)" }}>
                    {inspectorTarget.eco.description}
                  </div>
                </div>
              )}

              {inspectorTarget.type === "code" && (
                <div>
                  <h4 style={{ margin: "0 0 6px" }}>Executable Model Snippet ({inspectorTarget.language})</h4>
                  <pre
                    style={{
                      padding: "10px",
                      borderRadius: "6px",
                      background: "var(--color-canvas-subtle)",
                      border: "1px solid var(--color-border-default)",
                      color: "var(--color-fg-default)",
                      fontSize: "11.5px",
                      overflowX: "auto",
                    }}
                  >
                    {inspectorTarget.code}
                  </pre>
                  <Link
                    to={`/morsel?code=${encodeURIComponent(inspectorTarget.code)}`}
                    style={{
                      display: "inline-block",
                      marginTop: "8px",
                      padding: "6px 12px",
                      borderRadius: "6px",
                      background: "#2563eb",
                      color: "#fff",
                      textDecoration: "none",
                      fontSize: "12px",
                      fontWeight: 700,
                    }}
                  >
                    ▶ Launch Full WASM Simulator ↗
                  </Link>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Tab 3: Living Docs (CMS / SharePoint / Confluence Replacement) ── */}
      {activeTab === "docs" && (
        <div style={{ display: "grid", gridTemplateColumns: "240px 1fr", minHeight: "560px" }}>
          <div
            style={{
              borderRight: "1px solid var(--color-border)",
              padding: "16px 12px",
              background: "var(--color-canvas-subtle, var(--ms-surface-hover))",
            }}
          >
            <div
              style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}
            >
              <span
                style={{
                  fontSize: "12px",
                  fontWeight: 700,
                  color: "var(--color-text-muted)",
                  textTransform: "uppercase",
                }}
              >
                Living Docs Tree
              </span>
              {viewerState.canWrite && (
                <button
                  type="button"
                  onClick={() => {
                    setEditDocSlug("");
                    setEditDocTitle("");
                    setEditDocSummary("");
                    setEditDocContent("# New Specification\n\nWrite Markdown and embed live models here.");
                    setIsEditingDoc(true);
                  }}
                  style={{
                    padding: "3px 8px",
                    borderRadius: "6px",
                    border: "1px solid var(--color-border)",
                    background: "transparent",
                    color: "var(--ms-brand, #3b82f6)",
                    fontSize: "11px",
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  + New Page
                </button>
              )}
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
              {pages.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    setSelectedDocSlug(p.slug);
                    setIsEditingDoc(false);
                  }}
                  style={{
                    padding: "8px 10px",
                    borderRadius: "8px",
                    border: "none",
                    background: p.slug === selectedDocSlug ? "rgba(59, 130, 246, 0.16)" : "transparent",
                    color: p.slug === selectedDocSlug ? "var(--color-text-primary)" : "var(--color-text-secondary)",
                    fontWeight: p.slug === selectedDocSlug ? 700 : 500,
                    fontSize: "13px",
                    textAlign: "left",
                    cursor: "pointer",
                  }}
                >
                  <div>📄 {p.title}</div>
                  <div style={{ fontSize: "11px", fontFamily: "monospace", color: "var(--color-text-muted)" }}>
                    {p.path_in_git}
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div style={{ padding: "24px" }}>
            {isEditingDoc ? (
              <form onSubmit={handleSaveDoc} style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                <h3 style={{ margin: 0 }}>Commit Living Doc to Space Git Vault</h3>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                  <input
                    type="text"
                    required
                    placeholder="Slug (e.g. specs/battery-thermal)"
                    value={editDocSlug}
                    onChange={(e) => setEditDocSlug(e.target.value)}
                    style={{
                      padding: "8px 12px",
                      borderRadius: "8px",
                      border: "1px solid var(--color-border)",
                      background: "var(--ms-bg)",
                      color: "inherit",
                    }}
                  />
                  <input
                    type="text"
                    required
                    placeholder="Document Title"
                    value={editDocTitle}
                    onChange={(e) => setEditDocTitle(e.target.value)}
                    style={{
                      padding: "8px 12px",
                      borderRadius: "8px",
                      border: "1px solid var(--color-border)",
                      background: "var(--ms-bg)",
                      color: "inherit",
                    }}
                  />
                </div>
                <textarea
                  rows={14}
                  value={editDocContent}
                  onChange={(e) => setEditDocContent(e.target.value)}
                  style={{
                    padding: "12px",
                    borderRadius: "8px",
                    border: "1px solid var(--color-border)",
                    background: "var(--ms-bg, #090d16)",
                    color: "inherit",
                    fontFamily: "monospace",
                    fontSize: "13px",
                  }}
                />
                <div style={{ display: "flex", gap: "8px" }}>
                  <button
                    type="submit"
                    style={{
                      padding: "8px 16px",
                      borderRadius: "8px",
                      border: "none",
                      background: "#2563eb",
                      color: "#fff",
                      fontWeight: 700,
                      cursor: "pointer",
                    }}
                  >
                    Commit to Git Vault
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsEditingDoc(false)}
                    style={{
                      padding: "8px 16px",
                      borderRadius: "8px",
                      border: "1px solid var(--color-border)",
                      background: "transparent",
                      color: "inherit",
                      cursor: "pointer",
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            ) : activeDoc ? (
              <div>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: "14px",
                  }}
                >
                  <div>
                    <span
                      style={{
                        padding: "3px 8px",
                        borderRadius: "6px",
                        background: "rgba(148, 163, 184, 0.12)",
                        fontFamily: "monospace",
                        fontSize: "11.5px",
                        color: "var(--color-text-muted)",
                      }}
                    >
                      {activeDoc.path_in_git} • SHA: {(activeDoc.last_commit_sha || "HEAD").slice(0, 8)}
                    </span>
                  </div>
                  {viewerState.canWrite && (
                    <button
                      type="button"
                      onClick={() => {
                        setEditDocSlug(activeDoc.slug);
                        setEditDocTitle(activeDoc.title);
                        setEditDocSummary(activeDoc.summary || "");
                        setEditDocContent(activeDoc.content_markdown);
                        setIsEditingDoc(true);
                      }}
                      style={{
                        padding: "6px 12px",
                        borderRadius: "6px",
                        border: "1px solid var(--color-border)",
                        background: "transparent",
                        color: "inherit",
                        fontSize: "12px",
                        fontWeight: 600,
                        cursor: "pointer",
                      }}
                    >
                      ✏️ Edit Living Doc
                    </button>
                  )}
                </div>

                <div
                  style={{
                    padding: "24px 28px",
                    borderRadius: "6px",
                    border: "1px solid var(--color-border-default, var(--color-border))",
                    background: "var(--color-canvas-default, var(--color-bg-primary))",
                  }}
                >
                  <PostMarkdownContent text={activeDoc.content_markdown} isLongForm={true} />
                </div>
              </div>
            ) : (
              <p>No Living Docs yet.</p>
            )}
          </div>
        </div>
      )}

      {/* ── Tab: Issues & Problem Reports (ECR) ── */}
      {activeTab === "issues" && (
        <SpaceIssuesTab
          detail={detail}
          viewerState={viewerState}
          user={user}
          onIssueCreated={(_issue, issues) => {
            setDetail((prev) => (prev ? { ...prev, issues } : prev));
          }}
          onIssueUpdated={(_issue, issues) => {
            setDetail((prev) => (prev ? { ...prev, issues } : prev));
          }}
        />
      )}

      {/* ── Tab 4: Change Control & Pull Requests (Formerly PLM) ── */}
      {(activeTab === "changes" || activeTab === "plm") && (
        <SpaceChangeControlTab
          detail={detail}
          viewerState={viewerState}
          user={user}
          onEcoCreated={(_eco, ecos) => {
            setDetail((prev) => (prev ? { ...prev, ecos } : prev));
          }}
          onEcoReviewed={(_eco, ecos) => {
            setDetail((prev) => (prev ? { ...prev, ecos } : prev));
          }}
        />
      )}

      {/* ── Tab: Code & Git Vault Explorer ── */}
      {activeTab === "code" && (
        <div
          style={{
            maxWidth: "1520px",
            margin: "0 auto",
            padding: "0 20px 48px",
            width: "100%",
            boxSizing: "border-box",
          }}
        >
          <SpaceCodeTab detail={detail} viewerState={viewerState} />
        </div>
      )}

      {/* ── Tab 5: Repositories, PDM & Packages ── */}
      {activeTab === "repos" && (
        <div
          style={{
            maxWidth: "1280px",
            margin: "0 auto",
            padding: "0 0 48px",
            width: "100%",
            boxSizing: "border-box",
          }}
        >
          <SpacePackagesTab detail={detail} viewerState={viewerState} onCountUpdated={(c) => setPackagesCount(c)} />
        </div>
      )}

      {/* ── Tab 6: Space Settings (Two-Column Layout) ── */}
      {activeTab === "settings" && (
        <div
          style={{
            padding: "24px 28px 48px",
            width: "100%",
            maxWidth: "1280px",
            margin: "0 auto",
            boxSizing: "border-box",
          }}
        >
          <SpaceSettingsTab
            detail={detail}
            viewerState={viewerState}
            myOrgs={myOrgs}
            onSpaceUpdated={(updated) => {
              setDetail((prev) => (prev ? { ...prev, space: updated } : prev));
            }}
            onMembersUpdated={(updatedMembers) => {
              setDetail((prev) => (prev ? { ...prev, members: updatedMembers } : prev));
            }}
            onRefresh={loadSpace}
          />
        </div>
      )}
    </div>
  );
};

export default SpacePage;
