// SPDX-License-Identifier: AGPL-3.0-or-later

import { CodeIcon, XIcon } from "@primer/octicons-react";
import { Heading, IconButton, Text } from "@primer/react";
import React from "react";
import { createPortal } from "react-dom";
import { createArtifactView } from "../../api";
import type { NotebookCell } from "../../util/notebook";
import Box from "../Box";
import { MORSEL_LANGUAGES, getLanguageInfo } from "../morsel/constants";
import { CommandPill, TweetButton } from "./styles";

const GENERAL_CODE_LANGUAGES = [
  { id: "typescript", label: "TypeScript", ext: "ts" },
  { id: "python", label: "Python", ext: "py" },
  { id: "rust", label: "Rust", ext: "rs" },
  { id: "json", label: "JSON", ext: "json" },
  { id: "bash", label: "Bash", ext: "sh" },
] as const;

export interface ComposeCodeSnippetModalProps {
  isOpen: boolean;
  onClose: () => void;
  snippetFilename: string;
  setSnippetFilename: (val: string) => void;
  snippetLang: string;
  setSnippetLang: (val: string) => void;
  snippetCode: string;
  setSnippetCode: (val: string) => void;
  token: string | null;
  isNotebookMode: boolean;
  activeCellId: string | null;
  notebookCells: NotebookCell[];
  insertMarkdownSnippet: (cellId: string, snippet: string) => void;
  content: string;
  setContent: (val: string) => void;
  attachArtifactToComposer: (id: number, title?: string) => void;
}

