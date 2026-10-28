// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  BookIcon,
  CodeIcon,
  PackageIcon,
  PaperclipIcon,
  PulseIcon,
  ServerIcon,
  SmileyIcon,
} from "@primer/octicons-react";
import React from "react";
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
  replyToPost?: any;
  textareaRef?: React.RefObject<HTMLTextAreaElement | null> | undefined;
  onInsertEmoji?: ((emoji: string) => void) | undefined;
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
}) => {
  const emojiWrapperRef = React.useRef<HTMLDivElement>(null);

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
      <Box display="flex" gap={1} mb={2} flexWrap="wrap">
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
