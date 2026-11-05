// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  BookIcon,
  ChevronDownIcon,
  CodeIcon,
  HistoryIcon,
  PackageIcon,
  PaperclipIcon,
  PulseIcon,
  ServerIcon,
  SmileyIcon,
  SparklesFillIcon,
} from "@primer/octicons-react";
import React from "react";
import type { AiPolishMode } from "../../api";
import { useFeatureFlag } from "../../FeatureFlagContext";
import type { ComposerAiEngineMode } from "../../util/composer-ai";
import Box from "../Box";
import SimpleEmojiPicker from "../SimpleEmojiPicker";
import { getAttachAcceptList } from "./attach";
import { ActionIconButton, CommandPill, TweetButton } from "./styles";

export interface ComposeToolbarProps {
  isModal?: boolean | undefined;
  isInputFocused?: boolean | undefined;
  isNotebookMode: boolean;
  content: string;
  setContent: (val: string) => void;
  handleToggleNotebookMode?: (() => void) | undefined;
  setShowMorselModal: (show: boolean) => void;
  setShowPackageRepoPicker: (show: boolean) => void;
  setShowCodeSnippetModal: (show: boolean) => void;
  setShowHpcPicker: (show: boolean) => void;
  setShowCitationPicker?: ((show: boolean) => void) | undefined;
  hasHpc: boolean;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  handleFileUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  uploadingFile: boolean;
  showContentWarning: boolean;
  setShowContentWarning: React.Dispatch<React.SetStateAction<boolean>>;
  showEmojiPicker: boolean;
  setShowEmojiPicker: React.Dispatch<React.SetStateAction<boolean>>;
  handleSubmit: () => void;
  submitting: boolean;
  artifactId: number | string | null;
  hasNotebookContent: boolean;
  editPostId?: string | number | null | undefined;
  replyToPost?: unknown;
  quotePost?: unknown | undefined;
  textareaRef?: React.RefObject<HTMLTextAreaElement | null> | undefined;
  onInsertEmoji?: ((emoji: string) => void) | undefined;
  onAiDraft?: (() => void) | undefined;
  onAiPolish?: ((mode: AiPolishMode) => void) | undefined;
  onUndoAi?: (() => void) | undefined;
  canUndoAi?: boolean | undefined;
  aiBusy?: "drafting" | "polishing" | null | undefined;
  aiEngine?: ComposerAiEngineMode | undefined;
  onChangeAiEngine?: ((mode: ComposerAiEngineMode) => void) | undefined;
  aiLastSourceLabel?: string | null | undefined;
}

