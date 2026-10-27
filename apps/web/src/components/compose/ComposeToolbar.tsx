// SPDX-License-Identifier: AGPL-3.0-or-later

/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  BookIcon,
  CodeIcon,
  ImageIcon,
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
}) => {
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
              ? "💾 Update Tutorial"
              : "💾 Save Changes"
            : replyToPost
              ? "Reply"
              : isNotebookMode
                ? "📓 Publish Tutorial"
                : "⚡ Publish & Run"}
        </TweetButton>
      </Box>
    </Box>
  );
};