export const ComposeCodeSnippetModal: React.FC<ComposeCodeSnippetModalProps> = ({
  isOpen,
  onClose,
  snippetFilename,
  setSnippetFilename,
  snippetLang,
  setSnippetLang,
  snippetCode,
  setSnippetCode,
  token,
  isNotebookMode,
  activeCellId,
  notebookCells,
  insertMarkdownSnippet,
  content,
  setContent,
  attachArtifactToComposer,
}) => {
  if (!isOpen) return null;

  const snippetTitle = snippetFilename;

  const modal = (
    <>
      <div
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 99998,
          backgroundColor: "rgba(0, 0, 0, 0.72)",
          backdropFilter: "blur(6px)",
        }}
        onClick={onClose}
      />
      <Box
        position="fixed"
        top="50%"
        left="50%"
        style={{
          transform: "translate(-50%, -50%)",
          width: "640px",
          maxWidth: "94vw",
          maxHeight: "90vh",
          overflowY: "auto",
          backdropFilter: "blur(16px)",
        }}
        bg="var(--surface-overlay)"
        border="1px solid var(--color-border-glass)"
        borderRadius="16px"
        zIndex={99999}
        boxShadow="0 20px 50px rgba(0,0,0,0.65)"
        display="flex"
        flexDirection="column"
      >
        <Box
          display="flex"
          alignItems="center"
          justifyContent="space-between"
          px={3}
          py={2}
          borderBottom="1px solid var(--color-border)"
        >
          <Box display="flex" alignItems="center" gap={2}>
            <span style={{ color: "var(--color-accent-cyan)", display: "inline-flex" }}>
              <CodeIcon size={18} />
            </span>
            <Heading as="h3" style={{ fontSize: "16px", margin: 0 }}>
              Insert Code Snippet / Executable Model
            </Heading>
          </Box>
          <IconButton icon={XIcon} variant="invisible" onClick={onClose} aria-label="Close" />
        </Box>
        <Box p={3} display="flex" flexDirection="column" gap={2}>
          <Box display="flex" gap={2}>
            <input
              type="text"
              placeholder="Filename (e.g., DampedOscillator.mo)"
              value={snippetFilename}
              onChange={(e) => setSnippetFilename(e.target.value)}
              style={{
                flex: 1,
                padding: "8px 12px",
                fontSize: "13px",
                fontFamily: "var(--font-mono, monospace)",
                borderRadius: "8px",
                border: "1px solid var(--color-border-default)",
                background: "rgba(0, 0, 0, 0.3)",
                color: "var(--color-fg-default)",
                outline: "none",
              }}
            />
            <select
              value={snippetLang}
              onChange={(e) => setSnippetLang(e.target.value)}
              style={{
                padding: "8px 12px",
                fontSize: "13px",
                fontFamily: "var(--font-mono, monospace)",
                borderRadius: "8px",
                border: "1px solid var(--color-border-default)",
                background: "var(--color-bg-primary, #0b1120)",
                color: "var(--color-fg-default)",
                outline: "none",
              }}
            >
              <optgroup label="Engineering & Simulation Languages (44)">
                {MORSEL_LANGUAGES.map((lang) => (
                  <option key={lang.id} value={lang.id}>
                    {lang.label || lang.name} (.{lang.ext})
                  </option>
                ))}
              </optgroup>
              <optgroup label="General Code Blocks">
                {GENERAL_CODE_LANGUAGES.map((lang) => (
                  <option key={lang.id} value={lang.id}>
                    {lang.label} (.{lang.ext})
                  </option>
                ))}
              </optgroup>
            </select>
          </Box>
          <textarea
            rows={10}
            value={snippetCode}
            onChange={(e) => setSnippetCode(e.target.value)}
            placeholder="Paste or write Modelica / ModelScript / SysML v2 / engineering code..."
            style={{
              width: "100%",
              padding: "10px 12px",
              fontSize: "13px",
              lineHeight: 1.5,
              fontFamily: "var(--font-mono, monospace)",
              borderRadius: "10px",
              border: "1px solid var(--color-border-default)",
              background: "var(--color-pre-bg, #030712)",
              color: "var(--color-fg-default)",
              outline: "none",
              boxSizing: "border-box",
              resize: "vertical",
            }}
          />
          <Box
            display="flex"
            justifyContent="space-between"
            alignItems="center"
            style={{ paddingTop: "4px", flexWrap: "wrap" }}
            gap={2}
          >
            <Text style={{ fontSize: "11.5px", color: "var(--color-text-muted)" }}>
              Renders with Baeldung-style line numbers, syntax highlighting, Copy, and ▶ Open in Playground buttons.
            </Text>
            <Box display="flex" gap={2}>
              {token && (
                <CommandPill
                  type="button"
                  onClick={async () => {
                    try {
                      const langInfo = getLanguageInfo(snippetLang);
                      const generalLang = GENERAL_CODE_LANGUAGES.find((g) => g.id === snippetLang);
                      const langLabel = generalLang?.label || langInfo.label || langInfo.name;
                      const resolvedTitle = snippetTitle.trim() || `${langLabel} Snippet`;
                      const data = await createArtifactView({
                        artifact_type: snippetLang === "modelica" ? "modelica-code" : snippetLang,
                        view_config: JSON.stringify({
                          code: snippetCode,
                          title: resolvedTitle,
                          dialect: snippetLang,
                        }),
                        title: resolvedTitle,
                      });
                      attachArtifactToComposer(data.id, resolvedTitle);
                      onClose();
                    } catch (err) {
                      console.error(err);
                    }
                  }}
                >
                  <span>⚡ Attach as Artifact Cell</span>
                </CommandPill>
              )}
              <TweetButton
                type="button"
                onClick={() => {
                  const fileHeader = snippetFilename.trim() ? `// File: ${snippetFilename.trim()}\n` : "";
                  const fenced = `\`\`\`${snippetLang}\n${fileHeader}${snippetCode.trim()}\n\`\`\``;
                  if (isNotebookMode) {
                    const targetId =
                      activeCellId ||
                      notebookCells.find((c) => c.type === "markdown")?.id ||
                      notebookCells[notebookCells.length - 1]?.id;
                    if (targetId) {
                      insertMarkdownSnippet(targetId, fenced);
                    }
                  } else {
                    const prefix = content.trim().length > 0 && !content.endsWith("\n") ? "\n\n" : "";
                    setContent(`${content}${prefix}${fenced}`);
                  }
                  onClose();
                }}
              >
                Insert Code
              </TweetButton>
            </Box>
          </Box>
        </Box>
      </Box>
    </>
  );

  return typeof document !== "undefined" ? createPortal(modal, document.body) : modal;
};
