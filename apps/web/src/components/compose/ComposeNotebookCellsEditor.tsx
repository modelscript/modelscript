// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  ChevronDownIcon,
  ChevronUpIcon,
  CodeIcon,
  PaperclipIcon,
  PlusIcon,
  PulseIcon,
  TrashIcon,
} from "@primer/octicons-react";
import React from "react";
import type { NotebookCell } from "../../util/notebook";
import ArtifactViewCard from "../artifacts/ArtifactViewCard";
import Box from "../Box";
import {
  ArtifactCaptionInput,
  CellActionBtn,
  CommandPill,
  NotebookCellCard,
  NotebookCellHeader,
  NotebookCellTextarea,
} from "./styles";

export interface ComposeNotebookCellsEditorProps {
  notebookCells: NotebookCell[];
  activeCellId: string | null;
  setActiveCellId: (id: string | null) => void;
  insertMarkdownSnippet: (cellId: string, snippet: string) => void;
  moveCell: (cellId: string, direction: -1 | 1) => void;
  addMarkdownCellAfter: (cellId?: string | undefined) => void;
  removeCell: (cellId: string) => void;
  updateMarkdownCell: (cellId: string, content: string) => void;
  updateArtifactCellCaption: (cellId: string, caption: string) => void;
  updateTokenState: (value: string, cursorPosition: number) => void;
  handleInteraction: (e: React.SyntheticEvent<HTMLTextAreaElement>) => void;
  handleSubmit: () => void;
  setMentionQuery: (q: { query: string; index: number } | null) => void;
  setHashtagQuery: (q: { query: string; index: number } | null) => void;
  setPendingInsertAfterCellId: (id: string | null) => void;
  setShowCodeSnippetModal: (show: boolean) => void;
  setShowMorselModal: (show: boolean) => void;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
}

export const ComposeNotebookCellsEditor: React.FC<ComposeNotebookCellsEditorProps> = ({
  notebookCells,
  activeCellId,
  setActiveCellId,
  insertMarkdownSnippet,
  moveCell,
  addMarkdownCellAfter,
  removeCell,
  updateMarkdownCell,
  updateArtifactCellCaption,
  updateTokenState,
  handleInteraction,
  handleSubmit,
  setMentionQuery,
  setHashtagQuery,
  setPendingInsertAfterCellId,
  setShowCodeSnippetModal,
  setShowMorselModal,
  fileInputRef,
}) => {
  return (
    <>
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
              <div style={{ display: "flex", alignItems: "center", gap: "4px", flexWrap: "wrap" }}>
                {cell.type === "markdown" && (
                  <>
                    <CellActionBtn
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        insertMarkdownSnippet(cell.id, `## ${idx + 1}. Section Title\n\n`);
                      }}
                      title="Insert H2 section heading (indexed in Table of Contents)"
                    >
                      H2
                    </CellActionBtn>
                    <CellActionBtn
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        insertMarkdownSnippet(cell.id, `### Subsection\n\n`);
                      }}
                      title="Insert H3 subsection heading"
                    >
                      H3
                    </CellActionBtn>
                    <CellActionBtn
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setActiveCellId(cell.id);
                        setShowCodeSnippetModal(true);
                      }}
                      title="Insert syntax-highlighted code block with filename & IDE launcher"
                    >
                      {"</>"} Code
                    </CellActionBtn>
                    <CellActionBtn
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        insertMarkdownSnippet(
                          cell.id,
                          `$$\nm \\cdot \\ddot{x} + c \\cdot \\dot{x} + k \\cdot x = 0\n$$`,
                        );
                      }}
                      title="Insert LaTeX display math block ($$...$$)"
                    >
                      ∑ Math
                    </CellActionBtn>
                    <CellActionBtn
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        insertMarkdownSnippet(
                          cell.id,
                          `> [!TIP]\n> **Pro Tip:** Describe a practical engineering best practice or solver tip here.`,
                        );
                      }}
                      title="Insert Baeldung/GitHub-style Pro Tip callout box"
                    >
                      💡 Tip
                    </CellActionBtn>
                    <CellActionBtn
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        insertMarkdownSnippet(
                          cell.id,
                          `> [!NOTE]\n> **Engineering Note:** Highlight an important assumption or DAE formulation detail.`,
                        );
                      }}
                      title="Insert Engineering Note callout box"
                    >
                      ℹ️ Note
                    </CellActionBtn>
                    <CellActionBtn
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        insertMarkdownSnippet(
                          cell.id,
                          `| Parameter | Symbol | Value | Unit |\n| :--- | :--- | :--- | :--- |\n| Mass | $m$ | \`1.0\` | kg |\n| Damping | $c$ | \`0.4\` | N·s/m |\n| Stiffness | $k$ | \`25.0\` | N/m |`,
                        );
                      }}
                      title="Insert Markdown parameter table"
                    >
                      ⊞ Table
                    </CellActionBtn>
                  </>
                )}
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
                rows={Math.max(3, Math.min(18, cell.content.split("\n").length + 1))}
                placeholder={
                  idx === 0
                    ? "Write ## 1. Overview, equations ($...$), callouts (> [!TIP]), or code blocks..."
                    : "Continue your tutorial section, code explanation, or simulation analysis..."
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

      <Box display="flex" gap={2} style={{ flexWrap: "wrap", paddingTop: "4px" }} alignItems="center">
        <CommandPill type="button" onClick={() => addMarkdownCellAfter(notebookCells[notebookCells.length - 1]?.id)}>
          <span className="pill-icon">
            <PlusIcon size={11} />
          </span>
          <span>Add Text Section</span>
        </CommandPill>
        <CommandPill
          type="button"
          onClick={() => {
            setShowCodeSnippetModal(true);
          }}
        >
          <span className="pill-icon">
            <CodeIcon size={11} />
          </span>
          <span>Insert Code Block</span>
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
            fileInputRef.current?.click();
          }}
        >
          <span className="pill-icon">
            <PaperclipIcon size={11} />
          </span>
          <span>Insert CAD / Media Cell</span>
        </CommandPill>
      </Box>
    </>
  );
};
