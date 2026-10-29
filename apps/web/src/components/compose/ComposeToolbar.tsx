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
import type { ComposerAiEngineMode } from "../../util/composer-ai";
import Box from "../Box";
import SimpleEmojiPicker from "../SimpleEmojiPicker";
import { ActionIconButton, CommandPill, TweetButton } from "./styles";

export interface ComposeToolbarProps {
  isModal?: boolean | undefined;
  isNotebookMode: boolean;
  content: string;
  setContent: (val: string) => void;
  handleToggleNotebookMode: () => void;
  setShowMorselModal: (show: boolean) => void;
  setShowPackageRepoPicker: (show: boolean) => void;
  setShowCodeSnippetModal: (show: boolean) => void;
  setShowHpcPicker: (show: boolean) => void;
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
  artifactId: number | null;
  hasNotebookContent: boolean;
  editPostId?: string | number | null | undefined;
  replyToPost?: unknown;
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
  isNotebookMode,
  content,
  setContent,
  handleToggleNotebookMode,
  setShowMorselModal,
  setShowPackageRepoPicker,
  setShowCodeSnippetModal,
  setShowHpcPicker,
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

  const hasTextToPolish = Boolean(content.trim() || hasNotebookContent);
  const isAiRunning = Boolean(aiBusy);

  return (
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
      <Box display="flex" gap={1} mb={2} flexWrap="wrap" alignItems="center">
        <CommandPill
          type="button"
          onClick={handleToggleNotebookMode}
          aria-pressed={isNotebookMode}
          title="Toggle long-form Notebook Mode with interspersed Markdown & interactive Artifacts"
        >
          <span className="pill-icon">
            <BookIcon size={12} />
          </span>
          <span>Notebook mode</span>
        </CommandPill>

        {artifactId !== null && onAiDraft && (
          <CommandPill
            type="button"
            onClick={onAiDraft}
            disabled={isAiRunning}
            data-testid="composer-ai-draft-btn"
            title="Automatically draft or regenerate a post summarizing the attached engineering artifact"
            style={{
              borderColor: "rgba(168, 85, 247, 0.35)",
              background: aiBusy === "drafting" ? "rgba(168, 85, 247, 0.18)" : undefined,
              opacity: isAiRunning && aiBusy !== "drafting" ? 0.6 : 1,
            }}
          >
            <span className="pill-icon" style={{ color: "#c084fc" }}>
              <SparklesFillIcon size={12} />
            </span>
            <span>{aiBusy === "drafting" ? "Drafting..." : "Draft from artifact"}</span>
          </CommandPill>
        )}

        {onAiPolish && (
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
                      color: hasTextToPolish ? "var(--color-fg-default, #e6edf3)" : "var(--color-text-muted, #8b949e)",
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
                        color: "#c084fc",
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
                              color: active ? "var(--color-accent-cyan, #06b6d4)" : "var(--color-text-muted, #8b949e)",
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
            onClick={() => setShowCodeSnippetModal(true)}
            aria-label="Add Code"
            title="Insert Code Snippet or Executable Code Cell"
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
            accept=".usdz,.usd,.usda,.glb,.gltf,image/*,video/*,audio/*,.pdf,.step,.stp,.csv,.tsv,.mo,.mos,.sysml,.sysml2,.kerml,.pscx,.pslx,.psout,.raw,.con,.inl,.opi,.key,.tpl,.olga,.ez5,.ezm,.roc,.deck,.lps,.tgx,.sima,.sys,.gtm,.gtd,.inp,.inpt,.bdf,.cfg,.cfgt,.su2,.fmu,.ssp,.ssd,.owl,.ttl,.ofn,.tei,.xml"
            onChange={handleFileUpload}
            disabled={uploadingFile}
          />
          <ActionIconButton
            onClick={() => fileInputRef.current?.click()}
            disabled={uploadingFile}
            aria-label="Upload media or CAD/FMU"
            title="Upload media, CAD (STEP/USD/glTF), FMU/SSP, PDFs, CSV, TEI"
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
                <div style={{ position: "absolute", top: "100%", zIndex: 1000, marginTop: "8px" }}>
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
            <span style={{ fontSize: "12px", color: "var(--color-fg-muted)", marginLeft: "8px" }}>Uploading...</span>
          )}
        </Box>
        <TweetButton
          onClick={handleSubmit}
          disabled={(!content.trim() && !artifactId && !hasNotebookContent) || submitting}
        >
          {editPostId
            ? isNotebookMode
              ? "Update tutorial"
              : "Save changes"
            : replyToPost
              ? "Reply"
              : isNotebookMode
                ? "Publish tutorial"
                : "Post"}
        </TweetButton>
      </Box>
    </Box>
  );
};
