/* eslint-disable */
import {
  BookIcon,
  CheckCircleIcon,
  CircleIcon,
  CodeIcon,
  GlobeIcon,
  ImageIcon,
  MentionIcon,
  PersonIcon,
  SlidersIcon,
  SmileyIcon,
  XIcon,
} from "@primer/octicons-react";
import { Heading, IconButton, Text } from "@primer/react";
import React, { useEffect, useMemo, useRef, useState } from "react";
import styled from "styled-components";
import { useAuth } from "../AuthContext";
import { API_BASE_URL } from "../config";
import { getAvatarUrl } from "../util/avatar";
import Box from "./Box";
import SimpleEmojiPicker from "./SimpleEmojiPicker";
import ArtifactViewCard from "./artifacts/ArtifactViewCard";

const TweetButton = styled.button`
  background-color: #1d9bf0;
  color: white;
  border: none;
  border-radius: 9999px;
  padding: 8px 20px;
  font-size: 15px;
  font-weight: bold;
  cursor: pointer;
  transition: opacity 0.2s;

  &:hover {
    opacity: 0.9;
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

const ActionIconButton = styled.button`
  background: transparent;
  border: none;
  cursor: pointer;
  border-radius: 50%;
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #71767b;
  transition: background-color 0.2s;
  padding: 0;

  &:hover:not(:disabled) {
    background-color: var(--color-action-list-item-default-hover-bg, rgba(128, 128, 128, 0.15));
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  & svg {
    fill: currentColor;
    stroke: currentColor;
    stroke-width: 0.2px;
    transition: transform 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275);
  }

  &:hover:not(:disabled) svg {
    transform: scale(1.15);
  }
`;

const OverlayWrapper = styled.div`
  position: relative;
  width: 100%;
  display: flex;
  flex-direction: column;
`;

const Backdrop = styled.div`
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  pointer-events: none;
  font-size: 20px;
  padding: 6px 0 4px 0;
  font-family: inherit;
  white-space: pre-wrap;
  word-wrap: break-word;
  color: var(--color-fg-default);
  z-index: 0;
`;

const ComposeInput = styled.textarea`
  width: 100%;
  border: none;
  outline: none;
  font-size: 20px;
  padding: 6px 0 4px 0;
  resize: none;
  background: transparent !important;
  color: var(--color-fg-default) !important;
  -webkit-text-fill-color: transparent !important;
  caret-color: var(--color-fg-default);
  font-family: inherit;
  overflow: hidden;
  box-sizing: border-box;
  flex-shrink: 0;
  margin-bottom: 12px;
  position: relative;
  z-index: 1;
  &::placeholder {
    color: #71767b;
    -webkit-text-fill-color: #71767b;
    opacity: 1;
  }
`;

const QuoteWrapper = styled.div`
  margin-top: 8px;
  padding: 12px;
  border: 1px solid var(--color-border);
  border-radius: 12px;