export const ComposeToolbar: React.FC<ComposeToolbarProps> = ({
  isModal,
  isInputFocused,
  isNotebookMode,
  content,
  setContent,
  setShowMorselModal,
  setShowPackageRepoPicker,
  setShowCodeSnippetModal,
  setShowHpcPicker,
  setShowCitationPicker,
  hasHpc,
  fileInputRef,
  handleFileUpload,
  uploadingFile,
  showContentWarning,
  setShowContentWarning,
  showEmojiPicker,
  setShowEmojiPicker,
  handleSubmit,
  submitting,
  artifactId,
  hasNotebookContent,
  editPostId,
  replyToPost,
  quotePost,
  textareaRef,
  onInsertEmoji,
  onAiDraft,
  onAiPolish,
  onUndoAi,
  canUndoAi,
  aiBusy,
  aiEngine = "auto",
  onChangeAiEngine,
  aiLastSourceLabel,
}) => {
  const emojiWrapperRef = React.useRef<HTMLDivElement>(null);
  const aiMenuWrapperRef = React.useRef<HTMLDivElement>(null);
  const [showAiMenu, setShowAiMenu] = React.useState(false);

  React.useEffect(() => {
    if (!showEmojiPicker) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setShowEmojiPicker(false);
      }
    };
    const handleMouseDown = (e: MouseEvent) => {
      if (emojiWrapperRef.current && !emojiWrapperRef.current.contains(e.target as Node)) {
        setShowEmojiPicker(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    document.addEventListener("mousedown", handleMouseDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("mousedown", handleMouseDown);
    };
  }, [showEmojiPicker, setShowEmojiPicker]);

  React.useEffect(() => {
    if (!showAiMenu) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setShowAiMenu(false);
      }
    };
    const handleMouseDown = (e: MouseEvent) => {
      if (aiMenuWrapperRef.current && !aiMenuWrapperRef.current.contains(e.target as Node)) {
        setShowAiMenu(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    document.addEventListener("mousedown", handleMouseDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("mousedown", handleMouseDown);
    };
  }, [showAiMenu]);

  const hasComposerAiPolish = useFeatureFlag("composer_ai_polish");
  const hasAiPolishAlias = useFeatureFlag("ai_polish");
  const isAiPolishFeatureEnabled = hasComposerAiPolish || hasAiPolishAlias;
  const hasReferences = useFeatureFlag(["references", "scientific_references"]);
  const hasTextToPolish = Boolean(content.trim() || hasNotebookContent);
  const isAiRunning = Boolean(aiBusy);
  const hasEnteredContent = Boolean(content.trim() || artifactId !== null || hasNotebookContent);
  const isReply = Boolean(replyToPost);
  const isExpanded = Boolean(!isReply && (isInputFocused || hasEnteredContent));
  const hasAiPills = Boolean(
    !isReply &&
    ((artifactId !== null && onAiDraft) ||
      (isAiPolishFeatureEnabled && onAiPolish) ||
      (canUndoAi && onUndoAi) ||
      (aiLastSourceLabel && !isAiRunning)),
  );

  return (
    <Box
      style={{
        position: "sticky",
        bottom: "0px",
        backgroundColor: isModal ? "transparent" : "var(--color-bg-primary)",
        zIndex: 10,
        paddingBottom: "0px",
        paddingTop: isReply ? "4px" : isExpanded ? "12px" : "4px",
        borderTop: isReply || isModal || !isExpanded ? "none" : "1px solid var(--color-border)",
        marginTop: isModal ? (quotePost ? "4px" : "auto") : undefined,
      }}
    >
      {isExpanded && hasAiPills && (
        <Box display="flex" gap={1} mb={2} flexWrap="wrap" alignItems="center">
          {artifactId !== null && onAiDraft && (
            <CommandPill
              type="button"
              onClick={onAiDraft}
              disabled={isAiRunning}
              data-testid="composer-ai-draft-btn"
              title="Automatically draft or regenerate a post summarizing the attached engineering artifact"
              style={{
                borderColor: "var(--color-accent-blue-border)",
                background: aiBusy === "drafting" ? "var(--ms-brand-soft)" : undefined,
                opacity: isAiRunning && aiBusy !== "drafting" ? 0.6 : 1,
              }}
            >
              <span className="pill-icon" style={{ color: "var(--color-accent-cyan, #06b6d4)" }}>
                <SparklesFillIcon size={12} />
              </span>
              <span>{aiBusy === "drafting" ? "Drafting..." : "Draft from artifact"}</span>
            </CommandPill>
          )}

          {isAiPolishFeatureEnabled && onAiPolish && (
            <div
              ref={aiMenuWrapperRef}
              style={{ position: "relative", display: "inline-flex", alignItems: "center", gap: "2px" }}
            >
              <CommandPill
                type="button"
                onClick={() => onAiPolish("polish")}
                disabled={isAiRunning || !hasTextToPolish}
                data-testid="composer-ai-polish-btn"
                title={
                  hasTextToPolish
                    ? "Polish and refine your post text using AI (Local or Remote)"
                    : "Enter some text first to polish with AI"
                }
                style={{
                  borderTopRightRadius: "4px",
                  borderBottomRightRadius: "4px",
                  opacity: !hasTextToPolish || isAiRunning ? 0.55 : 1,
                  cursor: !hasTextToPolish || isAiRunning ? "not-allowed" : "pointer",
                }}
              >
                <span className="pill-icon" style={{ color: "var(--color-accent-cyan, #06b6d4)" }}>
                  <SparklesFillIcon size={12} />
                </span>
                <span>{aiBusy === "polishing" ? "Polishing..." : "Polish"}</span>
              </CommandPill>
              <CommandPill
                type="button"
                onClick={() => setShowAiMenu((prev) => !prev)}
                disabled={isAiRunning}
                aria-label="AI Polish & Engine Options"
                data-testid="composer-ai-menu-btn"
                title="AI Polish Presets & Local/Remote Engine Selector"
                style={{
                  padding: "4px 6px",
                  borderTopLeftRadius: "4px",
                  borderBottomLeftRadius: "4px",
                }}
              >
                <ChevronDownIcon size={12} />
              </CommandPill>

              {showAiMenu && (
                <div
                  data-testid="composer-ai-menu"
                  style={{
                    position: "absolute",
                    bottom: "calc(100% + 6px)",
                    left: 0,
                    zIndex: 1000,
                    minWidth: "240px",
                    backgroundColor: "var(--color-bg-elevated, #161b22)",
                    border: "1px solid var(--color-border, #30363d)",
                    borderRadius: "10px",
                    boxShadow: "0 8px 24px rgba(0, 0, 0, 0.45)",
                    padding: "6px",
                    display: "flex",
                    flexDirection: "column",
                    gap: "2px",
                  }}
                >
                  <div
                    style={{
                      fontSize: "10.5px",
                      fontWeight: 700,
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                      color: "var(--color-text-muted, #8b949e)",
                      padding: "4px 8px 2px",
                    }}
                  >
                    Polish Presets
                  </div>
                  {(
                    [
                      {
                        mode: "polish" as AiPolishMode,
                        label: "✨ Technical Polish",
                        desc: "Refine clarity, grammar & tone",
                      },
                      {
                        mode: "concise" as AiPolishMode,
                        label: "⚡ Make Concise",
                        desc: "Tighten into a punchy summary",
                      },
                      {
                        mode: "expand" as AiPolishMode,
                        label: "📐 Expand Analysis",
                        desc: "Add engineering takeaways",
                      },
                      {
                        mode: "hashtags" as AiPolishMode,
                        label: "# Add Hashtags",
                        desc: "Append domain-classified tags",
                      },
                    ] as const
                  ).map((item) => (
                    <button
                      key={item.mode}
                      type="button"
                      disabled={!hasTextToPolish || isAiRunning}
                      onClick={() => {
                        setShowAiMenu(false);
                        onAiPolish(item.mode);
                      }}
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "flex-start",
                        width: "100%",
                        padding: "6px 8px",
                        border: "none",
                        borderRadius: "6px",
                        background: "transparent",
                        color: hasTextToPolish
                          ? "var(--color-fg-default, #e6edf3)"
                          : "var(--color-text-muted, #8b949e)",
                        cursor: hasTextToPolish && !isAiRunning ? "pointer" : "not-allowed",
                        textAlign: "left",
                        fontSize: "12px",
                      }}
                    >
                      <span style={{ fontWeight: 600 }}>{item.label}</span>
                      <span style={{ fontSize: "10.5px", color: "var(--color-text-muted, #8b949e)" }}>{item.desc}</span>
                    </button>
                  ))}

                  {artifactId !== null && onAiDraft && (
                    <>
                      <div
                        style={{
                          height: "1px",
                          backgroundColor: "var(--color-border, #30363d)",
                          margin: "4px 0",
                        }}
                      />
                      <button
                        type="button"
                        disabled={isAiRunning}
                        onClick={() => {
                          setShowAiMenu(false);
                          onAiDraft();
                        }}
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "flex-start",
                          width: "100%",
                          padding: "6px 8px",
                          border: "none",
                          borderRadius: "6px",
                          background: "transparent",
                          color: "var(--color-accent-cyan, #06b6d4)",
                          cursor: isAiRunning ? "not-allowed" : "pointer",
                          textAlign: "left",
                          fontSize: "12px",
                        }}
                      >
                        <span style={{ fontWeight: 600 }}>📝 Draft from Artifact</span>
                        <span style={{ fontSize: "10.5px", color: "var(--color-text-muted, #8b949e)" }}>
                          Synthesize post from attached artifact
                        </span>
                      </button>
                    </>
                  )}

                  {onChangeAiEngine && (
                    <>
                      <div
                        style={{
                          height: "1px",
                          backgroundColor: "var(--color-border, #30363d)",
                          margin: "4px 0",
                        }}
                      />
                      <div
                        style={{
                          fontSize: "10.5px",
                          fontWeight: 700,
                          textTransform: "uppercase",
                          letterSpacing: "0.05em",
                          color: "var(--color-text-muted, #8b949e)",
                          padding: "2px 8px 4px",
                        }}
                      >
                        AI Engine ({aiEngine})
                      </div>
                      <div style={{ display: "flex", gap: "4px", padding: "0 4px 4px" }}>
                        {(
                          [
                            { id: "auto", label: "Auto" },
                            { id: "local", label: "Local" },
                            { id: "remote", label: "Remote" },
                          ] as const
                        ).map((opt) => {
                          const active = aiEngine === opt.id;
                          return (
                            <button
                              key={opt.id}
                              type="button"
                              onClick={() => onChangeAiEngine(opt.id)}
                              style={{
                                flex: 1,
                                padding: "4px 6px",
                                fontSize: "11px",
                                fontWeight: active ? 700 : 500,
                                borderRadius: "6px",
                                border: active
                                  ? "1px solid var(--color-accent-cyan, #06b6d4)"
                                  : "1px solid var(--color-border, #30363d)",
                                background: active ? "rgba(6, 182, 212, 0.14)" : "transparent",
                                color: active
                                  ? "var(--color-accent-cyan, #06b6d4)"
                                  : "var(--color-text-muted, #8b949e)",
                                cursor: "pointer",
                              }}
                            >
                              {opt.label}
                            </button>
                          );
                        })}
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          {canUndoAi && onUndoAi && (
            <CommandPill
              type="button"
              onClick={onUndoAi}
              disabled={isAiRunning}
              data-testid="composer-ai-undo-btn"
              title="Restore text before the last AI draft or polish"
            >
              <span className="pill-icon">
                <HistoryIcon size={12} />
              </span>
              <span>Undo AI</span>
            </CommandPill>
          )}

          {aiLastSourceLabel && !isAiRunning && (
            <span
              style={{
                fontSize: "10.5px",
                fontFamily: "var(--font-mono, monospace)",
                color: "var(--color-text-muted, #8b949e)",
                padding: "2px 6px",
                borderRadius: "999px",
                border: "1px solid var(--color-border, #30363d)",
              }}
              title="AI engine used for the last generation"
            >
              {aiLastSourceLabel}
            </span>
          )}
        </Box>
      )}
      <Box display="flex" justifyContent="space-between" alignItems="center" gap={2}>
        <Box
          display="flex"
          gap={1.5}
          alignItems="center"
          style={{
            minWidth: 0,
            overflowX: "auto",
            scrollbarWidth: "none",
            WebkitOverflowScrolling: "touch",
            padding: "2px 0",
          }}
        >
          <ActionIconButton
            onClick={() => setShowMorselModal(true)}
            aria-label="Add model"
            title="Add model — an interactive, simulatable diagram (attach multiple to build an Article)"
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
            onClick={() => setShowCodeSnippetModal(true)}
            aria-label="Add Code"
            title="Insert Code Snippet or Executable Code Cell"
          >
            <CodeIcon size={20} />
          </ActionIconButton>
          {hasReferences && (
            <ActionIconButton
              type="button"
              onClick={() => setShowCitationPicker?.(true)}
              aria-label="Insert Citation"
              title="Insert Scholarly Citation (OpenAlex, DOI, ArXiv, URN)"
              data-testid="composer-insert-citation-btn"
            >
              <BookIcon size={20} />
            </ActionIconButton>
          )}
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
            accept={getAttachAcceptList()}
            onChange={handleFileUpload}
            disabled={uploadingFile}
          />
          <ActionIconButton
            onClick={() => fileInputRef.current?.click()}
            disabled={uploadingFile}
            aria-label="Upload media or CAD/FMU"
            title="Upload media, CAD (STEP/USD/glTF), FMU/SSP, PDFs, Datasets (CSV/JSON/YAML/XML/HDF5), TEI"
          >
            <PaperclipIcon size={20} />
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
          <div ref={emojiWrapperRef} style={{ position: "relative" }}>
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
                <div
                  style={{
                    position: "absolute",
                    top: isModal ? "auto" : "100%",
                    bottom: isModal ? "calc(100% + 8px)" : "auto",
                    zIndex: 1000,
                    marginTop: isModal ? undefined : "8px",
                  }}
                >
                  <SimpleEmojiPicker
                    onEmojiClick={(emojiData) => {
                      if (onInsertEmoji) {
                        onInsertEmoji(emojiData.emoji);
                        return;
                      }
                      const el = textareaRef?.current;
                      if (el) {
                        const start = el.selectionStart ?? content.length;
                        const end = el.selectionEnd ?? start;
                        const next = content.slice(0, start) + emojiData.emoji + content.slice(end);
                        setContent(next);
                        requestAnimationFrame(() => {
                          el.focus();
                          const cursor = start + emojiData.emoji.length;
                          el.setSelectionRange(cursor, cursor);
                        });
                      } else {
                        setContent(content + emojiData.emoji);
                      }
                    }}
                  />
                </div>
              </>
            )}
          </div>
          {uploadingFile && (
            <span style={{ fontSize: "12px", color: "var(--color-fg-muted)", marginLeft: "4px", whiteSpace: "nowrap" }}>
              Uploading...
            </span>
          )}
        </Box>
        <Box display="flex" alignItems="center" gap={2} flexShrink={0}>
          {!isNotebookMode && content.length > 0 && (
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "5px",
                userSelect: "none",
              }}
              title={
                content.length > 500
                  ? `${content.length}/500 characters (Exceeds standard 500 character limit)`
                  : `${500 - content.length} characters remaining`
              }
            >
              {content.length >= 480 && (
                <span
                  style={{
                    fontSize: "11px",
                    fontWeight: 700,
                    fontFamily: "var(--font-mono, monospace)",
                    color: content.length > 500 ? "var(--ms-danger, #e11d48)" : "var(--ms-warning, #d97706)",
                  }}
                >
                  {500 - content.length}
                </span>
              )}
              <svg width="18" height="18" viewBox="0 0 20 20" style={{ transform: "rotate(-90deg)" }}>
                <circle
                  cx="10"
                  cy="10"
                  r="7.5"
                  fill="none"
                  stroke="var(--ms-divider, rgba(148, 163, 184, 0.2))"
                  strokeWidth="2"
                />
                <circle
                  cx="10"
                  cy="10"
                  r="7.5"
                  fill="none"
                  stroke={
                    content.length > 500
                      ? "var(--ms-danger, #e11d48)"
                      : content.length >= 450
                        ? "var(--ms-warning, #d97706)"
                        : "var(--ms-brand, #0891b2)"
                  }
                  strokeWidth="2"
                  strokeDasharray={2 * Math.PI * 7.5}
                  strokeDashoffset={2 * Math.PI * 7.5 * (1 - Math.min(content.length / 500, 1))}
                  strokeLinecap="round"
                  style={{ transition: "stroke-dashoffset 0.1s linear, stroke 0.15s ease" }}
                />
              </svg>
            </div>
          )}
          <TweetButton
            onClick={handleSubmit}
            disabled={(!content.trim() && !artifactId && !hasNotebookContent) || submitting}
            title="Submit post (Ctrl+Enter)"
          >
            {editPostId
              ? isNotebookMode
                ? "Update article"
                : "Save changes"
              : replyToPost
                ? "Reply"
                : isNotebookMode
                  ? "Publish article"
                  : "Post"}
          </TweetButton>
        </Box>
      </Box>
    </Box>
  );
};
