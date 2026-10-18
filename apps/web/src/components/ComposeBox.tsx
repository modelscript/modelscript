// SPDX-License-Identifier: AGPL-3.0-or-later

/* eslint-disable */
import {
  BeakerIcon,
  BookIcon,
  CheckCircleIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  CircleIcon,
  CodeIcon,
  GlobeIcon,
  ImageIcon,
  MentionIcon,
  PackageIcon,
  PaperclipIcon,
  PersonIcon,
  PinIcon,
  PlusIcon,
  PulseIcon,
  ServerIcon,
  SlidersIcon,
  SmileyIcon,
  SparkleIcon,
  TrashIcon,
  XIcon,
  ZapIcon,
} from "@primer/octicons-react";
import { Heading, IconButton, Text } from "@primer/react";
import React, { useEffect, useMemo, useRef, useState } from "react";
import styled from "styled-components";
import {
  createArtifactView,
  createPost,
  getTrending,
  getUserFollowers,
  resolveFederatedActor,
  uploadStorageFile,
} from "../api";
import { useAuth } from "../AuthContext";
import { useFeatureFlag } from "../FeatureFlagContext";
import { getAvatarUrl } from "../util/avatar";
import { getAllPrivateKeyIds, getPrivateKey, migrateLegacyKeys } from "../util/keystore";
import {
  createCellId,
  extractArtifactIdsFromCells,
  hasArtifactDirectives,
  type NotebookCell,
  parseNotebookFromContent,
  serializeCellsToMarkdown,
} from "../util/notebook";
import ArtifactViewCard from "./artifacts/ArtifactViewCard";
import Box from "./Box";
import HpcArtifactPickerModal from "./HpcArtifactPickerModal";
import MorselComposeModal from "./MorselComposeModal";
import PackageRepoPickerModal from "./PackageRepoPickerModal";
import SimpleEmojiPicker from "./SimpleEmojiPicker";

const TweetButton = styled.button`
  background: var(--gradient-cta);
  color: white;
  border: none;
  border-radius: 8px;
  padding: 8px 18px;
  font-size: 13.5px;
  font-weight: 600;
  font-family: inherit;
  letter-spacing: -0.01em;
  cursor: pointer;
  box-shadow: 0 0 12px rgba(139, 92, 246, 0.35);
  transition: all 0.2s ease;

  &:hover:not(:disabled) {
    box-shadow: 0 0 18px rgba(6, 182, 212, 0.5);
    transform: translateY(-1px);
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
    box-shadow: none;
    background: var(--color-btn-disabled-bg, rgba(255, 255, 255, 0.08));
    color: var(--color-text-muted);
    border: 1px solid var(--color-border-subtle);
  }
`;

const CommandPill = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-family: var(--font-mono, monospace);
  font-size: 11px;
  font-weight: 500;
  color: var(--color-text-secondary);
  background: var(--color-canvas-subtle, rgba(255, 255, 255, 0.04));
  border: 1px solid var(--color-border-default, rgba(255, 255, 255, 0.1));
  padding: 3px 8px;
  border-radius: 6px;
  cursor: pointer;
  outline: none;
  transition: all 0.15s cubic-bezier(0.16, 1, 0.3, 1);
  white-space: nowrap;

  &:hover {
    color: var(--color-text-heading);
    background: var(--surface-row-hover, rgba(255, 255, 255, 0.08));
    border-color: var(--color-border-strong, rgba(255, 255, 255, 0.25));
    transform: translateY(-1px);
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.08);
  }

  .pill-icon {
    display: inline-flex;
    align-items: center;
    color: var(--color-accent-cyan);
    opacity: 0.85;
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
  color: var(--color-text-muted);
  transition: all 0.2s ease;
  padding: 0;

  &:hover:not(:disabled) {
    background-color: rgba(6, 182, 212, 0.12);
    color: var(--color-accent-cyan);
  }

  &:disabled {
    opacity: 0.4;
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
    color: var(--color-text-muted);
    -webkit-text-fill-color: var(--color-text-muted);
    opacity: 1;
  }
`;

const QuoteWrapper = styled.div`
  margin-top: 8px;
  padding: 12px;
  border: 1px solid var(--color-border);
  border-radius: 12px;
  background-color: rgba(255, 255, 255, 0.02);
`;

const NotebookContainer = styled.div`
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 12px;
`;

const NotebookTitleInput = styled.input`
  width: 100%;
  padding: 10px 14px;
  font-size: 18px;
  font-weight: 700;
  color: var(--color-fg-default);
  background: rgba(139, 92, 246, 0.06);
  border: 1px solid rgba(139, 92, 246, 0.28);
  border-radius: 10px;
  outline: none;
  box-sizing: border-box;
  font-family: inherit;
  transition:
    border-color 0.15s ease,
    box-shadow 0.15s ease;

  &:focus {
    border-color: var(--color-accent-cyan);
    box-shadow: 0 0 0 2px rgba(6, 182, 212, 0.15);
  }

  &::placeholder {
    color: var(--color-text-muted);
    font-weight: 500;
  }
`;

const NotebookCellCard = styled.div<{ $active?: boolean | undefined; $isArtifact?: boolean | undefined }>`
  border: 1px solid
    ${(props) =>
      props.$active
        ? "var(--color-accent-cyan, #06b6d4)"
        : props.$isArtifact
          ? "rgba(139, 92, 246, 0.28)"
          : "var(--color-border-default, rgba(255, 255, 255, 0.12))"};
  border-radius: 12px;
  background: ${(props) => (props.$isArtifact ? "rgba(139, 92, 246, 0.04)" : "rgba(255, 255, 255, 0.02)")};
  overflow: hidden;
  transition:
    border-color 0.15s ease,
    box-shadow 0.15s ease;
`;

const NotebookCellHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 5px 10px;
  background: rgba(255, 255, 255, 0.03);
  border-bottom: 1px solid var(--color-border-subtle, rgba(255, 255, 255, 0.08));
  font-family: var(--font-mono, monospace);
  font-size: 11px;
  color: var(--color-text-muted);
`;

const CellActionBtn = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: transparent;
  border: 1px solid transparent;
  color: var(--color-text-muted);
  font-family: var(--font-mono, monospace);
  font-size: 11px;
  padding: 2px 6px;
  border-radius: 5px;
  cursor: pointer;
  transition: all 0.15s ease;

  &:hover:not(:disabled) {
    color: var(--color-fg-default);
    background: rgba(255, 255, 255, 0.08);
    border-color: rgba(255, 255, 255, 0.12);
  }

  &:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }
