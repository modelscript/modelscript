// SPDX-License-Identifier: AGPL-3.0-or-later

import type {
  LanguagePanelHost,
  LanguagePanelMode,
  LanguagePanelNotifyLevel,
  LanguagePanelProps,
} from "@modelscript/react";
import React, { Component, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PLAYGROUND_LANG, type PlaygroundPanelEntry } from "virtual:modelscript-playground-lang";

interface HostEventEntry {
  id: number;
  time: string;
  event: string;
  detail: string;
}

interface ToastEntry {
  id: number;
  level: LanguagePanelNotifyLevel;
  message: string;
}

interface CstParseSummary {
  status: "idle" | "loading" | "ready" | "unavailable" | "error";
  parseMs?: number;
  errorCount?: number;
  treeText?: string;
  errorMessage?: string;
}

interface PlaygroundDiagnostic {
  line: number;
  character: number;
  severity: number;
  code?: string | number;
  message: string;
}

class PanelErrorBoundary extends Component<{ panelId: string; children: React.ReactNode }, { error: Error | null }> {
  constructor(props: { panelId: string; children: React.ReactNode }) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error };
  }

  override componentDidUpdate(prevProps: { panelId: string }): void {
    if (prevProps.panelId !== this.props.panelId && this.state.error) {
      this.setState({ error: null });
    }
  }

  override render(): React.ReactNode {
    if (this.state.error) {
      return (
        <div className="pg-empty">
          <h3>Panel Render Error ({this.props.panelId})</h3>
          <pre>{this.state.error.stack || this.state.error.message}</pre>
          <button className="pg-btn" onClick={() => this.setState({ error: null })}>
            Retry Render
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function triggerDownload(filename: string, content: string | Uint8Array, mimeType?: string): void {
  const blobPart: BlobPart = typeof content === "string" ? content : new Uint8Array(content);
  const blob = new Blob([blobPart], { type: mimeType ?? "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function formatCstNode(node: unknown, depth = 0, maxNodes = { remaining: 250 }): string {
  if (!node || typeof node !== "object" || maxNodes.remaining <= 0) return "";
  maxNodes.remaining--;
  const n = node as {
    type?: string;
    isError?: boolean;
    hasError?: boolean;
    text?: string;
    startPosition?: { row: number; column: number };
    endPosition?: { row: number; column: number };
    namedChildren?: unknown[];
    children?: unknown[];
  };
  const indent = "  ".repeat(depth);
  const pos =
    n.startPosition && n.endPosition
      ? ` [${n.startPosition.row + 1}:${n.startPosition.column + 1}-${n.endPosition.row + 1}:${n.endPosition.column + 1}]`
      : "";
  const errTag = n.isError ? " <ERROR>" : "";
  const kids = n.namedChildren && n.namedChildren.length > 0 ? n.namedChildren : [];
  let snippet = "";
  if (kids.length === 0 && typeof n.text === "string" && n.text.length > 0) {
    const compact = n.text.replace(/\s+/g, " ").trim();
    snippet = ` = ${JSON.stringify(compact.length > 48 ? `${compact.slice(0, 48)}…` : compact)}`;
  }
  const lines = [`${indent}${n.type ?? "node"}${errTag}${pos}${snippet}`];
  for (const child of kids) {
    if (maxNodes.remaining <= 0) {
      lines.push(`${indent}  … (truncated)`);
      break;
    }
    const formatted = formatCstNode(child, depth + 1, maxNodes);
    if (formatted) lines.push(formatted);
  }
  return lines.join("\n");
}

function countErrors(node: unknown): number {
  if (!node || typeof node !== "object") return 0;
  const n = node as { isError?: boolean; isMissing?: boolean; children?: unknown[] };
  let total = n.isError || n.isMissing ? 1 : 0;
  if (Array.isArray(n.children)) {
    for (const c of n.children) {
      total += countErrors(c);
    }
  }
  return total;
}

function getInitialQueryParam(key: string): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get(key);
}

const DEFAULT_SIM_RESULT_JSON = JSON.stringify(
  {
    time: [0, 1, 2, 3, 4, 5],
    signals: {
      voltage_pu: [1.0, 0.98, 0.95, 0.99, 1.01, 1.0],
      frequency_hz: [60.0, 59.95, 59.88, 59.96, 60.02, 60.0],
    },
    metadata: { solver: "playground-mock", converged: true },
  },
  null,
  2,
);

export const PlaygroundApp: React.FC = () => {
  const initialMode =
    (getInitialQueryParam("mode") as LanguagePanelMode | null) || PLAYGROUND_LANG.initialMode || "workbench";
  const initialTheme =
    (getInitialQueryParam("theme") as "dark" | "light" | null) || PLAYGROUND_LANG.initialTheme || "dark";
  const initialTokens =
    (getInitialQueryParam("tokens") as "web" | "vscode" | null) || (initialMode === "workbench" ? "vscode" : "web");

  const [mode, setMode] = useState<LanguagePanelMode>(initialMode);
  const [colorMode, setColorMode] = useState<"dark" | "light">(initialTheme);
  const [tokenPreset, setTokenPreset] = useState<"web" | "vscode">(initialTokens);
  const [documentUri, setDocumentUri] = useState<string>(PLAYGROUND_LANG.initialDocumentUri);
  const [code, setCode] = useState<string>(PLAYGROUND_LANG.initialCode);
  const [projectFiles, setProjectFiles] = useState<Record<string, string>>({});
  const [activeFile, setActiveFile] = useState<string>("__main__");
  const [selectedSample, setSelectedSample] = useState<string>(PLAYGROUND_LANG.initialSamplePath || "");
  const [activePanelId, setActivePanelId] = useState<string>(
    getInitialQueryParam("panel") ||
      PLAYGROUND_LANG.panels[0]?.id ||
      (PLAYGROUND_LANG.simulationCards.length > 0 ? "__sim_cards__" : ""),
  );
  const [drawerTab, setDrawerTab] = useState<"cst" | "diagnostics" | "events">("cst");
  const [highlightedLine, setHighlightedLine] = useState<number | null>(null);
  const [events, setEvents] = useState<HostEventEntry[]>([]);
  const [toasts, setToasts] = useState<ToastEntry[]>([]);
  const [diagnostics, setDiagnostics] = useState<PlaygroundDiagnostic[]>([]);
  const [simResultJson, setSimResultJson] = useState<string>(DEFAULT_SIM_RESULT_JSON);
  const [rebuildingParser, setRebuildingParser] = useState(false);
  const [parserVersion, setParserVersion] = useState(0);
  const [cstSummary, setCstSummary] = useState<CstParseSummary>({
    status: PLAYGROUND_LANG.hasWasm && PLAYGROUND_LANG.hasBindings ? "loading" : "unavailable",
  });

  const parserRef = useRef<{ parse: (input: string) => { rootNode: unknown } } | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const gutterRef = useRef<HTMLDivElement | null>(null);
  const eventIdRef = useRef(1);
  const codeRef = useRef(code);
  const documentUriRef = useRef(documentUri);
  codeRef.current = code;
  documentUriRef.current = documentUri;

  useEffect(() => {
    document.documentElement.dataset["theme"] = colorMode;
    document.documentElement.dataset["tokens"] = tokenPreset;
    document.title = `${PLAYGROUND_LANG.displayName} — ModelScript Playground`;
  }, [colorMode, tokenPreset]);

  const handleModeChange = (nextMode: LanguagePanelMode) => {
    setMode(nextMode);
    setTokenPreset(nextMode === "workbench" ? "vscode" : "web");
  };

  const pushEvent = useCallback((event: string, detail: string) => {
    const id = eventIdRef.current++;
    const time = new Date().toLocaleTimeString();
    setEvents((prev) => [{ id, time, event, detail }, ...prev].slice(0, 100));
  }, []);

  const pushToast = useCallback((level: LanguagePanelNotifyLevel, message: string) => {
    const id = eventIdRef.current++;
    setToasts((prev) => [...prev, { id, level, message }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  const revealLineInEditor = useCallback(
    (line: number, identifier?: string) => {
      setActiveFile("__main__");
      setHighlightedLine(line);
      pushEvent("onRevealLine", `line ${line}${identifier ? ` (${identifier})` : ""}`);
      if (textareaRef.current) {
        const lineHeight = 19;
        const targetScroll = Math.max(0, (line - 4) * lineHeight);
        textareaRef.current.scrollTop = targetScroll;
        if (gutterRef.current) gutterRef.current.scrollTop = targetScroll;
        textareaRef.current.focus();
      }
      window.setTimeout(() => setHighlightedLine((cur) => (cur === line ? null : cur)), 2000);
    },
    [pushEvent],
  );

  // Load WASM parser when available
  useEffect(() => {
    if (!PLAYGROUND_LANG.hasWasm || !PLAYGROUND_LANG.hasBindings) {
      setCstSummary({ status: "unavailable" });
      return;
    }
    let cancelled = false;
    setCstSummary({ status: "loading" });

    (async () => {
      try {
        const cacheBust = `?v=${parserVersion}`;
        const bindingsUrl = `/__playground/bindings.js${cacheBust}`;
        const bindingsMod = (await import(/* @vite-ignore */ bindingsUrl)) as {
          createWasmParser?: (wasmInput: string | ArrayBuffer | Uint8Array) => Promise<{
            parser: { parse: (input: string) => { rootNode: unknown } };
          }>;
        };
        if (typeof bindingsMod.createWasmParser !== "function") {
          if (!cancelled) {
            setCstSummary({
              status: "unavailable",
              errorMessage: "bindings.js does not export createWasmParser",
            });
          }
          return;
        }
        const wasmResp = await fetch(`/__playground/parser.wasm${cacheBust}`);
        if (!wasmResp.ok) {
          throw new Error(`Failed to fetch parser.wasm (${wasmResp.status})`);
        }
        const wasmBytes = new Uint8Array(await wasmResp.arrayBuffer());
        const { parser } = await bindingsMod.createWasmParser(wasmBytes);
        if (!cancelled) {
          parserRef.current = parser;
          setCstSummary({ status: "ready" });
        }
      } catch (err) {
        if (!cancelled) {
          setCstSummary({
            status: "error",
            errorMessage: err instanceof Error ? err.message : String(err),
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [parserVersion]);

  // Live parse on code change
  useEffect(() => {
    if (cstSummary.status !== "ready" || !parserRef.current) return;
    const handle = window.setTimeout(() => {
      try {
        const t0 = performance.now();
        const tree = parserRef.current!.parse(code);
        const dt = performance.now() - t0;
        const errors = countErrors(tree.rootNode);
        const treeText = formatCstNode(tree.rootNode);
        setCstSummary({
          status: "ready",
          parseMs: dt,
          errorCount: errors,
          treeText,
        });
      } catch (err) {
        setCstSummary({
          status: "error",
          errorMessage: err instanceof Error ? err.message : String(err),
        });
      }
    }, 120);
    return () => window.clearTimeout(handle);
  }, [code, cstSummary.status === "ready", parserVersion]);

  // Live single-language LSP diagnostics when src/lsp.ts exists
  useEffect(() => {
    if (!PLAYGROUND_LANG.hasLsp) return;
    let cancelled = false;
    const handle = window.setTimeout(async () => {
      try {
        const resp = await fetch("/__playground/lsp", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            method: "textDocument/diagnostic",
            code,
            documentUri,
          }),
        });
        if (!resp.ok) return;
        const data = (await resp.json()) as { handled?: boolean; result?: unknown };
        if (cancelled || !data.handled || !Array.isArray(data.result)) return;
        const normalized: PlaygroundDiagnostic[] = data.result.map((d: Record<string, unknown>) => {
          const range = d["range"] as { start?: { line?: number; character?: number } } | undefined;
          return {
            line: (range?.start?.line ?? (typeof d["line"] === "number" ? d["line"] - 1 : 0)) + 1,
            character: (range?.start?.character ?? 0) + 1,
            severity: typeof d["severity"] === "number" ? d["severity"] : 2,
            ...(typeof d["code"] === "string" || typeof d["code"] === "number" ? { code: d["code"] } : {}),
            message: typeof d["message"] === "string" ? d["message"] : String(d["message"] ?? ""),
          };
        });
        setDiagnostics(normalized);
      } catch {
        // Ignore transient dev server errors
      }
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [code, documentUri]);

  const handleLoadSample = useCallback(
    async (samplePath: string) => {
      setSelectedSample(samplePath);
      if (!samplePath) return;
      try {
        const resp = await fetch(`/__playground/sample?path=${encodeURIComponent(samplePath)}`);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const text = await resp.text();
        setCode(text);
        setActiveFile("__main__");
        const baseName = samplePath.split("/").pop() || documentUri;
        setDocumentUri(baseName);
        pushEvent("loadSample", samplePath);
      } catch (err) {
        pushToast("error", `Failed to load sample: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
    [documentUri, pushEvent, pushToast],
  );

  const handleRebuildParser = useCallback(async () => {
    setRebuildingParser(true);
    pushEvent("rebuildParser", `Building parser.wasm for ${PLAYGROUND_LANG.id}...`);
    try {
      const resp = await fetch("/__playground/rebuild-parser", { method: "POST" });
      const data = (await resp.json()) as { ok: boolean; output: string };
      if (data.ok) {
        pushToast("info", `Rebuilt parser.wasm for ${PLAYGROUND_LANG.displayName}`);
        pushEvent("rebuildParser", "Success");
        setParserVersion((v) => v + 1);
      } else {
        pushToast("error", `Parser build failed: ${data.output.slice(0, 140)}`);
        pushEvent("rebuildParser:error", data.output);
      }
    } catch (err) {
      pushToast("error", `Parser build request failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setRebuildingParser(false);
    }
  }, [pushEvent, pushToast]);

  const host = useMemo<LanguagePanelHost>(
    () => ({
      onCodeChange: (newCode: string) => {
        setCode(newCode);
        pushEvent("onCodeChange", `${newCode.length} chars`);
      },
      onRevealLine: revealLineInEditor,
      onUpdateProjectFile: (relativePath: string, content: string) => {
        setProjectFiles((prev) => ({ ...prev, [relativePath]: content }));
        pushEvent("onUpdateProjectFile", `${relativePath} (${content.length} chars)`);
        pushToast("info", `Updated project file: ${relativePath}`);
      },
      requestLsp: async <R = unknown,>(method: string, params?: unknown): Promise<R> => {
        pushEvent("requestLsp:send", `${method} ${JSON.stringify(params ?? {})}`);
        try {
          const resp = await fetch("/__playground/lsp", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              method,
              params,
              code: codeRef.current,
              documentUri: documentUriRef.current,
            }),
          });
          const data = (await resp.json()) as { handled?: boolean; result?: R; error?: string; note?: string };
          if (data.error) {
            pushEvent("requestLsp:error", `${method}: ${data.error}`);
            pushToast("error", `LSP ${method} failed: ${data.error}`);
            return undefined as R;
          }
          if (!data.handled) {
            pushEvent("requestLsp:unhandled", `${method} (${data.note ?? "no handler in src/lsp.ts"})`);
            pushToast("warning", `Unhandled LSP method: ${method}`);
            return undefined as R;
          }
          pushEvent("requestLsp:ok", `${method} -> ${JSON.stringify(data.result ?? null).slice(0, 120)}`);
          return data.result as R;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          pushEvent("requestLsp:error", `${method}: ${msg}`);
          return undefined as R;
        }
      },
      exportFile: (filename: string, content: string | Uint8Array, mimeType?: string) => {
        triggerDownload(filename, content, mimeType);
        pushEvent(
          "exportFile",
          `${filename} (${typeof content === "string" ? content.length : content.byteLength} bytes)`,
        );
        pushToast("info", `Exported ${filename}`);
      },
      notify: (level: LanguagePanelNotifyLevel, message: string) => {
        pushEvent(`notify:${level}`, message);
        pushToast(level, message);
      },
      openInMorsel: (_c: string, dialect: string, title?: string) => {
        handleModeChange("inspector");
        pushEvent("openInMorsel", `${dialect}${title ? ` — ${title}` : ""}`);
        pushToast("info", "Switched playground to Morsel (inspector) mode");
      },
      openExternal: (url: string) => {
        pushEvent("openExternal", url);
        window.open(url, "_blank", "noopener,noreferrer");
      },
    }),
    [pushEvent, pushToast, revealLineInEditor],
  );

  const activeText = activeFile === "__main__" ? code : (projectFiles[activeFile] ?? "");
  const setActiveText = (next: string) => {
    if (activeFile === "__main__") {
      setCode(next);
    } else {
      setProjectFiles((prev) => ({ ...prev, [activeFile]: next }));
    }
  };

  const lineCount = useMemo(() => activeText.split("\n").length, [activeText]);
  const isSimCardsTab = activePanelId === "__sim_cards__";
  const activePanel: PlaygroundPanelEntry | undefined = isSimCardsTab
    ? undefined
    : (PLAYGROUND_LANG.panels.find((p) => p.id === activePanelId) ?? PLAYGROUND_LANG.panels[0]);

  const parsedSimResult = useMemo<{ value: Record<string, unknown>; error?: string }>(() => {
    try {
      const parsed = JSON.parse(simResultJson);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return { value: parsed as Record<string, unknown> };
      }
      return { value: {}, error: "Simulation result JSON must be an object." };
    } catch (err) {
      return { value: {}, error: err instanceof Error ? err.message : String(err) };
    }
  }, [simResultJson]);

  const handleAddSiblingFile = () => {
    const name = window.prompt("New sibling project file name (e.g. model.dyr, data.csv):");
    if (!name || !name.trim()) return;
    const trimmed = name.trim();
    setProjectFiles((prev) => ({ ...prev, [trimmed]: prev[trimmed] ?? "" }));
    setActiveFile(trimmed);
  };

  const handleInsertStencil = (snippet: string, label: string) => {
    const sep = activeText.endsWith("\n") || activeText.length === 0 ? "" : "\n";
    setActiveText(`${activeText}${sep}${snippet}\n`);
    pushEvent("insertStencil", label);
  };

  const panelProps: LanguagePanelProps = {
    code,
    dialect: PLAYGROUND_LANG.id,
    colorMode,
    mode,
    documentUri,
    projectFiles,
    host,
  };

  return (
    <div className="pg-root">
      <header className="pg-topbar">
        <div className="pg-brand">
          <span className="pg-badge">{PLAYGROUND_LANG.displayName}</span>
          <span>Playground</span>
          <span className="pg-pill">{PLAYGROUND_LANG.packageName}</span>
        </div>

        {PLAYGROUND_LANG.samples.length > 0 && (
          <div className="pg-control-group">
            <select
              className="pg-select"
              value={selectedSample}
              onChange={(e) => void handleLoadSample(e.target.value)}
              title="Load sample fixture from language directory"
            >
              <option value="">Sample files ({PLAYGROUND_LANG.samples.length})…</option>
              {PLAYGROUND_LANG.samples.map((s) => (
                <option key={s.path} value={s.path}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="pg-control-group">
          <input
            className="pg-input pg-input-mono"
            value={documentUri}
            onChange={(e) => setDocumentUri(e.target.value)}
            title="Active documentUri (change extension to test multi-extension panels)"
          />
        </div>

        <div className="pg-spacer" />

        <div className="pg-segmented" role="group" aria-label="Host mode">
          {(["workbench", "inspector", "artifact"] as const).map((m) => (
            <button key={m} data-active={mode === m} onClick={() => handleModeChange(m)}>
              {m === "workbench" ? "VS Code" : m === "inspector" ? "Morsel" : "Ansatz"}
            </button>
          ))}
        </div>

        <div
          className="pg-segmented"
          role="group"
          aria-label="Token theme preset"
          title="Preview Web vs VS Code design tokens"
        >
          <button data-active={tokenPreset === "web"} onClick={() => setTokenPreset("web")}>
            Web CSS
          </button>
          <button data-active={tokenPreset === "vscode"} onClick={() => setTokenPreset("vscode")}>
            VS Code CSS
          </button>
        </div>

        <div className="pg-segmented" role="group" aria-label="Color theme">
          <button data-active={colorMode === "dark"} onClick={() => setColorMode("dark")}>
            Dark
          </button>
          <button data-active={colorMode === "light"} onClick={() => setColorMode("light")}>
            Light
          </button>
        </div>

        <button className="pg-btn" onClick={() => void handleRebuildParser()} disabled={rebuildingParser}>
          {rebuildingParser ? "Building…" : "Rebuild WASM"}
        </button>
      </header>

      <div className="pg-main">
        {/* Left Pane: Editor + Stencils + WASM CST / Diagnostics / Host Log */}
        <section className="pg-left">
          <div className="pg-tabs">
            <button
              className="pg-tab"
              data-active={activeFile === "__main__"}
              onClick={() => setActiveFile("__main__")}
            >
              {documentUri}
            </button>
            {Object.keys(projectFiles).map((fname) => (
              <button
                key={fname}
                className="pg-tab"
                data-active={activeFile === fname}
                onClick={() => setActiveFile(fname)}
              >
                {fname}
              </button>
            ))}
            <button className="pg-tab" onClick={handleAddSiblingFile} title="Add sibling projectFiles entry">
              + File
            </button>
          </div>

          {PLAYGROUND_LANG.stencils.length > 0 && (
            <div className="pg-stencils">
              <span style={{ fontSize: 11, color: "var(--ms-text-3)" }}>Stencils:</span>
              {PLAYGROUND_LANG.stencils.map((st) => (
                <button
                  key={st.label}
                  className="pg-stencil-chip"
                  onClick={() => handleInsertStencil(st.snippet, st.label)}
                  title={st.snippet}
                >
                  + {st.label}
                </button>
              ))}
            </div>
          )}

          <div className="pg-editor-wrap">
            <div className="pg-gutter" ref={gutterRef}>
              {Array.from({ length: lineCount }, (_, idx) => {
                const lineNum = idx + 1;
                return (
                  <div
                    key={lineNum}
                    className="pg-gutter-line"
                    data-highlighted={activeFile === "__main__" && highlightedLine === lineNum}
                  >
                    {lineNum}
                  </div>
                );
              })}
            </div>
            <textarea
              ref={textareaRef}
              className="pg-textarea"
              spellCheck={false}
              value={activeText}
              onChange={(e) => setActiveText(e.target.value)}
              onScroll={(e) => {
                if (gutterRef.current) gutterRef.current.scrollTop = e.currentTarget.scrollTop;
              }}
              placeholder={`Enter ${PLAYGROUND_LANG.displayName} source code…`}
            />
          </div>

          <div className="pg-drawer">
            <div className="pg-tabs">
              <button className="pg-tab" data-active={drawerTab === "cst"} onClick={() => setDrawerTab("cst")}>
                WASM CST{" "}
                {cstSummary.status === "ready" && cstSummary.parseMs !== undefined
                  ? `(${cstSummary.parseMs.toFixed(1)}ms${cstSummary.errorCount ? `, ${cstSummary.errorCount} err` : ""})`
                  : ""}
              </button>
              {PLAYGROUND_LANG.hasLsp && (
                <button
                  className="pg-tab"
                  data-active={drawerTab === "diagnostics"}
                  onClick={() => setDrawerTab("diagnostics")}
                >
                  Diagnostics ({diagnostics.length})
                </button>
              )}
              <button className="pg-tab" data-active={drawerTab === "events"} onClick={() => setDrawerTab("events")}>
                Host Events ({events.length})
              </button>
            </div>
            <div className="pg-drawer-body">
              {drawerTab === "cst" ? (
                cstSummary.status === "ready" ? (
                  <pre style={{ margin: 0 }}>{cstSummary.treeText || "(empty)"}</pre>
                ) : cstSummary.status === "loading" ? (
                  <span style={{ color: "var(--ms-text-2)" }}>Loading parser.wasm…</span>
                ) : cstSummary.status === "unavailable" ? (
                  <span style={{ color: "var(--ms-text-2)" }}>
                    {cstSummary.errorMessage || "No dist/parser.wasm found. Click 'Rebuild WASM' to build it."}
                  </span>
                ) : (
                  <span style={{ color: "var(--ms-danger)" }}>{cstSummary.errorMessage}</span>
                )
              ) : drawerTab === "diagnostics" ? (
                diagnostics.length === 0 ? (
                  <span style={{ color: "var(--ms-success)" }}>No LSP diagnostics reported.</span>
                ) : (
                  diagnostics.map((d, idx) => (
                    <div
                      key={`${d.line}:${d.character}:${idx}`}
                      style={{ cursor: "pointer", padding: "2px 0" }}
                      onClick={() => revealLineInEditor(d.line, d.code ? String(d.code) : undefined)}
                    >
                      <span
                        style={{
                          color:
                            d.severity === 1
                              ? "var(--ms-danger)"
                              : d.severity === 2
                                ? "var(--ms-warning)"
                                : "var(--ms-info)",
                          fontWeight: 600,
                        }}
                      >
                        [{d.severity === 1 ? "ERR" : d.severity === 2 ? "WARN" : "INFO"}
                        {d.code ? ` ${d.code}` : ""}]
                      </span>{" "}
                      <span style={{ color: "var(--ms-text-3)" }}>
                        L{d.line}:{d.character}
                      </span>{" "}
                      {d.message}
                    </div>
                  ))
                )
              ) : events.length === 0 ? (
                <span style={{ color: "var(--ms-text-2)" }}>
                  No LanguagePanelHost callbacks triggered yet. Interact with the panel to inspect host events.
                </span>
              ) : (
                events.map((ev) => (
                  <div key={ev.id}>
                    <span style={{ color: "var(--ms-text-3)" }}>[{ev.time}]</span>{" "}
                    <strong style={{ color: "var(--ms-link)" }}>{ev.event}</strong>: {ev.detail}
                  </div>
                ))
              )}
            </div>
          </div>
        </section>

        {/* Right Pane: Language UI Panels & Simulation Cards */}
        <section className="pg-right">
          <div className="pg-tabs">
            {PLAYGROUND_LANG.panels.map((panel) => (
              <button
                key={panel.id}
                className="pg-tab"
                data-active={!isSimCardsTab && activePanel?.id === panel.id}
                onClick={() => setActivePanelId(panel.id)}
                title={`Targets: ${panel.targets.join(", ")} | ViewType: ${panel.viewType}`}
              >
                {panel.shortTitle || panel.title}
              </button>
            ))}
            {PLAYGROUND_LANG.simulationCards.length > 0 && (
              <button className="pg-tab" data-active={isSimCardsTab} onClick={() => setActivePanelId("__sim_cards__")}>
                Sim Cards ({PLAYGROUND_LANG.simulationCards.length})
              </button>
            )}
            {PLAYGROUND_LANG.panels.length === 0 && PLAYGROUND_LANG.simulationCards.length === 0 && (
              <span className="pg-tab" data-active="true">
                UI Panel
              </span>
            )}
            {PLAYGROUND_LANG.treeViews.length > 0 && (
              <span
                className="pg-pill"
                style={{ marginLeft: "auto", marginBottom: 4 }}
                title={`VS Code-only treeViews: ${PLAYGROUND_LANG.treeViews.map((t) => t.name).join(", ")}`}
              >
                +{PLAYGROUND_LANG.treeViews.length} VS Code TreeView(s)
              </span>
            )}
          </div>

          <div className="pg-panel-host">
            {isSimCardsTab ? (
              <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 14 }}>
                <details>
                  <summary style={{ cursor: "pointer", fontWeight: 600, color: "var(--ms-text-2)" }}>
                    Mock Simulation Result JSON{" "}
                    {parsedSimResult.error && (
                      <span style={{ color: "var(--ms-danger)", marginLeft: 8 }}>{parsedSimResult.error}</span>
                    )}
                  </summary>
                  <textarea
                    className="pg-textarea"
                    style={{
                      height: 140,
                      marginTop: 8,
                      border: "1px solid var(--ms-border)",
                      borderRadius: 6,
                    }}
                    value={simResultJson}
                    onChange={(e) => setSimResultJson(e.target.value)}
                  />
                </details>
                {PLAYGROUND_LANG.simulationCards.map((card) => (
                  <div
                    key={card.id}
                    style={{
                      border: "1px solid var(--ms-border)",
                      borderRadius: 8,
                      padding: 12,
                      background: "var(--ms-bg-alt)",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                      <strong>{card.title}</strong>
                      {card.standards.map((std) => (
                        <span key={std} className="pg-pill">
                          {std}
                        </span>
                      ))}
                    </div>
                    <PanelErrorBoundary panelId={`sim-card:${card.id}`}>
                      <card.Component
                        dialect={PLAYGROUND_LANG.id}
                        colorMode={colorMode}
                        result={parsedSimResult.value}
                        code={code}
                        host={host}
                      />
                    </PanelErrorBoundary>
                  </div>
                ))}
              </div>
            ) : activePanel ? (
              <PanelErrorBoundary panelId={activePanel.id}>
                <activePanel.Component {...panelProps} />
              </PanelErrorBoundary>
            ) : (
              <div className="pg-empty">
                <h3>No UI Panels Declared for {PLAYGROUND_LANG.displayName}</h3>
                <p>
                  You can still test the grammar, WASM CST parser, LSP diagnostics, and stencils on the left. To add a
                  cross-host React UI panel, declare <code>ui.panels</code> in{" "}
                  <code>languages/{PLAYGROUND_LANG.id}/src/language.ts</code>:
                </p>
                <pre>{`ui: {
  panels: [
    {
      id: "${PLAYGROUND_LANG.id}Panel",
      title: "${PLAYGROUND_LANG.displayName} Workbench",
      entry: "./src/ui/${PLAYGROUND_LANG.id[0]?.toUpperCase() ?? "L"}${PLAYGROUND_LANG.id.slice(1)}Panel.tsx",
      exportName: "${PLAYGROUND_LANG.id[0]?.toUpperCase() ?? "L"}${PLAYGROUND_LANG.id.slice(1)}Panel",
    },
  ],
}`}</pre>
              </div>
            )}
          </div>
        </section>
      </div>

      {toasts.length > 0 && (
        <div className="pg-toasts">
          {toasts.map((t) => (
            <div key={t.id} className="pg-toast" data-level={t.level}>
              {t.message}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
