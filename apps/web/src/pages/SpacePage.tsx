// SPDX-License-Identifier: AGPL-3.0-or-later

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import styled from "styled-components";
import {
  addSpaceMember,
  autocompleteSpaceEntities,
  createSpaceChannel,
  createSpaceEco,
  followSpace,
  getMyOrganizations,
  getSpaceChannelMessages,
  getSpaceDetail,
  promoteSpaceMessage,
  removeSpaceMember,
  reviewSpaceEco,
  sendSpaceChannelMessage,
  toggleSpaceMessageReaction,
  transferSpace,
  unfollowSpace,
  upsertSpaceDoc,
  type Organization,
  type SpaceChannelRecord,
  type SpaceDetailResponse,
  type SpaceEcoProposalRecord,
  type SpaceMessageRecord,
  type SpaceOwnerType,
  type SpacePageRecord,
  type SpaceRole,
} from "../api";
import { useAuth } from "../AuthContext";
import { PostMarkdownContent } from "../components/post/PostMarkdownContent";
import Spinner from "../components/Spinner";
import { useToast } from "../components/ToastContext";
import { usePageTitle } from "../util/title";

type SpaceTab = "overview" | "chat" | "docs" | "plm" | "repos" | "settings";

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
  padding: 18px;
  border-radius: 12px;
  border: 1px solid var(--color-border);
  background: var(--ms-bg-elv, rgba(15, 23, 42, 0.55));
  display: flex;
  flex-direction: column;
  gap: 12px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
`;

const SpaceTabsNav = styled.nav`
  display: flex;
  gap: 6px;
  margin-top: 18px;
  overflow-x: auto;
  border-bottom: 1px solid var(--color-border);
  padding-bottom: 0px;
  scrollbar-width: none;
  -ms-overflow-style: none;

  &::-webkit-scrollbar {
    display: none;
  }
`;

const SpaceTabButton = styled.button<{ $active?: boolean; $accentColor?: string }>`
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 9px 14px;
  border: none;
  border-bottom: 2px solid
    ${(props) => (props.$active ? props.$accentColor || "var(--ms-brand, #3b82f6)" : "transparent")};
  background: transparent;
  color: ${(props) => (props.$active ? "var(--color-text-primary)" : "var(--color-text-muted)")};
  font-weight: ${(props) => (props.$active ? 700 : 500)};
  font-size: 13.5px;
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.12s ease;
  margin-bottom: -1px;

  &:hover {
    color: var(--color-text-primary);
  }
