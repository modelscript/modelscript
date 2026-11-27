// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Code editor component that delegates all language intelligence to the
 * LSP server via the Monaco-LSP adapter across all 44 ModelScript languages.
 */

import { Editor, loader, type Theme } from "@monaco-editor/react";
import * as monaco from "monaco-editor";
import { editor, type IDisposable } from "monaco-editor";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useEditorModelingPreferences as useModelingPreferences } from "../host";
import { ensureMonacoThemesDefined, getMonacoThemeName } from "../internal/monaco-theme";
import { notifyCstWorkerDeltas, notifyCstWorkerOpen } from "./util/cst-edit-client";
import {
  buildHypergraphMonacoDecorations,
  buildPerturbationGutterDecorations,
  buildXRayHeatmapMonacoDecorations,
  type AnsatzXRayTokenHeat,
} from "./util/hypergraph-overlay";
import {
  didChange,
  didChangeVisibleRanges,
  didOpen,
  didSave,
  getRelationalHypergraphInAnsatz,
  type AnsatzHypergraphTokenOverride,
  type AnsatzRelationalHypergraphRecord,
  type AnsatzRelationalTokenSpan,
} from "./util/lsp-bridge";
import { getLsp, startLsp } from "./util/lsp-worker";
import { registerAllModelscriptLanguages, setupMonacoLspAdapter } from "./util/monaco-lsp-adapter";
import { buildIsomorphicRenameScramble } from "./util/zonotope-feasibility";
import {
  parseLinearConstraintExpression,
  type LinearConstraintSpec,
  type ZonotopeBrushMode,
  type ZonotopePendingOverride,
} from "./util/zonotope-workbench-state";

const CodeEditorContainer: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ style, ...rest }) => (
  <div
    style={{
      display: "flex",
      flexDirection: "column",
      width: "100%",
      height: "100%",
      minHeight: 0,
      position: "relative",
      ...style,
    }}
    {...rest}
  />
);

const EditorSurfaceWrapper: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ style, ...rest }) => (
  <div
    style={{
      flex: 1,
      minHeight: 0,
      width: "100%",
      position: "relative",
      ...style,
    }}
    {...rest}
  />
);

const ZonotopeConstraintBar: React.FC<React.FormHTMLAttributes<HTMLFormElement>> = ({ style, ...rest }) => (
  <form
    style={{
      display: "flex",
      flexWrap: "wrap",
      alignItems: "center",
      gap: "8px",
      padding: "6px 10px",
      background: "var(--surface-panel, rgba(15, 23, 42, 0.95))",
      borderBottom: "1px solid rgba(56, 189, 248, 0.35)",
      color: "var(--color-text-primary, #e2e8f0)",
      fontSize: "12px",
      flexShrink: 0,
      zIndex: 6,
      ...style,
    }}
    {...rest}
  />
);

const ZonotopeConstraintInput = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function ZonotopeConstraintInput({ className, style, ...rest }, ref) {
    return (
      <input
        ref={ref}
        className={className ? `ms-zonotope-constraint-input ${className}` : "ms-zonotope-constraint-input"}
        style={{
          flex: 1,
          minWidth: "180px",
          height: "26px",
          padding: "0 8px",
          borderRadius: "5px",
          border: "1px solid rgba(56, 189, 248, 0.45)",
          background: "rgba(15, 23, 42, 0.72)",
          color: "#f8fafc",
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          fontSize: "12px",
          outline: "none",
          ...style,
        }}
        {...rest}
      />
    );
  },
);

const ZonotopeMiniButton: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement>> = ({ className, style, ...rest }) => (
  <button
    className={className ? `ms-zonotope-mini-btn ${className}` : "ms-zonotope-mini-btn"}
    style={{
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      height: "26px",
      padding: "0 9px",
      borderRadius: "5px",
      border: "1px solid rgba(148, 163, 184, 0.32)",
      background: "rgba(56, 189, 248, 0.16)",
      color: "#e0f2fe",
      fontSize: "11px",
      fontWeight: 600,
      cursor: "pointer",
      ...style,
    }}
    {...rest}
  />
);

const ScramblePreviewBanner: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ style, ...rest }) => (
  <div
    style={{
      display: "flex",
      flexDirection: "column",
      gap: "6px",
      padding: "8px 12px",
      background: "var(--surface-panel, rgba(15, 23, 42, 0.96))",
      borderBottom: "1px solid rgba(52, 211, 153, 0.4)",
      color: "var(--color-text-primary, #e2e8f0)",
      fontSize: "12px",
      flexShrink: 0,
      zIndex: 6,
      ...style,
    }}
    {...rest}
  />
);

const ScrambleCodePre: React.FC<React.HTMLAttributes<HTMLPreElement>> = ({ style, ...rest }) => (
  <pre
    style={{
      margin: 0,
      padding: "8px 10px",
      maxHeight: "150px",
      overflow: "auto",
      borderRadius: "6px",
      border: "1px solid rgba(148, 163, 184, 0.2)",
      background: "rgba(2, 6, 23, 0.72)",
      color: "#cbd5e1",
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
      fontSize: "11.5px",
      lineHeight: 1.45,
      whiteSpace: "pre",
      ...style,
    }}
    {...rest}
  />
);

const MobileAccessoryBar: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ className, style, ...rest }) => (
  <div
    className={className ? `ms-mobile-accessory-bar ${className}` : "ms-mobile-accessory-bar"}
    style={{
      alignItems: "center",
      gap: "5px",
      padding: "5px 8px",
      background: "var(--surface-panel, rgba(14, 20, 36, 0.96))",
      borderBottom: "1px solid var(--color-border-subtle, rgba(255, 255, 255, 0.08))",
      overflowX: "auto",
      scrollbarWidth: "none",
      WebkitOverflowScrolling: "touch",
      flexShrink: 0,
      zIndex: 5,
      ...style,
    }}
    {...rest}
  />
);