`;

const NotebookCellTextarea = styled.textarea`
  width: 100%;
  border: none;
  outline: none;
  font-size: 15.5px;
  line-height: 1.55;
  padding: 10px 12px;
  resize: vertical;
  min-height: 68px;
  background: transparent;
  color: var(--color-fg-default);
  font-family: inherit;
  box-sizing: border-box;

  &::placeholder {
    color: var(--color-text-muted);
  }
`;

const ArtifactCaptionInput = styled.input`
  width: 100%;
  border: none;
  border-top: 1px solid var(--color-border-subtle, rgba(255, 255, 255, 0.08));
  outline: none;
  font-size: 12.5px;
  padding: 8px 12px;
  background: rgba(0, 0, 0, 0.2);
  color: var(--color-fg-default);
  font-family: inherit;
  box-sizing: border-box;

  &::placeholder {
    color: var(--color-text-muted);
  }
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
  onPostCreated?: ((post: any) => void) | undefined;
  quotePost?: any;
  replyToPost?: any;
  placeholder?: string | undefined;
  minRows?: number | undefined;
  autoFocus?: boolean | undefined;
  pendingPin?: SpatialPin | undefined;
  content?: string | undefined;
  setContent?: ((val: string) => void) | undefined;
  artifactId?: number | null | undefined;
  setArtifactId?: ((val: number | null) => void) | undefined;
  isModal?: boolean | undefined;
  notebookMode?: boolean | undefined;
  setNotebookMode?: ((val: boolean) => void) | undefined;
  notebookTitle?: string | undefined;
  setNotebookTitle?: ((val: string) => void) | undefined;
  notebookCells?: NotebookCell[] | undefined;
  setNotebookCells?: ((cells: NotebookCell[]) => void) | undefined;
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
  notebookMode: controlledNotebookMode,
  setNotebookMode: setControlledNotebookMode,
  notebookTitle: controlledNotebookTitle,
  setNotebookTitle: setControlledNotebookTitle,
  notebookCells: controlledNotebookCells,
  setNotebookCells: setControlledNotebookCells,
}: ComposeBoxProps) {
  const { user, token } = useAuth();

  const [internalContent, setInternalContent] = useState("");
  const content = controlledContent !== undefined ? controlledContent : internalContent;
  const setContent = setControlledContent || setInternalContent;

  const [internalArtifactId, setInternalArtifactId] = useState<number | null>(null);
  const artifactId = controlledArtifactId !== undefined ? controlledArtifactId : internalArtifactId;
  const setArtifactId = setControlledArtifactId || setInternalArtifactId;

  const [internalNotebookMode, setInternalNotebookMode] = useState(false);
  const isNotebookMode = controlledNotebookMode !== undefined ? controlledNotebookMode : internalNotebookMode;
  const setIsNotebookMode = setControlledNotebookMode || setInternalNotebookMode;

  const [internalNotebookTitle, setInternalNotebookTitle] = useState("");
  const notebookTitle = controlledNotebookTitle !== undefined ? controlledNotebookTitle : internalNotebookTitle;
  const setNotebookTitle = setControlledNotebookTitle || setInternalNotebookTitle;

  const [internalNotebookCells, setInternalNotebookCells] = useState<NotebookCell[]>([
    { id: createCellId("md"), type: "markdown", content: "" },
  ]);
  const notebookCells = controlledNotebookCells !== undefined ? controlledNotebookCells : internalNotebookCells;
  const setNotebookCells = setControlledNotebookCells || setInternalNotebookCells;

  const [activeCellId, setActiveCellId] = useState<string | null>(null);
  const [pendingInsertAfterCellId, setPendingInsertAfterCellId] = useState<string | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showContentWarning, setShowContentWarning] = useState(false);
  const [contentWarning, setContentWarning] = useState("");
  const [showHpcPicker, setShowHpcPicker] = useState(false);
  const [showMorselModal, setShowMorselModal] = useState(false);
  const [showPackageRepoPicker, setShowPackageRepoPicker] = useState(false);
  const hasHpc = useFeatureFlag("cae_cloud_solver");
  const hasExperimental = useFeatureFlag("experimental_viewers");
  const [replyVisibility, setReplyVisibility] = useState<"everyone" | "following" | "mentioned">("everyone");
  const [showVisibilityMenu, setShowVisibilityMenu] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const syncNotebookToContentAndArtifact = (cells: NotebookCell[], title: string) => {
    setNotebookCells(cells);
    const serialized = serializeCellsToMarkdown(cells, title);
    setContent(serialized);
    const artIds = extractArtifactIdsFromCells(cells);
    setArtifactId(artIds[0] ?? null);
  };

  const handleToggleNotebookMode = () => {
    if (!isNotebookMode) {
      const parsed = parseNotebookFromContent(content, artifactId);
      const nextCells = [...parsed.cells];
      if (nextCells.length === 0 || nextCells[nextCells.length - 1]!.type === "artifact") {
        nextCells.push({ id: createCellId("md"), type: "markdown", content: "" });
      }
      if (parsed.title && !notebookTitle) {
        setNotebookTitle(parsed.title);
      }
      setNotebookCells(nextCells);
      setActiveCellId(nextCells[nextCells.length - 1]?.id || null);
      setIsNotebookMode(true);
    } else {
      const serialized = serializeCellsToMarkdown(notebookCells, notebookTitle);
      setContent(serialized);
      const artIds = extractArtifactIdsFromCells(notebookCells);
      setArtifactId(artIds[0] ?? null);
      setIsNotebookMode(false);
    }
  };

  const updateMarkdownCell = (cellId: string, newText: string) => {
    const nextCells = notebookCells.map((c) =>
      c.id === cellId && c.type === "markdown" ? { ...c, content: newText } : c,
    );
    syncNotebookToContentAndArtifact(nextCells, notebookTitle);
  };

  const updateArtifactCellCaption = (cellId: string, caption: string) => {
    const nextCells = notebookCells.map((c) => (c.id === cellId && c.type === "artifact" ? { ...c, caption } : c));
    syncNotebookToContentAndArtifact(nextCells, notebookTitle);
  };

  const addMarkdownCellAfter = (afterCellId?: string | null) => {
    const newCell: NotebookCell = { id: createCellId("md"), type: "markdown", content: "" };
    const nextCells = [...notebookCells];
    if (afterCellId) {
      const idx = nextCells.findIndex((c) => c.id === afterCellId);
      if (idx !== -1) {
        nextCells.splice(idx + 1, 0, newCell);
      } else {
        nextCells.push(newCell);
      }
    } else {
      nextCells.push(newCell);
    }
    syncNotebookToContentAndArtifact(nextCells, notebookTitle);
    setActiveCellId(newCell.id);
  };

  const moveCell = (cellId: string, direction: -1 | 1) => {
    const idx = notebookCells.findIndex((c) => c.id === cellId);
    if (idx === -1) return;
    const targetIdx = idx + direction;
    if (targetIdx < 0 || targetIdx >= notebookCells.length) return;
    const nextCells = [...notebookCells];
    const [removed] = nextCells.splice(idx, 1);
    nextCells.splice(targetIdx, 0, removed!);
    syncNotebookToContentAndArtifact(nextCells, notebookTitle);
  };

  const removeCell = (cellId: string) => {
    const nextCells = notebookCells.filter((c) => c.id !== cellId);
    if (nextCells.length === 0) {
      nextCells.push({ id: createCellId("md"), type: "markdown", content: "" });
    }
    syncNotebookToContentAndArtifact(nextCells, notebookTitle);
  };

  const attachArtifactToComposer = (newArtifactId: number, title?: string, suggestedCaption?: string) => {
    if (!isNotebookMode && artifactId === null && !hasArtifactDirectives(content)) {
      setArtifactId(newArtifactId);
      if (!content.trim() && suggestedCaption) {
        setContent(suggestedCaption);
      }
      return;
    }

    // Either already in Notebook Mode or attaching a 2nd+ artifact: build/update cells
    const baseCells = isNotebookMode ? [...notebookCells] : parseNotebookFromContent(content, artifactId).cells;

    const newArtCell: NotebookCell = {
      id: createCellId("art"),
      type: "artifact",
      artifactId: newArtifactId,
      ...(title ? { title } : {}),
      ...(suggestedCaption ? { caption: suggestedCaption } : {}),
    };

    const insertAfterId = pendingInsertAfterCellId || activeCellId;
    if (insertAfterId) {
      const idx = baseCells.findIndex((c) => c.id === insertAfterId);
      if (idx !== -1) {
        baseCells.splice(idx + 1, 0, newArtCell);
      } else {
        baseCells.push(newArtCell);
      }
    } else {
      baseCells.push(newArtCell);
    }

    // Ensure there's always a trailing markdown cell so the user can keep typing below the artifact
    if (baseCells.length === 0 || baseCells[baseCells.length - 1]!.type === "artifact") {
      baseCells.push({ id: createCellId("md"), type: "markdown", content: "" });
    }

    setPendingInsertAfterCellId(null);
    if (!isNotebookMode) {
      setIsNotebookMode(true);
    }
    syncNotebookToContentAndArtifact(baseCells, notebookTitle);
  };

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
    const matches = (replyToPost.content?.match(/@([a-zA-Z0-9_.-]+(?:@[a-zA-Z0-9_.-]+)?)/g) || []).map((m: string) =>
      m.slice(1),
    );
    const unique = Array.from(new Set([replyToPost.username, ...matches])).filter((u) => u !== user?.username);
    return unique;
  }, [replyToPost, user?.username]);

  const [followers, setFollowers] = useState<any[]>([]);
  const [mentionQuery, setMentionQuery] = useState<{ query: string; index: number } | null>(null);
  const [hashtagQuery, setHashtagQuery] = useState<{ query: string; index: number } | null>(null);
  const [trendingTopics, setTrendingTopics] = useState<any[]>([]);
  const [remoteActorSuggestions, setRemoteActorSuggestions] = useState<Map<string, any>>(new Map());

  useEffect(() => {
    if (user?.username && token) {
      getUserFollowers(user.username)
        .then((d) => {
          if (d.followers) setFollowers(d.followers);
        })
        .catch(console.error);
    }
    getTrending(20)
      .then((d) => {
        if (d.topics) setTrendingTopics(d.topics);
      })
      .catch(console.error);
  }, [user, token]);

  useEffect(() => {
    if (!mentionQuery || !mentionQuery.query.includes("@")) return;
    const handle = mentionQuery.query;
    const parts = handle.split("@");
    if (parts.length < 2 || !parts[0] || parts[1]!.length < 2) return;

    const timer = setTimeout(() => {
      resolveFederatedActor(handle)
        .then((res) => {
          if (res?.user) {
            setRemoteActorSuggestions((prev) => new Map(prev).set(res.user.username.toLowerCase(), res.user));
          }
        })
        .catch(() => {});
    }, 350);

    return () => clearTimeout(timer);
  }, [mentionQuery]);

  const mentionSuggestions = useMemo(() => {
    if (!mentionQuery) return [];
    const matches = (content.match(/@([a-zA-Z0-9_.-]+(?:@[a-zA-Z0-9_.-]+)?)/g) || []).map((m: string) => m.slice(1));
    const allUsers = new Map<string, any>();

    followers.forEach((f) => allUsers.set(f.username.toLowerCase(), f));
    allMentionedUsers.forEach((u) => {
      if (!allUsers.has(u.toLowerCase())) allUsers.set(u.toLowerCase(), { username: u });
    });
    matches.forEach((u) => {
      if (!allUsers.has(u.toLowerCase())) allUsers.set(u.toLowerCase(), { username: u });
    });
    remoteActorSuggestions.forEach((u, k) => {
      allUsers.set(k, u);
    });

    const q = mentionQuery.query.toLowerCase();
    return Array.from(allUsers.values())
      .filter((u) => u.username.toLowerCase().includes(q) || u.display_name?.toLowerCase().includes(q))
      .slice(0, 15);
  }, [mentionQuery, followers, allMentionedUsers, content, remoteActorSuggestions]);

  const hashtagSuggestions = useMemo(() => {
    if (!hashtagQuery) return [];
    const q = hashtagQuery.query.toLowerCase();
    return trendingTopics.filter((t) => (t.displayName || t.concept || "").toLowerCase().includes(q)).slice(0, 10);
  }, [hashtagQuery, trendingTopics]);

  const updateTokenState = (val: string, cursor: number) => {
    const textBeforeCursor = val.slice(0, cursor);
    const mentionMatch = textBeforeCursor.match(/(?:^|\s)@([a-zA-Z0-9_.-]+(?:@[a-zA-Z0-9_.-]*)?)$/);
    if (mentionMatch) {
      const atIndex = textBeforeCursor.lastIndexOf("@");
      setMentionQuery({ query: mentionMatch[1]!, index: atIndex });
      setHashtagQuery(null);
      return;
    } else {
      setMentionQuery(null);
    }

    const hashMatch = textBeforeCursor.match(/(?:^|\s)#([a-zA-Z0-9_-]*)$/);
    if (hashMatch) {
      const hashIndex = textBeforeCursor.lastIndexOf("#");
      setHashtagQuery({ query: hashMatch[1]!, index: hashIndex });
    } else {
      setHashtagQuery(null);
    }
  };

  const handleContentChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setContent(e.target.value);
    updateTokenState(e.target.value, e.target.selectionStart);
  };

  const handleInteraction = (e: React.SyntheticEvent<HTMLTextAreaElement>) => {
    updateTokenState(e.currentTarget.value, e.currentTarget.selectionStart || 0);
  };

  const insertMention = (username: string) => {
    if (!mentionQuery) return;
    if (isNotebookMode && activeCellId) {
      const targetCell = notebookCells.find((c) => c.id === activeCellId);
      if (targetCell && targetCell.type === "markdown") {
        const before = targetCell.content.slice(0, mentionQuery.index);
        const after = targetCell.content.slice(mentionQuery.index + mentionQuery.query.length + 1);
        updateMarkdownCell(activeCellId, `${before}@${username} ${after}`);
        setMentionQuery(null);
        return;
      }
    }
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

  const insertHashtag = (tag: string) => {
    if (!hashtagQuery) return;
    if (isNotebookMode && activeCellId) {
      const targetCell = notebookCells.find((c) => c.id === activeCellId);
      if (targetCell && targetCell.type === "markdown") {
        const before = targetCell.content.slice(0, hashtagQuery.index);
        const after = targetCell.content.slice(hashtagQuery.index + hashtagQuery.query.length + 1);
        updateMarkdownCell(activeCellId, `${before}#${tag} ${after}`);
        setHashtagQuery(null);
        return;
      }
    }
    const before = content.slice(0, hashtagQuery.index);
    const after = content.slice(textareaRef.current?.selectionStart || content.length);
    const newContent = `${before}#${tag} ${after}`;
    setContent(newContent);
    setHashtagQuery(null);
    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
        const newCursor = before.length + tag.length + 2;
        textareaRef.current.setSelectionRange(newCursor, newCursor);
      }
    }, 0);
  };

  const includedUsers = useMemo(() => {
    return allMentionedUsers.filter((u) => !excludedUsers.has(u));
  }, [allMentionedUsers, excludedUsers]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!token || !e.target.files || e.target.files.length === 0) return;
    const file = e.target.files[0]!;
    setUploadingFile(true);
    try {
      const formData = new FormData();
      formData.append("file", file);

      const uploadData = await uploadStorageFile(formData);
      const view_config = JSON.stringify({ url: uploadData.url });

      const artifactData = await createArtifactView({
        artifact_type: uploadData.view_type,
        view_config,
        title: file.name,
      });
      attachArtifactToComposer(artifactData.id, file.name);
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

      const title = `Example ${type}`;
      const data = await createArtifactView({
        artifact_type: type,
        view_config,
        title,
      });
      attachArtifactToComposer(data.id, title);
    } catch (err) {
      console.error(err);
    }
  };

  const signContent = async (text: string) => {
    try {
      await migrateLegacyKeys();
      const keyIds = await getAllPrivateKeyIds();
      if (keyIds.length === 0) return null;

      const keyIdString = keyIds[0]!;
      const cryptoKey = await getPrivateKey(keyIdString);
      if (!cryptoKey) return null;

      const encoder = new TextEncoder();
      const data = encoder.encode(text);
      const signatureBuffer = await window.crypto.subtle.sign("RSASSA-PKCS1-v1_5", cryptoKey, data);

      const signatureBytes = new Uint8Array(signatureBuffer);
      const signatureBase64 = btoa(String.fromCharCode(...signatureBytes));

      return { signatureBase64, keyIdString };
    } catch (e) {
      console.error("Signing failed", e);
      return null;
    }
  };

  const hasNotebookContent =
    isNotebookMode &&
    (notebookTitle.trim().length > 0 ||
      notebookCells.some((c) => (c.type === "markdown" ? c.content.trim().length > 0 : Boolean(c.artifactId))));

  const handleSubmit = async () => {
    if ((!content.trim() && !artifactId && !hasNotebookContent) || !token) return;
    setSubmitting(true);
    try {
      const effectiveCells = isNotebookMode
        ? notebookCells.filter((c) => (c.type === "markdown" ? c.content.trim().length > 0 : Boolean(c.artifactId)))
        : hasArtifactDirectives(content)
          ? parseNotebookFromContent(content, artifactId).cells
          : null;

      const effectiveArtIds = effectiveCells ? extractArtifactIdsFromCells(effectiveCells) : [];
      const primaryArtifactId = effectiveArtIds[0] ?? artifactId ?? undefined;
      const text = isNotebookMode
        ? serializeCellsToMarkdown(effectiveCells || [], notebookTitle).trim()
        : content.trim();

      const signatureObj = await signContent(text);

      const notebookPayload =
        effectiveCells && (isNotebookMode || effectiveArtIds.length > 1 || hasArtifactDirectives(text))
          ? {
              isNotebook: true,
              ...(notebookTitle.trim() ? { title: notebookTitle.trim() } : {}),
              cells: effectiveCells,
              artifactIds: effectiveArtIds,
            }
          : undefined;

      const payload: any = {
        content: text,
        content_warning: contentWarning.trim() || undefined,
        artifact_view_id: primaryArtifactId,
        quote_post_id: quotePost?.id,
        reply_to_id: replyToPost?.id,
        reply_visibility: replyVisibility,
        ...(notebookPayload ? { notebook: notebookPayload } : {}),
        metadata: {
          ...(pendingPin ? { spatialPin: pendingPin } : {}),
          ...(contentWarning.trim() ? { contentWarning: contentWarning.trim() } : {}),
          ...(notebookPayload ? { notebook: notebookPayload } : {}),
        },
      };

      if (signatureObj) {
        payload.client_signature = signatureObj.signatureBase64;
        payload.key_id_string = signatureObj.keyIdString;
      }

      const data = await createPost(payload);
      setContent("");
      setContentWarning("");
      setShowContentWarning(false);
      setArtifactId(null);
      setNotebookTitle("");
      setNotebookCells([{ id: createCellId("md"), type: "markdown", content: "" }]);
      setIsNotebookMode(false);
      onPostCreated?.(data.post);
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
              backgroundColor: "rgba(0, 0, 0, 0.7)",
              backdropFilter: "blur(6px)",
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
              maxWidth: "92vw",
              maxHeight: "90vh",
              overflowY: "auto",
              backdropFilter: "blur(16px)",
            }}
            bg="var(--surface-overlay)"
            border="1px solid var(--color-border-glass)"
            borderRadius="16px"
            zIndex={99999}
            boxShadow="0 20px 50px rgba(0,0,0,0.6)"
            display="flex"
            flexDirection="column"
          >
            <Box display="flex" alignItems="center" px={3} py={2} borderBottom="1px solid var(--color-border)">
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
                    backgroundColor: "rgba(255, 255, 255, 0.05)",
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
                  <Box borderBottom="1px solid var(--color-border)" my={3} />
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
                            backgroundColor: "rgba(255, 255, 255, 0.05)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            color: "var(--color-text-muted)",
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
                            style={{
                              width: "20px",
                              height: "20px",
                              pointerEvents: "none",
                              accentColor: "var(--color-accent-cyan)",
                            }}
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
            color="var(--color-text-muted)"
            onClick={() => setShowRecipientsModal(true)}
            style={{ cursor: "pointer" }}
          >
            <span className="handle-text">Replying to</span>
            <span style={{ color: "var(--color-accent-cyan)", fontWeight: "500" }}>
              {includedUsers.map((u) => `@${u}`).join(", ")}
            </span>
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
              backgroundColor: "rgba(255, 255, 255, 0.05)",
            }}
          />
          <Box flex={1} display="flex" flexDirection="column" style={{ minWidth: 0, position: "relative" }}>
            {showContentWarning && (
              <Box mb={2}>
                <input
                  type="text"
                  placeholder="Content warning / sensitive summary..."
                  value={contentWarning}
                  onChange={(e) => setContentWarning(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "8px 12px",
                    background: "rgba(210, 153, 34, 0.08)",
                    border: "1px solid rgba(210, 153, 34, 0.3)",
                    borderRadius: "8px",
                    color: "var(--color-fg-default)",
                    fontSize: "14px",
                    outline: "none",
                    boxSizing: "border-box",
                  }}
                />
              </Box>
            )}
            {isNotebookMode ? (
              <NotebookContainer>
                <Box
                  display="flex"
                  alignItems="center"
                  justifyContent="space-between"
                  px={2}
                  py={1}
                  borderRadius="8px"
                  style={{
                    background: "linear-gradient(135deg, rgba(139, 92, 246, 0.12), rgba(6, 182, 212, 0.08))",
                    border: "1px solid rgba(139, 92, 246, 0.25)",
                  }}
                >
                  <span
                    style={{
                      fontSize: "12px",
                      fontWeight: 700,
                      fontFamily: "var(--font-mono, monospace)",
                      color: "var(--color-accent-cyan)",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "6px",
                    }}
                  >
                    <BookIcon size={13} />
                    <span>Engineering Notebook Mode · Interleaved Prose & Artifacts</span>
                  </span>
                  <CellActionBtn type="button" onClick={handleToggleNotebookMode} title="Switch to raw Markdown view">
                    Raw Markdown (`::artifact`)
                  </CellActionBtn>
                </Box>

                <NotebookTitleInput
                  type="text"
                  placeholder="Notebook / Article Title (optional)..."
                  value={notebookTitle}
                  onChange={(e) => {
                    const nextTitle = e.target.value;
                    setNotebookTitle(nextTitle);
                    syncNotebookToContentAndArtifact(notebookCells, nextTitle);
                  }}
                />

                {notebookCells.map((cell, idx) => {
                  const isFirst = idx === 0;
                  const isLast = idx === notebookCells.length - 1;
                  return (
                    <NotebookCellCard
                      key={cell.id}
                      $active={activeCellId === cell.id}
                      $isArtifact={cell.type === "artifact"}
                      onClick={() => setActiveCellId(cell.id)}
                    >
                      <NotebookCellHeader>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: "6px", fontWeight: 600 }}>
                          <span
                            style={{
                              color:
                                cell.type === "artifact"
                                  ? "var(--color-accent-purple, #a855f7)"
                                  : "var(--color-accent-cyan, #06b6d4)",
                            }}
                          >
                            {cell.type === "artifact" ? `⚡ Artifact Cell #${idx + 1}` : `📝 Markdown Cell #${idx + 1}`}
                          </span>
                          {cell.type === "artifact" && (
                            <span style={{ opacity: 0.75 }}>({cell.title || `id=${cell.artifactId}`})</span>
                          )}
                        </span>
                        <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                          <CellActionBtn
                            type="button"
                            disabled={isFirst}
                            onClick={(e) => {
                              e.stopPropagation();
                              moveCell(cell.id, -1);
                            }}
                            title="Move cell up"
                            aria-label="Move cell up"
                          >
                            <ChevronUpIcon size={12} />
                          </CellActionBtn>
                          <CellActionBtn
                            type="button"
                            disabled={isLast}
                            onClick={(e) => {
                              e.stopPropagation();
                              moveCell(cell.id, 1);
                            }}
                            title="Move cell down"
                            aria-label="Move cell down"
                          >
                            <ChevronDownIcon size={12} />
                          </CellActionBtn>
                          <CellActionBtn
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              addMarkdownCellAfter(cell.id);
                            }}
                            title="Insert Markdown section below"
                          >
                            <PlusIcon size={11} /> Text
                          </CellActionBtn>
                          <CellActionBtn
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setPendingInsertAfterCellId(cell.id);
                              setShowMorselModal(true);
                            }}
                            title="Insert interactive Morsel model below"
                          >
                            <PlusIcon size={11} /> Morsel
                          </CellActionBtn>
                          <CellActionBtn
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              removeCell(cell.id);
                            }}
                            title="Remove cell"
                            aria-label="Remove cell"
                          >
                            <TrashIcon size={12} />
                          </CellActionBtn>
                        </div>
                      </NotebookCellHeader>

                      {cell.type === "markdown" ? (
                        <NotebookCellTextarea
                          value={cell.content}
                          placeholder={
                            idx === 0
                              ? "Write introduction, equations, or # section headings... (@mention, #hashtag)"
                              : "Continue your engineering narrative, analysis, or observations..."
                          }
                          onFocus={() => setActiveCellId(cell.id)}
                          onChange={(e) => {
                            setActiveCellId(cell.id);
                            updateMarkdownCell(cell.id, e.target.value);
                            updateTokenState(e.target.value, e.target.selectionStart);
                          }}
                          onKeyUp={handleInteraction}
                          onClick={handleInteraction}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                              handleSubmit();
                            }
                          }}
                          onBlur={() => {
                            setTimeout(() => {
                              setMentionQuery(null);
                              setHashtagQuery(null);
                            }, 150);
                          }}
                        />
                      ) : (
                        <div>
                          <div style={{ padding: "8px" }}>
                            <ArtifactViewCard artifactId={cell.artifactId} />
                          </div>
                          <ArtifactCaptionInput
                            type="text"
                            placeholder="Add figure caption or engineering note for this artifact (optional)..."
                            value={cell.caption || ""}
                            onChange={(e) => updateArtifactCellCaption(cell.id, e.target.value)}
                          />
                        </div>
                      )}
                    </NotebookCellCard>
                  );
                })}

                <Box display="flex" gap={2} flexWrap="wrap" alignItems="center" pt={1}>
                  <CommandPill
                    type="button"
                    onClick={() => addMarkdownCellAfter(notebookCells[notebookCells.length - 1]?.id)}
                  >
                    <span className="pill-icon">
                      <PlusIcon size={11} />
                    </span>
                    <span>Add Text Section</span>
                  </CommandPill>
                  <CommandPill
                    type="button"
                    onClick={() => {
                      setPendingInsertAfterCellId(notebookCells[notebookCells.length - 1]?.id || null);
                      setShowMorselModal(true);
                    }}
                  >
                    <span className="pill-icon">
                      <PulseIcon size={11} />
                    </span>
                    <span>Insert Morsel Cell</span>
                  </CommandPill>
                  <CommandPill
                    type="button"
                    onClick={() => {
                      setPendingInsertAfterCellId(notebookCells[notebookCells.length - 1]?.id || null);
                      createDummyArtifact("simulation-plot");
                    }}
                  >
                    <span className="pill-icon">
                      <SlidersIcon size={11} />
                    </span>
                    <span>Insert Plot Cell</span>
                  </CommandPill>
                  <CommandPill
                    type="button"
                    onClick={() => {
                      setPendingInsertAfterCellId(notebookCells[notebookCells.length - 1]?.id || null);
                      fileInputRef.current?.click();
                    }}
                  >
                    <span className="pill-icon">
                      <PaperclipIcon size={11} />
                    </span>
                    <span>Insert CAD / Media Cell</span>
                  </CommandPill>
                </Box>
              </NotebookContainer>
            ) : (
              <OverlayWrapper>
                <Backdrop>
                  {content.split(/(@[a-zA-Z0-9_.-]+(?:@[a-zA-Z0-9_.-]+)?|#[a-zA-Z0-9_-]+)/g).map((part, i) =>
                    part.startsWith("@") ? (
                      <span key={i} style={{ color: "var(--color-accent-cyan)" }}>
                        {part}
                      </span>
                    ) : part.startsWith("#") ? (
                      <span key={i} style={{ color: "var(--color-accent-purple, #a855f7)", fontWeight: 600 }}>
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
                  onBlur={() => {
                    setTimeout(() => {
                      setMentionQuery(null);
                      setHashtagQuery(null);
                    }, 150);
                  }}
                />
              </OverlayWrapper>
            )}
            {mentionQuery && mentionSuggestions.length > 0 && (
              <Box
                position="absolute"
                bg="var(--surface-overlay)"
                border="1px solid var(--color-border)"
                borderRadius="12px"
                boxShadow="0 8px 24px rgba(0,0,0,0.5)"
                style={{ backdropFilter: "blur(12px)" }}
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
                    sx={{ cursor: "pointer", "&:hover": { bg: "rgba(255, 255, 255, 0.06)" } }}
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
            {hashtagQuery && hashtagSuggestions.length > 0 && (
              <Box
                position="absolute"
                bg="var(--surface-overlay)"
                border="1px solid var(--color-border)"
                borderRadius="12px"
                boxShadow="0 8px 24px rgba(0,0,0,0.5)"
                style={{ backdropFilter: "blur(12px)" }}
                zIndex={100}
                top="100%"
                left={0}
                mt={2}
                maxHeight="300px"
                overflow="auto"
                width="280px"
              >
                <Box px={3} py={2} borderBottom="1px solid var(--color-border)">
                  <span style={{ fontSize: "11px", fontWeight: 700, color: "var(--color-text-muted)" }}>
                    TRENDING TOPICS
                  </span>
                </Box>
                {hashtagSuggestions.map((t) => {
                  const tag = t.displayName || t.concept;
                  return (
                    <Box
                      key={t.concept}
                      display="flex"
                      alignItems="center"
                      justifyContent="space-between"
                      p={2}
                      px={3}
                      sx={{ cursor: "pointer", "&:hover": { bg: "rgba(255, 255, 255, 0.06)" } }}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        insertHashtag(tag);
                      }}
                    >
                      <Box display="flex" alignItems="center" gap={2}>
                        <span style={{ color: "var(--color-accent-purple, #a855f7)", fontWeight: "bold" }}>#</span>
                        <span style={{ fontWeight: 600, fontSize: "13px", color: "var(--color-fg-default)" }}>
                          {tag}
                        </span>
                      </Box>
                      {t.score !== undefined && (
                        <span style={{ fontSize: "11px", color: "var(--color-text-muted)" }}>
                          {Math.round(t.score)} posts
                        </span>
                      )}
                    </Box>
                  );
                })}
              </Box>
            )}
            {!isNotebookMode && artifactId !== null && (
              <div
                style={{
                  position: "relative",
                  marginTop: "8px",
                  marginBottom: "8px",
                  borderRadius: "12px",
                  overflow: "hidden",
                  border: "1px solid var(--color-border)",
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
                border="1px solid var(--color-border)"
                borderRadius="8px"
                backgroundColor="rgba(255, 255, 255, 0.03)"
              >
                <span
                  style={{
                    fontSize: "12px",
                    color: "var(--color-text-muted)",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "4px",
                  }}
                >
                  <PinIcon size={12} style={{ color: "var(--color-accent-cyan)" }} />
                  <span>
                    Pinned to <b>{pendingPin.fieldName}</b> = {pendingPin.scalarValue.toFixed(2)}
                  </span>
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
                  {replyVisibility === "everyone" && (
                    <GlobeIcon size={16} style={{ color: "var(--color-accent-cyan)" }} />
                  )}
                  {replyVisibility === "following" && (
                    <PersonIcon size={16} style={{ color: "var(--color-accent-cyan)" }} />
                  )}
                  {replyVisibility === "mentioned" && (
                    <MentionIcon size={16} style={{ color: "var(--color-accent-cyan)" }} />
                  )}
                  <span style={{ color: "var(--color-accent-cyan)", fontWeight: "bold", fontSize: "14px" }}>
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
                      bg="var(--surface-overlay)"
                      border="1px solid var(--color-border)"
                      borderRadius="16px"
                      boxShadow="0 8px 24px rgba(0,0,0,0.5)"
                      style={{ backdropFilter: "blur(12px)" }}
                      zIndex={100}
                      width="280px"
                      py={2}
                    >
                      <Box px={3} pb={2} borderBottom="1px solid var(--color-border)" mb={2}>
                        <Text style={{ fontWeight: "bold", fontSize: "15px" }}>Who can reply?</Text>
                      </Box>
                      <Box
                        display="flex"
                        alignItems="center"
                        gap={3}
                        px={3}
                        py={2}
                        style={{ cursor: "pointer" }}
                        sx={{ "&:hover": { backgroundColor: "rgba(255, 255, 255, 0.06)" } }}
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
                          bg="var(--color-accent-cyan)"
                          color="#06080f"
                        >
                          <GlobeIcon size={20} />
                        </Box>
                        <Text flex={1} style={{ fontWeight: "bold", fontSize: "15px" }}>
                          Everyone
                        </Text>
                        {replyVisibility === "everyone" ? (
                          <CheckCircleIcon size={20} style={{ color: "var(--color-accent-cyan)" }} />
                        ) : (
                          <CircleIcon size={20} style={{ color: "var(--color-text-muted)" }} />
                        )}
                      </Box>
                      <Box
                        display="flex"
                        alignItems="center"
                        gap={3}
                        px={3}
                        py={2}
                        style={{ cursor: "pointer" }}
                        sx={{ "&:hover": { backgroundColor: "rgba(255, 255, 255, 0.06)" } }}
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
                          bg="var(--color-accent-cyan)"
                          color="#06080f"
                        >
                          <PersonIcon size={20} />
                        </Box>
                        <Text flex={1} style={{ fontWeight: "bold", fontSize: "15px" }}>
                          Accounts you follow
                        </Text>
                        {replyVisibility === "following" ? (
                          <CheckCircleIcon size={20} style={{ color: "var(--color-accent-cyan)" }} />
                        ) : (
                          <CircleIcon size={20} style={{ color: "var(--color-text-muted)" }} />
                        )}
                      </Box>
                      <Box
                        display="flex"
                        alignItems="center"
                        gap={3}
                        px={3}
                        py={2}
                        style={{ cursor: "pointer" }}
                        sx={{ "&:hover": { backgroundColor: "rgba(255, 255, 255, 0.06)" } }}
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
                          bg="var(--color-accent-cyan)"
                          color="#06080f"
                        >
                          <MentionIcon size={20} />
                        </Box>
                        <Text flex={1} style={{ fontWeight: "bold", fontSize: "15px" }}>
                          Only accounts you mention
                        </Text>
                        {replyVisibility === "mentioned" ? (
                          <CheckCircleIcon size={20} style={{ color: "var(--color-accent-cyan)" }} />
                        ) : (
                          <CircleIcon size={20} style={{ color: "var(--color-text-muted)" }} />
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
              <Box display="flex" gap={1} mb={2} flexWrap="wrap">
                <CommandPill
                  type="button"
                  onClick={handleToggleNotebookMode}
                  title="Toggle long-form Notebook Mode with interspersed Markdown & interactive Artifacts"
                  style={
                    isNotebookMode
                      ? {
                          background: "rgba(139, 92, 246, 0.16)",
                          borderColor: "var(--color-accent-cyan)",
                          color: "var(--color-fg-default)",
                        }
                      : undefined
                  }
                >
                  <span className="pill-icon">
                    <BookIcon size={11} />
                  </span>
                  <span>{isNotebookMode ? "Notebook Mode: ON" : "📓 Notebook Mode"}</span>
                </CommandPill>
                <CommandPill
                  type="button"
                  onClick={() => setContent(content ? `${content} /synthesize model ` : "/synthesize model ")}
                  title="Generate a physics-informed Modelica or DAE model"
                >
                  <span className="pill-icon">
                    <SparkleIcon size={11} />
                  </span>
                  <span>/synthesize model</span>
                </CommandPill>
                <CommandPill
                  type="button"
                  onClick={() =>
                    setContent(content ? `${content} /benchmark solver=cvode ` : "/benchmark solver=cvode ")
                  }
                  title="Run numerical benchmark on SUNDIALS CVODE solver"
                >
                  <span className="pill-icon">
                    <ZapIcon size={11} />
                  </span>
                  <span>/benchmark solver</span>
                </CommandPill>
                <CommandPill
                  type="button"
                  onClick={() => setContent(content ? `${content} /analyze dae_index=1 ` : "/analyze dae_index=1 ")}
                  title="Perform structural DAE index analysis"
                >
                  <span className="pill-icon">
                    <BeakerIcon size={11} />
                  </span>
                  <span>/analyze DAE</span>
                </CommandPill>
                <CommandPill
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  title="Attach CAD STEP model or FMU co-simulation container"
                >
                  <span className="pill-icon">
                    <PaperclipIcon size={11} />
                  </span>
                  <span>Attach CAD/FMU</span>
                </CommandPill>
              </Box>
              <Box display="flex" justifyContent="space-between" alignItems="center">
                <Box display="flex" gap={2} alignItems="center">
                  <ActionIconButton
                    onClick={() => setShowMorselModal(true)}
                    aria-label="Add Morsel Diagram"
                    title="Add Morsel Diagram & Simulation (attach multiple to build a Notebook)"
                  >
                    <PulseIcon size={20} />
                  </ActionIconButton>
                  <ActionIconButton
                    onClick={() => setShowPackageRepoPicker(true)}
                    aria-label="Attach Package or Repository"
                    title="Attach Package or Repository"
                  >
                    <PackageIcon size={20} />
                  </ActionIconButton>
                  <ActionIconButton
                    onClick={() => createDummyArtifact("modelica-code")}
                    aria-label="Add Code"
                    title="Add Code Cell"
                  >
                    <CodeIcon size={20} />
                  </ActionIconButton>
                  {hasHpc && (
                    <ActionIconButton
                      onClick={() => setShowHpcPicker(true)}
                      aria-label="Attach HPC Artifact"
                      title="Attach HPC Simulation Artifact (FEA, CFD, DOEs)"
                    >
                      <ServerIcon size={20} />
                    </ActionIconButton>
                  )}
                  <input
                    type="file"
                    style={{ display: "none" }}
                    ref={fileInputRef}
                    accept=".usdz,.usd,.usda,.glb,.gltf,image/*,video/*,audio/*,.pdf,.step,.stp,.csv,.mo,.tei,.xml"
                    onChange={handleFileUpload}
                    disabled={uploadingFile}
                  />
                  <ActionIconButton
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploadingFile}
                    aria-label="Upload Media"
                    title="Upload Media (Images, Videos, USDZ 3D, CAD, PDFs, CSV, TEI)"
                  >
                    <ImageIcon size={20} />
                  </ActionIconButton>
                  <ActionIconButton
                    type="button"
                    onClick={() => setShowContentWarning((prev) => !prev)}
                    aria-label="Content Warning"
                    title="Add Content Warning (ActivityPub Note summary)"
                    style={{
                      fontWeight: "bold",
                      fontSize: "12px",
                      fontFamily: "var(--font-mono, monospace)",
                      color: showContentWarning ? "var(--color-warning-fg, #d29922)" : "var(--color-text-muted)",
                      background: showContentWarning ? "rgba(210, 153, 34, 0.12)" : "transparent",
                    }}
                  >
                    CW
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
                              setContent(content + emojiData.emoji);
                            }}
                          />
                        </div>
                      </>
                    )}
                  </div>
                  <ActionIconButton
                    onClick={() => createDummyArtifact("simulation-plot")}
                    aria-label="Add Params"
                    title="Add Simulation Plot / Params Cell"
                  >
                    <SlidersIcon size={20} />
                  </ActionIconButton>
                  {hasExperimental && (
                    <ActionIconButton
                      onClick={() => createDummyArtifact("tei-document")}
                      aria-label="Add TEI Document"
                      title="Add TEI Document"
                    >
                      <BookIcon size={20} />
                    </ActionIconButton>
                  )}
                  {uploadingFile && (
                    <span style={{ fontSize: "12px", color: "var(--color-fg-muted)", marginLeft: "8px" }}>
                      Uploading...
                    </span>
                  )}
                </Box>
                <TweetButton
                  onClick={handleSubmit}
                  disabled={(!content.trim() && !artifactId && !hasNotebookContent) || submitting}
                >
                  {replyToPost ? "Reply" : isNotebookMode ? "📓 Publish Notebook" : "⚡ Publish & Run"}
                </TweetButton>
              </Box>
            </Box>
          </Box>
        </Box>
      </Box>

      {hasHpc && (
        <HpcArtifactPickerModal
          isOpen={showHpcPicker}
          onClose={() => setShowHpcPicker(false)}
          onSelect={(res) => {
            attachArtifactToComposer(res.artifactId, undefined, res.suggestedCaption);
          }}
        />
      )}

      <MorselComposeModal
        isOpen={showMorselModal}
        onClose={() => setShowMorselModal(false)}
        onAttach={async ({ code, title, dialect }) => {
          if (!token) return;
          try {
            const data = await createArtifactView({
              artifact_type: "morsel",
              view_config: JSON.stringify({ code, dialect, title }),
              title: `⚡ ${title}`,
            });
            attachArtifactToComposer(data.id, title);
          } catch (err) {
            console.error("Failed to attach morsel artifact:", err);
          }
        }}
      />

      <PackageRepoPickerModal
        isOpen={showPackageRepoPicker}
        onClose={() => setShowPackageRepoPicker(false)}
        onSelect={(res) => {
          attachArtifactToComposer(res.artifactId, undefined, res.suggestedCaption);
        }}
      />
    </>
  );
}