`;

const TabPillBadge = styled.span<{ $active?: boolean }>`
  padding: 1px 7px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 700;
  margin-left: 5px;
  background: ${(props) => (props.$active ? "rgba(59, 130, 246, 0.2)" : "rgba(148, 163, 184, 0.12)")};
  color: ${(props) => (props.$active ? "var(--color-accent-cyan, #38bdf8)" : "var(--color-text-muted)")};
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

  const tabParam = (searchParams.get("tab") || "overview").toLowerCase() as SpaceTab;
  const activeTab: SpaceTab = ["overview", "chat", "docs", "plm", "repos", "settings"].includes(tabParam)
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

  // PLM ECO state
  const [showNewEcoForm, setShowNewEcoForm] = useState(false);
  const [newEcoTitle, setNewEcoTitle] = useState("");
  const [newEcoDesc, setNewEcoDesc] = useState("");
  const [newEcoSeverity, setNewEcoSeverity] = useState<"minor" | "standard" | "major" | "safety_critical">("standard");
  const [newEcoModels, setNewEcoModels] = useState("docs/overview.md");

  // Settings & Transfer state
  const [myOrgs, setMyOrgs] = useState<Organization[]>([]);
  const [newMemberUsername, setNewMemberUsername] = useState("");
  const [newMemberRole, setNewMemberRole] = useState<SpaceRole>("contributor");
  const [transferTargetType, setTransferTargetType] = useState<SpaceOwnerType>("organization");
  const [transferTargetSlug, setTransferTargetSlug] = useState("");
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
          if (orgs.length > 0 && !transferTargetSlug) {
            setTransferTargetSlug(orgs[0]!.slug);
          }
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

  const handleCreateEco = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!detail || !newEcoTitle.trim()) return;
    try {
      const res = await createSpaceEco(detail.space.owner_namespace, detail.space.slug, {
        title: newEcoTitle.trim(),
        description: newEcoDesc.trim(),
        severity: newEcoSeverity,
        impactedModels: newEcoModels
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      });
      setDetail((prev) => (prev ? { ...prev, ecos: res.ecos } : prev));
      setShowNewEcoForm(false);
      setNewEcoTitle("");
      setNewEcoDesc("");
      toast.success(`Created Engineering Change Order ECO-${res.eco.eco_number}`);
    } catch (err: any) {
      toast.error(err?.response?.data?.error || "Failed to create ECO");
    }
  };

  const handleReviewEco = async (ecoId: string, decision: "approved" | "changes_requested" | "rejected") => {
    if (!detail) return;
    try {
      const res = await reviewSpaceEco(detail.space.owner_namespace, detail.space.slug, ecoId, decision);
      setDetail((prev) => (prev ? { ...prev, ecos: res.ecos } : prev));
      toast.success(`Recorded cryptographic ${decision.toUpperCase()} signature on ECO-${res.eco.eco_number}`);
    } catch (err: any) {
      toast.error(err?.response?.data?.error || "Failed to review ECO");
    }
  };

  const handleTransferOwnership = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!detail || !transferTargetSlug.trim()) return;
    try {
      const updated = await transferSpace(detail.space.owner_namespace, detail.space.slug, {
        targetOwnerType: transferTargetType,
        targetSlug: transferTargetSlug.trim(),
      });
      toast.success(`Transferred Space to @${updated.owner_namespace}/${updated.slug}`);
      navigate(`/@${updated.owner_namespace}/${updated.slug}`);
    } catch (err: any) {
      toast.error(err?.response?.data?.error || "Failed to transfer Space");
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
          padding: "20px 28px 0 28px",
          background: `linear-gradient(180deg, ${preset.accentColor}12 0%, transparent 100%)`,
          borderBottom: "1px solid var(--color-border, #1e293b)",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: "16px",
            flexWrap: "wrap",
          }}
        >
          <div style={{ display: "flex", gap: "14px", alignItems: "center" }}>
            <div
              style={{
                width: "48px",
                height: "48px",
                borderRadius: "12px",
                background: `${preset.accentColor}20`,
                border: `1.5px solid ${preset.accentColor}66`,
                color: preset.accentColor,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontWeight: 800,
                fontSize: "19px",
                boxShadow: `0 2px 10px ${preset.accentColor}20`,
                flexShrink: 0,
              }}
            >
              {space.name.slice(0, 2).toUpperCase()}
            </div>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                <Link
                  to={`/@${space.owner_namespace}`}
                  style={{
                    fontSize: "13px",
                    fontWeight: 700,
                    color: "var(--color-text-secondary)",
                    textDecoration: "none",
                    display: "flex",
                    alignItems: "center",
                    gap: "5px",
                  }}
                >
                  <span>{space.owner_type === "organization" ? "🏢" : "👤"}</span>
                  <span>@{space.owner_namespace}</span>
                </Link>
                <span style={{ color: "var(--color-text-muted)" }}>/</span>
                <span
                  style={{
                    fontSize: "13.5px",
                    fontFamily: "monospace",
                    fontWeight: 700,
                    color: "var(--color-text-primary)",
                  }}
                >
                  {space.slug}
                </span>
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "5px",
                    padding: "1px 8px",
                    borderRadius: "999px",
                    fontSize: "11px",
                    fontWeight: 700,
                    background: `${preset.accentColor}18`,
                    color: preset.accentColor,
                    border: `1px solid ${preset.accentColor}44`,
                  }}
                >
                  <span style={{ width: "5px", height: "5px", borderRadius: "50%", background: preset.accentColor }} />
                  {preset.shortLabel}
                </span>
                <span
                  style={{
                    padding: "1px 8px",
                    borderRadius: "999px",
                    fontSize: "11px",
                    fontWeight: 600,
                    background: "rgba(148, 163, 184, 0.12)",
                    color: "var(--color-text-muted)",
                    textTransform: "uppercase",
                  }}
                >
                  {space.visibility === "public" ? "🌐 Public" : "🔒 Private"}
                </span>
                <span
                  style={{
                    padding: "1px 8px",
                    borderRadius: "999px",
                    fontSize: "11px",
                    fontWeight: 600,
                    background: "rgba(16, 185, 129, 0.1)",
                    color: "#34d399",
                    border: "1px solid rgba(16, 185, 129, 0.22)",
                    fontFamily: "monospace",
                  }}
                >
                  git: main
                </span>
              </div>

              <h1 style={{ margin: "4px 0 2px", fontSize: "22px", fontWeight: 800, letterSpacing: "-0.02em" }}>
                {space.name}
              </h1>
              {space.tagline && (
                <p style={{ margin: 0, fontSize: "13px", color: "var(--color-text-secondary)" }}>{space.tagline}</p>
              )}
            </div>
          </div>

          {/* Unified Action Toolbar */}
          <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
            {/* Follow Button */}
            <button
              type="button"
              onClick={handleFollowToggle}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                padding: "6px 12px",
                borderRadius: "7px",
                border: "1px solid var(--color-border)",
                background: viewerState.isFollowing ? "rgba(59, 130, 246, 0.12)" : "rgba(15, 23, 42, 0.5)",
                color: viewerState.isFollowing ? "var(--ms-brand, #3b82f6)" : "var(--color-text-secondary)",
                fontSize: "12.5px",
                fontWeight: 600,
                cursor: "pointer",
                transition: "all 0.15s ease",
              }}
            >
              <span>{viewerState.isFollowing ? "★" : "☆"}</span>
              <span>{viewerState.isFollowing ? "Following" : "Follow"}</span>
              <span style={{ opacity: 0.65, fontSize: "11px", fontFamily: "monospace" }}>({space.follower_count})</span>
            </button>

            {/* Quick Clone Button */}
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard?.writeText(`git clone ${gitCloneUrl}`);
                toast.info(`Copied clone command: git clone ${gitCloneUrl}`);
              }}
              title={`git clone @${space.owner_namespace}/${space.slug}.git`}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                padding: "6px 12px",
                borderRadius: "7px",
                border: "1px solid var(--color-border)",
                background: "rgba(15, 23, 42, 0.5)",
                color: "var(--color-text-secondary)",
                fontSize: "12.5px",
                fontWeight: 600,
                cursor: "pointer",
                transition: "all 0.15s ease",
              }}
            >
              <span>📋</span>
              <span>Clone</span>
            </button>

            {/* Direct Chat / Sidenav Link */}
            <Link
              to={`/chat?space=${encodeURIComponent(`${space.owner_namespace}/${space.slug}`)}`}
              title="⚡ Dock in Chat Sidenav"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                padding: "6px 12px",
                borderRadius: "7px",
                border: "1px solid var(--color-border)",
                background: "rgba(15, 23, 42, 0.5)",
                color: "var(--color-text-secondary)",
                textDecoration: "none",
                fontSize: "12.5px",
                fontWeight: 600,
                transition: "all 0.15s ease",
              }}
            >
              <span>💬</span>
              <span>Chat</span>
            </Link>

            {/* Single Unified Primary + New Dropdown */}
            {viewerState.canWrite && (
              <div style={{ position: "relative" }}>
                <button
                  type="button"
                  onClick={() => setShowNewMenu((prev) => !prev)}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "5px",
                    padding: "6px 14px",
                    borderRadius: "7px",
                    border: "none",
                    background: "var(--ms-brand, #2563eb)",
                    color: "#ffffff",
                    fontSize: "12.5px",
                    fontWeight: 700,
                    cursor: "pointer",
                    boxShadow: "0 2px 8px rgba(37, 99, 235, 0.25)",
                    transition: "all 0.15s ease",
                  }}
                >
                  <span>+ New</span>
                  <span style={{ fontSize: "10px", marginLeft: "2px" }}>▾</span>
                </button>
                {showNewMenu && (
                  <div
                    style={{
                      position: "absolute",
                      top: "calc(100% + 6px)",
                      right: 0,
                      zIndex: 50,
                      minWidth: "175px",
                      padding: "5px",
                      borderRadius: "8px",
                      border: "1px solid var(--color-border)",
                      background: "var(--ms-bg-elv, #0f172a)",
                      boxShadow: "0 10px 25px rgba(0, 0, 0, 0.45)",
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
                        padding: "8px 10px",
                        borderRadius: "6px",
                        border: "none",
                        background: "transparent",
                        color: "var(--color-text-primary)",
                        fontSize: "12.5px",
                        fontWeight: 500,
                        cursor: "pointer",
                        textAlign: "left",
                        width: "100%",
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255, 255, 255, 0.06)")}
                      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                    >
                      <span>📄</span>
                      <span>New Living Doc</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setShowNewMenu(false);
                        setShowNewEcoForm(true);
                        setActiveTab("plm");
                      }}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                        padding: "8px 10px",
                        borderRadius: "6px",
                        border: "none",
                        background: "transparent",
                        color: "var(--color-text-primary)",
                        fontSize: "12.5px",
                        fontWeight: 500,
                        cursor: "pointer",
                        textAlign: "left",
                        width: "100%",
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255, 255, 255, 0.06)")}
                      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                    >
                      <span>🔗</span>
                      <span>Propose ECO</span>
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
                        padding: "8px 10px",
                        borderRadius: "6px",
                        border: "none",
                        background: "transparent",
                        color: "var(--color-text-primary)",
                        fontSize: "12.5px",
                        fontWeight: 500,
                        cursor: "pointer",
                        textAlign: "left",
                        width: "100%",
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255, 255, 255, 0.06)")}
                      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                    >
                      <span>💬</span>
                      <span>New Channel</span>
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Navigation Tabs */}
        <SpaceTabsNav>
          {(
            [
              { id: "overview", label: "Overview", icon: "🧭" },
              { id: "chat", label: "Channels", icon: "💬", count: channels.length },
              { id: "docs", label: "Docs", icon: "📄", count: pages.length },
              { id: "plm", label: "PLM", icon: "🔗", count: ecos.length },
              { id: "repos", label: "Packages", icon: "📦" },
              { id: "settings", label: "Settings", icon: "⚙️", count: members.length },
            ] as { id: SpaceTab; label: string; icon: string; count?: number }[]
          ).map((t) => {
            const isActive = activeTab === t.id;
            return (
              <SpaceTabButton
                key={t.id}
                type="button"
                onClick={() => setActiveTab(t.id)}
                $active={isActive}
                $accentColor={preset.accentColor}
              >
                <span>{t.icon}</span>
                <span>{t.label}</span>
                {typeof t.count === "number" && <TabPillBadge $active={isActive}>{t.count}</TabPillBadge>}
              </SpaceTabButton>
            );
          })}
        </SpaceTabsNav>
      </div>

      {/* ── Tab 1: Overview & Activity Stream ── */}
      {activeTab === "overview" && (
        <div style={{ padding: "24px 28px", width: "100%", boxSizing: "border-box" }}>
          <SpaceCockpitGrid>
            {/* Primary Left Cockpit Column */}
            <div style={{ display: "flex", flexDirection: "column", gap: "20px", minWidth: 0 }}>
              {/* Domain Blueprint Banner */}
              <div
                style={{
                  padding: "18px 20px",
                  borderRadius: "12px",
                  border: "1px solid var(--color-border)",
                  background: "var(--ms-bg-elv, rgba(15, 23, 42, 0.5))",
                  display: "flex",
                  flexDirection: "column",
                  gap: "12px",
                  boxShadow: "0 2px 12px rgba(0, 0, 0, 0.15)",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    flexWrap: "wrap",
                    gap: "8px",
                  }}
                >
                  <div style={{ fontWeight: 800, fontSize: "15px", display: "flex", alignItems: "center", gap: "8px" }}>
                    <span style={{ color: "var(--color-text-secondary)" }}>Industry Blueprint:</span>
                    <span style={{ color: preset.accentColor }}>{preset.name}</span>
                  </div>
                  <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                    {preset.complianceStandards.map((std) => (
                      <span
                        key={std}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "4px",
                          padding: "2px 8px",
                          borderRadius: "999px",
                          fontSize: "11px",
                          fontWeight: 700,
                          background: "rgba(16, 185, 129, 0.12)",
                          color: "#34d399",
                          border: "1px solid rgba(16, 185, 129, 0.25)",
                        }}
                      >
                        ✓ {std}
                      </span>
                    ))}
                  </div>
                </div>
                <p style={{ margin: 0, fontSize: "13.5px", color: "var(--color-text-secondary)", lineHeight: 1.55 }}>
                  {space.description || preset.description}
                </p>
                <div style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>
                  <strong style={{ color: "var(--color-text-primary)" }}>Replaces & Consolidates:</strong>{" "}
                  {preset.replacesTools.join(" • ")}
                </div>
              </div>

              {/* Executable Domain Baseline Preview */}
              <div
                style={{
                  padding: "18px 20px",
                  borderRadius: "12px",
                  border: "1px solid var(--color-border)",
                  background: "var(--ms-bg-elv, rgba(15, 23, 42, 0.5))",
                  boxShadow: "0 2px 12px rgba(0, 0, 0, 0.15)",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: "12px",
                    flexWrap: "wrap",
                    gap: "8px",
                  }}
                >
                  <div>
                    <span style={{ fontWeight: 800, fontSize: "14px" }}>
                      ⚡ Baseline Verification Model: {preset.sampleCodeSnippet.title}
                    </span>
                    <span
                      style={{
                        marginLeft: "8px",
                        fontSize: "11.5px",
                        fontFamily: "monospace",
                        color: preset.accentColor,
                        fontWeight: 700,
                      }}
                    >
                      ({preset.sampleCodeSnippet.language})
                    </span>
                  </div>
                  <Link
                    to={`/morsel?code=${encodeURIComponent(preset.sampleCodeSnippet.code)}`}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "6px",
                      padding: "6px 13px",
                      borderRadius: "6px",
                      background: "var(--ms-brand, #2563eb)",
                      color: "#fff",
                      textDecoration: "none",
                      fontSize: "12px",
                      fontWeight: 700,
                      boxShadow: "0 2px 8px rgba(37, 99, 235, 0.3)",
                    }}
                  >
                    <span>▶ Simulate in WASM Playground</span>
                  </Link>
                </div>
                <pre
                  style={{
                    margin: 0,
                    padding: "14px 16px",
                    borderRadius: "8px",
                    background: "#020617",
                    border: "1px solid #1e293b",
                    fontSize: "12px",
                    fontFamily: "monospace",
                    overflowX: "auto",
                    color: "#e2e8f0",
                    lineHeight: 1.5,
                  }}
                >
                  {preset.sampleCodeSnippet.code}
                </pre>
              </div>

              {/* Space Event Stream / Activity Timeline */}
              <div
                style={{
                  padding: "18px 20px",
                  borderRadius: "12px",
                  border: "1px solid var(--color-border)",
                  background: "var(--ms-bg-elv, rgba(15, 23, 42, 0.5))",
                  display: "flex",
                  flexDirection: "column",
                  gap: "14px",
                  boxShadow: "0 2px 12px rgba(0, 0, 0, 0.15)",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontWeight: 800, fontSize: "14px" }}>Recent Space Activity Stream</span>
                  <span style={{ fontSize: "11px", color: "var(--color-text-muted)" }}>Live Real-Time Feed</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "0px", position: "relative" }}>
                  <div
                    style={{
                      position: "absolute",
                      left: "14px",
                      top: "14px",
                      bottom: "14px",
                      width: "1.5px",
                      background: "var(--color-border, #1e293b)",
                      zIndex: 0,
                    }}
                  />

                  {messages.slice(0, 3).map((m) => (
                    <div
                      key={`act-${m.id}`}
                      style={{
                        position: "relative",
                        zIndex: 1,
                        display: "flex",
                        alignItems: "flex-start",
                        gap: "12px",
                        padding: "9px 0",
                      }}
                    >
                      <div
                        style={{
                          width: "30px",
                          height: "30px",
                          borderRadius: "50%",
                          background: "var(--ms-bg-elv, #0f172a)",
                          border: "1.5px solid var(--color-border)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: "12px",
                          flexShrink: 0,
                        }}
                      >
                        💬
                      </div>
                      <div style={{ flex: 1, minWidth: 0, paddingTop: "2px" }}>
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "baseline",
                            gap: "8px",
                          }}
                        >
                          <div style={{ fontSize: "13px", color: "var(--color-text-primary)", lineHeight: 1.4 }}>
                            <strong>{m.sender_name || `@${m.author_username || "engineer"}`}</strong>{" "}
                            <span style={{ color: "var(--color-text-secondary)" }}>posted in</span>{" "}
                            <span style={{ fontFamily: "monospace", color: preset.accentColor, fontWeight: 600 }}>
                              #{activeChannelSlug}
                            </span>
                            :{" "}
                            <span style={{ color: "var(--color-text-muted)" }}>
                              "{m.content.slice(0, 70)}
                              {m.content.length > 70 ? "..." : ""}"
                            </span>
                          </div>
                          <span style={{ fontSize: "11px", color: "var(--color-text-muted)", whiteSpace: "nowrap" }}>
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
                        position: "relative",
                        zIndex: 1,
                        display: "flex",
                        alignItems: "flex-start",
                        gap: "12px",
                        padding: "9px 0",
                      }}
                    >
                      <div
                        style={{
                          width: "30px",
                          height: "30px",
                          borderRadius: "50%",
                          background: "var(--ms-bg-elv, #0f172a)",
                          border: "1.5px solid rgba(16, 185, 129, 0.4)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: "12px",
                          flexShrink: 0,
                          color: "#34d399",
                        }}
                      >
                        🔗
                      </div>
                      <div style={{ flex: 1, minWidth: 0, paddingTop: "2px" }}>
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "baseline",
                            gap: "8px",
                          }}
                        >
                          <div style={{ fontSize: "13px", color: "var(--color-text-primary)", lineHeight: 1.4 }}>
                            <strong style={{ color: "#34d399", fontFamily: "monospace" }}>ECO-{eco.eco_number}</strong>{" "}
                            <span>{eco.title}</span>{" "}
                            <span style={{ fontSize: "11.5px", color: "var(--color-text-muted)" }}>
                              (Simulation Gate: {eco.simulation_gate_status})
                            </span>
                          </div>
                          <span
                            style={{
                              padding: "2px 7px",
                              borderRadius: "999px",
                              fontSize: "10.5px",
                              fontWeight: 700,
                              background: "rgba(16, 185, 129, 0.14)",
                              color: "#34d399",
                              textTransform: "uppercase",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {eco.status}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}

                  {messages.length === 0 && ecos.length === 0 && (
                    <div
                      style={{
                        padding: "16px 0",
                        textAlign: "center",
                        color: "var(--color-text-muted)",
                        fontSize: "12.5px",
                      }}
                    >
                      No recent activity in this Space yet.
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Contextual Space Inspector Column */}
            <SpaceInspectorPanel>
              <SpaceCardPanel style={{ padding: 0, gap: 0, overflow: "hidden" }}>
                {/* Section 1: Space Git Vault */}
                <div style={{ padding: "16px 18px", borderBottom: "1px solid var(--color-border)" }}>
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
                        fontWeight: 800,
                        fontSize: "12px",
                        textTransform: "uppercase",
                        letterSpacing: "0.04em",
                        color: "var(--color-text-muted)",
                      }}
                    >
                      Space Git Vault
                    </span>
                    <span
                      style={{
                        padding: "2px 7px",
                        borderRadius: "999px",
                        fontSize: "10.5px",
                        fontWeight: 700,
                        background: "rgba(16, 185, 129, 0.16)",
                        color: "#34d399",
                      }}
                    >
                      SYNCED
                    </span>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "6px", fontSize: "12.5px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ color: "var(--color-text-muted)" }}>Default Branch:</span>
                      <strong style={{ fontFamily: "monospace" }}>main</strong>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ color: "var(--color-text-muted)" }}>Visibility:</span>
                      <span style={{ textTransform: "capitalize" }}>{space.visibility}</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ color: "var(--color-text-muted)" }}>Protocols:</span>
                      <span style={{ fontFamily: "monospace" }}>HTTPS, SSH</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      void navigator.clipboard?.writeText(gitCloneUrl);
                      toast.info("Copied Git clone URL");
                    }}
                    style={{
                      marginTop: "12px",
                      width: "100%",
                      padding: "7px 10px",
                      borderRadius: "6px",
                      border: "1px solid var(--color-border)",
                      background: "rgba(15, 23, 42, 0.6)",
                      color: "var(--color-text-primary)",
                      fontSize: "11.5px",
                      fontFamily: "monospace",
                      cursor: "pointer",
                      textAlign: "center",
                    }}
                  >
                    git clone {space.owner_namespace}/{space.slug}.git 📋
                  </button>
                </div>

                {/* Section 2: Standards & Verification Gates */}
                <div style={{ padding: "16px 18px", borderBottom: "1px solid var(--color-border)" }}>
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
                        fontWeight: 800,
                        fontSize: "12px",
                        textTransform: "uppercase",
                        letterSpacing: "0.04em",
                        color: "var(--color-text-muted)",
                      }}
                    >
                      Compliance & Gates
                    </span>
                    <span
                      style={{
                        padding: "2px 7px",
                        borderRadius: "999px",
                        fontSize: "10.5px",
                        fontWeight: 700,
                        background: "rgba(59, 130, 246, 0.16)",
                        color: "#60a5fa",
                      }}
                    >
                      DAE ACTIVE
                    </span>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "8px", fontSize: "12.5px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <span style={{ color: "#34d399", fontWeight: 800 }}>✓</span>
                      <span>Automated Simulation Verification Gate</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <span style={{ color: "#34d399", fontWeight: 800 }}>✓</span>
                      <span>Ed25519 Cryptographic Signatures</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <span style={{ color: "#34d399", fontWeight: 800 }}>✓</span>
                      <span>{preset.complianceStandards.join(", ")} Enforcement</span>
                    </div>
                  </div>
                </div>

                {/* Section 3: Space Team & Signatories */}
                <div style={{ padding: "16px 18px", borderBottom: "1px solid var(--color-border)" }}>
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
                        fontWeight: 800,
                        fontSize: "12px",
                        textTransform: "uppercase",
                        letterSpacing: "0.04em",
                        color: "var(--color-text-muted)",
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
                          color: "var(--ms-brand, #3b82f6)",
                          fontSize: "12px",
                          fontWeight: 700,
                          cursor: "pointer",
                        }}
                      >
                        Manage
                      </button>
                    )}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                    {members.map((m) => (
                      <div
                        key={m.user_id}
                        style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                          <div
                            style={{
                              width: "26px",
                              height: "26px",
                              borderRadius: "50%",
                              background: "rgba(59, 130, 246, 0.18)",
                              color: "var(--ms-brand, #3b82f6)",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              fontSize: "11px",
                              fontWeight: 800,
                            }}
                          >
                            {m.username.charAt(0).toUpperCase()}
                          </div>
                          <span style={{ fontSize: "12.5px", fontWeight: 600 }}>@{m.username}</span>
                        </div>
                        <span
                          style={{
                            padding: "2px 7px",
                            borderRadius: "999px",
                            fontSize: "10.5px",
                            fontWeight: 700,
                            background:
                              m.role === "owner"
                                ? "rgba(239, 68, 68, 0.14)"
                                : m.role === "maintainer"
                                  ? "rgba(245, 158, 11, 0.14)"
                                  : "rgba(148, 163, 184, 0.12)",
                            color:
                              m.role === "owner"
                                ? "#f87171"
                                : m.role === "maintainer"
                                  ? "#fbbf24"
                                  : "var(--color-text-muted)",
                            textTransform: "uppercase",
                          }}
                        >
                          {m.role}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Section 4: Quick Living Docs Shortcuts */}
                <div style={{ padding: "16px 18px" }}>
                  <div
                    style={{
                      fontWeight: 800,
                      fontSize: "12px",
                      textTransform: "uppercase",
                      letterSpacing: "0.04em",
                      color: "var(--color-text-muted)",
                      marginBottom: "10px",
                    }}
                  >
                    Key Living Specs
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
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
                          padding: "7px 10px",
                          borderRadius: "6px",
                          border: "1px solid var(--color-border)",
                          background: "rgba(15, 23, 42, 0.4)",
                          color: "var(--color-text-primary)",
                          fontSize: "12px",
                          fontWeight: 600,
                          cursor: "pointer",
                          textAlign: "left",
                        }}
                      >
                        <span>📄 {p.title}</span>
                        <span style={{ fontSize: "10.5px", fontFamily: "monospace", color: "var(--color-text-muted)" }}>
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
              background: "rgba(15, 23, 42, 0.35)",
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
                            border: "1px solid rgba(59, 130, 246, 0.4)",
                            background: "rgba(59, 130, 246, 0.15)",
                            color: "#60a5fa",
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
                          ▶ Run in WASM Playground
                        </Link>
                      </div>
                    )}

                    {m.promoted_target_type && (
                      <div
                        style={{
                          marginTop: "8px",
                          padding: "5px 10px",
                          borderRadius: "6px",
                          background: "rgba(16, 185, 129, 0.12)",
                          border: "1px solid rgba(16, 185, 129, 0.35)",
                          color: "#34d399",
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
                    background: "var(--ms-bg-elv, #0f172a)",
                    border: "1px solid var(--color-border)",
                    borderRadius: "8px",
                    padding: "6px",
                    boxShadow: "0 12px 24px rgba(0,0,0,0.45)",
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
                background: "rgba(15, 23, 42, 0.5)",
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
                  <div style={{ fontSize: "12px", color: "#34d399", marginBottom: "8px" }}>
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
                      borderRadius: "8px",
                      background: "#020617",
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
              background: "rgba(15, 23, 42, 0.3)",
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
                    borderRadius: "14px",
                    border: "1px solid var(--color-border)",
                    background: "var(--ms-bg-elv, rgba(15, 23, 42, 0.45))",
                    boxShadow: "0 4px 16px rgba(0, 0, 0, 0.15)",
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

      {/* ── Tab 4: PLM & Engineering Change Orders (Teamcenter / Windchill Replacement) ── */}
      {activeTab === "plm" && (
        <div style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: "16px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <h3 style={{ margin: 0 }}>PLM Engineering Change Orders (ECOs) & Digital Thread</h3>
              <p style={{ margin: "4px 0 0", fontSize: "13px", color: "var(--color-text-muted)" }}>
                Git-backed change proposals gated by automated DAE simulation verification and cryptographic sign-offs.
              </p>
            </div>
            {user && (
              <button
                type="button"
                onClick={() => setShowNewEcoForm((prev) => !prev)}
                style={{
                  padding: "8px 14px",
                  borderRadius: "8px",
                  border: "none",
                  background: "var(--ms-brand, #2563eb)",
                  color: "#fff",
                  fontSize: "13px",
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                + Propose New ECO
              </button>
            )}
          </div>

          {showNewEcoForm && (
            <form
              onSubmit={handleCreateEco}
              style={{
                padding: "16px",
                borderRadius: "12px",
                border: "1px solid var(--color-border)",
                background: "rgba(15, 23, 42, 0.6)",
                display: "flex",
                flexDirection: "column",
                gap: "10px",
              }}
            >
              <input
                type="text"
                required
                placeholder="ECO Title (e.g. Increase Suspension Damper Rate by 12% for Bump-Steer Margin)"
                value={newEcoTitle}
                onChange={(e) => setNewEcoTitle(e.target.value)}
                style={{
                  padding: "8px 12px",
                  borderRadius: "8px",
                  border: "1px solid var(--color-border)",
                  background: "var(--ms-bg)",
                  color: "inherit",
                }}
              />
              <textarea
                rows={3}
                placeholder="Engineering rationale, requirements impacted, and verification summary..."
                value={newEcoDesc}
                onChange={(e) => setNewEcoDesc(e.target.value)}
                style={{
                  padding: "8px 12px",
                  borderRadius: "8px",
                  border: "1px solid var(--color-border)",
                  background: "var(--ms-bg)",
                  color: "inherit",
                }}
              />
              <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                <select
                  value={newEcoSeverity}
                  onChange={(e) => setNewEcoSeverity(e.target.value as any)}
                  style={{
                    padding: "8px 12px",
                    borderRadius: "8px",
                    border: "1px solid var(--color-border)",
                    background: "var(--ms-bg)",
                    color: "inherit",
                  }}
                >
                  <option value="minor">Minor Change</option>
                  <option value="standard">Standard Change</option>
                  <option value="major">Major Architecture Change</option>
                  <option value="safety_critical">Safety-Critical (ISO 26262 / SIL / 21 CFR 11)</option>
                </select>
                <input
                  type="text"
                  placeholder="Impacted models (comma-separated)"
                  value={newEcoModels}
                  onChange={(e) => setNewEcoModels(e.target.value)}
                  style={{
                    flex: 1,
                    padding: "8px 12px",
                    borderRadius: "8px",
                    border: "1px solid var(--color-border)",
                    background: "var(--ms-bg)",
                    color: "inherit",
                  }}
                />
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
                  Submit ECO
                </button>
              </div>
            </form>
          )}

          {ecos.map((eco) => (
            <div
              key={eco.id}
              style={{
                padding: "16px",
                borderRadius: "12px",
                border: "1px solid var(--color-border)",
                background: "rgba(15, 23, 42, 0.45)",
                display: "flex",
                flexDirection: "column",
                gap: "10px",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  flexWrap: "wrap",
                  gap: "8px",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <span
                    style={{
                      padding: "3px 8px",
                      borderRadius: "6px",
                      fontFamily: "monospace",
                      fontSize: "12px",
                      fontWeight: 700,
                      background: "rgba(59, 130, 246, 0.16)",
                      color: "#60a5fa",
                    }}
                  >
                    ECO-{eco.eco_number}
                  </span>
                  <span style={{ fontWeight: 700, fontSize: "15px" }}>{eco.title}</span>
                </div>

                <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                  <span
                    style={{
                      padding: "3px 8px",
                      borderRadius: "999px",
                      fontSize: "11px",
                      fontWeight: 700,
                      background: "rgba(16, 185, 129, 0.16)",
                      color: "#34d399",
                    }}
                  >
                    ✓ Simulation Gate: {eco.simulation_gate_status.toUpperCase()}
                  </span>
                  <span
                    style={{
                      padding: "3px 8px",
                      borderRadius: "999px",
                      fontSize: "11px",
                      fontWeight: 700,
                      background: "rgba(148, 163, 184, 0.16)",
                      textTransform: "uppercase",
                    }}
                  >
                    {eco.status}
                  </span>
                </div>
              </div>

              <div style={{ fontSize: "13px", color: "var(--color-text-secondary)", whiteSpace: "pre-wrap" }}>
                {eco.description}
              </div>

              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  flexWrap: "wrap",
                  gap: "8px",
                }}
              >
                <div style={{ fontSize: "12px", color: "var(--color-text-muted)", fontFamily: "monospace" }}>
                  Branch: {eco.source_branch} → {eco.target_branch} • Impacted:{" "}
                  {eco.impacted_models.join(", ") || "none"}
                </div>

                {user && (
                  <div style={{ display: "flex", gap: "8px" }}>
                    <button
                      type="button"
                      onClick={() => handleReviewEco(eco.id, "approved")}
                      style={{
                        padding: "5px 12px",
                        borderRadius: "6px",
                        border: "1px solid rgba(16, 185, 129, 0.4)",
                        background: "rgba(16, 185, 129, 0.15)",
                        color: "#34d399",
                        fontSize: "12px",
                        fontWeight: 700,
                        cursor: "pointer",
                      }}
                    >
                      ✍️ Approve & Sign ECO
                    </button>
                    <button
                      type="button"
                      onClick={() => handleReviewEco(eco.id, "changes_requested")}
                      style={{
                        padding: "5px 12px",
                        borderRadius: "6px",
                        border: "1px solid var(--color-border)",
                        background: "transparent",
                        color: "var(--color-text-secondary)",
                        fontSize: "12px",
                        cursor: "pointer",
                      }}
                    >
                      Request Changes
                    </button>
                  </div>
                )}
              </div>

              {eco.approvals.length > 0 && (
                <div
                  style={{
                    marginTop: "6px",
                    paddingTop: "8px",
                    borderTop: "1px solid var(--color-border)",
                    fontSize: "12px",
                    color: "var(--color-text-muted)",
                  }}
                >
                  <strong>Cryptographic Sign-Offs:</strong>{" "}
                  {eco.approvals.map((a) => (
                    <span key={a.user_id} style={{ marginRight: "12px" }}>
                      @{a.username} ({a.role}): <strong>{a.decision.toUpperCase()}</strong> [sig:{" "}
                      <code>{(a.signature_hex || "").slice(0, 10)}</code>]
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── Tab 5: Repositories, PDM & Packages ── */}
      {activeTab === "repos" && (
        <div style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: "16px" }}>
          <div
            style={{
              padding: "18px",
              borderRadius: "12px",
              border: "1px solid var(--color-border)",
              background: "rgba(15, 23, 42, 0.45)",
            }}
          >
            <h3 style={{ margin: "0 0 6px" }}>Backing Git Vault & Multi-Model PDM Repository</h3>
            <p style={{ margin: "0 0 12px", fontSize: "13px", color: "var(--color-text-secondary)" }}>
              Clone this Space's Git Vault to manage <code>docs/</code>, <code>articles/</code>, and domain models (
              {preset.languages.map((l) => `.${l}`).join(", ")}) with full Git LFS and 3D CAD / DAE semantic diffing.
            </p>
            <div
              style={{
                padding: "10px 14px",
                borderRadius: "8px",
                background: "#020617",
                border: "1px solid #1e293b",
                fontFamily: "monospace",
                fontSize: "13px",
              }}
            >
              git clone {gitCloneUrl}
            </div>
          </div>
        </div>
      )}

      {/* ── Tab 6: Members, Governance & Container Ownership Transfer ── */}
      {activeTab === "settings" && (
        <div style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: "20px" }}>
          {/* Space Members & Engineering RBAC */}
          <div
            style={{
              padding: "18px",
              borderRadius: "12px",
              border: "1px solid var(--color-border)",
              background: "rgba(15, 23, 42, 0.45)",
            }}
          >
            <h3 style={{ margin: "0 0 12px" }}>Space Engineering Members & Roles ({members.length})</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginBottom: "14px" }}>
              {members.map((m) => (
                <div
                  key={m.user_id}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "8px 12px",
                    borderRadius: "8px",
                    background: "rgba(30, 41, 59, 0.4)",
                  }}
                >
                  <div>
                    <Link
                      to={`/@${m.username}`}
                      style={{ fontWeight: 700, color: "var(--color-text-primary)", textDecoration: "none" }}
                    >
                      @{m.username}
                    </Link>
                    {m.display_name && (
                      <span style={{ marginLeft: "8px", fontSize: "12px", color: "var(--color-text-muted)" }}>
                        ({m.display_name})
                      </span>
                    )}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <span
                      style={{
                        padding: "2px 8px",
                        borderRadius: "999px",
                        fontSize: "11px",
                        fontWeight: 700,
                        background: "rgba(59, 130, 246, 0.16)",
                        color: "#60a5fa",
                      }}
                    >
                      {m.role}
                    </span>
                    {viewerState.canAdmin && m.role !== "owner" && (
                      <button
                        type="button"
                        onClick={async () => {
                          const list = await removeSpaceMember(space.owner_namespace, space.slug, m.user_id);
                          setDetail((prev) => (prev ? { ...prev, members: list } : prev));
                        }}
                        style={{
                          background: "transparent",
                          border: "none",
                          color: "#f87171",
                          fontSize: "12px",
                          cursor: "pointer",
                        }}
                      >
                        Remove
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {viewerState.canAdmin && (
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (!newMemberUsername.trim()) return;
                  try {
                    const list = await addSpaceMember(
                      space.owner_namespace,
                      space.slug,
                      newMemberUsername.trim(),
                      newMemberRole,
                    );
                    setDetail((prev) => (prev ? { ...prev, members: list } : prev));
                    setNewMemberUsername("");
                    toast.success("Updated Space member role");
                  } catch (err: any) {
                    toast.error(err?.response?.data?.error || "Failed to add member");
                  }
                }}
                style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}
              >
                <input
                  type="text"
                  placeholder="username"
                  value={newMemberUsername}
                  onChange={(e) => setNewMemberUsername(e.target.value)}
                  style={{
                    padding: "8px 12px",
                    borderRadius: "8px",
                    border: "1px solid var(--color-border)",
                    background: "var(--ms-bg)",
                    color: "inherit",
                  }}
                />
                <select
                  value={newMemberRole}
                  onChange={(e) => setNewMemberRole(e.target.value as SpaceRole)}
                  style={{
                    padding: "8px 12px",
                    borderRadius: "8px",
                    border: "1px solid var(--color-border)",
                    background: "var(--ms-bg)",
                    color: "inherit",
                  }}
                >
                  <option value="lead_engineer">Lead Engineer</option>
                  <option value="approver">PLM Approver</option>
                  <option value="contributor">Contributor</option>
                  <option value="reviewer">Reviewer</option>
                  <option value="viewer">Viewer</option>
                </select>
                <button
                  type="submit"
                  style={{
                    padding: "8px 14px",
                    borderRadius: "8px",
                    border: "none",
                    background: "#2563eb",
                    color: "#fff",
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  Add / Update Member
                </button>
              </form>
            )}
          </div>

          {/* Transfer Space Ownership between User Profile and Organization */}
          {viewerState.canAdmin && (
            <div
              style={{
                padding: "18px",
                borderRadius: "12px",
                border: "1px solid rgba(245, 158, 11, 0.35)",
                background: "rgba(245, 158, 11, 0.06)",
              }}
            >
              <h3 style={{ margin: "0 0 6px" }}>Transfer Container Ownership (Personal Profile ↔ Organization)</h3>
              <p style={{ margin: "0 0 12px", fontSize: "13px", color: "var(--color-text-secondary)" }}>
                Graduate a personal R&D Space into an Organization container, or move an Organization Space to another
                namespace. The backing Git Vault is relocated automatically.
              </p>
              <form onSubmit={handleTransferOwnership} style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                <select
                  value={transferTargetType}
                  onChange={(e) => {
                    const nextType = e.target.value as SpaceOwnerType;
                    setTransferTargetType(nextType);
                    if (nextType === "user" && user) {
                      setTransferTargetSlug(user.username);
                    } else if (nextType === "organization" && myOrgs[0]) {
                      setTransferTargetSlug(myOrgs[0].slug);
                    }
                  }}
                  style={{
                    padding: "8px 12px",
                    borderRadius: "8px",
                    border: "1px solid var(--color-border)",
                    background: "var(--ms-bg)",
                    color: "inherit",
                  }}
                >
                  <option value="organization">🏢 Transfer to Organization</option>
                  <option value="user">👤 Transfer to Personal Profile</option>
                </select>

                <input
                  type="text"
                  placeholder="Target @slug (e.g. ford or username)"
                  value={transferTargetSlug}
                  onChange={(e) => setTransferTargetSlug(e.target.value)}
                  style={{
                    padding: "8px 12px",
                    borderRadius: "8px",
                    border: "1px solid var(--color-border)",
                    background: "var(--ms-bg)",
                    color: "inherit",
                  }}
                />
                <button
                  type="submit"
                  style={{
                    padding: "8px 16px",
                    borderRadius: "8px",
                    border: "none",
                    background: "#d97706",
                    color: "#fff",
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  Transfer Space →
                </button>
              </form>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default SpacePage;