const AccessoryKeyButton: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement>> = ({ className, style, ...rest }) => (
  <button
    className={className ? `ms-accessory-key-btn ${className}` : "ms-accessory-key-btn"}
    style={{
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      height: "30px",
      minWidth: "32px",
      padding: "0 8px",
      borderRadius: "6px",
      border: "1px solid var(--color-border-subtle, rgba(255, 255, 255, 0.14))",
      background: "var(--color-bg-elevated, rgba(255, 255, 255, 0.06))",
      color: "var(--color-text-primary, #f8fafc)",
      fontFamily: 'var(--font-mono, "JetBrains Mono", monospace)',
      fontSize: "12px",
      fontWeight: 600,
      whiteSpace: "nowrap",
      cursor: "pointer",
      flexShrink: 0,
      userSelect: "none",
      WebkitTapHighlightColor: "transparent",
      transition: "background 0.12s ease, border-color 0.12s ease",
      ...style,
    }}
    {...rest}
  />
);

interface QuickSymbol {
  label: string;
  insertText: string;
  cursorOffset?: number;
  title: string;
}

const MOBILE_ENGINEERING_SYMBOLS: QuickSymbol[] = [
  { label: "=", insertText: " = ", title: "Insert equals" },
  { label: ":=", insertText: " := ", title: "Insert assignment (:=)" },
  { label: ";", insertText: ";", title: "Insert semicolon" },
  { label: "der()", insertText: "der()", cursorOffset: -1, title: "Insert time derivative der()" },
  { label: "connect()", insertText: "connect(, )", cursorOffset: -3, title: "Insert connect(a, b)" },
  { label: "( )", insertText: "()", cursorOffset: -1, title: "Insert parentheses" },
  { label: "[ ]", insertText: "[]", cursorOffset: -1, title: "Insert brackets" },
  { label: "{ }", insertText: "{}", cursorOffset: -1, title: "Insert braces" },
  { label: "^", insertText: "^", title: "Insert exponent (^)" },
  { label: "_", insertText: "_", title: "Insert underscore (_)" },
  { label: "param", insertText: "parameter Real ", title: "Insert parameter Real declaration" },
  { label: "equation", insertText: "equation\n  ", title: "Insert equation section" },
];

// ────────────────────────────────────────────────────────────────────
// Monaco environment (editor web worker — NOT the LSP worker)
// ────────────────────────────────────────────────────────────────────

if (!self.MonacoEnvironment) {
  self.MonacoEnvironment = {
    getWorker: function () {
      return new Worker(new URL("monaco-editor/esm/vs/editor/editor.worker.js", import.meta.url), {
        type: "module",
      });
    },
  };
  loader.config({ monaco });
}

interface DebouncedFunction<TArgs extends unknown[]> {
  (...args: TArgs): void;
  cancel: () => void;
}

function debounce<TArgs extends unknown[]>(fn: (...args: TArgs) => void, waitMs: number): DebouncedFunction<TArgs> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const debounced = (...args: TArgs): void => {
    if (timer !== null) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      timer = null;
      fn(...args);
    }, waitMs);
  };
  debounced.cancel = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };
  return debounced;
}

const MONACO_CANCEL_GUARD_SYMBOL = Symbol.for("modelscript.editor.monacoCancelGuard");

if (typeof window !== "undefined") {
  const win = window as Window & {
    monaco?: typeof monaco;
  };
  win.monaco = monaco;

  // Suppress benign Monaco internal cancellation errors (e.g. WordHighlighter / Delayer cancellation on model swap)
  const globalState = globalThis as Record<symbol, boolean | undefined>;
  if (!globalState[MONACO_CANCEL_GUARD_SYMBOL]) {
    globalState[MONACO_CANCEL_GUARD_SYMBOL] = true;
    window.addEventListener("unhandledrejection", (event) => {
      const reason = event.reason;
      if (
        reason &&
        (reason.name === "Canceled" ||
          reason.message === "Canceled" ||
          reason.name === "CancellationError" ||
          (typeof reason.message === "string" && reason.message.includes("Canceled")))
      ) {
        event.preventDefault();
      }
    });
  }
}

// ────────────────────────────────────────────────────────────────────
// Props & Handle
// ────────────────────────────────────────────────────────────────────

interface CodeEditorProps {
  content: string;
  uri: string;
  languageId?: string | undefined;
  setEditor: (editor: editor.ICodeEditor) => void;
  onChange?: ((value: string) => void) | undefined;
  onPaste?: ((pastedText: string, fullText: string) => void) | undefined;
  onProgress?: ((progress: number, message: string) => void) | undefined;
  onParsed?: (() => void) | undefined;
  onDiagnostics?: ((markers: editor.IMarkerData[], uri?: string) => void) | undefined;
  onStatusChange?: ((state: string, message: string) => void) | undefined;
  onSimulate?: (() => void | Promise<void>) | undefined;
  onExecuteCommand?:
    | ((commandId: string, args: unknown[]) => boolean | Promise<boolean | undefined> | Promise<void> | undefined)
    | undefined;
  onSave?: ((value: string) => void) | undefined;
  theme: Theme;
  embed: boolean;
  readOnly?: boolean | undefined;
  hideMinimap?: boolean | undefined;
  externalErrors?: string[] | undefined;
  externalMarkers?: editor.IMarkerData[] | undefined;
  /** Toggle live 4-column Relational Hypergraph `group_id` (ε_k) decorations in Monaco. */
  showHypergraphOverlay?: boolean | undefined;
  /** Optional interactive annotator overrides applied on top of the compiled hypergraph. */
  hypergraphOverrides?: AnsatzHypergraphTokenOverride[] | undefined;
  /** Optional active generator group_id to isolate/highlight in the overlay. */
  activeHypergraphGroupId?: number | null | undefined;
  /** Callback fired whenever the 4-column hypergraph is recomputed. */
  onHypergraphComputed?: ((record: AnsatzRelationalHypergraphRecord) => void) | undefined;
  /** Callback fired when a user clicks a token while the relational hypergraph overlay is active. */
  onHypergraphTokenClick?: ((span: AnsatzRelationalTokenSpan) => void) | undefined;
  /** Optional token-level Δ_t / worst-case loss X-Ray heatmap decorations in Monaco. */
  xrayTokenHeat?: AnsatzXRayTokenHeat[] | undefined;
  /** Optional active zonotope generator group_id (ε_k) highlighted across modalities. */
  zonotopeActiveGroupId?: number | null | undefined;
  /** Active direct-manipulation zonotope labeling brush mode. */
  zonotopeBrush?: ZonotopeBrushMode | undefined;
  /** Controlled toggle for live isomorphic rename scramble ghost preview. */
  zonotopeScramblePreview?: boolean | undefined;
  /** Callback fired when the user toggles isomorphic rename scramble preview. */
  onToggleZonotopeScramble?: ((enabled: boolean) => void) | undefined;
  /** Callback fired when a user emits a direct-manipulation token override (lock / flip sign). */
  onAddZonotopeOverride?: ((override: ZonotopePendingOverride) => void) | undefined;
  /** Callback fired when a user submits a linear constraint from the inline Monaco mini-bar. */
  onAddZonotopeConstraint?: ((constraint: LinearConstraintSpec) => void) | undefined;
  /** Callback fired whenever the compiled relational hypergraph record changes or clears. */
  onHypergraphRecordChange?: ((record: AnsatzRelationalHypergraphRecord | null) => void) | undefined;
}

