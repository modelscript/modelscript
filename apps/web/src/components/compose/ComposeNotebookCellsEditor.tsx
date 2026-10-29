// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  ArrowDownIcon,
  ArrowUpIcon,
  CodeIcon,
  CopyIcon,
  GrabberIcon,
  ImageIcon,
  PackageIcon,
  PaperclipIcon,
  PlusIcon,
  PulseIcon,
  SparklesFillIcon,
  TrashIcon,
} from "@primer/octicons-react";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { NotebookCell } from "../../util/notebook";
import ArtifactViewCard from "../artifacts/ArtifactViewCard";
import {
  ArtifactCaptionInput,
  NotebookCellTextarea,
  NotionBlockGutter,
  NotionBlockRow,
  NotionGhostButton,
  NotionGutterIconButton,
  SlashMenuItemButton,
  SlashMenuPopover,
  SlashMenuSectionTitle,
} from "./styles";

export interface ComposeNotebookCellsEditorProps {
  notebookCells: NotebookCell[];
  activeCellId: string | null;
  setActiveCellId: (id: string | null) => void;
  insertMarkdownSnippet: (cellId: string, snippet: string) => void;
  moveCell: (cellId: string, direction: -1 | 1) => void;
  addMarkdownCellAfter: (cellId?: string | null | undefined, initialContent?: string) => string | undefined;
  duplicateCell?: ((cellId: string) => string | null) | undefined;
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
  setShowPackageRepoPicker?: ((show: boolean) => void) | undefined;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onPolishCell?: ((cellId: string) => void) | undefined;
  onDraftFromArtifactCell?: ((artifactId: number, cellId: string) => void) | undefined;
  aiBusy?: "drafting" | "polishing" | null | undefined;
}

interface SlashCommandItem {
  id: string;
  category: "Basic blocks" | "Media & technical" | "Interactive engineering";
  title: string;
  description: string;
  icon: React.ReactNode;
  keywords: string[];
}

const SLASH_COMMANDS: SlashCommandItem[] = [
  {
    id: "text",
    category: "Basic blocks",
    title: "Text",
    description: "Start writing plain text or Markdown",
    icon: "T",
    keywords: ["text", "paragraph", "plain", "markdown", "p"],
  },
  {
    id: "h1",
    category: "Basic blocks",
    title: "Heading 1",
    description: "Big section heading",
    icon: "H1",
    keywords: ["h1", "heading1", "title", "large"],
  },
  {
    id: "h2",
    category: "Basic blocks",
    title: "Heading 2",
    description: "Medium section heading (indexed in ToC)",
    icon: "H2",
    keywords: ["h2", "heading2", "section", "subtitle"],
  },
  {
    id: "h3",
    category: "Basic blocks",
    title: "Heading 3",
    description: "Small subsection heading",
    icon: "H3",
    keywords: ["h3", "heading3", "subsection"],
  },
  {
    id: "bullet",
    category: "Basic blocks",
    title: "Bulleted List",
    description: "Create a simple bulleted list",
    icon: "•",
    keywords: ["bullet", "list", "ul"],
  },
  {
    id: "number",
    category: "Basic blocks",
    title: "Numbered List",
    description: "Create a list with numbering",
    icon: "1.",
    keywords: ["number", "ordered", "list", "ol"],
  },
  {
    id: "callout",
    category: "Basic blocks",
    title: "Callout",
    description: "Highlight an engineering tip or key note",
    icon: "💡",
    keywords: ["callout", "tip", "note", "info", "alert"],
  },
  {
    id: "quote",
    category: "Basic blocks",
    title: "Quote",
    description: "Capture a quote or theorem statement",
    icon: "❝",
    keywords: ["quote", "blockquote", "citation"],
  },
  {
    id: "divider",
    category: "Basic blocks",
    title: "Divider",
    description: "Visually divide blocks with a line",
    icon: "—",
    keywords: ["divider", "hr", "line", "separator"],
  },
  {
    id: "picture",
    category: "Media & technical",
    title: "Picture / Image",
    description: "Upload an image, plot, or diagram",
    icon: <ImageIcon size={14} />,
    keywords: ["picture", "image", "photo", "png", "jpg", "svg", "diagram", "img"],
  },
  {
    id: "code",
    category: "Media & technical",
    title: "Code Block",
    description: "Syntax-highlighted code block",
    icon: <CodeIcon size={14} />,
    keywords: ["code", "snippet", "modelica", "python", "typescript", "script"],
  },
  {
    id: "math",
    category: "Media & technical",
    title: "Math Equation",
    description: "Display LaTeX equation block ($$...$$)",
    icon: "∑",
    keywords: ["math", "equation", "latex", "formula", "katex"],
  },
  {
    id: "table",
    category: "Media & technical",
    title: "Table",
    description: "Insert a structured Markdown table",
    icon: "⊞",
    keywords: ["table", "grid", "parameters", "rows"],
  },
  {
    id: "morsel",
    category: "Interactive engineering",
    title: "Interactive Model",
    description: "Embed a live runnable simulation model",
    icon: <PulseIcon size={14} />,
    keywords: ["model", "morsel", "simulation", "interactive", "circuit", "dae"],
  },
  {
    id: "cad",
    category: "Interactive engineering",
    title: "3D CAD / File Artifact",
    description: "Attach STEP, glTF, USDZ, CSV, PDF, or FMU",
    icon: <PaperclipIcon size={14} />,
    keywords: ["cad", "3d", "step", "gltf", "file", "fmu", "csv", "pdf", "upload"],
  },
  {
    id: "package",
    category: "Interactive engineering",
    title: "Package or Repository",
    description: "Embed a ModelScript package or Git repo",
    icon: <PackageIcon size={14} />,
    keywords: ["package", "repo", "repository", "library", "git"],
  },
];