`;

import type { SpatialPin } from "./artifacts/spatial-pin";

function formatRelativeTime(dateString: string): string {
  if (!dateString) return "";
  const date = new Date(dateString);
  const now = new Date();
  const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);
  if (diffInSeconds < 60) return "Just now";
  const diffInMinutes = Math.floor(diffInSeconds / 60);
  if (diffInMinutes < 60) return `${diffInMinutes}m`;
  const diffInHours = Math.floor(diffInMinutes / 60);
  if (diffInHours < 24) return `${diffInHours}h`;
  const diffInDays = Math.floor(diffInHours / 24);
  if (diffInDays < 7) return `${diffInDays}d`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

interface ComposeBoxProps {
  onPostCreated?: (post: any) => void;
  quotePost?: any;
  replyToPost?: any;
  placeholder?: string;
  minRows?: number;
  autoFocus?: boolean;
  pendingPin?: SpatialPin;
  content?: string;
  setContent?: (val: string) => void;
  artifactId?: number | null;
  setArtifactId?: (val: number | null) => void;
  isModal?: boolean;
}

export default function ComposeBox({
  onPostCreated,
  quotePost,
  replyToPost,
  placeholder,
  minRows = 1,
  autoFocus,
  pendingPin,
  content: controlledContent,
  setContent: setControlledContent,
  artifactId: controlledArtifactId,
  setArtifactId: setControlledArtifactId,
  isModal,
}: ComposeBoxProps) {
  const { user, token } = useAuth();

  const [internalContent, setInternalContent] = useState("");
  const content = controlledContent !== undefined ? controlledContent : internalContent;
  const setContent = setControlledContent || setInternalContent;

  const [internalArtifactId, setInternalArtifactId] = useState<number | null>(null);
  const artifactId = controlledArtifactId !== undefined ? controlledArtifactId : internalArtifactId;
  const setArtifactId = setControlledArtifactId || setInternalArtifactId;

  const [submitting, setSubmitting] = useState(false);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [replyVisibility, setReplyVisibility] = useState<"everyone" | "following" | "mentioned">("everyone");
  const [showVisibilityMenu, setShowVisibilityMenu] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    }
  }, [content]);

  const [showRecipientsModal, setShowRecipientsModal] = useState(false);
  const [excludedUsers, setExcludedUsers] = useState<Set<string>>(new Set());

  const allMentionedUsers = useMemo(() => {
    if (!replyToPost) return [];
    const matches = (replyToPost.content?.match(/@\w+/g) || []).map((m: string) => m.slice(1));
    const unique = Array.from(new Set([replyToPost.username, ...matches])).filter((u) => u !== user?.username);
    return unique;
  }, [replyToPost, user?.username]);

  const [followers, setFollowers] = useState<any[]>([]);
  const [mentionQuery, setMentionQuery] = useState<{ query: string; index: number } | null>(null);

  useEffect(() => {
    if (user?.username && token) {
      fetch(`${API_BASE_URL}/users/${user.username}/followers`, {
        headers: { Authorization: `Bearer ${token}` },
      })
        .then((r) => r.json())
        .then((d) => {
          if (d.followers) setFollowers(d.followers);
        })
        .catch(console.error);
    }
  }, [user, token]);

  const mentionSuggestions = useMemo(() => {
    if (!mentionQuery) return [];
    const matches = (content.match(/@\w+/g) || []).map((m: string) => m.slice(1));
    const allUsers = new Map<string, any>();

    followers.forEach((f) => allUsers.set(f.username.toLowerCase(), f));
    allMentionedUsers.forEach((u) => {
      if (!allUsers.has(u.toLowerCase())) allUsers.set(u.toLowerCase(), { username: u });
    });
    matches.forEach((u) => {
      if (!allUsers.has(u.toLowerCase())) allUsers.set(u.toLowerCase(), { username: u });
    });

    const q = mentionQuery.query.toLowerCase();
    return Array.from(allUsers.values())
      .filter((u) => u.username.toLowerCase().includes(q) || u.display_name?.toLowerCase().includes(q))
      .slice(0, 15);
  }, [mentionQuery, followers, allMentionedUsers, content]);

  const updateMentionState = (val: string, cursor: number) => {
    const textBeforeCursor = val.slice(0, cursor);
    const match = textBeforeCursor.match(/(?:^|\s)@(\w*)$/);
    if (match) {
      const atIndex = textBeforeCursor.lastIndexOf("@");
      setMentionQuery({ query: match[1], index: atIndex });
    } else {
      setMentionQuery(null);
    }
  };

  const handleContentChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setContent(e.target.value);
    updateMentionState(e.target.value, e.target.selectionStart);
  };

  const handleInteraction = (e: React.SyntheticEvent<HTMLTextAreaElement>) => {
    updateMentionState(e.currentTarget.value, e.currentTarget.selectionStart || 0);
  };

  const insertMention = (username: string) => {
    if (!mentionQuery) return;
    const before = content.slice(0, mentionQuery.index);
    const after = content.slice(textareaRef.current?.selectionStart || content.length);
    const newContent = `${before}@${username} ${after}`;
    setContent(newContent);
    setMentionQuery(null);
    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
        const newCursor = before.length + username.length + 2;
        textareaRef.current.setSelectionRange(newCursor, newCursor);
      }
    }, 0);
  };

  const includedUsers = useMemo(() => {
    return allMentionedUsers.filter((u) => !excludedUsers.has(u));
  }, [allMentionedUsers, excludedUsers]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!token || !e.target.files || e.target.files.length === 0) return;
    const file = e.target.files[0];
    setUploadingFile(true);
    try {
      const formData = new FormData();
      formData.append("file", file);

      const uploadRes = await fetch(`${API_BASE_URL}/storage/upload`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });

      if (uploadRes.ok) {
        const uploadData = await uploadRes.json();
        const view_config = JSON.stringify({ url: uploadData.url });

        const artifactRes = await fetch(`${API_BASE_URL}/social/artifact-views`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ artifact_type: uploadData.view_type, view_config, title: file.name }),
        });

        if (artifactRes.ok) {
          const artifactData = await artifactRes.json();
          setArtifactId(artifactData.id);
        }
      }
    } catch (err) {
      console.error(err);
    } finally {
      setUploadingFile(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const createDummyArtifact = async (type: string) => {
    if (!token) return;
    try {
      let view_config = "{}";
      if (type === "modelica-code") {
        view_config = JSON.stringify({ code: "model BouncingBall\n  Real h(start=1);\n  Real v;\nend BouncingBall;" });
      } else if (type === "simulation-plot") {
        view_config = JSON.stringify({
          model: "BouncingBall",
          overrides: { "h(start)": 10, e: 0.8 },
          variables: ["h", "v"],
          timeRange: [0, 5],
        });
      } else if (type === "tei-document") {
        view_config = JSON.stringify({
          data: `<?xml version="1.0" encoding="UTF-8"?>