function makeCodeOverrideId(prefix: string, seed: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${prefix}_${(hash >>> 0).toString(16).padStart(8, "0")}_${Date.now().toString(36)}`;
}

function findHypergraphSpanAtPosition(
  record: AnsatzRelationalHypergraphRecord | null,
  lineNumber: number,
  column: number,
): AnsatzRelationalTokenSpan | undefined {
  if (!record || record.spans.length === 0) return undefined;
  const matchesPosition = (span: AnsatzRelationalTokenSpan, inclusiveEnd: boolean): boolean => {
    if (lineNumber < span.startLine || lineNumber > span.endLine) return false;
    if (lineNumber === span.startLine && column < span.startColumn) return false;
    if (lineNumber === span.endLine && (inclusiveEnd ? column > span.endColumn : column >= span.endColumn)) {
      return false;
    }
    return true;
  };
  return record.spans.find((s) => matchesPosition(s, false)) ?? record.spans.find((s) => matchesPosition(s, true));
}

export interface CodeEditorHandle {
  /** Trigger the LSP to re-validate the current content. */
  sync: () => Promise<void>;
  /** Scroll to and select the definition of a component. */
  revealComponent: (name: string) => void;
  /** Return the underlying Monaco editor instance. */
  getEditor: () => editor.ICodeEditor | null;
}

// ────────────────────────────────────────────────────────────────────
// Component
// ────────────────────────────────────────────────────────────────────

export const CodeEditor = React.forwardRef<CodeEditorHandle, CodeEditorProps>((props, ref) => {
  const { preferences: modelingPrefs } = useModelingPreferences();
  const editorFontSize =
    typeof modelingPrefs.editorFontSize === "number"
      ? modelingPrefs.editorFontSize
      : typeof modelingPrefs.fontSize === "number"
        ? modelingPrefs.fontSize
        : 14;
  const editorTabSize =
    typeof modelingPrefs.editorTabSize === "number"
      ? modelingPrefs.editorTabSize
      : typeof modelingPrefs.tabSize === "number"
        ? modelingPrefs.tabSize
        : 2;
  const rawWordWrap = modelingPrefs.editorWordWrap ?? modelingPrefs.wordWrap;
  const editorWordWrap: "on" | "off" | "wordWrapColumn" | "bounded" =
    rawWordWrap === "on" || rawWordWrap === "off" || rawWordWrap === "wordWrapColumn" || rawWordWrap === "bounded"
      ? rawWordWrap
      : "on";
  const rawLineNumbers = modelingPrefs.editorLineNumbers ?? modelingPrefs.lineNumbers;
  const editorLineNumbers: editor.LineNumbersType =
    rawLineNumbers === "on" ||
    rawLineNumbers === "off" ||
    rawLineNumbers === "relative" ||
    rawLineNumbers === "interval"
      ? rawLineNumbers
      : "on";
  const editorMinimap = props.hideMinimap
    ? false
    : typeof modelingPrefs.editorMinimap === "boolean"
      ? modelingPrefs.editorMinimap
      : typeof modelingPrefs.minimapEnabled === "boolean"
        ? modelingPrefs.minimapEnabled
        : true;
  const bracketPairColorization =
    typeof modelingPrefs.bracketPairColorization === "boolean" ? modelingPrefs.bracketPairColorization : true;
  const lintOnType = typeof modelingPrefs.lintOnType === "boolean" ? modelingPrefs.lintOnType : true;

  const [editorMounted, setEditorMounted] = useState(false);
  const [hypergraphRecord, setHypergraphRecord] = useState<AnsatzRelationalHypergraphRecord | null>(null);
  const [localScramblePreview, setLocalScramblePreview] = useState(false);
  const [liveSource, setLiveSource] = useState(props.content);
  const [constraintBarOpen, setConstraintBarOpen] = useState(false);
  const [constraintDraft, setConstraintDraft] = useState("");
  const [constraintError, setConstraintError] = useState<string | null>(null);
  const constraintInputRef = useRef<HTMLInputElement | null>(null);
  const editorRef = useRef<editor.ICodeEditor>(null);
  const adapterDisposableRef = useRef<IDisposable | null>(null);
  const mouseDownDisposableRef = useRef<IDisposable | null>(null);
  const zonotopeActionsRef = useRef<IDisposable[]>([]);
  const gutterDecorationsRef = useRef<editor.IEditorDecorationsCollection | null>(null);
  const latestHypergraphRef = useRef<AnsatzRelationalHypergraphRecord | null>(null);
  const didOpenSentRef = useRef(false);
  const lastValueRef = useRef<string | undefined>(undefined);
  const uriRef = useRef(props.uri);
  const languageIdRef = useRef(props.languageId ?? "modelica");
  const lintOnTypeRef = useRef(lintOnType);
  const onPasteRef = useRef(props.onPaste);
  const onParsedRef = useRef(props.onParsed);
  const onSimulateRef = useRef(props.onSimulate);
  const onExecuteCommandRef = useRef(props.onExecuteCommand);
  const onSaveRef = useRef(props.onSave);
  const showHypergraphOverlayRef = useRef(Boolean(props.showHypergraphOverlay));
  const onHypergraphTokenClickRef = useRef(props.onHypergraphTokenClick);
  const zonotopeBrushRef = useRef(props.zonotopeBrush);
  const onAddZonotopeOverrideRef = useRef(props.onAddZonotopeOverride);
  const onAddZonotopeConstraintRef = useRef(props.onAddZonotopeConstraint);
  const onToggleZonotopeScrambleRef = useRef(props.onToggleZonotopeScramble);
  const onHypergraphRecordChangeRef = useRef(props.onHypergraphRecordChange);
  const xrayDecorationsRef = useRef<editor.IEditorDecorationsCollection | null>(null);
  const xrayTokenHeatRef = useRef(props.xrayTokenHeat);

  const effectiveActiveGroupId =
    props.zonotopeActiveGroupId !== undefined ? props.zonotopeActiveGroupId : props.activeHypergraphGroupId;
  const effectiveScramblePreview =
    props.zonotopeScramblePreview !== undefined ? props.zonotopeScramblePreview : localScramblePreview;
  const effectiveScramblePreviewRef = useRef(effectiveScramblePreview);

  uriRef.current = props.uri;
  languageIdRef.current = props.languageId ?? "modelica";
  lintOnTypeRef.current = lintOnType;
  onPasteRef.current = props.onPaste;
  onParsedRef.current = props.onParsed;
  onSimulateRef.current = props.onSimulate;
  onExecuteCommandRef.current = props.onExecuteCommand;
  onSaveRef.current = props.onSave;
  showHypergraphOverlayRef.current = Boolean(props.showHypergraphOverlay);
  onHypergraphTokenClickRef.current = props.onHypergraphTokenClick;
  zonotopeBrushRef.current = props.zonotopeBrush;
  onAddZonotopeOverrideRef.current = props.onAddZonotopeOverride;
  onAddZonotopeConstraintRef.current = props.onAddZonotopeConstraint;
  onToggleZonotopeScrambleRef.current = props.onToggleZonotopeScramble;
  onHypergraphRecordChangeRef.current = props.onHypergraphRecordChange;
  effectiveScramblePreviewRef.current = effectiveScramblePreview;
  xrayTokenHeatRef.current = props.xrayTokenHeat;

  const overflowWidgetsDomNode = useMemo(() => {
    if (typeof document === "undefined") return undefined;
    const node = document.createElement("div");
    node.className = `monaco-editor ${getMonacoThemeName(props.theme)}`;
    node.style.position = "fixed";
    node.style.top = "0";
    node.style.left = "0";
    node.style.width = "0";
    node.style.height = "0";
    node.style.overflow = "visible";
    node.style.backgroundColor = "transparent";
    node.style.zIndex = "1100";
    return node;
  }, []);

  useEffect(() => {
    if (!overflowWidgetsDomNode) return;
    overflowWidgetsDomNode.className = `monaco-editor ${getMonacoThemeName(props.theme)}`;
  }, [overflowWidgetsDomNode, props.theme]);

  useEffect(() => {
    if (!overflowWidgetsDomNode || typeof document === "undefined") return;
    document.body.appendChild(overflowWidgetsDomNode);
    return () => {
      overflowWidgetsDomNode.remove();
    };
  }, [overflowWidgetsDomNode]);

  // ── Sync Monaco editor options when user preferences change ──
  useEffect(() => {
    if (!editorRef.current || props.embed) return;
    editorRef.current.updateOptions({
      fontSize: editorFontSize,
      wordWrap: editorWordWrap,
      lineNumbers: editorLineNumbers,
      minimap: { enabled: editorMinimap },
      bracketPairColorization: { enabled: bracketPairColorization },
      glyphMargin: Boolean(props.showHypergraphOverlay),
    });
    editorRef.current.getModel()?.updateOptions({ tabSize: editorTabSize });
  }, [
    editorMounted,
    props.embed,
    props.showHypergraphOverlay,
    editorFontSize,
    editorTabSize,
    editorWordWrap,
    editorLineNumbers,
    editorMinimap,
    bracketPairColorization,
  ]);

  useEffect(() => {
    if (!editorRef.current) return;
    editorRef.current.updateOptions({
      glyphMargin: Boolean(props.showHypergraphOverlay),
    });
  }, [editorMounted, props.showHypergraphOverlay]);

  // ── LSP adapter setup (runs once on mount) ──
  useEffect(() => {
    let cancelled = false;

    (async () => {
      props.onProgress?.(20, "Initializing modeling & simulation engine…");
      const connection = await startLsp(languageIdRef.current);
      if (cancelled) return;

      props.onProgress?.(40, "Connecting editor to compiler runtime…");

      // Register Monaco providers that proxy to the LSP
      adapterDisposableRef.current = setupMonacoLspAdapter(monaco, connection, uriRef.current, {
        onDiagnostics: (_uri, markers) => {
          props.onDiagnostics?.(markers, _uri);
        },
        onStatus: (state, message) => {
          props.onStatusChange?.(state, message);
        },
        onExecuteCommand: async (commandId, args) => {
          const handled = await onExecuteCommandRef.current?.(commandId, args);
          if (handled) return true;
          if (
            commandId === "modelscript.action.simulate" ||
            /^modelscript\.[^.]+\.simulate(?:_.*)?$/i.test(commandId) ||
            commandId === "modelscript.ampl.ampl_solve" ||
            commandId === "modelscript.action.ampl_solve"
          ) {
            await onSimulateRef.current?.();
            return true;
          }
          return false;
        },
      });

      props.onProgress?.(100, "Ready");
    })();

    return () => {
      cancelled = true;
      adapterDisposableRef.current?.dispose();
    };
  }, []);

  // ── Re-notify LSP when document URI or languageId changes ──
  useEffect(() => {
    if (!didOpenSentRef.current) return;
    const value = editorRef.current?.getValue() ?? props.content;
    lastValueRef.current = value;
    didOpen(props.uri, value, props.languageId ?? "modelica");
  }, [props.uri, props.languageId]);

  // ── Send external errors / markers as additional markers ──
  useEffect(() => {
    const model = editorRef.current?.getModel();
    if (!model) return;

    const extras: editor.IMarkerData[] = [];
    if (props.externalErrors && props.externalErrors.length > 0) {
      for (const err of props.externalErrors) {
        extras.push({
          message: err,
          startLineNumber: 1,
          startColumn: 1,
          endLineNumber: 1,
          endColumn: 1,
          severity: monaco.MarkerSeverity.Error,
        });
      }
    }
    if (props.externalMarkers && props.externalMarkers.length > 0) {
      extras.push(...props.externalMarkers);
    }
    monaco.editor.setModelMarkers(model, "external", extras);
  }, [props.externalErrors?.join("||"), props.externalMarkers, props.uri]);

  // ── Handler: editor mounted ──
  const handleEditorDidMount = (ed: editor.IStandaloneCodeEditor) => {
    editorRef.current = ed;
    setEditorMounted(true);
    props.setEditor(ed);

    // Apply initial external markers if any exist at mount time
    const model = ed.getModel();
    if (model && props.externalMarkers && props.externalMarkers.length > 0) {
      monaco.editor.setModelMarkers(model, "external", props.externalMarkers);
    }

    // Apply initial X-Ray heatmap decorations if already populated at mount time
    if (xrayTokenHeatRef.current && xrayTokenHeatRef.current.length > 0) {
      const decorations = buildXRayHeatmapMonacoDecorations(xrayTokenHeatRef.current);
      if (!xrayDecorationsRef.current) {
        xrayDecorationsRef.current = ed.createDecorationsCollection(decorations);
      } else {
        xrayDecorationsRef.current.set(decorations);
      }
    }

    // Send initial didOpen
    if (!didOpenSentRef.current) {
      didOpenSentRef.current = true;
      const value = ed.getValue();
      lastValueRef.current = value;
      didOpen(uriRef.current, value, languageIdRef.current);
      if (model) {
        notifyCstWorkerOpen(uriRef.current, languageIdRef.current, value, model.getVersionId());
      }
    }

    // Stream O(1) incremental Monaco content deltas directly into the Dedicated CST Edit Worker
    ed.onDidChangeModelContent((e) => {
      const m = ed.getModel();
      if (!m || !e.changes || e.changes.length === 0) return;
      notifyCstWorkerDeltas(
        uriRef.current,
        languageIdRef.current,
        e.changes.map((c) => ({
          rangeOffset: c.rangeOffset,
          rangeLength: c.rangeLength,
          text: c.text,
        })),
        m.getVersionId(),
      );
    });

    // ── Viewport tracking: send visible line ranges to LSP ──
    const sendVisibleRanges = debounce(() => {
      const visibleRanges = ed.getVisibleRanges();
      if (visibleRanges.length > 0) {
        const ranges = visibleRanges.map((r) => ({
          startLine: r.startLineNumber - 1, // Monaco is 1-indexed, LSP is 0-indexed
          endLine: r.endLineNumber - 1,
        }));
        didChangeVisibleRanges(uriRef.current, ranges);
      }
    }, 150);

    ed.onDidScrollChange(sendVisibleRanges);
    mouseDownDisposableRef.current?.dispose();
    mouseDownDisposableRef.current = ed.onMouseDown((event) => {
      if (!showHypergraphOverlayRef.current) return;
      const onTokenClick = onHypergraphTokenClickRef.current;
      const onAddOverride = onAddZonotopeOverrideRef.current;
      const brush = zonotopeBrushRef.current;
      const record = latestHypergraphRef.current;
      if (!record || record.spans.length === 0) return;
      if (!onTokenClick && !(brush === "lock-zero" && onAddOverride)) return;
      if (event.target.type !== monaco.editor.MouseTargetType.CONTENT_TEXT) return;
      const pos = event.target.position;
      if (!pos) return;
      const matchedSpan = findHypergraphSpanAtPosition(record, pos.lineNumber, pos.column);
      if (matchedSpan) {
        if (brush === "lock-zero" && onAddOverride) {
          const override: ZonotopePendingOverride = {
            id: makeCodeOverrideId("code_lock", `${matchedSpan.index}:${matchedSpan.text}`),
            tokenIndex: matchedSpan.index,
            symbolName: matchedSpan.symbolName ?? matchedSpan.text,
            textSnippet: matchedSpan.text,
            groupId: 0,
            relTypeId: 0,
            relSign: 0,
            modality: "code",
            note: "Locked via lock-zero brush click",
          };
          onAddOverride(override);
        }
        onTokenClick?.(matchedSpan);
      }
    });
    ed.onDidPaste((pasteEvent) => {
      const handler = onPasteRef.current;
      if (!handler) return;
      const m = ed.getModel();
      if (!m) return;
      const pastedText = m.getValueInRange(pasteEvent.range);
      if (pastedText) {
        handler(pastedText, m.getValue());
      }
    });
    ed.onDidBlurEditorText(() => {
      if (!lintOnTypeRef.current && lastValueRef.current !== undefined) {
        didChange(uriRef.current, lastValueRef.current);
        props.onParsed?.();
      }
    });
    ed.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      const value = ed.getValue();
      void didSave(uriRef.current, value);
      onSaveRef.current?.(value);
    });
    sendVisibleRanges();
  };

  const pendingEchoesRef = useRef<string[]>([]);

  // ── Sync external content changes without wiping undo/redo stack ──
  useEffect(() => {
    const code = props.content;
    if (code !== undefined) {
      setLiveSource(code);
    }
    const model = editorRef.current?.getModel();
    if (!model || code === undefined) return;
    const echoIdx = pendingEchoesRef.current.indexOf(code);
    if (echoIdx !== -1) {
      pendingEchoesRef.current.splice(0, echoIdx + 1);
      return;
    }
    if (code === model.getValue()) return;
    pendingEchoesRef.current.length = 0;
    lastValueRef.current = code;
    if (editorRef.current) {
      editorRef.current.pushUndoStop();
      editorRef.current.executeEdits("ansatz-external-sync", [
        {
          range: model.getFullModelRange(),
          text: code,
          forceMoveMarkers: true,
        },
      ]);
      editorRef.current.pushUndoStop();
    } else {
      model.setValue(code);
    }
  }, [props.content]);

  // ── Handler: content changed ──
  // Send didChange immediately so the LSP worker can cancel stale semantic work
  // and run Tier 1 syntax/WASM lints without an extra 300ms client-side stall.
  // Keep onParsed debounced & memoized so parent context refreshes don't fire per keystroke.
  const notifyParsed = useMemo(
    () =>
      debounce(() => {
        onParsedRef.current?.();
      }, 150),
    [],
  );

  const sendDebouncedDidChange = useMemo(
    () =>
      debounce((uri: string, value: string) => {
        void didChange(uri, value);
      }, 180),
    [],
  );

  useEffect(() => {
    return () => {
      notifyParsed.cancel();
      sendDebouncedDidChange.cancel();
    };
  }, [notifyParsed, sendDebouncedDidChange]);

  const handleDidChangeContent = (value: string | undefined) => {
    if (value === undefined) return;
    lastValueRef.current = value;
    setLiveSource(value);
    pendingEchoesRef.current.push(value);
    if (pendingEchoesRef.current.length > 64) {
      pendingEchoesRef.current.shift();
    }
    props.onChange?.(value);
    if (lintOnTypeRef.current) {
      sendDebouncedDidChange(uriRef.current, value);
      notifyParsed();
    }
  };

  // ── Imperative handle ──
  React.useImperativeHandle(ref, () => ({
    sync: async () => {
      notifyParsed.cancel();
      sendDebouncedDidChange.cancel();
      const value = editorRef.current?.getValue();
      if (value !== undefined) {
        await didChange(uriRef.current, value);
      }
    },
    revealComponent: (name: string) => {
      const ed = editorRef.current;
      if (!ed) return;
      const conn = getLsp();
      if (!conn) return;

      type DocSym = {
        name?: string;
        children?: DocSym[];
        selectionRange?: {
          start: { line: number; character: number };
          end: { line: number; character: number };
        };
      };
      conn
        .sendRequest<DocSym[] | null>("textDocument/documentSymbol", { textDocument: { uri: uriRef.current } })
        .then((symbols) => {
          const findSymbol = (items: DocSym[]): DocSym | null => {
            for (const sym of items) {
              if (sym.name === name) return sym;
              if (sym.children) {
                const found = findSymbol(sym.children);
                if (found) return found;
              }
            }
            return null;
          };
          const sym = findSymbol(symbols ?? []);
          if (sym?.selectionRange) {
            const range = {
              startLineNumber: sym.selectionRange.start.line + 1,
              startColumn: sym.selectionRange.start.character + 1,
              endLineNumber: sym.selectionRange.end.line + 1,
              endColumn: sym.selectionRange.end.character + 1,
            };
            ed.revealRangeInCenter(range);
            ed.setSelection(range);
          }
        })
        .catch(() => {});
    },
    getEditor: () => editorRef.current,
  }));

  const hypergraphDecorationsRef = useRef<editor.IEditorDecorationsCollection | null>(null);
  const onHypergraphComputedRef = useRef(props.onHypergraphComputed);
  onHypergraphComputedRef.current = props.onHypergraphComputed;

  useEffect(() => {
    const ed = editorRef.current;
    if (!ed) return;

    if (!props.showHypergraphOverlay) {
      latestHypergraphRef.current = null;
      setHypergraphRecord(null);
      onHypergraphRecordChangeRef.current?.(null);
      hypergraphDecorationsRef.current?.clear();
      gutterDecorationsRef.current?.clear();
      return;
    }

    let cancelled = false;
    const timer = setTimeout(() => {
      getRelationalHypergraphInAnsatz(props.uri, {
        source: props.content,
        dialect: props.languageId ?? "modelica",
        overrides: props.hypergraphOverrides,
      })
        .then((res) => {
          if (cancelled || !res?.success || !res.record || !editorRef.current) return;
          latestHypergraphRef.current = res.record;
          setHypergraphRecord(res.record);
          onHypergraphComputedRef.current?.(res.record);
          onHypergraphRecordChangeRef.current?.(res.record);
          const decorations = buildHypergraphMonacoDecorations(res.record, effectiveActiveGroupId);
          if (!hypergraphDecorationsRef.current) {
            hypergraphDecorationsRef.current = editorRef.current.createDecorationsCollection(decorations);
          } else {
            hypergraphDecorationsRef.current.set(decorations);
          }
        })
        .catch(() => {
          // Non-fatal: LSP worker may still be initializing
        });
    }, 120);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [
    editorMounted,
    props.showHypergraphOverlay,
    props.uri,
    props.content,
    props.languageId,
    props.hypergraphOverrides,
    effectiveActiveGroupId,
  ]);

  // ── Perturbation & Δ_t Margin Gutter decorations ──
  useEffect(() => {
    const ed = editorRef.current;
    if (!ed) return;

    if (!props.showHypergraphOverlay || !hypergraphRecord) {
      gutterDecorationsRef.current?.clear();
      return;
    }

    const gutterDecorations = buildPerturbationGutterDecorations(
      hypergraphRecord,
      props.xrayTokenHeat ?? undefined,
      effectiveActiveGroupId,
    );
    if (!gutterDecorationsRef.current) {
      gutterDecorationsRef.current = ed.createDecorationsCollection(gutterDecorations);
    } else {
      gutterDecorationsRef.current.set(gutterDecorations);
    }
  }, [editorMounted, props.showHypergraphOverlay, hypergraphRecord, props.xrayTokenHeat, effectiveActiveGroupId]);

  // ── Monaco Context-Menu Semantic Labeling Actions (disposed on toggle/unmount) ──
  useEffect(() => {
    for (const d of zonotopeActionsRef.current) {
      d.dispose();
    }
    zonotopeActionsRef.current = [];

    const ed = editorRef.current as editor.IStandaloneCodeEditor | null;
    if (!ed || !props.showHypergraphOverlay || typeof ed.addAction !== "function") return;

    const resolveCursorToken = (
      targetEditor: editor.ICodeEditor,
    ): {
      span?: AnsatzRelationalTokenSpan | undefined;
      text: string;
    } => {
      const pos = targetEditor.getPosition();
      if (!pos) return { text: "" };
      const span = findHypergraphSpanAtPosition(latestHypergraphRef.current, pos.lineNumber, pos.column);
      if (span) {
        return { span, text: span.symbolName ?? span.text };
      }
      const word = targetEditor.getModel()?.getWordAtPosition(pos);
      return { text: word?.word ?? "" };
    };

    const actions: IDisposable[] = [
      ed.addAction({
        id: "ms.zonotope.lockToken",
        label: "Zonotope: Lock Token (group_id = 0)",
        contextMenuGroupId: "zonotope",
        contextMenuOrder: 1,
        run: (targetEditor: editor.ICodeEditor) => {
          const { span, text } = resolveCursorToken(targetEditor);
          if (!text && !span) return;
          const override: ZonotopePendingOverride = {
            id: makeCodeOverrideId("ctx_lock", `${span?.index ?? 0}:${text}`),
            groupId: 0,
            relTypeId: 0,
            relSign: 0,
            modality: "code",
            textSnippet: span?.text ?? text,
            symbolName: text || span?.text,
            note: "Locked via Monaco context menu",
          };
          if (span !== undefined) {
            override.tokenIndex = span.index;
          }
          onAddZonotopeOverrideRef.current?.(override);
        },
      }),
      ed.addAction({
        id: "ms.zonotope.flipSign",
        label: "Zonotope: Flip Coupling Sign (±1)",
        contextMenuGroupId: "zonotope",
        contextMenuOrder: 2,
        run: (targetEditor: editor.ICodeEditor) => {
          const { span, text } = resolveCursorToken(targetEditor);
          if (!text && !span) return;
          const nextSign = (span?.relSign ?? 1) < 0 ? 1 : -1;
          const nextRelType = nextSign < 0 ? 2 : 1;
          const nextGroupId = span && span.groupId > 0 ? span.groupId : 1;
          const override: ZonotopePendingOverride = {
            id: makeCodeOverrideId("ctx_flip", `${span?.index ?? 0}:${text}:${nextSign}`),
            groupId: nextGroupId,
            relTypeId: nextRelType,
            relSign: nextSign,
            modality: "code",
            textSnippet: span?.text ?? text,
            symbolName: text || span?.text,
            note: `Coupling sign flipped to ${nextSign > 0 ? "+1" : "-1"} via Monaco context menu`,
          };
          if (span !== undefined) {
            override.tokenIndex = span.index;
          }
          onAddZonotopeOverrideRef.current?.(override);
        },
      }),
      ed.addAction({
        id: "ms.zonotope.addConstraint",
        label: "Zonotope: Add Linear Constraint (Cξ ≤ d)",
        contextMenuGroupId: "zonotope",
        contextMenuOrder: 3,
        run: (targetEditor: editor.ICodeEditor) => {
          const { text } = resolveCursorToken(targetEditor);
          const tokenText = text.trim() || "x";
          setConstraintDraft(`${tokenText} >= 0`);
          setConstraintError(null);
          setConstraintBarOpen(true);
          setTimeout(() => {
            constraintInputRef.current?.focus();
            constraintInputRef.current?.select();
          }, 0);
        },
      }),
      ed.addAction({
        id: "ms.zonotope.toggleScramble",
        label: "Zonotope: Toggle Live Isomorphic Rename Scramble",
        contextMenuGroupId: "zonotope",
        contextMenuOrder: 4,
        run: () => {
          const next = !effectiveScramblePreviewRef.current;
          setLocalScramblePreview(next);
          onToggleZonotopeScrambleRef.current?.(next);
        },
      }),
    ];

    zonotopeActionsRef.current = actions;
    return () => {
      for (const d of actions) {
        d.dispose();
      }
      if (zonotopeActionsRef.current === actions) {
        zonotopeActionsRef.current = [];
      }
    };
  }, [editorMounted, props.showHypergraphOverlay]);

  useEffect(() => {
    const ed = editorRef.current;
    if (!ed) return;

    if (!props.xrayTokenHeat || props.xrayTokenHeat.length === 0) {
      xrayDecorationsRef.current?.clear();
      return;
    }

    const decorations = buildXRayHeatmapMonacoDecorations(props.xrayTokenHeat);
    if (!xrayDecorationsRef.current) {
      xrayDecorationsRef.current = ed.createDecorationsCollection(decorations);
    } else {
      xrayDecorationsRef.current.set(decorations);
    }
  }, [props.xrayTokenHeat, props.uri]);

  useEffect(() => {
    return () => {
      for (const d of zonotopeActionsRef.current) {
        d.dispose();
      }
      zonotopeActionsRef.current = [];
      mouseDownDisposableRef.current?.dispose();
      mouseDownDisposableRef.current = null;
      hypergraphDecorationsRef.current?.clear();
      hypergraphDecorationsRef.current = null;
      gutterDecorationsRef.current?.clear();
      gutterDecorationsRef.current = null;
      latestHypergraphRef.current = null;
      xrayDecorationsRef.current?.clear();
      xrayDecorationsRef.current = null;
    };
  }, []);

  const scrambleResult = useMemo(() => {
    if (!effectiveScramblePreview || !hypergraphRecord) return null;
    return buildIsomorphicRenameScramble(liveSource, hypergraphRecord);
  }, [effectiveScramblePreview, hypergraphRecord, liveSource]);

  const handleConstraintSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const parsed = parseLinearConstraintExpression(constraintDraft, "code");
      if (!parsed) {
        setConstraintError("Enter a valid linear inequality (e.g. R1 >= 0 or 2*R1 + R2 <= 10)");
        return;
      }
      onAddZonotopeConstraintRef.current?.(parsed);
      setConstraintError(null);
      setConstraintBarOpen(false);
    },
    [constraintDraft],
  );

  const handleCloseScramble = useCallback(() => {
    setLocalScramblePreview(false);
    onToggleZonotopeScrambleRef.current?.(false);
  }, []);

  const handleInsertSymbol = useCallback((sym: QuickSymbol) => {
    const ed = editorRef.current;
    if (!ed) return;
    const selection = ed.getSelection();
    if (!selection) return;

    ed.executeEdits("mobile-accessory-bar", [
      {
        range: selection,
        text: sym.insertText,
        forceMoveMarkers: true,
      },
    ]);

    if (sym.cursorOffset) {
      const pos = ed.getPosition();
      if (pos) {
        const nextCol = Math.max(1, pos.column + sym.cursorOffset);
        ed.setPosition({ lineNumber: pos.lineNumber, column: nextCol });
      }
    }
    ed.focus();
  }, []);

  const handleEditorTrigger = useCallback((commandId: string) => {
    const ed = editorRef.current;
    if (!ed) return;
    ed.trigger("mobile-accessory-bar", commandId, null);
    ed.focus();
  }, []);

  const showMobileAccessoryBar = !props.readOnly && !props.embed;

  return (
    <CodeEditorContainer>
      {constraintBarOpen && (
        <ZonotopeConstraintBar onSubmit={handleConstraintSubmit} aria-label="Add linear zonotope constraint">
          <span
            style={{
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              fontWeight: 700,
              color: "#7dd3fc",
            }}
          >
            Cξ ≤ d
          </span>
          <ZonotopeConstraintInput
            ref={constraintInputRef}
            type="text"
            value={constraintDraft}
            placeholder="e.g. R1 >= 0 or 2*wall_thickness + bore <= 20"
            onChange={(e) => {
              setConstraintDraft(e.target.value);
              if (constraintError) setConstraintError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setConstraintBarOpen(false);
                setConstraintError(null);
                editorRef.current?.focus();
              }
            }}
          />
          <ZonotopeMiniButton type="submit">Add Constraint</ZonotopeMiniButton>
          <ZonotopeMiniButton
            type="button"
            onClick={() => {
              setConstraintBarOpen(false);
              setConstraintError(null);
              editorRef.current?.focus();
            }}
          >
            ×
          </ZonotopeMiniButton>
          {constraintError && <span style={{ width: "100%", color: "#fda4af", fontSize: 11 }}>{constraintError}</span>}
        </ZonotopeConstraintBar>
      )}
      {scrambleResult && (
        <ScramblePreviewBanner role="region" aria-label="Live isomorphic rename scramble ghost preview">
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 8,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span style={{ fontWeight: 700, color: "#e2e8f0" }}>
                Isomorphic Rename Scramble (Read-Only Ghost Preview)
              </span>
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  padding: "2px 8px",
                  borderRadius: 999,
                  fontSize: 11,
                  fontWeight: 700,
                  background: scrambleResult.invariant ? "rgba(52, 211, 153, 0.18)" : "rgba(251, 191, 36, 0.2)",
                  border: scrambleResult.invariant
                    ? "1px solid rgba(52, 211, 153, 0.55)"
                    : "1px solid rgba(251, 191, 36, 0.55)",
                  color: scrambleResult.invariant ? "#6ee7b7" : "#fcd34d",
                }}
              >
                {scrambleResult.invariant ? "✓ 4-Column Topology 100% Invariant" : "⚠ Topology Drift Detected"}
              </span>
              <span
                style={{
                  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                  fontSize: 11,
                  color: "#94a3b8",
                }}
              >
                {scrambleResult.scrambledGroupCount} groups scrambled · {scrambleResult.preservedLockedCount} locked
              </span>
            </div>
            <ZonotopeMiniButton type="button" onClick={handleCloseScramble}>
              Close Preview
            </ZonotopeMiniButton>
          </div>
          {Object.keys(scrambleResult.renameMap).length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {Object.entries(scrambleResult.renameMap).map(([orig, synth]) => (
                <span
                  key={orig}
                  style={{
                    padding: "1px 7px",
                    borderRadius: 999,
                    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                    fontSize: 11,
                    background: "rgba(56, 189, 248, 0.14)",
                    border: "1px solid rgba(56, 189, 248, 0.35)",
                    color: "#7dd3fc",
                  }}
                >
                  {orig} → {synth}
                </span>
              ))}
            </div>
          )}
          <ScrambleCodePre>{scrambleResult.scrambledSource}</ScrambleCodePre>
        </ScramblePreviewBanner>
      )}
      {showMobileAccessoryBar && (
        <MobileAccessoryBar role="toolbar" aria-label="Engineering symbols and shortcuts">
          <AccessoryKeyButton
            type="button"
            title="Indent line (Tab)"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() =>
              handleInsertSymbol({
                label: "⇥",
                insertText: " ".repeat(editorTabSize || 2),
                title: "Indent",
              })
            }
          >
            ⇥
          </AccessoryKeyButton>
          {MOBILE_ENGINEERING_SYMBOLS.map((sym) => (
            <AccessoryKeyButton
              key={sym.label}
              type="button"
              title={sym.title}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => handleInsertSymbol(sym)}
            >
              {sym.label}
            </AccessoryKeyButton>
          ))}
          <AccessoryKeyButton
            type="button"
            title="Undo"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => handleEditorTrigger("undo")}
          >
            ↶
          </AccessoryKeyButton>
          <AccessoryKeyButton
            type="button"
            title="Redo"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => handleEditorTrigger("redo")}
          >
            ↷
          </AccessoryKeyButton>
        </MobileAccessoryBar>
      )}
      <EditorSurfaceWrapper>
        <Editor
          theme={getMonacoThemeName(props.theme)}
          defaultValue={props.content}
          language={props.languageId ?? "modelica"}
          path={props.uri}
          beforeMount={(m) => {
            ensureMonacoThemesDefined(m);
            registerAllModelscriptLanguages(m);
          }}
          onChange={handleDidChangeContent}
          onMount={handleEditorDidMount}
          options={
            !props.embed
              ? {
                  automaticLayout: true,
                  fixedOverflowWidgets: true,
                  overflowWidgetsDomNode,
                  autoIndent: "full",
                  fontSize: editorFontSize,
                  tabSize: editorTabSize,
                  wordWrap: editorWordWrap,
                  lineNumbers: editorLineNumbers,
                  glyphMargin: Boolean(props.showHypergraphOverlay),
                  minimap: { enabled: editorMinimap },
                  bracketPairColorization: { enabled: bracketPairColorization },
                  insertSpaces: true,
                  guides: {
                    indentation: true,
                  },
                  readOnly: Boolean(props.readOnly),
                  padding: { top: 16, bottom: 16 },
                  "semanticHighlighting.enabled": true,
                }
              : {
                  automaticLayout: true,
                  fixedOverflowWidgets: true,
                  overflowWidgetsDomNode,
                  codeLens: false,
                  folding: false,
                  glyphMargin: Boolean(props.showHypergraphOverlay),
                  lineDecorationsWidth: 0,
                  lineNumbers: "off",
                  lineNumbersMinChars: 0,
                  minimap: { enabled: false },
                  scrollBeyondLastLine: false,
                  padding: { top: 8, bottom: 8 },
                  "semanticHighlighting.enabled": true,
                }
          }
          height="100%"
          width="100%"
        ></Editor>
      </EditorSurfaceWrapper>
    </CodeEditorContainer>
  );
});

export default CodeEditor;
