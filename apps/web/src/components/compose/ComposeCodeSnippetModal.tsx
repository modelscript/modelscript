// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  AlertIcon,
  CheckCircleIcon,
  CodeIcon,
  PlayIcon,
  ScreenFullIcon,
  ScreenNormalIcon,
  SparklesFillIcon,
  XIcon,
  ZapIcon,
} from "@primer/octicons-react";
import { Heading, IconButton, Text, useTheme } from "@primer/react";
import type { editor } from "monaco-editor";
import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { createArtifactView } from "../../api";
import type { NotebookCell } from "../../util/notebook";
import Box from "../Box";
import type { CodeEditorHandle } from "../morsel/Code";
import { getLanguageInfo, useVisibleMorselLanguages } from "../morsel/constants";
import Spinner from "../Spinner";
import {
  analyzeSnippetDiagnostics,
  extractPrimaryConstructInfo,
  formatLanguageFileHeader,
  GENERAL_CODE_LANGUAGES,
  inferSnippetFilename,
  resolveSnippetFilename,
  type SnippetDiagnostic,
} from "./snippet-diagnostics";
import { TweetButton } from "./styles";

const LazyCodeEditor = React.lazy(() => import("../morsel/Code"));

export type SnippetEmbedMode = "markdown" | "artifact";

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
  onReplaceFencedBlock?: ((fencedBlock: string) => void) | undefined;
  isEditingExistingBlock?: boolean | undefined;
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
  onReplaceFencedBlock,
  isEditingExistingBlock = false,
}) => {
  const { resolvedColorMode } = useTheme();
  const visibleMorselLanguages = useVisibleMorselLanguages();
  const [embedMode, setEmbedMode] = useState<SnippetEmbedMode>("markdown");
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [lspMarkers, setLspMarkers] = useState<editor.IMarkerData[]>([]);

  const codeEditorRef = useRef<CodeEditorHandle>(null);
  const monacoEditorRef = useRef<editor.ICodeEditor | null>(null);

  const generalLang = useMemo(() => GENERAL_CODE_LANGUAGES.find((g) => g.id === snippetLang), [snippetLang]);
  const morselLang = useMemo(() => (generalLang ? null : getLanguageInfo(snippetLang)), [generalLang, snippetLang]);

  const langLabel = generalLang?.label || morselLang?.label || morselLang?.name || snippetLang;
  const langExt = generalLang?.ext || morselLang?.ext || snippetLang;
  const isEngineeringLang = !generalLang;
  const documentUri = useMemo(() => `file:///compose_snippet.${langExt}`, [langExt]);

  // Reset transient error/mode state when modal opens
  useEffect(() => {
    if (isOpen) {
      setSubmitError(null);
      setIsSubmitting(false);
      if (isEditingExistingBlock) {
        setEmbedMode("markdown");
      }
    }
  }, [isOpen, isEditingExistingBlock]);

  // Clear LSP markers when switching language
  useEffect(() => {
    setLspMarkers([]);
  }, [snippetLang]);

  // Synchronous semantic & syntax diagnostics (instant feedback for M2005, M3001, M1002, JSON, delimiters)
  const syncDiagnostics = useMemo(
    () => analyzeSnippetDiagnostics(snippetCode, snippetLang),
    [snippetCode, snippetLang],
  );

  // Convert synchronous diagnostics into Monaco markers so squiggly underlines appear immediately
  const externalMonacoMarkers = useMemo<editor.IMarkerData[]>(() => {
    return syncDiagnostics.map((d) => ({
      code: d.code,
      severity: d.severity === "error" ? 8 : d.severity === "warning" ? 4 : 2,
      message: `[${d.code}] ${d.message}`,
      startLineNumber: d.startLineNumber,
      startColumn: d.startColumn,
      endLineNumber: d.endLineNumber,
      endColumn: d.endColumn,
      source: "modelscript-lint",
    }));
  }, [syncDiagnostics]);

  // Merge synchronous diagnostics + live WASM LSP diagnostics (deduplicating by line + code)
  const combinedDiagnostics = useMemo<SnippetDiagnostic[]>(() => {
    const merged: SnippetDiagnostic[] = [...syncDiagnostics];
    const seenKeys = new Set(syncDiagnostics.map((d) => `${d.startLineNumber}:${d.code}`));
    for (const m of lspMarkers) {
      const codeStr = m.code ? String(m.code) : "LSP";
      const key = `${m.startLineNumber}:${codeStr}`;
      if (seenKeys.has(key)) continue;
      // Avoid duplicating M2005/M1002 if already caught with a quickFix by syncDiagnostics
      if (
        (codeStr.includes("2005") && syncDiagnostics.some((d) => d.code === "M2005")) ||
        (codeStr.includes("1002") && syncDiagnostics.some((d) => d.code === "M1002"))
      ) {
        continue;
      }
      seenKeys.add(key);
      merged.push({
        code: codeStr.startsWith("M") ? codeStr : `M${codeStr}`,
        severity: m.severity === 8 ? "error" : m.severity === 4 ? "warning" : "info",
        message: m.message,
        startLineNumber: m.startLineNumber,
        startColumn: m.startColumn,
        endLineNumber: m.endLineNumber,
        endColumn: m.endColumn,
      });
    }
    return merged;
  }, [syncDiagnostics, lspMarkers]);

  const errorCount = useMemo(
    () => combinedDiagnostics.filter((d) => d.severity === "error").length,
    [combinedDiagnostics],
  );
  const warningCount = useMemo(
    () => combinedDiagnostics.filter((d) => d.severity === "warning").length,
    [combinedDiagnostics],
  );

  const constructInfo = useMemo(
    () => extractPrimaryConstructInfo(snippetCode, snippetLang),
    [snippetCode, snippetLang],
  );
  const inferredFilename = useMemo(
    () => inferSnippetFilename(snippetCode, snippetLang, langExt),
    [snippetCode, snippetLang, langExt],
  );
  const effectiveFilename = useMemo(
    () => resolveSnippetFilename(snippetFilename, snippetCode, snippetLang, langExt),
    [snippetFilename, snippetCode, snippetLang, langExt],
  );

  const handleLanguageChange = (nextLang: string) => {
    const prevDefault = generalLang?.defaultCode || morselLang?.defaultCode || "";
    const nextGeneral = GENERAL_CODE_LANGUAGES.find((g) => g.id === nextLang);
    const nextMorsel = nextGeneral ? null : getLanguageInfo(nextLang);
    const nextDefault = nextGeneral?.defaultCode || nextMorsel?.defaultCode || "";

    setSnippetLang(nextLang);
    setSubmitError(null);

    if (snippetCode.trim() && prevDefault.trim() && snippetCode.trim() === prevDefault.trim() && nextDefault) {
      setSnippetCode(nextDefault);
    }
  };

  const handleLoadStarter = () => {
    const sample =
      generalLang?.defaultCode ||
      morselLang?.defaultCode ||
      `model DampedOscillator\n  parameter Real k = 100.0 "Spring constant [N/m]";\n  parameter Real d = 1.5 "Damping coefficient [N.s/m]";\n  Real x(start = 1.0, fixed = true) "Position [m]";\n  Real v(start = 0.0, fixed = true) "Velocity [m/s]";\nequation\n  der(x) = v;\n  der(v) = -k * x - d * v;\nend DampedOscillator;\n`;
    setSnippetCode(sample);
    setSubmitError(null);
  };

  const handleRevealDiagnostic = (diag: SnippetDiagnostic) => {
    const ed = monacoEditorRef.current ?? codeEditorRef.current?.getEditor();
    if (!ed) return;
    ed.revealLineInCenter(diag.startLineNumber);
    ed.setPosition({ lineNumber: diag.startLineNumber, column: diag.startColumn });
    ed.focus();
  };

  const handleInsertMarkdownBlock = useCallback(() => {
    if (!snippetCode.trim()) return;
    const fileHeader = formatLanguageFileHeader(effectiveFilename, snippetLang);
    const fenced = `\`\`\`${snippetLang}\n${fileHeader}${snippetCode.trim()}\n\`\`\``;

    if (onReplaceFencedBlock) {
      onReplaceFencedBlock(fenced);
    } else if (isNotebookMode) {
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
    setSnippetCode("");
    setSnippetFilename("");
    onClose();
  }, [
    snippetCode,
    effectiveFilename,
    snippetLang,
    onReplaceFencedBlock,
    isNotebookMode,
    activeCellId,
    notebookCells,
    insertMarkdownSnippet,
    content,
    setContent,
    setSnippetCode,
    setSnippetFilename,
    onClose,
  ]);

  const handleAttachInteractiveModel = useCallback(async () => {
    if (!snippetCode.trim() || !token) return;
    setIsSubmitting(true);
    setSubmitError(null);
    try {
      const resolvedTitle = effectiveFilename || constructInfo?.name || `${langLabel} Snippet`;
      const data = await createArtifactView({
        artifact_type: snippetLang === "modelica" ? "modelica-code" : snippetLang,
        view_config: JSON.stringify({
          code: snippetCode,
          title: resolvedTitle,
          dialect: snippetLang,
        }),
        title: resolvedTitle,
      });
      if (!data?.id) {
        throw new Error("Server did not return an artifact ID.");
      }
      attachArtifactToComposer(data.id, resolvedTitle);
      setSnippetCode("");
      setSnippetFilename("");
      onClose();
    } catch (err: unknown) {
      console.error("Failed to attach interactive model:", err);
      const errorObj = err as { response?: { data?: { error?: string } }; message?: string } | undefined;
      setSubmitError(
        errorObj?.response?.data?.error ||
          errorObj?.message ||
          "Failed to attach interactive model. Please try again or insert as an Inline Code Block.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }, [
    snippetCode,
    token,
    effectiveFilename,
    constructInfo,
    langLabel,
    snippetLang,
    attachArtifactToComposer,
    setSnippetCode,
    setSnippetFilename,
    onClose,
  ]);

  const handlePrimarySubmit = useCallback(() => {
    if (embedMode === "artifact" && token && !isEditingExistingBlock) {
      void handleAttachInteractiveModel();
    } else {
      handleInsertMarkdownBlock();
    }
  }, [embedMode, token, isEditingExistingBlock, handleAttachInteractiveModel, handleInsertMarkdownBlock]);

  // Keyboard shortcuts: Escape to close, Cmd/Ctrl+Enter to submit
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        if (snippetCode.trim() && !isSubmitting) {
          handlePrimarySubmit();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose, snippetCode, isSubmitting, handlePrimarySubmit]);

  if (!isOpen) return null;

  const isDark = resolvedColorMode === "dark";
  const controlBg = isDark ? "rgba(15, 23, 42, 0.65)" : "var(--color-canvas-subtle, #f8fafc)";
  const controlBorder = "var(--ms-border, var(--color-border-default, #d0d7de))";

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
          backgroundColor: isDark ? "rgba(0, 0, 0, 0.72)" : "rgba(15, 23, 42, 0.45)",
          backdropFilter: "blur(6px)",
        }}
        onClick={onClose}
      />
      <Box
        role="dialog"
        aria-modal="true"
        aria-labelledby="compose-code-snippet-modal-title"
        position="fixed"
        top="50%"
        left="50%"
        style={{
          transform: "translate(-50%, -50%)",
          width: isFullScreen ? "96vw" : "740px",
          maxWidth: "96vw",
          height: isFullScreen ? "92vh" : undefined,
          maxHeight: "92vh",
          overflowY: "auto",
          backdropFilter: "blur(16px)",
        }}
        bg="var(--color-canvas-default, var(--surface-overlay, #ffffff))"
        border="1px solid var(--ms-border, var(--color-border-default))"
        borderRadius="16px"
        zIndex={99999}
        boxShadow={isDark ? "0 20px 50px rgba(0,0,0,0.65)" : "0 20px 50px rgba(15, 23, 42, 0.18)"}
        display="flex"
        flexDirection="column"
        onClick={(e: React.MouseEvent) => e.stopPropagation()}
      >
        {/* Header */}
        <Box
          display="flex"
          alignItems="center"
          justifyContent="space-between"
          px={3}
          py={2}
          borderBottom="1px solid var(--ms-divider, var(--color-border-default))"
          bg="var(--color-canvas-subtle, transparent)"
        >
          <Box display="flex" alignItems="center" gap={2}>
            <span style={{ color: "var(--color-accent-cyan, #06b6d4)", display: "inline-flex" }}>
              <CodeIcon size={18} />
            </span>
            <Heading id="compose-code-snippet-modal-title" as="h3" style={{ fontSize: "15px", margin: 0 }}>
              {isEditingExistingBlock ? "Edit Code Snippet" : "Insert Code Snippet / Executable Model"}
            </Heading>
            <span
              style={{
                fontSize: "11px",
                fontFamily: "var(--font-mono, monospace)",
                padding: "1px 7px",
                borderRadius: "999px",
                background: "rgba(6, 182, 212, 0.12)",
                color: "var(--color-accent-cyan, #06b6d4)",
                border: "1px solid rgba(6, 182, 212, 0.28)",
                fontWeight: 600,
              }}
            >
              {isEngineeringLang ? "WASM Compiler + LSP" : "Syntax + Lint"}
            </span>
          </Box>
          <Box display="flex" alignItems="center" gap={1}>
            <button
              type="button"
              onClick={handleLoadStarter}
              data-testid="snippet-load-sample-btn"
              title={`Load sample ${langLabel} snippet`}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "5px",
                padding: "4px 10px",
                fontSize: "12px",
                fontWeight: 600,
                borderRadius: "6px",
                border: `1px solid ${controlBorder}`,
                background: controlBg,
                color: "var(--color-fg-default)",
                cursor: "pointer",
                marginRight: "4px",
              }}
            >
              <SparklesFillIcon size={12} />
              <span>Load Sample</span>
            </button>
            <IconButton
              icon={isFullScreen ? ScreenNormalIcon : ScreenFullIcon}
              variant="invisible"
              size="small"
              onClick={() => setIsFullScreen((prev) => !prev)}
              aria-label={isFullScreen ? "Exit Full Screen" : "Expand Editor"}
            />
            <IconButton icon={XIcon} variant="invisible" size="small" onClick={onClose} aria-label="Close" />
          </Box>
        </Box>

        {/* Body */}
        <Box p={3} display="flex" flexDirection="column" gap={2} flex={1} style={{ minHeight: 0 }}>
          {/* Language & Filename Controls */}
          <Box display="flex" gap={2} style={{ flexWrap: "wrap" }}>
            <select
              value={snippetLang}
              onChange={(e) => handleLanguageChange(e.target.value)}
              aria-label="Code language"
              data-testid="snippet-language-select"
              style={{
                padding: "7px 12px",
                height: "36px",
                fontSize: "13px",
                fontWeight: 600,
                fontFamily: "var(--font-mono, monospace)",
                borderRadius: "8px",
                border: `1px solid ${controlBorder}`,
                background: controlBg,
                color: "var(--color-fg-default)",
                outline: "none",
                cursor: "pointer",
              }}
            >
              <optgroup label={`Engineering & Simulation Languages (${visibleMorselLanguages.length})`}>
                {visibleMorselLanguages.map((lang) => (
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

            <div style={{ position: "relative", flex: 1, minWidth: "220px", display: "flex", alignItems: "center" }}>
              <input
                type="text"
                aria-label="Snippet filename"
                data-testid="snippet-filename-input"
                placeholder={
                  inferredFilename
                    ? `Filename (auto-detected: ${inferredFilename})`
                    : `Filename (optional, e.g. DampedOscillator.${langExt})`
                }
                value={snippetFilename}
                onChange={(e) => setSnippetFilename(e.target.value)}
                style={{
                  width: "100%",
                  height: "36px",
                  padding: "7px 12px",
                  paddingRight: !snippetFilename.trim() && inferredFilename ? "115px" : "12px",
                  fontSize: "13px",
                  fontFamily: "var(--font-mono, monospace)",
                  borderRadius: "8px",
                  border: `1px solid ${controlBorder}`,
                  background: controlBg,
                  color: "var(--color-fg-default)",
                  outline: "none",
                  boxSizing: "border-box",
                }}
              />
              {!snippetFilename.trim() && inferredFilename && (
                <button
                  type="button"
                  onClick={() => setSnippetFilename(inferredFilename)}
                  title="Click to lock in auto-detected filename"
                  style={{
                    position: "absolute",
                    right: "6px",
                    padding: "2px 8px",
                    fontSize: "11px",
                    fontFamily: "var(--font-mono, monospace)",
                    borderRadius: "999px",
                    border: "1px solid rgba(6, 182, 212, 0.35)",
                    background: "rgba(6, 182, 212, 0.1)",
                    color: "var(--color-accent-cyan, #06b6d4)",
                    cursor: "pointer",
                    fontWeight: 600,
                  }}
                >
                  Auto: {inferredFilename}
                </button>
              )}
            </div>
          </Box>

          {/* Monaco + WASM LSP Code Editor Container */}
          <div
            data-testid="snippet-editor-container"
            style={{
              width: "100%",
              height: isFullScreen ? "calc(92vh - 280px)" : "270px",
              minHeight: "200px",
              borderRadius: "10px",
              border: errorCount > 0 ? "1px solid var(--color-danger-emphasis, #ef4444)" : `1px solid ${controlBorder}`,
              overflow: "hidden",
              position: "relative",
              background: "var(--color-canvas-default)",
            }}
          >
            <Suspense
              fallback={
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    height: "100%",
                    gap: "8px",
                    color: "var(--color-fg-muted)",
                    fontSize: "12.5px",
                  }}
                >
                  <Spinner size="small" />
                  <span>Loading code editor &amp; language intelligence…</span>
                </div>
              }
            >
              <LazyCodeEditor
                ref={codeEditorRef}
                uri={documentUri}
                languageId={snippetLang}
                content={snippetCode}
                onChange={(val) => setSnippetCode(val)}
                setEditor={(ed) => {
                  monacoEditorRef.current = ed;
                }}
                onDiagnostics={(markers) => {
                  setLspMarkers(markers);
                }}
                externalMarkers={externalMonacoMarkers}
                theme={isDark ? "vs-dark" : "light"}
                embed={false}
                hideMinimap={true}
              />
            </Suspense>
          </div>

          {/* Live Compiler / Typecheck / Lint Status Bar */}
          <div
            data-testid="snippet-diagnostics-bar"
            role="status"
            aria-live="polite"
            style={{
              borderRadius: "8px",
              padding: "8px 12px",
              fontSize: "12px",
              fontFamily: "var(--font-mono, monospace)",
              border: !snippetCode.trim()
                ? `1px solid ${controlBorder}`
                : errorCount > 0
                  ? "1px solid rgba(239, 68, 68, 0.4)"
                  : warningCount > 0
                    ? "1px solid rgba(210, 153, 34, 0.4)"
                    : "1px solid rgba(34, 197, 94, 0.35)",
              background: !snippetCode.trim()
                ? controlBg
                : errorCount > 0
                  ? "rgba(239, 68, 68, 0.08)"
                  : warningCount > 0
                    ? "rgba(210, 153, 34, 0.08)"
                    : "rgba(34, 197, 94, 0.08)",
              display: "flex",
              flexDirection: "column",
              gap: "6px",
            }}
          >
            {!snippetCode.trim() ? (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  color: "var(--color-fg-muted)",
                }}
              >
                <span>Write or paste {langLabel} code above for live syntax &amp; semantic checking.</span>
                <button
                  type="button"
                  onClick={handleLoadStarter}
                  style={{
                    background: "transparent",
                    border: "none",
                    color: "var(--color-accent-cyan, #06b6d4)",
                    fontWeight: 600,
                    fontSize: "12px",
                    cursor: "pointer",
                    padding: 0,
                  }}
                >
                  Insert starter template →
                </button>
              </div>
            ) : combinedDiagnostics.length === 0 ? (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  color: "var(--color-success-fg, #16a34a)",
                  fontWeight: 600,
                }}
              >
                <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                  <CheckCircleIcon size={14} />
                  <span>No syntax or type errors</span>
                  {constructInfo && (
                    <span
                      style={{
                        color: "var(--color-fg-muted)",
                        fontWeight: 500,
                      }}
                    >
                      • {constructInfo.kind} &apos;{constructInfo.name}&apos;
                    </span>
                  )}
                </span>
                {effectiveFilename && (
                  <span style={{ color: "var(--color-fg-muted)", fontWeight: 500 }}>📄 {effectiveFilename}</span>
                )}
              </div>
            ) : (
              <>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    color: errorCount > 0 ? "var(--color-danger-fg, #ef4444)" : "var(--color-attention-fg, #d97706)",
                    fontWeight: 700,
                  }}
                >
                  <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                    <AlertIcon size={14} />
                    <span>
                      {errorCount > 0
                        ? `${errorCount} compiler ${errorCount === 1 ? "error" : "errors"}`
                        : `${warningCount} ${warningCount === 1 ? "warning" : "warnings"}`}
                    </span>
                  </span>
                  <span style={{ fontSize: "11px", fontWeight: 500, color: "var(--color-fg-muted)" }}>
                    Click a diagnostic to jump to line
                  </span>
                </div>
                <div
                  style={{ display: "flex", flexDirection: "column", gap: "4px", maxHeight: "96px", overflowY: "auto" }}
                >
                  {combinedDiagnostics.map((diag, idx) => (
                    <div
                      key={`${diag.code}-${diag.startLineNumber}-${idx}`}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: "8px",
                        padding: "4px 6px",
                        borderRadius: "6px",
                        background: isDark ? "rgba(0, 0, 0, 0.25)" : "rgba(255, 255, 255, 0.7)",
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => handleRevealDiagnostic(diag)}
                        style={{
                          background: "transparent",
                          border: "none",
                          padding: 0,
                          textAlign: "left",
                          cursor: "pointer",
                          color: "var(--color-fg-default)",
                          fontSize: "11.5px",
                          fontFamily: "var(--font-mono, monospace)",
                          display: "flex",
                          alignItems: "center",
                          gap: "6px",
                          flex: 1,
                          minWidth: 0,
                        }}
                      >
                        <span
                          style={{
                            color:
                              diag.severity === "error"
                                ? "var(--color-danger-fg, #ef4444)"
                                : "var(--color-attention-fg, #d97706)",
                            fontWeight: 700,
                            flexShrink: 0,
                          }}
                        >
                          [{diag.code}]
                        </span>
                        <span style={{ color: "var(--color-fg-muted)", flexShrink: 0 }}>
                          Ln {diag.startLineNumber}:{diag.startColumn}
                        </span>
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {diag.message}
                        </span>
                      </button>
                      {diag.quickFix && (
                        <button
                          type="button"
                          data-testid="snippet-quick-fix-btn"
                          onClick={() => setSnippetCode(diag.quickFix!.replacementCode)}
                          style={{
                            flexShrink: 0,
                            padding: "2px 8px",
                            fontSize: "11px",
                            fontWeight: 700,
                            fontFamily: "var(--font-mono, monospace)",
                            borderRadius: "999px",
                            border: "1px solid rgba(6, 182, 212, 0.45)",
                            background: "rgba(6, 182, 212, 0.14)",
                            color: "var(--color-accent-cyan, #06b6d4)",
                            cursor: "pointer",
                          }}
                        >
                          ✨ Fix: {diag.quickFix.label}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Embed Mode Selector (Eliminates ambiguity between Inline Code vs Interactive Artifact Cell) */}
          {token && !isEditingExistingBlock && (
            <div
              role="radiogroup"
              aria-label="How should this code appear in your post?"
              data-testid="snippet-embed-mode-selector"
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
                gap: "8px",
                marginTop: "2px",
              }}
            >
              <button
                type="button"
                role="radio"
                aria-checked={embedMode === "markdown"}
                data-testid="embed-mode-markdown"
                onClick={() => setEmbedMode("markdown")}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "flex-start",
                  gap: "3px",
                  padding: "9px 12px",
                  borderRadius: "10px",
                  border:
                    embedMode === "markdown"
                      ? "1.5px solid var(--color-accent-cyan, #06b6d4)"
                      : `1px solid ${controlBorder}`,
                  background: embedMode === "markdown" ? "rgba(6, 182, 212, 0.08)" : controlBg,
                  color: "var(--color-fg-default)",
                  cursor: "pointer",
                  textAlign: "left",
                }}
              >
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "6px",
                    fontSize: "12.5px",
                    fontWeight: 700,
                  }}
                >
                  <CodeIcon size={14} />
                  <span>Inline Code Block</span>
                </span>
                <span style={{ fontSize: "11px", color: "var(--color-fg-muted)", lineHeight: 1.35 }}>
                  Embeds a syntax-highlighted snippet with line numbers, Copy &amp; Open in Sketch.
                </span>
              </button>

              <button
                type="button"
                role="radio"
                aria-checked={embedMode === "artifact"}
                data-testid="embed-mode-artifact"
                onClick={() => setEmbedMode("artifact")}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "flex-start",
                  gap: "3px",
                  padding: "9px 12px",
                  borderRadius: "10px",
                  border:
                    embedMode === "artifact"
                      ? "1.5px solid var(--color-accent-cyan, #06b6d4)"
                      : `1px solid ${controlBorder}`,
                  background: embedMode === "artifact" ? "rgba(6, 182, 212, 0.08)" : controlBg,
                  color: "var(--color-fg-default)",
                  cursor: "pointer",
                  textAlign: "left",
                }}
              >
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "6px",
                    fontSize: "12.5px",
                    fontWeight: 700,
                  }}
                >
                  <ZapIcon size={14} />
                  <span>Interactive Model Card</span>
                </span>
                <span style={{ fontSize: "11px", color: "var(--color-fg-muted)", lineHeight: 1.35 }}>
                  Attaches an executable card with live Code, Diagram, Simulate &amp; 3D tabs.
                </span>
              </button>
            </div>
          )}

          {/* Footer */}
          <Box
            display="flex"
            justifyContent="space-between"
            alignItems="center"
            style={{
              paddingTop: "8px",
              borderTop: "1px solid var(--ms-divider, var(--color-border-default))",
              flexWrap: "wrap",
            }}
            gap={2}
          >
            {submitError ? (
              <Text
                role="alert"
                style={{ fontSize: "12px", color: "var(--color-danger-fg, #ef4444)", fontWeight: 600 }}
              >
                {submitError}
              </Text>
            ) : (
              <Text style={{ fontSize: "11.5px", color: "var(--color-fg-muted)" }}>
                Tip: Press <kbd style={{ fontFamily: "var(--font-mono, monospace)" }}>Ctrl+Enter</kbd> to insert •{" "}
                <kbd style={{ fontFamily: "var(--font-mono, monospace)" }}>Tab</kbd> indents code
              </Text>
            )}

            <Box display="flex" alignItems="center" gap={2} style={{ marginLeft: "auto" }}>
              <button
                type="button"
                onClick={onClose}
                disabled={isSubmitting}
                data-testid="snippet-cancel-btn"
                style={{
                  height: "36px",
                  padding: "0 14px",
                  borderRadius: "999px",
                  border: `1px solid ${controlBorder}`,
                  background: "transparent",
                  color: "var(--color-fg-default)",
                  fontSize: "13px",
                  fontWeight: 600,
                  cursor: isSubmitting ? "not-allowed" : "pointer",
                }}
              >
                Cancel
              </button>

              <TweetButton
                type="button"
                data-testid="snippet-submit-btn"
                disabled={!snippetCode.trim() || isSubmitting}
                onClick={handlePrimarySubmit}
                style={{ height: "36px", fontSize: "13.5px", padding: "0 18px" }}
              >
                {isSubmitting ? (
                  <>
                    <Spinner size="small" />
                    <span>Attaching…</span>
                  </>
                ) : isEditingExistingBlock ? (
                  <span>Update Code Block</span>
                ) : embedMode === "artifact" && token ? (
                  <>
                    <PlayIcon size={14} />
                    <span>Attach Interactive Model</span>
                  </>
                ) : (
                  <span>Insert Code Block</span>
                )}
              </TweetButton>
            </Box>
          </Box>
        </Box>
      </Box>
    </>
  );

  return typeof document !== "undefined" ? createPortal(modal, document.body) : modal;
};