const CODE_BLOCK_LANGUAGES = [
  { id: "modelica", label: "Modelica" },
  { id: "modelscript", label: "ModelScript" },
  { id: "sysml2", label: "SysML v2" },
  { id: "python", label: "Python" },
  { id: "typescript", label: "TypeScript" },
  { id: "rust", label: "Rust" },
  { id: "cpp", label: "C++" },
  { id: "julia", label: "Julia" },
  { id: "matlab", label: "MATLAB" },
  { id: "scad", label: "OpenSCAD" },
  { id: "json", label: "JSON" },
  { id: "bash", label: "Bash" },
] as const;

function detectMarkdownVariant(content: string): {
  kind: "p" | "h1" | "h2" | "h3" | "quote" | "callout" | "code" | "math" | "divider";
  codeLang?: string;
  codeFilename?: string;
  codeBody?: string;
  mathBody?: string;
} {
  const trimmed = content.trim();
  if (trimmed === "---" || trimmed === "***") {
    return { kind: "divider" };
  }
  const codeMatch = content.match(/^```([a-zA-Z0-9_-]*)\n([\s\S]*?)\n?```$/);
  if (codeMatch) {
    const codeLang = codeMatch[1] || "modelica";
    let rawBody = codeMatch[2] ?? "";
    let codeFilename = "";
    const fileMatch = rawBody.match(/^\/\/\s*File:\s*([^\n]+)\n([\s\S]*)$/);
    if (fileMatch) {
      codeFilename = fileMatch[1]!.trim();
      rawBody = fileMatch[2] ?? "";
    }
    return { kind: "code", codeLang, codeFilename, codeBody: rawBody };
  }
  const mathMatch = content.match(/^\$\$\n?([\s\S]*?)\n?\$\$$/);
  if (mathMatch) {
    return { kind: "math", mathBody: mathMatch[1] ?? "" };
  }
  if (content.startsWith("# ")) return { kind: "h1" };
  if (content.startsWith("## ")) return { kind: "h2" };
  if (content.startsWith("### ")) return { kind: "h3" };
  if (content.startsWith("> [!")) return { kind: "callout" };
  if (content.startsWith("> ")) return { kind: "quote" };
  return { kind: "p" };
}