<TEI xmlns="http://www.tei-c.org/ns/1.0">
  <teiHeader>
    <fileDesc>
      <titleStmt><title>Example TEI Document</title><author>Jane Doe</author></titleStmt>
      <publicationStmt><p>Published by ModelScript</p></publicationStmt>
      <sourceDesc><p>Born digital</p></sourceDesc>
    </fileDesc>
  </teiHeader>
  <text>
    <body>
      <head>Chapter 1</head>
      <p>This is a paragraph in a Text Encoding Initiative document.</p>
      <lg>
        <l>A stanza has lines,</l>
        <l>And this is one of them.</l>
      </lg>
    </body>
  </text>
</TEI>`,
        });
      }

      const res = await fetch(`${API_BASE_URL}/social/artifact-views`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ artifact_type: type, view_config, title: `Example ${type}` }),
      });
      if (res.ok) {
        const data = await res.json();
        setArtifactId(data.id);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const signContent = async (text: string) => {
    for (let i = 0; i < localStorage.length; i++) {
      const keyName = localStorage.key(i);
      if (keyName && keyName.startsWith("ap_priv_key_")) {
        const keyIdString = keyName.replace("ap_priv_key_", "");
        const pem = localStorage.getItem(keyName) || "";

        const base64 = pem
          .replace(/-----BEGIN PRIVATE KEY-----/, "")
          .replace(/-----END PRIVATE KEY-----/, "")
          .replace(/\s+/g, "");

        try {
          const binaryStr = atob(base64);
          const bytes = new Uint8Array(binaryStr.length);
          for (let j = 0; j < binaryStr.length; j++) {
            bytes[j] = binaryStr.charCodeAt(j);
          }

          const cryptoKey = await window.crypto.subtle.importKey(
            "pkcs8",
            bytes,
            { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
            false,
            ["sign"],
          );

          const encoder = new TextEncoder();
          const data = encoder.encode(text);
          const signatureBuffer = await window.crypto.subtle.sign("RSASSA-PKCS1-v1_5", cryptoKey, data);

          const signatureBytes = new Uint8Array(signatureBuffer);
          const signatureBase64 = btoa(String.fromCharCode(...signatureBytes));

          return { signatureBase64, keyIdString };
        } catch (e) {
          console.error("Signing failed", e);
        }
      }
    }
    return null;
  };

  const handleSubmit = async () => {
    if ((!content.trim() && !artifactId) || !token) return;
    setSubmitting(true);
    try {
      const text = content.trim();
      const signatureObj = await signContent(text);

      const payload: any = {
        content: text,
        artifact_view_id: artifactId,
        quote_post_id: quotePost?.id,
        reply_to_id: replyToPost?.id,
        reply_visibility: replyVisibility,
        metadata: pendingPin ? { spatialPin: pendingPin } : undefined,
      };

      if (signatureObj) {
        payload.client_signature = signatureObj.signatureBase64;
        payload.key_id_string = signatureObj.keyIdString;
      }

      const res = await fetch(`${API_BASE_URL}/social/posts`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        const data = await res.json();
        setContent("");
        setArtifactId(null);
        onPostCreated?.(data.post);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      {showRecipientsModal && replyToPost && (
        <>
          <div
            style={{
              position: "fixed",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              zIndex: 99998,
              backgroundColor: "rgba(0,0,0,0.4)",
            }}
            onClick={() => setShowRecipientsModal(false)}
          />
          <Box
            position="fixed"
            top="50%"
            left="50%"
            style={{
              transform: "translate(-50%, -50%)",
              width: "600px",
              maxWidth: "100%",
              maxHeight: "90vh",
              overflowY: "auto",
            }}
            bg="var(--color-bg-primary)"
            borderRadius="16px"
            zIndex={99999}
            boxShadow="0 4px 12px rgba(0,0,0,0.15)"
            display="flex"
            flexDirection="column"
          >
            <Box display="flex" alignItems="center" px={3} py={2}>
              <IconButton
                icon={() => <XIcon size={20} />}
                variant="invisible"
                onClick={() => setShowRecipientsModal(false)}
                sx={{ color: "var(--color-fg-default)" }}
              />
              <Box flex={1} ml={4}>
                <h2 style={{ fontSize: "18px", margin: 0, fontWeight: "bold" }}>Replying to</h2>
              </Box>
              <TweetButton onClick={() => setShowRecipientsModal(false)} style={{ padding: "6px 16px" }}>
                Done
              </TweetButton>
            </Box>
            <Box p={3}>
              <Box display="flex" alignItems="center" mb={3}>
                <img
                  src={getAvatarUrl(replyToPost.username, replyToPost.avatar_url)}
                  alt="avatar"
                  style={{
                    width: "40px",
                    height: "40px",
                    borderRadius: "50%",
                    flexShrink: 0,
                    objectFit: "cover",
                    backgroundColor: "var(--color-canvas-subtle)",
                    marginRight: "12px",
                  }}
                />
                <Box flex={1}>
                  <div style={{ fontWeight: "bold" }}>{replyToPost.username}</div>
                  <div style={{ color: "var(--color-text-muted)", fontSize: "14px" }}>@{replyToPost.username}</div>
                </Box>
                <Box>
                  <input type="checkbox" checked disabled style={{ width: "20px", height: "20px" }} />
                </Box>
              </Box>

              {allMentionedUsers.length > 1 && (
                <>
                  <Box borderBottom="1px solid var(--color-border-subtle)" my={3} />
                  <Heading as="h3" sx={{ fontSize: "18px", mb: 3 }}>
                    Others in this conversation
                  </Heading>
                  {allMentionedUsers
                    .filter((u) => u !== replyToPost.username)
                    .map((u) => (
                      <Box
                        key={u}
                        display="flex"
                        alignItems="center"
                        mb={3}
                        onClick={() => {
                          const newSet = new Set(excludedUsers);
                          if (newSet.has(u)) newSet.delete(u);
                          else newSet.add(u);
                          setExcludedUsers(newSet);
                        }}
                        style={{ cursor: "pointer" }}
                      >
                        <div
                          style={{
                            width: "40px",
                            height: "40px",
                            borderRadius: "50%",
                            backgroundColor: "var(--color-canvas-subtle)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            color: "var(--color-fg-muted)",
                            fontWeight: "bold",
                            flexShrink: 0,
                            marginRight: "12px",
                          }}
                        >
                          {u.charAt(0).toUpperCase()}
                        </div>
                        <Box flex={1}>
                          <div style={{ fontWeight: "bold" }}>{u}</div>
                          <div style={{ color: "var(--color-text-muted)", fontSize: "14px" }}>@{u}</div>
                        </Box>
                        <Box>
                          <input
                            type="checkbox"
                            checked={!excludedUsers.has(u)}
                            readOnly
                            style={{ width: "20px", height: "20px", pointerEvents: "none", accentColor: "#1d9bf0" }}
                          />
                        </Box>
                      </Box>
                    ))}
                </>
              )}
            </Box>
          </Box>
        </>
      )}
      <Box
        width="100%"
        display={isModal ? "flex" : "block"}
        flexDirection={isModal ? "column" : undefined}
        height={isModal ? "100%" : undefined}
      >
        {replyToPost && (
          <Box
            mb={2}
            ml={13}
            display="flex"
            gap={1}
            fontSize="14px"
            color="var(--color-fg-muted)"
            onClick={() => setShowRecipientsModal(true)}
            style={{ cursor: "pointer" }}
          >
            <span className="handle-text">Replying to</span>
            <span style={{ color: "#1d9bf0", fontWeight: "500" }}>{includedUsers.map((u) => `@${u}`).join(", ")}</span>
          </Box>
        )}
        <Box display="flex" gap={3} width="100%" flex={isModal ? 1 : undefined}>
          <img
            src={getAvatarUrl(user?.username || "?", user?.avatar_url)}
            alt="avatar"
            style={{
              width: 40,
              height: 40,
              borderRadius: "50%",
              flexShrink: 0,
              objectFit: "cover",
              backgroundColor: "var(--color-canvas-subtle)",
            }}
          />
          <Box flex={1} display="flex" flexDirection="column" style={{ minWidth: 0, position: "relative" }}>
            <OverlayWrapper>
              <Backdrop>
                {content.split(/(@\w+)/g).map((part, i) =>
                  part.startsWith("@") ? (
                    <span key={i} style={{ color: "#1d9bf0" }}>
                      {part}
                    </span>
                  ) : (
                    part
                  ),
                )}
                {/* Add an invisible newline if content ends with one so Backdrop height matches textarea */}
                {content.endsWith("\n") && <br />}
              </Backdrop>
              <ComposeInput
                ref={textareaRef}
                value={content}
                onChange={handleContentChange}
                onKeyUp={handleInteraction}
                onClick={handleInteraction}
                placeholder={placeholder || (replyToPost ? "Post your reply" : "What is happening?!")}
                rows={minRows}
                autoFocus={autoFocus}
                style={{ marginBottom: replyToPost ? "0px" : "12px" }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                    handleSubmit();
                  }
                }}
                onBlur={() => setMentionQuery(null)}
              />
            </OverlayWrapper>
            {mentionQuery && mentionSuggestions.length > 0 && (
              <Box
                position="absolute"
                bg="var(--color-canvas-default)"
                border="1px solid var(--color-border)"
                borderRadius="12px"
                boxShadow="0 4px 12px rgba(0,0,0,0.15)"
                zIndex={100}
                top="100%"
                left={0}
                mt={2}
                maxHeight="300px"
                overflow="auto"
                width="300px"
              >
                {mentionSuggestions.map((u) => (
                  <Box
                    key={u.username}
                    display="flex"
                    alignItems="center"
                    p={2}
                    sx={{ cursor: "pointer", "&:hover": { bg: "var(--color-canvas-subtle)" } }}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      insertMention(u.username);
                    }}
                  >
                    <img
                      src={getAvatarUrl(u.username, u.avatar_url)}
                      alt=""
                      style={{
                        width: "32px",
                        height: "32px",
                        borderRadius: "50%",
                        marginRight: "12px",
                        objectFit: "cover",
                      }}
                    />
                    <Box>
                      <div style={{ fontWeight: "bold", fontSize: "14px", color: "var(--color-fg-default)" }}>
                        {u.display_name || u.username}
                      </div>
                      <div style={{ fontSize: "13px", color: "var(--color-text-muted)" }}>@{u.username}</div>
                    </Box>
                  </Box>
                ))}
              </Box>
            )}
            {artifactId !== null && (
              <div
                style={{
                  position: "relative",
                  marginTop: "8px",
                  marginBottom: "8px",
                  borderRadius: "12px",
                  overflow: "hidden",
                  border: "1px solid var(--color-border-subtle)",
                }}
              >
                <ArtifactViewCard artifactId={artifactId} />
                <div style={{ position: "absolute", top: "8px", right: "8px", zIndex: 10 }}>
                  <IconButton
                    icon={XIcon}
                    variant="invisible"
                    onClick={() => setArtifactId(null)}
                    aria-label="Remove artifact"
                    sx={{
                      backgroundColor: "rgba(0, 0, 0, 0.75) !important",
                      color: "white !important",
                      border: "none !important",
                      boxShadow: "none !important",
                      borderRadius: "50%",
                      width: "32px",
                      height: "32px",
                      "&:hover": { backgroundColor: "rgba(0, 0, 0, 0.9) !important" },
                    }}
                  />
                </div>
              </div>
            )}

            {pendingPin && (
              <Box
                mb={2}
                p={2}
                border="1px solid var(--color-border-subtle)"
                borderRadius="8px"
                backgroundColor="var(--color-canvas-subtle)"
              >
                <span style={{ fontSize: "12px", color: "var(--color-fg-muted)" }}>
                  📍 Pinned to <b>{pendingPin.fieldName}</b> = {pendingPin.scalarValue.toFixed(2)}
                </span>
              </Box>
            )}

            {quotePost && (
              <QuoteWrapper>
                <Box display="flex" alignItems="center" gap={1} mb={1}>
                  <span style={{ fontWeight: "bold", fontSize: "14px" }}>
                    {quotePost.display_name || quotePost.username}
                  </span>
                  <span style={{ color: "var(--color-fg-muted)", fontSize: "14px" }}>@{quotePost.username}</span>
                  <span style={{ color: "var(--color-fg-muted)", fontSize: "14px", margin: "0 4px" }}>·</span>
                  <span style={{ color: "var(--color-fg-muted)", fontSize: "14px" }}>
                    {formatRelativeTime(quotePost.created_at)}
                  </span>
                </Box>
                <span style={{ fontSize: "14px" }}>{quotePost.content}</span>
              </QuoteWrapper>
            )}

            {!replyToPost && (
              <Box style={{ position: "relative", width: "fit-content" }}>
                <Box
                  mt={2}
                  mb={2}
                  display="flex"
                  alignItems="center"
                  gap={2}
                  style={{ cursor: "pointer", width: "fit-content" }}
                  onClick={() => setShowVisibilityMenu(!showVisibilityMenu)}
                >
                  {replyVisibility === "everyone" && <GlobeIcon size={16} style={{ color: "#1d9bf0" }} />}
                  {replyVisibility === "following" && <PersonIcon size={16} style={{ color: "#1d9bf0" }} />}
                  {replyVisibility === "mentioned" && <MentionIcon size={16} style={{ color: "#1d9bf0" }} />}
                  <span style={{ color: "#1d9bf0", fontWeight: "bold", fontSize: "14px" }}>
                    {replyVisibility === "everyone" && "Everyone can reply"}
                    {replyVisibility === "following" && "Accounts you follow can reply"}
                    {replyVisibility === "mentioned" && "Only accounts you mention can reply"}
                  </span>
                </Box>
                {showVisibilityMenu && (
                  <>
                    <div
                      style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, zIndex: 99 }}
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowVisibilityMenu(false);
                      }}
                    />
                    <Box
                      position="absolute"
                      top="100%"
                      left={0}
                      bg="var(--color-bg-primary)"
                      border="1px solid var(--color-border-subtle)"
                      borderRadius="16px"
                      boxShadow="0 4px 12px rgba(0,0,0,0.15)"
                      zIndex={100}
                      width="280px"
                      py={2}
                    >
                      <Box px={3} pb={2} borderBottom="1px solid var(--color-border-subtle)" mb={2}>
                        <Text style={{ fontWeight: "bold", fontSize: "15px" }}>Who can reply?</Text>
                      </Box>
                      <Box
                        display="flex"
                        alignItems="center"
                        gap={3}
                        px={3}
                        py={2}
                        style={{ cursor: "pointer" }}
                        sx={{ "&:hover": { backgroundColor: "var(--color-canvas-subtle)" } }}
                        onClick={() => {
                          setReplyVisibility("everyone");
                          setShowVisibilityMenu(false);
                        }}
                      >
                        <Box
                          display="flex"
                          alignItems="center"
                          justifyContent="center"
                          width="36px"
                          height="36px"
                          borderRadius="50%"
                          bg="#1d9bf0"
                          color="white"
                        >
                          <GlobeIcon size={20} />
                        </Box>
                        <Text flex={1} style={{ fontWeight: "bold", fontSize: "15px" }}>
                          Everyone
                        </Text>
                        {replyVisibility === "everyone" ? (
                          <CheckCircleIcon size={20} style={{ color: "#1d9bf0" }} />
                        ) : (
                          <CircleIcon size={20} style={{ color: "var(--color-fg-muted)" }} />
                        )}
                      </Box>
                      <Box
                        display="flex"
                        alignItems="center"
                        gap={3}
                        px={3}
                        py={2}
                        style={{ cursor: "pointer" }}
                        sx={{ "&:hover": { backgroundColor: "var(--color-canvas-subtle)" } }}
                        onClick={() => {
                          setReplyVisibility("following");
                          setShowVisibilityMenu(false);
                        }}
                      >
                        <Box
                          display="flex"
                          alignItems="center"
                          justifyContent="center"
                          width="36px"
                          height="36px"
                          borderRadius="50%"
                          bg="#1d9bf0"
                          color="white"
                        >
                          <PersonIcon size={20} />
                        </Box>
                        <Text flex={1} style={{ fontWeight: "bold", fontSize: "15px" }}>
                          Accounts you follow
                        </Text>
                        {replyVisibility === "following" ? (
                          <CheckCircleIcon size={20} style={{ color: "#1d9bf0" }} />
                        ) : (
                          <CircleIcon size={20} style={{ color: "var(--color-fg-muted)" }} />
                        )}
                      </Box>
                      <Box
                        display="flex"
                        alignItems="center"
                        gap={3}
                        px={3}
                        py={2}
                        style={{ cursor: "pointer" }}
                        sx={{ "&:hover": { backgroundColor: "var(--color-canvas-subtle)" } }}
                        onClick={() => {
                          setReplyVisibility("mentioned");
                          setShowVisibilityMenu(false);
                        }}
                      >
                        <Box
                          display="flex"
                          alignItems="center"
                          justifyContent="center"
                          width="36px"
                          height="36px"
                          borderRadius="50%"
                          bg="#1d9bf0"
                          color="white"
                        >
                          <MentionIcon size={20} />
                        </Box>
                        <Text flex={1} style={{ fontWeight: "bold", fontSize: "15px" }}>
                          Only accounts you mention
                        </Text>
                        {replyVisibility === "mentioned" ? (
                          <CheckCircleIcon size={20} style={{ color: "#1d9bf0" }} />
                        ) : (
                          <CircleIcon size={20} style={{ color: "var(--color-fg-muted)" }} />
                        )}
                      </Box>
                    </Box>
                  </>
                )}
              </Box>
            )}

            <Box
              style={{
                position: "sticky",
                bottom: "0px",
                backgroundColor: "var(--color-bg-primary)",
                zIndex: 10,
                paddingBottom: "0px",
                paddingTop: "12px",
                borderTop: isModal ? "none" : "1px solid var(--color-border)",
                marginTop: isModal ? "auto" : undefined,
              }}
            >
              <Box display="flex" justifyContent="space-between" alignItems="center">
                <Box display="flex" gap={2} alignItems="center">
                  <ActionIconButton
                    onClick={() => createDummyArtifact("modelica-code")}
                    disabled={artifactId !== null}
                    aria-label="Add Code"
                    title="Add Code"
                  >
                    <CodeIcon size={20} />
                  </ActionIconButton>
                  <input
                    type="file"
                    style={{ display: "none" }}
                    ref={fileInputRef}
                    accept=".usdz,.usd,.usda,.glb,.gltf,image/*,video/*,audio/*,.pdf,.step,.stp,.csv,.mo,.tei,.xml"
                    onChange={handleFileUpload}
                    disabled={artifactId !== null || uploadingFile}
                  />
                  <ActionIconButton
                    onClick={() => fileInputRef.current?.click()}
                    disabled={artifactId !== null || uploadingFile}
                    aria-label="Upload Media"
                    title="Upload Media (Images, Videos, USDZ 3D, CAD, PDFs, CSV, TEI)"
                  >
                    <ImageIcon size={20} />
                  </ActionIconButton>
                  <div style={{ position: "relative" }}>
                    <ActionIconButton
                      onClick={() => setShowEmojiPicker((prev) => !prev)}
                      aria-label="Add Emoji"
                      title="Add Emoji"
                    >
                      <SmileyIcon size={20} />
                    </ActionIconButton>
                    {showEmojiPicker && (
                      <>
                        <div
                          style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, zIndex: 999 }}
                          onClick={(e) => {
                            e.stopPropagation();
                            setShowEmojiPicker(false);
                          }}
                        />
                        <div style={{ position: "absolute", top: "100%", zIndex: 1000, marginTop: "8px" }}>
                          <SimpleEmojiPicker
                            onEmojiClick={(emojiData) => {
                              setContent((prev) => prev + emojiData.emoji);
                            }}
                          />
                        </div>
                      </>
                    )}
                  </div>
                  <ActionIconButton
                    onClick={() => createDummyArtifact("simulation-plot")}
                    disabled={artifactId !== null}
                    aria-label="Add Params"
                    title="Add Params"
                  >
                    <SlidersIcon size={20} />
                  </ActionIconButton>
                  <ActionIconButton
                    onClick={() => createDummyArtifact("tei-document")}
                    disabled={artifactId !== null}
                    aria-label="Add TEI Document"
                    title="Add TEI Document"
                  >
                    <BookIcon size={20} />
                  </ActionIconButton>
                  {uploadingFile && (
                    <span style={{ fontSize: "12px", color: "var(--color-fg-muted)", marginLeft: "8px" }}>
                      Uploading...
                    </span>
                  )}
                </Box>
                <TweetButton onClick={handleSubmit} disabled={(!content.trim() && !artifactId) || submitting}>
                  {replyToPost ? "Reply" : "Post"}
                </TweetButton>
              </Box>
            </Box>
          </Box>
        </Box>
      </Box>
    </>
  );
}
