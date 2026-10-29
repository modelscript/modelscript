// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from "react";
import {
  createCellId,
  createStarterNotebookCells,
  extractArtifactIdsFromCells,
  hasArtifactDirectives,
  type NotebookCell,
  parseNotebookFromContent,
  serializeCellsToMarkdown,
} from "../../util/notebook";
import type { ComposeBoxProps } from "./types";

export interface UseComposeNotebookStateParams {
  content: string;
  setContent: (val: string) => void;
  artifactId: number | null;
  setArtifactId: (val: number | null) => void;
  props: ComposeBoxProps;
}

export function useComposeNotebookState({
  content,
  setContent,
  artifactId,
  setArtifactId,
  props,
}: UseComposeNotebookStateParams) {
  const [internalNotebookMode, setInternalNotebookMode] = useState(false);
  const isNotebookMode = props.notebookMode !== undefined ? props.notebookMode : internalNotebookMode;
  const setIsNotebookMode = props.setNotebookMode || setInternalNotebookMode;

  const [internalNotebookTitle, setInternalNotebookTitle] = useState("");
  const notebookTitle = props.notebookTitle !== undefined ? props.notebookTitle : internalNotebookTitle;
  const setNotebookTitle = props.setNotebookTitle || setInternalNotebookTitle;

  const [internalNotebookSummary, setInternalNotebookSummary] = useState("");
  const notebookSummary = props.notebookSummary !== undefined ? props.notebookSummary : internalNotebookSummary;
  const setNotebookSummary = props.setNotebookSummary || setInternalNotebookSummary;

  const [internalNotebookDifficulty, setInternalNotebookDifficulty] = useState<any>("Intermediate");
  const notebookDifficulty =
    props.notebookDifficulty !== undefined ? props.notebookDifficulty : internalNotebookDifficulty;
  const setNotebookDifficulty = props.setNotebookDifficulty || setInternalNotebookDifficulty;

  const [internalNotebookSeries, setInternalNotebookSeries] = useState("");
  const notebookSeries = props.notebookSeries !== undefined ? props.notebookSeries : internalNotebookSeries;
  const setNotebookSeries = props.setNotebookSeries || setInternalNotebookSeries;

  const [internalNotebookDialect, setInternalNotebookDialect] = useState("");
  const notebookDialect = props.notebookDialect !== undefined ? props.notebookDialect : internalNotebookDialect;
  const setNotebookDialect = props.setNotebookDialect || setInternalNotebookDialect;

  const [internalNotebookCompanionRepo, setInternalNotebookCompanionRepo] = useState("");
  const notebookCompanionRepo =
    props.notebookCompanionRepo !== undefined ? props.notebookCompanionRepo : internalNotebookCompanionRepo;
  const setNotebookCompanionRepo = props.setNotebookCompanionRepo || setInternalNotebookCompanionRepo;

  const [internalNotebookCells, setInternalNotebookCells] = useState<NotebookCell[]>([
    { id: createCellId("md"), type: "markdown", content: "" },
  ]);
  const notebookCells = props.notebookCells !== undefined ? props.notebookCells : internalNotebookCells;
  const setNotebookCells = props.setNotebookCells || setInternalNotebookCells;

  const [activeCellId, setActiveCellId] = useState<string | null>(null);
  const [pendingInsertAfterCellId, setPendingInsertAfterCellId] = useState<string | null>(null);
  const [showTutorialMetaEditor, setShowTutorialMetaEditor] = useState(false);

  const syncNotebookToContentAndArtifact = (cells: NotebookCell[], title?: string) => {
    setNotebookCells(cells);
    const serialized = serializeCellsToMarkdown(cells, title ?? notebookTitle);
    setContent(serialized);
    const artIds = extractArtifactIdsFromCells(cells);
    setArtifactId(artIds[0] ?? null);
  };

  const handleLoadStarterTemplate = () => {
    const starter = createStarterNotebookCells();
    if (!notebookTitle.trim()) {
      setNotebookTitle(starter.title);
    }
    if (!notebookSummary.trim()) {
      setNotebookSummary(starter.summary);
    }
    if (!notebookSeries.trim()) {
      setNotebookSeries(starter.series);
    }
    setNotebookDifficulty(starter.difficulty);
    setNotebookDialect(starter.dialect);
    syncNotebookToContentAndArtifact(starter.cells, notebookTitle.trim() || starter.title);
    setActiveCellId(starter.cells[0]?.id || null);
  };

  const insertMarkdownSnippet = (cellId: string, snippet: string) => {
    const target = notebookCells.find((c) => c.id === cellId);
    if (!target || target.type !== "markdown") return;
    const prefix = target.content.trim().length > 0 && !target.content.endsWith("\n") ? "\n\n" : "";
    updateMarkdownCell(cellId, `${target.content}${prefix}${snippet}`);
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
      setActiveCellId(nextCells[0]?.id || null);
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

  const addMarkdownCellAfter = (afterCellId?: string | null, initialContent = ""): string => {
    const newCell: NotebookCell = { id: createCellId("md"), type: "markdown", content: initialContent };
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
    return newCell.id;
  };

  const duplicateCell = (cellId: string): string | null => {
    const idx = notebookCells.findIndex((c) => c.id === cellId);
    if (idx === -1) return null;
    const source = notebookCells[idx]!;
    const copy: NotebookCell =
      source.type === "markdown"
        ? { id: createCellId("md"), type: "markdown", content: source.content }
        : {
            id: createCellId("art"),
            type: "artifact",
            artifactId: source.artifactId,
            ...(source.title ? { title: source.title } : {}),
            ...(source.caption ? { caption: source.caption } : {}),
          };
    const nextCells = [...notebookCells];
    nextCells.splice(idx + 1, 0, copy);
    syncNotebookToContentAndArtifact(nextCells, notebookTitle);
    setActiveCellId(copy.id);
    return copy.id;
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
    const idx = notebookCells.findIndex((c) => c.id === cellId);
    const nextCells = notebookCells.filter((c) => c.id !== cellId);
    if (nextCells.length === 0) {
      const fallbackId = createCellId("md");
      nextCells.push({ id: fallbackId, type: "markdown", content: "" });
      setActiveCellId(fallbackId);
    } else if (activeCellId === cellId) {
      const focusIdx = Math.max(0, idx - 1);
      setActiveCellId(nextCells[focusIdx]?.id || null);
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

    if (baseCells.length === 0 || baseCells[baseCells.length - 1]!.type === "artifact") {
      baseCells.push({ id: createCellId("md"), type: "markdown", content: "" });
    }

    setPendingInsertAfterCellId(null);
    if (!isNotebookMode) {
      setIsNotebookMode(true);
    }
    syncNotebookToContentAndArtifact(baseCells, notebookTitle);
  };

  return {
    isNotebookMode,
    setIsNotebookMode,
    notebookTitle,
    setNotebookTitle,
    notebookSummary,
    setNotebookSummary,
    notebookDifficulty,
    setNotebookDifficulty,
    notebookSeries,
    setNotebookSeries,
    notebookDialect,
    setNotebookDialect,
    notebookCompanionRepo,
    setNotebookCompanionRepo,
    notebookCells,
    setNotebookCells,
    activeCellId,
    setActiveCellId,
    pendingInsertAfterCellId,
    setPendingInsertAfterCellId,
    showTutorialMetaEditor,
    setShowTutorialMetaEditor,
    syncNotebookToContentAndArtifact,
    handleLoadStarterTemplate,
    insertMarkdownSnippet,
    handleToggleNotebookMode,
    updateMarkdownCell,
    updateArtifactCellCaption,
    addMarkdownCellAfter,
    duplicateCell,
    moveCell,
    removeCell,
    attachArtifactToComposer,
  };
}