export const ComposeNotebookCellsEditor: React.FC<ComposeNotebookCellsEditorProps> = ({
  notebookCells,
  activeCellId,
  setActiveCellId,
  moveCell,
  addMarkdownCellAfter,
  duplicateCell,
  removeCell,
  updateMarkdownCell,
  updateArtifactCellCaption,
  updateTokenState,
  handleInteraction,
  handleSubmit,
  setMentionQuery,
  setHashtagQuery,
  setPendingInsertAfterCellId,
  setShowMorselModal,
  setShowPackageRepoPicker,
  fileInputRef,
  onPolishCell,
  onDraftFromArtifactCell,
  aiBusy,
}) => {
  const [slashMenuState, setSlashMenuState] = useState<{
    cellId: string;
    query: string;
    selectedIndex: number;
    replaceSlashText: boolean;
  } | null>(null);
  const [blockActionMenuCellId, setBlockActionMenuCellId] = useState<string | null>(null);
  const [pendingFileOpen, setPendingFileOpen] = useState(false);
  const menuContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!pendingFileOpen) return;
    setPendingFileOpen(false);
    fileInputRef.current?.click();
  }, [pendingFileOpen, fileInputRef]);

  // Auto-resize all textareas whenever cells change
  useEffect(() => {
    const container = menuContainerRef.current;
    if (!container) return;
    const textareas = container.querySelectorAll<HTMLTextAreaElement>("textarea[data-cell-id]");
    textareas.forEach((el) => {
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight}px`;
    });
  }, [notebookCells]);

  // Focus active cell when requested
  const focusCell = useCallback(
    (cellId: string, caretPosition: "start" | "end" = "end") => {
      setActiveCellId(cellId);
      requestAnimationFrame(() => {
        const el = document.querySelector<HTMLTextAreaElement>(`textarea[data-cell-id="${cellId}"]`);
        if (el) {
          el.focus();
          const pos = caretPosition === "start" ? 0 : el.value.length;
          el.setSelectionRange(pos, pos);
        }
      });
    },
    [setActiveCellId],
  );

  // Close floating menus on outside click
  useEffect(() => {
    if (!slashMenuState && !blockActionMenuCellId) return;
    const handleMouseDown = (e: MouseEvent) => {
      if (menuContainerRef.current && !menuContainerRef.current.contains(e.target as Node)) {
        setSlashMenuState(null);
        setBlockActionMenuCellId(null);
      }
    };
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [slashMenuState, blockActionMenuCellId]);

  const filteredSlashCommands = useMemo(() => {
    if (!slashMenuState) return SLASH_COMMANDS;
    const q = slashMenuState.query.trim().toLowerCase();
    if (!q) return SLASH_COMMANDS;
    return SLASH_COMMANDS.filter(
      (cmd) =>
        cmd.title.toLowerCase().includes(q) ||
        cmd.description.toLowerCase().includes(q) ||
        cmd.keywords.some((k) => k.includes(q)),
    );
  }, [slashMenuState]);

  const executeSlashCommand = useCallback(
    (cmd: SlashCommandItem, targetCellId: string, replaceSlashText: boolean) => {
      setSlashMenuState(null);
      const cell = notebookCells.find((c) => c.id === targetCellId);

      // Strip `/query` if triggered by typing `/` in a markdown cell
      let baseText = "";
      if (cell && cell.type === "markdown") {
        baseText = replaceSlashText ? cell.content.replace(/(?:^|\n)\/[a-zA-Z0-9_-]*$/, "") : cell.content;
      }

      const applyOrInsertMarkdown = (newContent: string) => {
        if (cell && cell.type === "markdown" && !baseText.trim()) {
          updateMarkdownCell(targetCellId, newContent);
          focusCell(targetCellId, "end");
        } else {
          if (cell && cell.type === "markdown" && replaceSlashText) {
            updateMarkdownCell(targetCellId, baseText);
          }
          const newId = addMarkdownCellAfter(targetCellId, newContent);
          if (typeof newId === "string") {
            focusCell(newId, "end");
          }
        }
      };

      switch (cmd.id) {
        case "text":
          applyOrInsertMarkdown("");
          break;
        case "h1":
          applyOrInsertMarkdown("# ");
          break;
        case "h2":
          applyOrInsertMarkdown("## ");
          break;
        case "h3":
          applyOrInsertMarkdown("### ");
          break;
        case "bullet":
          applyOrInsertMarkdown("- ");
          break;
        case "number":
          applyOrInsertMarkdown("1. ");
          break;
        case "callout":
          applyOrInsertMarkdown("> [!TIP]\n> ");
          break;
        case "quote":
          applyOrInsertMarkdown("> ");
          break;
        case "divider": {
          applyOrInsertMarkdown("---");
          const afterId = addMarkdownCellAfter(targetCellId, "");
          if (typeof afterId === "string") {
            focusCell(afterId, "start");
          }
          break;
        }
        case "code":
          applyOrInsertMarkdown("```modelica\n\n```");
          break;
        case "math":
          applyOrInsertMarkdown("$$\n\n$$");
          break;
        case "table":
          applyOrInsertMarkdown(
            "| Parameter | Symbol | Value | Unit |\n| :--- | :--- | :--- | :--- |\n| Mass | $m$ | `1.0` | kg |\n| Damping | $c$ | `0.4` | N·s/m |",
          );
          break;
        case "picture":
        case "cad":
          if (cell && cell.type === "markdown" && replaceSlashText) {
            updateMarkdownCell(targetCellId, baseText);
          }
          setPendingInsertAfterCellId(targetCellId);
          setPendingFileOpen(true);
          break;
        case "morsel":
          if (cell && cell.type === "markdown" && replaceSlashText) {
            updateMarkdownCell(targetCellId, baseText);
          }
          setPendingInsertAfterCellId(targetCellId);
          setShowMorselModal(true);
          break;
        case "package":
          if (cell && cell.type === "markdown" && replaceSlashText) {
            updateMarkdownCell(targetCellId, baseText);
          }
          setPendingInsertAfterCellId(targetCellId);
          if (setShowPackageRepoPicker) {
            setShowPackageRepoPicker(true);
          } else {
            setShowMorselModal(true);
          }
          break;
      }
    },
    [
      notebookCells,
      updateMarkdownCell,
      focusCell,
      addMarkdownCellAfter,
      setPendingInsertAfterCellId,
      setShowMorselModal,
      setShowPackageRepoPicker,
    ],
  );

  const transformMarkdownBlock = (
    cellId: string,
    targetType: "p" | "h1" | "h2" | "h3" | "quote" | "callout" | "code",
  ) => {
    setBlockActionMenuCellId(null);
    const cell = notebookCells.find((c) => c.id === cellId);
    if (!cell || cell.type !== "markdown") return;

    // Strip existing heading / quote / code prefixes
    let stripped = cell.content
      .replace(/^#{1,3}\s+/, "")
      .replace(/^>\s*(\[![A-Z]+\]\s*\n?>\s*)?/, "")
      .replace(/^```[a-zA-Z0-9_-]*\n([\s\S]*?)\n?```$/, "$1")
      .trim();

    switch (targetType) {
      case "p":
        updateMarkdownCell(cellId, stripped);
        break;
      case "h1":
        updateMarkdownCell(cellId, `# ${stripped}`);
        break;
      case "h2":
        updateMarkdownCell(cellId, `## ${stripped}`);
        break;
      case "h3":
        updateMarkdownCell(cellId, `### ${stripped}`);
        break;
      case "quote":
        updateMarkdownCell(cellId, `> ${stripped}`);
        break;
      case "callout":
        updateMarkdownCell(cellId, `> [!TIP]\n> ${stripped}`);
        break;
      case "code":
        updateMarkdownCell(cellId, `\`\`\`modelica\n${stripped}\n\`\`\``);
        break;
    }
    focusCell(cellId, "end");
  };

  return (
    <div ref={menuContainerRef} style={{ display: "flex", flexDirection: "column", gap: "4px", flex: 1 }}>
      {notebookCells.map((cell, idx) => {
        const isFirst = idx === 0;
        const isLast = idx === notebookCells.length - 1;
        const isActive = activeCellId === cell.id;
        const isSlashOpenForCell = slashMenuState?.cellId === cell.id;
        const isActionMenuOpen = blockActionMenuCellId === cell.id;

        const mdInfo = cell.type === "markdown" ? detectMarkdownVariant(cell.content) : null;

        return (
          <NotionBlockRow key={cell.id} $active={isActive} onClick={() => setActiveCellId(cell.id)}>
            {/* Notion Left Gutter (+ and ⋮⋮) */}
            <NotionBlockGutter className="notion-block-gutter">
              <NotionGutterIconButton
                type="button"
                title="Click to add a block below"
                aria-label="Add block"
                onClick={(e) => {
                  e.stopPropagation();
                  setBlockActionMenuCellId(null);
                  setSlashMenuState({
                    cellId: cell.id,
                    query: "",
                    selectedIndex: 0,
                    replaceSlashText: false,
                  });
                }}
              >
                <PlusIcon size={14} />
              </NotionGutterIconButton>
              <NotionGutterIconButton
                type="button"
                title="Click to open block menu"
                aria-label="Block options"
                onClick={(e) => {
                  e.stopPropagation();
                  setSlashMenuState(null);
                  setBlockActionMenuCellId(isActionMenuOpen ? null : cell.id);
                }}
              >
                <GrabberIcon size={14} />
              </NotionGutterIconButton>
            </NotionBlockGutter>

            {/* Block Content */}
            {cell.type === "markdown" && mdInfo ? (
              mdInfo.kind === "divider" ? (
                <div
                  style={{
                    padding: "14px 0",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: "12px",
                  }}
                  onClick={() => setActiveCellId(cell.id)}
                >
                  <hr
                    style={{
                      flex: 1,
                      border: "none",
                      borderTop: "1px solid var(--ms-divider)",
                      margin: 0,
                    }}
                  />
                  {isActive && (
                    <NotionGhostButton
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeCell(cell.id);
                      }}
                    >
                      <TrashIcon size={12} /> Remove divider
                    </NotionGhostButton>
                  )}
                </div>
              ) : mdInfo.kind === "code" ? (
                <div
                  style={{
                    margin: "8px 0",
                    borderRadius: "10px",
                    border: "1px solid var(--ms-divider)",
                    background: "var(--color-pre-bg, #f8fafc)",
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "6px 12px",
                      borderBottom: "1px solid var(--ms-divider)",
                      gap: "8px",
                      flexWrap: "wrap",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <select
                        value={mdInfo.codeLang || "modelica"}
                        onChange={(e) => {
                          const nextLang = e.target.value;
                          const fileHeader = mdInfo.codeFilename ? `// File: ${mdInfo.codeFilename}\n` : "";
                          updateMarkdownCell(
                            cell.id,
                            `\`\`\`${nextLang}\n${fileHeader}${mdInfo.codeBody || ""}\n\`\`\``,
                          );
                        }}
                        style={{
                          padding: "3px 8px",
                          fontSize: "12px",
                          fontWeight: 600,
                          fontFamily: "var(--font-mono, monospace)",
                          borderRadius: "6px",
                          border: "1px solid var(--ms-border)",
                          background: "var(--color-canvas-inset, #ffffff)",
                          color: "var(--ms-text-1)",
                          outline: "none",
                          cursor: "pointer",
                        }}
                      >
                        {CODE_BLOCK_LANGUAGES.map((lang) => (
                          <option key={lang.id} value={lang.id}>
                            {lang.label}
                          </option>
                        ))}
                      </select>
                      <input
                        type="text"
                        placeholder="Filename (optional, e.g. Oscillator.mo)"
                        value={mdInfo.codeFilename || ""}
                        onChange={(e) => {
                          const nextFile = e.target.value;
                          const fileHeader = nextFile.trim() ? `// File: ${nextFile.trim()}\n` : "";
                          updateMarkdownCell(
                            cell.id,
                            `\`\`\`${mdInfo.codeLang || "modelica"}\n${fileHeader}${mdInfo.codeBody || ""}\n\`\`\``,
                          );
                        }}
                        style={{
                          padding: "3px 8px",
                          fontSize: "12px",
                          fontFamily: "var(--font-mono, monospace)",
                          borderRadius: "6px",
                          border: "1px solid transparent",
                          background: "transparent",
                          color: "var(--ms-text-2)",
                          outline: "none",
                          width: "220px",
                        }}
                      />
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                      <NotionGhostButton
                        type="button"
                        onClick={() => transformMarkdownBlock(cell.id, "p")}
                        title="Convert code block to plain text"
                      >
                        Plain text
                      </NotionGhostButton>
                      <NotionGhostButton type="button" onClick={() => removeCell(cell.id)} title="Remove code block">
                        <TrashIcon size={12} />
                      </NotionGhostButton>
                    </div>
                  </div>
                  <textarea
                    data-cell-id={cell.id}
                    value={mdInfo.codeBody || ""}
                    placeholder="Write or paste code here..."
                    rows={Math.max(3, (mdInfo.codeBody || "").split("\n").length)}
                    onFocus={() => setActiveCellId(cell.id)}
                    onChange={(e) => {
                      const nextCode = e.target.value;
                      const fileHeader = mdInfo.codeFilename ? `// File: ${mdInfo.codeFilename}\n` : "";
                      updateMarkdownCell(
                        cell.id,
                        `\`\`\`${mdInfo.codeLang || "modelica"}\n${fileHeader}${nextCode}\n\`\`\``,
                      );
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Tab") {
                        e.preventDefault();
                        const target = e.currentTarget;
                        const start = target.selectionStart;
                        const end = target.selectionEnd;
                        const body = mdInfo.codeBody || "";
                        const nextCode = `${body.slice(0, start)}  ${body.slice(end)}`;
                        const fileHeader = mdInfo.codeFilename ? `// File: ${mdInfo.codeFilename}\n` : "";
                        updateMarkdownCell(
                          cell.id,
                          `\`\`\`${mdInfo.codeLang || "modelica"}\n${fileHeader}${nextCode}\n\`\`\``,
                        );
                        requestAnimationFrame(() => {
                          target.setSelectionRange(start + 2, start + 2);
                        });
                      } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                        e.preventDefault();
                        const nextId = addMarkdownCellAfter(cell.id, "");
                        if (typeof nextId === "string") focusCell(nextId, "start");
                      }
                    }}
                    style={{
                      width: "100%",
                      border: "none",
                      outline: "none",
                      resize: "none",
                      overflow: "hidden",
                      padding: "12px 14px",
                      fontSize: "13.5px",
                      lineHeight: 1.6,
                      fontFamily: "var(--font-mono, monospace)",
                      background: "transparent",
                      color: "var(--ms-text-1)",
                      boxSizing: "border-box",
                    }}
                  />
                </div>
              ) : mdInfo.kind === "math" ? (
                <div
                  style={{
                    margin: "8px 0",
                    borderRadius: "10px",
                    border: "1px solid var(--ms-divider)",
                    background: "var(--ms-surface-hover, rgba(15, 23, 42, 0.025))",
                    padding: "10px 14px",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      marginBottom: "6px",
                    }}
                  >
                    <span
                      style={{
                        fontSize: "11.5px",
                        fontWeight: 600,
                        fontFamily: "var(--font-mono, monospace)",
                        color: "var(--ms-text-3)",
                      }}
                    >
                      ∑ LaTeX Equation Block
                    </span>
                    <div style={{ display: "flex", gap: "4px" }}>
                      <NotionGhostButton type="button" onClick={() => transformMarkdownBlock(cell.id, "p")}>
                        Plain text
                      </NotionGhostButton>
                      <NotionGhostButton type="button" onClick={() => removeCell(cell.id)}>
                        <TrashIcon size={12} />
                      </NotionGhostButton>
                    </div>
                  </div>
                  <textarea
                    data-cell-id={cell.id}
                    value={mdInfo.mathBody || ""}
                    placeholder="e.g. m \ddot{x}(t) + c \dot{x}(t) + k x(t) = F(t)"
                    rows={Math.max(2, (mdInfo.mathBody || "").split("\n").length)}
                    onFocus={() => setActiveCellId(cell.id)}
                    onChange={(e) => {
                      updateMarkdownCell(cell.id, `$$\n${e.target.value}\n$$`);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                        e.preventDefault();
                        const nextId = addMarkdownCellAfter(cell.id, "");
                        if (typeof nextId === "string") focusCell(nextId, "start");
                      }
                    }}
                    style={{
                      width: "100%",
                      border: "none",
                      outline: "none",
                      resize: "none",
                      overflow: "hidden",
                      padding: "4px 0",
                      fontSize: "14px",
                      lineHeight: 1.55,
                      fontFamily: "var(--font-mono, monospace)",
                      background: "transparent",
                      color: "var(--ms-text-1)",
                      boxSizing: "border-box",
                    }}
                  />
                </div>
              ) : (
                <NotebookCellTextarea
                  data-cell-id={cell.id}
                  $variant={mdInfo.kind}
                  value={cell.content}
                  rows={1}
                  placeholder={
                    idx === 0 && notebookCells.length === 1
                      ? "Type '/' for commands (headings, pictures, code, math, models), or start writing..."
                      : isActive
                        ? "Type '/' for commands, or continue writing..."
                        : ""
                  }
                  onFocus={() => setActiveCellId(cell.id)}
                  onChange={(e) => {
                    const val = e.target.value;
                    setActiveCellId(cell.id);
                    updateMarkdownCell(cell.id, val);
                    updateTokenState(val, e.target.selectionStart);

                    // Detect slash command at start of block or start of new line
                    const slashMatch = val.match(/(?:^|\n)\/([a-zA-Z0-9_-]*)$/);
                    if (slashMatch) {
                      setSlashMenuState({
                        cellId: cell.id,
                        query: slashMatch[1] || "",
                        selectedIndex: 0,
                        replaceSlashText: true,
                      });
                    } else if (slashMenuState?.cellId === cell.id && slashMenuState.replaceSlashText) {
                      setSlashMenuState(null);
                    }
                  }}
                  onKeyUp={handleInteraction}
                  onClick={handleInteraction}
                  onKeyDown={(e) => {
                    if (isSlashOpenForCell && filteredSlashCommands.length > 0) {
                      if (e.key === "ArrowDown") {
                        e.preventDefault();
                        setSlashMenuState((prev) =>
                          prev
                            ? {
                                ...prev,
                                selectedIndex: (prev.selectedIndex + 1) % filteredSlashCommands.length,
                              }
                            : null,
                        );
                        return;
                      }
                      if (e.key === "ArrowUp") {
                        e.preventDefault();
                        setSlashMenuState((prev) =>
                          prev
                            ? {
                                ...prev,
                                selectedIndex:
                                  (prev.selectedIndex - 1 + filteredSlashCommands.length) %
                                  filteredSlashCommands.length,
                              }
                            : null,
                        );
                        return;
                      }
                      if (e.key === "Enter" || e.key === "Tab") {
                        e.preventDefault();
                        const chosen = filteredSlashCommands[slashMenuState.selectedIndex] ?? filteredSlashCommands[0]!;
                        executeSlashCommand(chosen, cell.id, slashMenuState.replaceSlashText);
                        return;
                      }
                      if (e.key === "Escape") {
                        e.preventDefault();
                        setSlashMenuState(null);
                        return;
                      }
                    }

                    // Pressing Enter at the end of a heading creates a new paragraph block below
                    if (
                      e.key === "Enter" &&
                      !e.shiftKey &&
                      !e.ctrlKey &&
                      !e.metaKey &&
                      (mdInfo.kind === "h1" || mdInfo.kind === "h2" || mdInfo.kind === "h3")
                    ) {
                      e.preventDefault();
                      const nextId = addMarkdownCellAfter(cell.id, "");
                      if (typeof nextId === "string") {
                        focusCell(nextId, "start");
                      }
                      return;
                    }

                    // Backspace on an empty block removes it and focuses the previous block
                    if (e.key === "Backspace" && cell.content === "" && notebookCells.length > 1) {
                      e.preventDefault();
                      const prevCell = idx > 0 ? notebookCells[idx - 1] : notebookCells[idx + 1];
                      removeCell(cell.id);
                      if (prevCell) {
                        focusCell(prevCell.id, "end");
                      }
                      return;
                    }

                    // ArrowUp at start of block focuses previous block
                    if (
                      e.key === "ArrowUp" &&
                      e.currentTarget.selectionStart === 0 &&
                      e.currentTarget.selectionEnd === 0 &&
                      idx > 0
                    ) {
                      const prevCell = notebookCells[idx - 1];
                      if (prevCell && prevCell.type === "markdown") {
                        e.preventDefault();
                        focusCell(prevCell.id, "end");
                        return;
                      }
                    }

                    // ArrowDown at end of block focuses next block
                    if (
                      e.key === "ArrowDown" &&
                      e.currentTarget.selectionStart === cell.content.length &&
                      idx < notebookCells.length - 1
                    ) {
                      const nextCell = notebookCells[idx + 1];
                      if (nextCell && nextCell.type === "markdown") {
                        e.preventDefault();
                        focusCell(nextCell.id, "start");
                        return;
                      }
                    }

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
              )
            ) : (
              /* Embedded Media / Picture / CAD / Interactive Model Block */
              <div
                style={{
                  margin: "10px 0",
                  borderRadius: "12px",
                  border: "1px solid var(--ms-divider)",
                  background: "var(--color-canvas-inset, #ffffff)",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "6px 12px",
                    borderBottom: "1px solid var(--ms-divider)",
                    background: "var(--ms-surface-hover, rgba(15, 23, 42, 0.02))",
                  }}
                >
                  <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--ms-text-2)" }}>
                    {cell.title || `Embedded Artifact #${cell.artifactId}`}
                  </span>
                  <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                    {onDraftFromArtifactCell && (
                      <NotionGhostButton
                        type="button"
                        disabled={Boolean(aiBusy)}
                        onClick={(e) => {
                          e.stopPropagation();
                          onDraftFromArtifactCell(cell.artifactId, cell.id);
                        }}
                        title="Generate an explanation section below using AI"
                      >
                        <SparklesFillIcon size={12} />
                        <span>Explain with AI</span>
                      </NotionGhostButton>
                    )}
                    <NotionGhostButton
                      type="button"
                      disabled={isFirst}
                      onClick={(e) => {
                        e.stopPropagation();
                        moveCell(cell.id, -1);
                      }}
                      title="Move block up"
                    >
                      <ArrowUpIcon size={12} />
                    </NotionGhostButton>
                    <NotionGhostButton
                      type="button"
                      disabled={isLast}
                      onClick={(e) => {
                        e.stopPropagation();
                        moveCell(cell.id, 1);
                      }}
                      title="Move block down"
                    >
                      <ArrowDownIcon size={12} />
                    </NotionGhostButton>
                    <NotionGhostButton
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeCell(cell.id);
                      }}
                      title="Remove block"
                    >
                      <TrashIcon size={12} />
                    </NotionGhostButton>
                  </div>
                </div>
                <div style={{ padding: "8px" }}>
                  <ArtifactViewCard artifactId={cell.artifactId} />
                </div>
                <div style={{ padding: "0 12px 6px" }}>
                  <ArtifactCaptionInput
                    type="text"
                    placeholder="Write a caption for this figure or model..."
                    value={cell.caption || ""}
                    onChange={(e) => updateArtifactCellCaption(cell.id, e.target.value)}
                  />
                </div>
              </div>
            )}

            {/* Slash Command Menu Popover */}
            {isSlashOpenForCell && (
              <SlashMenuPopover role="listbox" aria-label="Insert block">
                {filteredSlashCommands.length === 0 ? (
                  <div style={{ padding: "12px", fontSize: "12.5px", color: "var(--ms-text-3)", textAlign: "center" }}>
                    No matching block types
                  </div>
                ) : (
                  (["Basic blocks", "Media & technical", "Interactive engineering"] as const).map((cat) => {
                    const catItems = filteredSlashCommands.filter((c) => c.category === cat);
                    if (catItems.length === 0) return null;
                    return (
                      <React.Fragment key={cat}>
                        <SlashMenuSectionTitle>{cat}</SlashMenuSectionTitle>
                        {catItems.map((cmd) => {
                          const globalIdx = filteredSlashCommands.indexOf(cmd);
                          const isSelected = globalIdx === slashMenuState.selectedIndex;
                          return (
                            <SlashMenuItemButton
                              key={cmd.id}
                              type="button"
                              role="option"
                              aria-selected={isSelected}
                              $selected={isSelected}
                              onMouseEnter={() =>
                                setSlashMenuState((prev) => (prev ? { ...prev, selectedIndex: globalIdx } : null))
                              }
                              onClick={(e) => {
                                e.stopPropagation();
                                executeSlashCommand(cmd, cell.id, slashMenuState.replaceSlashText);
                              }}
                            >
                              <span className="slash-item-icon">{cmd.icon}</span>
                              <span className="slash-item-text">
                                <span className="slash-item-title">{cmd.title}</span>
                                <span className="slash-item-desc">{cmd.description}</span>
                              </span>
                            </SlashMenuItemButton>
                          );
                        })}
                      </React.Fragment>
                    );
                  })
                )}
              </SlashMenuPopover>
            )}

            {/* Block Action Context Menu (from ⋮⋮ handle) */}
            {isActionMenuOpen && (
              <SlashMenuPopover style={{ width: "230px" }} role="menu" aria-label="Block actions">
                {cell.type === "markdown" && (
                  <>
                    <SlashMenuSectionTitle>Turn into</SlashMenuSectionTitle>
                    {(
                      [
                        { id: "p", label: "Text", icon: "T" },
                        { id: "h1", label: "Heading 1", icon: "H1" },
                        { id: "h2", label: "Heading 2", icon: "H2" },
                        { id: "h3", label: "Heading 3", icon: "H3" },
                        { id: "code", label: "Code Block", icon: "</>" },
                        { id: "callout", label: "Callout Box", icon: "💡" },
                        { id: "quote", label: "Quote", icon: "❝" },
                      ] as const
                    ).map((opt) => (
                      <SlashMenuItemButton
                        key={opt.id}
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          transformMarkdownBlock(cell.id, opt.id);
                        }}
                      >
                        <span className="slash-item-icon" style={{ width: "26px", height: "26px", fontSize: "11px" }}>
                          {opt.icon}
                        </span>
                        <span className="slash-item-title">{opt.label}</span>
                      </SlashMenuItemButton>
                    ))}
                  </>
                )}

                <SlashMenuSectionTitle>Actions</SlashMenuSectionTitle>
                {cell.type === "markdown" && onPolishCell && (
                  <SlashMenuItemButton
                    type="button"
                    disabled={Boolean(aiBusy) || !cell.content.trim()}
                    onClick={(e) => {
                      e.stopPropagation();
                      setBlockActionMenuCellId(null);
                      onPolishCell(cell.id);
                    }}
                  >
                    <span className="slash-item-icon" style={{ width: "26px", height: "26px" }}>
                      <SparklesFillIcon size={12} />
                    </span>
                    <span className="slash-item-title">Polish block with AI</span>
                  </SlashMenuItemButton>
                )}
                {duplicateCell && (
                  <SlashMenuItemButton
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setBlockActionMenuCellId(null);
                      duplicateCell(cell.id);
                    }}
                  >
                    <span className="slash-item-icon" style={{ width: "26px", height: "26px" }}>
                      <CopyIcon size={12} />
                    </span>
                    <span className="slash-item-title">Duplicate</span>
                  </SlashMenuItemButton>
                )}
                <SlashMenuItemButton
                  type="button"
                  disabled={isFirst}
                  onClick={(e) => {
                    e.stopPropagation();
                    setBlockActionMenuCellId(null);
                    moveCell(cell.id, -1);
                  }}
                >
                  <span className="slash-item-icon" style={{ width: "26px", height: "26px" }}>
                    <ArrowUpIcon size={12} />
                  </span>
                  <span className="slash-item-title">Move up</span>
                </SlashMenuItemButton>
                <SlashMenuItemButton
                  type="button"
                  disabled={isLast}
                  onClick={(e) => {
                    e.stopPropagation();
                    setBlockActionMenuCellId(null);
                    moveCell(cell.id, 1);
                  }}
                >
                  <span className="slash-item-icon" style={{ width: "26px", height: "26px" }}>
                    <ArrowDownIcon size={12} />
                  </span>
                  <span className="slash-item-title">Move down</span>
                </SlashMenuItemButton>
                <SlashMenuItemButton
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setBlockActionMenuCellId(null);
                    removeCell(cell.id);
                  }}
                >
                  <span
                    className="slash-item-icon"
                    style={{ width: "26px", height: "26px", color: "var(--ms-danger, #ef4444)" }}
                  >
                    <TrashIcon size={12} />
                  </span>
                  <span className="slash-item-title" style={{ color: "var(--ms-danger, #ef4444)" }}>
                    Delete block
                  </span>
                </SlashMenuItemButton>
              </SlashMenuPopover>
            )}
          </NotionBlockRow>
        );
      })}

      {/* Whisper-quiet Notion-style bottom block insertion bar & clickable blank canvas */}
      <div
        onClick={() => {
          const lastCell = notebookCells[notebookCells.length - 1];
          if (lastCell && lastCell.type === "markdown" && !lastCell.content.trim()) {
            focusCell(lastCell.id, "start");
          } else {
            const newId = addMarkdownCellAfter(lastCell?.id, "");
            if (typeof newId === "string") {
              focusCell(newId, "start");
            }
          }
        }}
        style={{
          flex: 1,
          minHeight: "140px",
          paddingTop: "16px",
          cursor: "text",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "2px",
            flexWrap: "wrap",
            opacity: 0.65,
            transition: "opacity 0.15s ease",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.opacity = "1";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.opacity = "0.65";
          }}
        >
          <NotionGhostButton
            type="button"
            onClick={() => {
              const lastId = notebookCells[notebookCells.length - 1]?.id;
              if (lastId) {
                setSlashMenuState({
                  cellId: lastId,
                  query: "",
                  selectedIndex: 0,
                  replaceSlashText: false,
                });
              }
            }}
          >
            <PlusIcon size={12} />
            <span>Add block</span>
          </NotionGhostButton>
          <NotionGhostButton
            type="button"
            onClick={() => {
              const lastId = notebookCells[notebookCells.length - 1]?.id || null;
              setPendingInsertAfterCellId(lastId);
              fileInputRef.current?.click();
            }}
          >
            <ImageIcon size={12} />
            <span>Picture</span>
          </NotionGhostButton>
          <NotionGhostButton
            type="button"
            onClick={() => {
              const lastId = notebookCells[notebookCells.length - 1]?.id;
              const cmd = SLASH_COMMANDS.find((c) => c.id === "code")!;
              if (lastId) executeSlashCommand(cmd, lastId, false);
            }}
          >
            <CodeIcon size={12} />
            <span>Code</span>
          </NotionGhostButton>
          <NotionGhostButton
            type="button"
            onClick={() => {
              const lastId = notebookCells[notebookCells.length - 1]?.id;
              const cmd = SLASH_COMMANDS.find((c) => c.id === "math")!;
              if (lastId) executeSlashCommand(cmd, lastId, false);
            }}
          >
            <span style={{ fontFamily: "var(--font-mono, monospace)", fontWeight: 700 }}>∑</span>
            <span>Equation</span>
          </NotionGhostButton>
          <NotionGhostButton
            type="button"
            onClick={() => {
              const lastId = notebookCells[notebookCells.length - 1]?.id || null;
              setPendingInsertAfterCellId(lastId);
              setShowMorselModal(true);
            }}
          >
            <PulseIcon size={12} />
            <span>Interactive Model</span>
          </NotionGhostButton>
        </div>
      </div>
    </div>
  );
};
