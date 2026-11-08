// SPDX-License-Identifier: AGPL-3.0-or-later

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
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
 * Primary Slack / Discord-style Engineering Chat Workspace (`/chat`).
 * Presents all Spaces the user belongs to (grouped by Organization and Personal containers)
 * in a fast multi-column sidenav with instant channel switching, WASM simulation execution,
 * and one-click links back to the full Space, Living Docs, and PLM Change Orders.
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

  const wsRef = useRef<WebSocket | null>(null);

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
    if (!activeSpace || !activeChannel) return;
    void getSpaceChannelMessages(activeSpace.owner_namespace, activeSpace.slug, activeChannel.slug)
      .then((res) => {
        setMessages(res.messages);
        setActiveChannel(res.channel);
      })
      .catch(() => {});
  }, [activeSpace?.id, activeChannel?.slug]);

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
            setMessages((prev) =>
              prev.some((m) => m.id === data.message.id) ? prev : [...prev, data.message as SpaceMessageRecord],
            );
          }
        } catch {}
      };
      return () => ws.close();
    } catch {
      return undefined;
    }
  }, [activeSpace?.id, activeChannel?.id]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeSpace || !activeChannel || !chatInput.trim()) return;
    try {
      const res = await sendSpaceChannelMessage(activeSpace.owner_namespace, activeSpace.slug, activeChannel.slug, {
        content: chatInput.trim(),
      });
      setChatInput("");
      setMessages((prev) => {
        const next = prev.some((m) => m.id === res.message.id) ? [...prev] : [...prev, res.message];
        if (res.botReply && !next.some((m) => m.id === res.botReply!.id)) {
          next.push(res.botReply);
        }
        return next;
      });
    } catch (err: any) {
      toast.error(err?.response?.data?.error || "Failed to send message");
    }
  };

  if (loading) {
    return (
      <div style={{ padding: "48px", display: "flex", justifyContent: "center" }}>
        <Spinner />
      </div>
    );
  }

  const orgSpaces = sidebarSpaces.filter((s) => s.owner_type === "organization");
  const personalSpaces = sidebarSpaces.filter((s) => s.owner_type === "user");

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "68px 230px 1fr",
        height: "calc(100vh - 2px)",
        width: "100%",
        overflow: "hidden",
      }}
    >
      {/* 1. Leftmost Discord/Slack Server Icon Rail */}
      <div
        style={{
          background: "rgba(2, 6, 23, 0.85)",
          borderRight: "1px solid var(--color-border)",
          padding: "12px 8px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "10px",
          overflowY: "auto",
        }}
      >
        {sidebarSpaces.map((sp) => {
          const isSelected = activeSpace?.id === sp.id;
          return (
            <button
              key={sp.id}
              type="button"
              title={`@${sp.owner_namespace}/${sp.slug} — ${sp.name}`}
              onClick={() => {
                setActiveSpace(sp);
                if (sp.channels[0]) setActiveChannel(sp.channels[0]);
                setSearchParams({ space: `${sp.owner_namespace}/${sp.slug}` });
              }}
              style={{
                width: "44px",
                height: "44px",
                borderRadius: isSelected ? "12px" : "22px",
                border: isSelected ? "2px solid #3b82f6" : "1px solid var(--color-border)",
                background: isSelected ? "rgba(59, 130, 246, 0.25)" : "rgba(30, 41, 59, 0.6)",
                color: "#f8fafc",
                fontWeight: 800,
                fontSize: "14px",
                cursor: "pointer",
                position: "relative",
                transition: "border-radius 0.15s ease",
              }}
            >
              {sp.name.slice(0, 2).toUpperCase()}
              {sp.total_unread > 0 && (
                <span
                  style={{
                    position: "absolute",
                    top: "-3px",
                    right: "-3px",
                    background: "#ef4444",
                    color: "#fff",
                    borderRadius: "999px",
                    fontSize: "10px",
                    padding: "1px 5px",
                  }}
                >
                  {sp.total_unread}
                </span>
              )}
            </button>
          );
        })}

        <button
          type="button"
          title="Create New Space"
          onClick={() => setIsCreateModalOpen(true)}
          style={{
            width: "44px",
            height: "44px",
            borderRadius: "22px",
            border: "1px dashed var(--color-border)",
            background: "transparent",
            color: "#3b82f6",
            fontSize: "20px",
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          +
        </button>
      </div>

      {/* 2. Space & Container Channel Sidenav */}
      <div
        style={{
          background: "rgba(15, 23, 42, 0.45)",
          borderRight: "1px solid var(--color-border)",
          padding: "14px 10px",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          overflowY: "auto",
        }}
      >
        <div>
          {activeSpace ? (
            <>
              <div
                style={{
                  padding: "6px 8px 12px",
                  borderBottom: "1px solid var(--color-border)",
                  marginBottom: "12px",
                }}
              >
                <div style={{ fontSize: "11px", color: "var(--color-text-muted)", fontWeight: 700 }}>
                  {activeSpace.owner_type === "organization" ? "🏢 ORG SPACE" : "👤 PERSONAL SPACE"}
                </div>
                <div style={{ fontWeight: 800, fontSize: "15px", marginTop: "2px" }}>{activeSpace.name}</div>
                <Link
                  to={`/@${activeSpace.owner_namespace}/${activeSpace.slug}`}
                  style={{
                    display: "inline-block",
                    marginTop: "6px",
                    fontSize: "12px",
                    fontWeight: 700,
                    color: "var(--ms-brand, #3b82f6)",
                    textDecoration: "none",
                  }}
                >
                  Open Full Space Hub ↗
                </Link>
              </div>

              <div
                style={{
                  fontSize: "11px",
                  fontWeight: 700,
                  color: "var(--color-text-muted)",
                  padding: "0 8px 6px",
                  textTransform: "uppercase",
                }}
              >
                Channels
              </div>
              {activeSpace.channels.map((ch) => {
                const isSelected = activeChannel?.slug === ch.slug;
                return (
                  <button
                    key={ch.id}
                    type="button"
                    onClick={() => setActiveChannel(ch)}
                    style={{
                      display: "block",
                      width: "100%",
                      padding: "7px 10px",
                      borderRadius: "7px",
                      border: "none",
                      background: isSelected ? "rgba(59, 130, 246, 0.18)" : "transparent",
                      color: isSelected ? "var(--color-text-primary)" : "var(--color-text-secondary)",
                      fontWeight: isSelected ? 700 : 500,
                      fontSize: "13px",
                      textAlign: "left",
                      cursor: "pointer",
                    }}
                  >
                    # {ch.name}
                  </button>
                );
              })}

              <div
                style={{
                  fontSize: "11px",
                  fontWeight: 700,
                  color: "var(--color-text-muted)",
                  padding: "16px 8px 6px",
                  textTransform: "uppercase",
                }}
              >
                Space Jump Links
              </div>
              <Link
                to={`/@${activeSpace.owner_namespace}/${activeSpace.slug}?tab=docs`}
                style={{
                  display: "block",
                  padding: "6px 10px",
                  color: "var(--color-text-secondary)",
                  textDecoration: "none",
                  fontSize: "12.5px",
                }}
              >
                📄 Living Docs (CMS)
              </Link>
              <Link
                to={`/@${activeSpace.owner_namespace}/${activeSpace.slug}?tab=plm`}
                style={{
                  display: "block",
                  padding: "6px 10px",
                  color: "var(--color-text-secondary)",
                  textDecoration: "none",
                  fontSize: "12.5px",
                }}
              >
                🔗 PLM & Change Orders
              </Link>
              <Link
                to={`/@${activeSpace.owner_namespace}/${activeSpace.slug}?tab=repos`}
                style={{
                  display: "block",
                  padding: "6px 10px",
                  color: "var(--color-text-secondary)",
                  textDecoration: "none",
                  fontSize: "12.5px",
                }}
              >
                📦 Git Vault & PDM
              </Link>
            </>
          ) : (
            <div style={{ padding: "12px", fontSize: "13px", color: "var(--color-text-muted)" }}>
              No Spaces joined yet.
            </div>
          )}

          {/* Container Tree Summary */}
          {orgSpaces.length > 0 && (
            <div style={{ marginTop: "18px", padding: "0 8px" }}>
              <div style={{ fontSize: "11px", fontWeight: 700, color: "var(--color-text-muted)", marginBottom: "4px" }}>
                🏢 ORGANIZATION SPACES ({orgSpaces.length})
              </div>
              {orgSpaces.map((s) => (
                <div
                  key={s.id}
                  onClick={() => {
                    setActiveSpace(s);
                    if (s.channels[0]) setActiveChannel(s.channels[0]);
                  }}
                  style={{
                    fontSize: "12px",
                    padding: "4px 0",
                    cursor: "pointer",
                    color: "var(--color-text-secondary)",
                  }}
                >
                  @{s.owner_namespace}/{s.slug}
                </div>
              ))}
            </div>
          )}

          {personalSpaces.length > 0 && (
            <div style={{ marginTop: "14px", padding: "0 8px" }}>
              <div style={{ fontSize: "11px", fontWeight: 700, color: "var(--color-text-muted)", marginBottom: "4px" }}>
                👤 PERSONAL SPACES ({personalSpaces.length})
              </div>
              {personalSpaces.map((s) => (
                <div
                  key={s.id}
                  onClick={() => {
                    setActiveSpace(s);
                    if (s.channels[0]) setActiveChannel(s.channels[0]);
                  }}
                  style={{
                    fontSize: "12px",
                    padding: "4px 0",
                    cursor: "pointer",
                    color: "var(--color-text-secondary)",
                  }}
                >
                  @{s.owner_namespace}/{s.slug}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 3. Primary Fast Chat Stream */}
      <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
        {activeSpace && activeChannel ? (
          <>
            <div
              style={{
                padding: "12px 18px",
                borderBottom: "1px solid var(--color-border)",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <div>
                <span style={{ fontWeight: 800, fontSize: "15px" }}>#{activeChannel.name}</span>
                <span style={{ marginLeft: "10px", fontSize: "12px", color: "var(--color-text-muted)" }}>
                  {activeChannel.topic || activeSpace.tagline}
                </span>
              </div>
              <Link
                to={`/@${activeSpace.owner_namespace}/${activeSpace.slug}`}
                style={{
                  padding: "6px 12px",
                  borderRadius: "8px",
                  background: "rgba(59, 130, 246, 0.15)",
                  color: "var(--ms-brand, #3b82f6)",
                  textDecoration: "none",
                  fontSize: "12px",
                  fontWeight: 700,
                }}
              >
                Go to Space (@{activeSpace.owner_namespace}/{activeSpace.slug}) →
              </Link>
            </div>

            <div
              style={{
                flex: 1,
                overflowY: "auto",
                padding: "16px 18px",
                display: "flex",
                flexDirection: "column",
                gap: "12px",
              }}
            >
              {messages.map((m) => (
                <div
                  key={m.id}
                  style={{
                    padding: "10px 14px",
                    borderRadius: "10px",
                    background: "rgba(30, 41, 59, 0.35)",
                    border: "1px solid var(--color-border)",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div>
                      <strong style={{ fontSize: "13px" }}>
                        {m.sender_name || (m.author_username ? `@${m.author_username}` : "Engineer")}
                      </strong>
                      <span style={{ marginLeft: "8px", fontSize: "11px", color: "var(--color-text-muted)" }}>
                        {m.created_at}
                      </span>
                    </div>
                    {user && (
                      <div style={{ display: "flex", gap: "6px" }}>
                        <button
                          type="button"
                          onClick={async () => {
                            await promoteSpaceMessage(
                              activeSpace.owner_namespace,
                              activeSpace.slug,
                              activeChannel.slug,
                              m.id,
                              "doc",
                            );
                            toast.success("Promoted message to Space Living Doc!");
                          }}
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
                          onClick={async () => {
                            await promoteSpaceMessage(
                              activeSpace.owner_namespace,
                              activeSpace.slug,
                              activeChannel.slug,
                              m.id,
                              "eco",
                            );
                            toast.success("Promoted message to PLM Change Order (ECO)!");
                          }}
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
                  <div style={{ marginTop: "6px", fontSize: "13.5px", whiteSpace: "pre-wrap", lineHeight: 1.5 }}>
                    {m.content}
                  </div>
                  <div style={{ display: "flex", gap: "6px", marginTop: "8px" }}>
                    {["🚀", "✅", "🔥"].map((emoji) => {
                      const count = (m.reactions?.[emoji] || []).length;
                      return (
                        <button
                          key={emoji}
                          type="button"
                          onClick={async () => {
                            const updated = await toggleSpaceMessageReaction(
                              activeSpace.owner_namespace,
                              activeSpace.slug,
                              activeChannel.slug,
                              m.id,
                              emoji,
                            );
                            setMessages((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
                          }}
                          style={{
                            padding: "2px 7px",
                            borderRadius: "999px",
                            border: "1px solid var(--color-border)",
                            background: count > 0 ? "rgba(59, 130, 246, 0.16)" : "transparent",
                            color: "inherit",
                            fontSize: "11px",
                            cursor: "pointer",
                          }}
                        >
                          {emoji} {count > 0 ? count : ""}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            <form
              onSubmit={handleSend}
              style={{
                padding: "12px 18px",
                borderTop: "1px solid var(--color-border)",
                display: "flex",
                gap: "8px",
              }}
            >
              <input
                type="text"
                placeholder={
                  user
                    ? `Message #${activeChannel.name} in @${activeSpace.owner_namespace}/${activeSpace.slug}... (Type /run to simulate)`
                    : "Sign in to chat..."
                }
                disabled={!user}
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
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
                disabled={!user}
                style={{
                  padding: "10px 18px",
                  borderRadius: "8px",
                  border: "none",
                  background: "var(--ms-brand, #2563eb)",
                  color: "#fff",
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                Send
              </button>
            </form>
          </>
        ) : (
          <div style={{ padding: "48px", textAlign: "center", color: "var(--color-text-muted)" }}>
            Select or create a Space on the left rail to start chatting.
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
