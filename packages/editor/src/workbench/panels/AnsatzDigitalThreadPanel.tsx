// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  AlertIcon,
  CheckCircleFillIcon,
  GitBranchIcon,
  LinkIcon,
  PlayIcon,
  SyncIcon,
  XCircleFillIcon,
} from "@primer/octicons-react";
import { Button } from "@primer/react";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { detectLanguageFromFilename } from "../constants";
import {
  getBlastRadius,
  getDocumentSymbols,
  getThreadGraph,
  reconcileThreadSlot,
  runVerification,
  verifyAll,
  type AnsatzBlastRadiusResult,
  type AnsatzThreadGraphResponse,
  type AnsatzVerifyAllReport,
} from "../util/lsp-bridge";

export interface AnsatzDigitalThreadPanelProps {
  projectFiles?: Record<string, string> | undefined;
  activeFileName?: string | undefined;
  documentUri?: string | undefined;
  colorMode: "dark" | "light";
  onSelectProjectFile?: ((fileName: string) => void) | undefined;
  onUpdateProjectFile?: ((fileName: string, content: string) => void) | undefined;
  onRevealLine?: ((line: number, identifier?: string) => void) | undefined;
}

interface ExtractedSymbolHint {
  name: string;
  value?: string | undefined;
  line: number;
}

function extractSymbolsFromContent(fileName: string, content: string): ExtractedSymbolHint[] {
  const lang = detectLanguageFromFilename(fileName);
  const results: ExtractedSymbolHint[] = [];
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (lang === "sysml2") {
      const attrMatch = /\battribute\s+([A-Za-z_]\w*)\s*(?::[^=;]+)?(?:=\s*([^;]+))?/.exec(line);
      if (attrMatch) {
        results.push({ name: attrMatch[1]!, value: attrMatch[2]?.trim(), line: i + 1 });
        continue;
      }
      const reqMatch = /\brequirement\s+(?:def\s+)?(?:<[^>]+>\s+)?([A-Za-z_]\w*)/.exec(line);
      if (reqMatch) {
        results.push({ name: reqMatch[1]!, line: i + 1 });
      }
    } else if (lang === "modelica" || lang === "modelscript") {
      const paramMatch =
        /\b(?:parameter\s+|constant\s+)?(?:Real|Integer|Boolean)\s+([A-Za-z_]\w*)(?:\([^)]*\))?\s*(?:=\s*([^;(\n]+))?/.exec(
          line,
        );
      if (paramMatch) {
        results.push({ name: paramMatch[1]!, value: paramMatch[2]?.trim(), line: i + 1 });
      }
    } else if (lang === "scad") {
      const assignMatch = /^\s*([A-Za-z_]\w*)\s*=\s*([^;]+);/.exec(line);
      if (assignMatch) {
        results.push({ name: assignMatch[1]!, value: assignMatch[2]?.trim(), line: i + 1 });
      }
      const portMatch = /\btag_port\s*\(\s*"([^"]+)"/.exec(line);
      if (portMatch) {
        results.push({ name: `port:${portMatch[1]!}`, line: i + 1 });
      }
    } else {
      const genericMatch = /^\s*([A-Za-z_]\w*)\s*=\s*([^;\n]+)/.exec(line);
      if (genericMatch) {
        results.push({ name: genericMatch[1]!, value: genericMatch[2]?.trim(), line: i + 1 });
      }
    }
  }
  return results;
}

export const AnsatzDigitalThreadPanel: React.FC<AnsatzDigitalThreadPanelProps> = ({
  projectFiles,
  activeFileName,
  documentUri,
  colorMode,
  onSelectProjectFile,
  onUpdateProjectFile,
  onRevealLine,
}) => {
  const isDark = colorMode === "dark";
  const fileNames = useMemo(() => Object.keys(projectFiles ?? {}), [projectFiles]);

  const [threadGraph, setThreadGraph] = useState<AnsatzThreadGraphResponse | null>(null);
  const [verifyReport, setVerifyReport] = useState<AnsatzVerifyAllReport | null>(null);
  const [simStatus, setSimStatus] = useState<{ state: "idle" | "running" | "done" | "error"; message?: string }>({
    state: "idle",
  });
  const [isVerifyingFormal, setIsVerifyingFormal] = useState(false);
  const [blastRadius, setBlastRadius] = useState<AnsatzBlastRadiusResult | null>(null);
  const [showLinkComposer, setShowLinkComposer] = useState(false);

  // Link composer state
  const [srcFile, setSrcFile] = useState<string>("");
  const [srcSymbol, setSrcSymbol] = useState<string>("");
  const [dstFile, setDstFile] = useState<string>("");
  const [dstSymbol, setDstSymbol] = useState<string>("");
  const [linkMode, setLinkMode] = useState<"twin-directive" | "modelica-annotation" | "sysml-import">("twin-directive");

  useEffect(() => {
    if (fileNames.length > 0 && (!srcFile || !fileNames.includes(srcFile))) {
      setSrcFile(fileNames[0]!);
    }
    if (fileNames.length > 1 && (!dstFile || !fileNames.includes(dstFile))) {
      setDstFile(fileNames[1]!);
    } else if (fileNames.length === 1 && !dstFile) {
      setDstFile(fileNames[0]!);
    }
  }, [fileNames, srcFile, dstFile]);

  const [lspSymbolsByFile, setLspSymbolsByFile] = useState<Map<string, ExtractedSymbolHint[]>>(() => new Map());

  useEffect(() => {
    if (!projectFiles || !documentUri) return;
    let cancelled = false;
    const basePrefix = documentUri.replace(/\/[^/]+$/, "");
    type DocSymbolLike = {
      name?: unknown;
      detail?: unknown;
      selectionRange?: { start?: { line?: number } };
      range?: { start?: { line?: number } };
      children?: DocSymbolLike[];
    };
    const flattenDocSymbols = (syms: DocSymbolLike[]): ExtractedSymbolHint[] => {
      const out: ExtractedSymbolHint[] = [];
      const seen = new Set<string>();
      const walk = (list: DocSymbolLike[]) => {
        for (const s of list) {
          if (!s || typeof s.name !== "string") continue;
          const line = (s.selectionRange?.start?.line ?? s.range?.start?.line ?? 0) + 1;
          if (!seen.has(s.name)) {
            seen.add(s.name);
            out.push({ name: s.name, value: typeof s.detail === "string" && s.detail ? s.detail : undefined, line });
          }
          if (Array.isArray(s.children) && s.children.length > 0) {
            walk(s.children);
          }
        }
      };
      walk(syms);
      return out;
    };

    void Promise.all(
      Object.keys(projectFiles).map(async (fName) => {
        const targetUri = fName === activeFileName ? documentUri : `${basePrefix}/${fName.replace(/^\/+/, "")}`;
        try {
          const syms = await getDocumentSymbols(targetUri);
          return [fName, Array.isArray(syms) ? flattenDocSymbols(syms) : []] as const;
        } catch {
          return [fName, []] as const;
        }
      }),
    ).then((entries) => {
      if (cancelled) return;
      const next = new Map<string, ExtractedSymbolHint[]>();
      for (const [fName, hints] of entries) {
        if (hints.length > 0) next.set(fName, hints);
      }
      setLspSymbolsByFile(next);
    });

    return () => {
      cancelled = true;
    };
  }, [projectFiles, documentUri, activeFileName]);

  const symbolsByFile = useMemo(() => {
    const map = new Map<string, ExtractedSymbolHint[]>();
    if (!projectFiles) return map;
    for (const [fName, content] of Object.entries(projectFiles)) {
      const fromLsp = lspSymbolsByFile.get(fName);
      map.set(fName, fromLsp && fromLsp.length > 0 ? fromLsp : extractSymbolsFromContent(fName, content));
    }
    return map;
  }, [projectFiles, lspSymbolsByFile]);

  const srcSymbols = useMemo(() => symbolsByFile.get(srcFile) ?? [], [symbolsByFile, srcFile]);
  const dstSymbols = useMemo(() => symbolsByFile.get(dstFile) ?? [], [symbolsByFile, dstFile]);

  useEffect(() => {
    if (srcSymbols.length > 0 && !srcSymbols.some((s) => s.name === srcSymbol)) {
      setSrcSymbol(srcSymbols[0]!.name);
    }
  }, [srcSymbols, srcSymbol]);

  useEffect(() => {
    if (dstSymbols.length > 0 && !dstSymbols.some((s) => s.name === dstSymbol)) {
      setDstSymbol(dstSymbols[0]!.name);
    }
  }, [dstSymbols, dstSymbol]);

  const refreshThreadGraph = useCallback(async () => {
    try {
      const graph = await getThreadGraph();
      setThreadGraph(graph);
    } catch {
      // LSP may still be warming up
    }
  }, []);

  const handleRunFormalVerify = useCallback(async () => {
    if (!documentUri) return;
    setIsVerifyingFormal(true);
    try {
      const [report] = await Promise.all([verifyAll(documentUri), refreshThreadGraph()]);
      setVerifyReport(report);
      if (!report) {
        setSimStatus({
          state: "error",
          message: "Formal verification returned no report for the active workspace.",
        });
      }
    } catch (err) {
      setSimStatus({
        state: "error",
        message: `Formal verification error: ${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      setIsVerifyingFormal(false);
    }
  }, [documentUri, refreshThreadGraph]);

  const handleRunSimVerify = useCallback(async () => {
    if (!documentUri) return;
    setSimStatus({ state: "running", message: "Running SysML v2 + Modelica simulation verification..." });
    try {
      const sysmlFile = fileNames.find((f) => /\.(sysml|kerml)$/i.test(f));
      const basePrefix = documentUri.replace(/\/[^/]+$/, "");
      const targetUri =
        !sysmlFile || sysmlFile === activeFileName ? documentUri : `${basePrefix}/${sysmlFile.replace(/^\/+/, "")}`;
      const res = await runVerification(targetUri);
      if (res.ok) {
        setSimStatus({
          state: "done",
          message: "Simulation verification completed. Check Diagnostics for requirement results.",
        });
      } else {
        setSimStatus({
          state: "error",
          message: `Simulation verification failed: ${res.error || "cancelled or no verification case matched."}`,
        });
      }
      await refreshThreadGraph();
    } catch (err) {
      setSimStatus({
        state: "error",
        message: `Simulation verification error: ${err instanceof Error ? err.message : "unknown error"}`,
      });
    }
  }, [documentUri, fileNames, activeFileName, refreshThreadGraph]);

  useEffect(() => {
    if (fileNames.length >= 2 && documentUri) {
      void handleRunFormalVerify();
    }
  }, [fileNames.length, documentUri, handleRunFormalVerify]);

  const handleApplySuggestedEdit = useCallback(
    (edit: NonNullable<NonNullable<AnsatzVerifyAllReport["polyglotDigitalThread"]>["suggestedEdits"]>[number]) => {
      if (!projectFiles || !onUpdateProjectFile) return;
      const targetName =
        edit.fileName && edit.fileName in projectFiles ? edit.fileName : (fileNames[edit.fileIndex] ?? activeFileName);
      if (!targetName || !(targetName in projectFiles)) return;
      const text = projectFiles[targetName]!;
      const lines = text.split("\n");
      const startLine = Math.max(0, (edit.startLine ?? 1) - 1);
      const endLine = Math.max(startLine, (edit.endLine ?? 1) - 1);
      const startCol = Math.max(0, (edit.startCol ?? 1) - 1);
      const endCol = Math.max(0, (edit.endCol ?? 1) - 1);
      if (startLine >= lines.length) return;

      const before =
        lines.slice(0, startLine).join("\n") + (startLine > 0 ? "\n" : "") + lines[startLine]!.slice(0, startCol);
      const after =
        lines[endLine]!.slice(endCol) + (endLine < lines.length - 1 ? "\n" + lines.slice(endLine + 1).join("\n") : "");
      onUpdateProjectFile(targetName, before + edit.newText + after);
    },
    [projectFiles, onUpdateProjectFile, fileNames, activeFileName],
  );

  const handleInsertLink = useCallback(() => {
    if (!projectFiles || !onUpdateProjectFile || !srcFile || !dstFile || !srcSymbol || !dstSymbol) return;
    const targetContent = projectFiles[srcFile] ?? "";
    const dstStem =
      dstFile
        .replace(/\.[^.]+$/, "")
        .split("/")
        .pop() ?? dstFile;

    let snippet = "";
    if (linkMode === "twin-directive") {
      const cleanSrc = srcSymbol.replace(/^port:/, "");
      const cleanDst = dstSymbol.replace(/^port:/, "");
      const directiveKind = srcSymbol.startsWith("port:") || dstSymbol.startsWith("port:") ? "@port_map" : "@twin";
      snippet = `// ${directiveKind}: ${cleanSrc} <-> ${dstStem}::${cleanDst}\n`;
      onUpdateProjectFile(srcFile, snippet + targetContent);
    } else if (linkMode === "modelica-annotation") {
      const moFile = detectLanguageFromFilename(dstFile) === "modelica" ? dstFile : srcFile;
      const moContent = projectFiles[moFile] ?? "";
      const sym = moFile === dstFile ? dstSymbol : srcSymbol;
      const otherStem =
        (moFile === dstFile ? srcFile : dstFile)
          .replace(/\.[^.]+$/, "")
          .split("/")
          .pop() ?? "Target";
      const otherSym = moFile === dstFile ? srcSymbol : dstSymbol;
      const isIdentChar = (c: number): boolean =>
        (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 95;
      const findSymIndex = (haystack: string, needle: string): number => {
        if (!needle) return -1;
        let from = 0;
        while (from <= haystack.length - needle.length) {
          const idx = haystack.indexOf(needle, from);
          if (idx === -1) return -1;
          const prevOk = idx === 0 || !isIdentChar(haystack.charCodeAt(idx - 1));
          const nextIdx = idx + needle.length;
          const nextOk = nextIdx >= haystack.length || !isIdentChar(haystack.charCodeAt(nextIdx));
          if (prevOk && nextOk) return idx;
          from = idx + 1;
        }
        return -1;
      };
      const lines = moContent.split("\n");
      let inBlockComment = false;
      let replaced = false;
      for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
        const line = lines[lineIdx]!;
        let masked = "";
        let inString = false;
        for (let i = 0; i < line.length; i++) {
          const ch = line[i]!;
          const next = line[i + 1];
          if (inBlockComment) {
            if (ch === "*" && next === "/") {
              masked += "  ";
              inBlockComment = false;
              i++;
            } else {
              masked += " ";
            }
          } else if (inString) {
            if (ch === "\\" && next !== undefined) {
              masked += "  ";
              i++;
            } else {
              masked += " ";
              if (ch === '"') inString = false;
            }
          } else if (ch === "/" && next === "/") {
            masked += " ".repeat(line.length - i);
            break;
          } else if (ch === "/" && next === "*") {
            masked += "  ";
            inBlockComment = true;
            i++;
          } else if (ch === '"') {
            masked += " ";
            inString = true;
          } else {
            masked += ch;
          }
        }
        const matchIdx = findSymIndex(masked, sym);
        if (matchIdx !== -1) {
          const semiIdx = masked.indexOf(";", matchIdx + sym.length);
          if (semiIdx !== -1) {
            lines[lineIdx] =
              `${line.slice(0, semiIdx)} annotation(twin = "${otherStem}::${otherSym}")${line.slice(semiIdx)}`;
            replaced = true;
            break;
          }
        }
      }
      if (replaced) {
        onUpdateProjectFile(moFile, lines.join("\n"));
      } else {
        onUpdateProjectFile(moFile, `// @twin: ${sym} <-> ${otherStem}::${otherSym}\n` + moContent);
      }
    } else if (linkMode === "sysml-import") {
      const sysmlFile = detectLanguageFromFilename(srcFile) === "sysml2" ? srcFile : dstFile;
      const otherStem =
        (sysmlFile === srcFile ? dstFile : srcFile)
          .replace(/\.[^.]+$/, "")
          .split("/")
          .pop() ?? "Model";
      const otherSym = sysmlFile === srcFile ? dstSymbol : srcSymbol;
      const sysmlContent = projectFiles[sysmlFile] ?? "";
      const importLine = `import ${otherStem}::*;\n// Linked constraint target: ${otherStem}.${otherSym}\n`;
      onUpdateProjectFile(sysmlFile, importLine + sysmlContent);
    }

    setShowLinkComposer(false);
    setTimeout(() => void handleRunFormalVerify(), 250);
  }, [projectFiles, onUpdateProjectFile, srcFile, dstFile, srcSymbol, dstSymbol, linkMode, handleRunFormalVerify]);

  const cardBg = isDark ? "rgba(22, 27, 34, 0.72)" : "#ffffff";
  const subtleBg = isDark ? "rgba(255, 255, 255, 0.04)" : "rgba(15, 23, 42, 0.03)";
  const border = isDark ? "rgba(255, 255, 255, 0.1)" : "rgba(15, 23, 42, 0.12)";
  const textPrimary = isDark ? "#f0f6fc" : "#0f172a";
  const textMuted = isDark ? "#8b949e" : "#475569";

  const polyglotThread = verifyReport?.polyglotDigitalThread;
  const variableLinks = polyglotThread?.variableLinks ?? [];
  const conflicts = polyglotThread?.conflicts ?? [];
  const suggestedEdits = polyglotThread?.suggestedEdits ?? [];

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflowY: "auto",
        padding: 16,
        gap: 14,
        color: textPrimary,
        fontSize: 13,
      }}
    >
      {/* Header & Actions */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          padding: 12,
          borderRadius: 10,
          border: `1px solid ${border}`,
          backgroundColor: cardBg,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <GitBranchIcon size={18} />
          <div>
            <div style={{ fontWeight: 600, fontSize: 14 }}>Digital Thread Composition & Verification</div>
            <div style={{ fontSize: 12, color: textMuted }}>
              {fileNames.length} artifact{fileNames.length === 1 ? "" : "s"} in workspace
              {polyglotThread ? ` · ${polyglotThread.mode ?? "generic"} mode` : ""}
            </div>
          </div>
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
          <Button
            size="small"
            leadingVisual={LinkIcon}
            onClick={() => setShowLinkComposer((v) => !v)}
            disabled={fileNames.length < 1}
          >
            Link Artifacts
          </Button>
          <Button
            size="small"
            leadingVisual={SyncIcon}
            onClick={() => void handleRunFormalVerify()}
            disabled={isVerifyingFormal || !documentUri}
          >
            {isVerifyingFormal ? "Verifying..." : "Verify Formal (SMT)"}
          </Button>
          <Button
            size="small"
            variant="primary"
            leadingVisual={PlayIcon}
            onClick={() => void handleRunSimVerify()}
            disabled={simStatus.state === "running" || !documentUri}
          >
            {simStatus.state === "running" ? "Simulating..." : "Verify Simulation"}
          </Button>
        </div>
      </div>

      {/* Interactive Link Composer */}
      {showLinkComposer && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 10,
            padding: 12,
            borderRadius: 10,
            border: `1px solid ${isDark ? "rgba(56, 189, 248, 0.35)" : "rgba(8, 145, 178, 0.35)"}`,
            backgroundColor: cardBg,
          }}
        >
          <div style={{ fontWeight: 600, fontSize: 12 }}>Compose Cross-Artifact Link</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 8 }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11, color: textMuted }}>
              Source Artifact
              <select
                value={srcFile}
                onChange={(e) => setSrcFile(e.target.value)}
                style={{
                  padding: "5px 8px",
                  borderRadius: 6,
                  border: `1px solid ${border}`,
                  background: subtleBg,
                  color: textPrimary,
                }}
              >
                {fileNames.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11, color: textMuted }}>
              Source Symbol / Port
              <input
                value={srcSymbol}
                onChange={(e) => setSrcSymbol(e.target.value)}
                list="ansatz-dt-src-symbols"
                style={{
                  padding: "5px 8px",
                  borderRadius: 6,
                  border: `1px solid ${border}`,
                  background: subtleBg,
                  color: textPrimary,
                }}
              />
              <datalist id="ansatz-dt-src-symbols">
                {srcSymbols.map((s) => (
                  <option key={`${s.name}:${s.line}`} value={s.name} />
                ))}
              </datalist>
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11, color: textMuted }}>
              Target Artifact
              <select
                value={dstFile}
                onChange={(e) => setDstFile(e.target.value)}
                style={{
                  padding: "5px 8px",
                  borderRadius: 6,
                  border: `1px solid ${border}`,
                  background: subtleBg,
                  color: textPrimary,
                }}
              >
                {fileNames.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11, color: textMuted }}>
              Target Symbol / Port
              <input
                value={dstSymbol}
                onChange={(e) => setDstSymbol(e.target.value)}
                list="ansatz-dt-dst-symbols"
                style={{
                  padding: "5px 8px",
                  borderRadius: 6,
                  border: `1px solid ${border}`,
                  background: subtleBg,
                  color: textPrimary,
                }}
              />
              <datalist id="ansatz-dt-dst-symbols">
                {dstSymbols.map((s) => (
                  <option key={`${s.name}:${s.line}`} value={s.name} />
                ))}
              </datalist>
            </label>
          </div>
          <div
            style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 8 }}
          >
            <select
              value={linkMode}
              onChange={(e) => setLinkMode(e.target.value as typeof linkMode)}
              style={{
                padding: "5px 8px",
                borderRadius: 6,
                border: `1px solid ${border}`,
                background: subtleBg,
                color: textPrimary,
                fontSize: 12,
              }}
            >
              <option value="twin-directive">Explicit Metadata (@twin: / @port_map:)</option>
              <option value="modelica-annotation">Modelica annotation(twin = "...")</option>
              <option value="sysml-import">SysML v2 import &amp; constraint binding</option>
            </select>
            <div style={{ display: "flex", gap: 8 }}>
              <Button size="small" onClick={() => setShowLinkComposer(false)}>
                Cancel
              </Button>
              <Button size="small" variant="primary" onClick={handleInsertLink}>
                Insert Link
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Simulation Verification Status */}
      {simStatus.state !== "idle" && (
        <div
          data-testid="ansatz-sim-status"
          data-state={simStatus.state}
          style={{
            padding: "8px 12px",
            borderRadius: 8,
            border: `1px solid ${border}`,
            backgroundColor: subtleBg,
            fontSize: 12,
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          {simStatus.state === "error" ? <XCircleFillIcon size={14} /> : <CheckCircleFillIcon size={14} />}
          <span>{simStatus.message}</span>
        </div>
      )}

      {/* Interactive Node-Link Digital Thread Graph */}
      {fileNames.length >= 2 && (
        <div
          data-testid="ansatz-digital-thread-graph"
          style={{
            padding: 12,
            borderRadius: 10,
            border: `1px solid ${border}`,
            backgroundColor: cardBg,
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 12 }}>
            <span style={{ fontWeight: 600 }}>Artifact Dependency &amp; Verification Graph</span>
            <span style={{ color: textMuted, fontSize: 11 }}>
              {variableLinks.length} active link{variableLinks.length === 1 ? "" : "s"}
            </span>
          </div>
          {(() => {
            const colWidth = 190;
            const gapX = 56;
            const padX = 16;
            const nodeH = 54;
            const nodeY = 26;
            const svgW = Math.max(460, padX * 2 + fileNames.length * colWidth + (fileNames.length - 1) * gapX);
            const edgeAreaH = Math.max(70, variableLinks.length * 26 + 34);
            const svgH = nodeY + nodeH + edgeAreaH;

            const nodeCenters = new Map<string, { x: number; y: number; lang: string }>();
            fileNames.forEach((f, idx) => {
              const x = padX + idx * (colWidth + gapX) + colWidth / 2;
              nodeCenters.set(f, { x, y: nodeY + nodeH, lang: detectLanguageFromFilename(f) });
            });

            const matchFileForDomain = (domName: string): string | undefined => {
              const low = domName.toLowerCase();
              return (
                fileNames.find((f) => {
                  const l = detectLanguageFromFilename(f).toLowerCase();
                  return (
                    l === low ||
                    (low.includes("sysml") && l === "sysml2") ||
                    (low.includes("cad") && (l === "scad" || l === "step")) ||
                    (low.includes("modelica") && l === "modelica")
                  );
                }) ?? fileNames[0]
              );
            };

            return (
              <div style={{ overflowX: "auto" }}>
                <svg
                  width="100%"
                  viewBox={`0 0 ${svgW} ${svgH}`}
                  style={{ display: "block", minWidth: Math.min(svgW, 460), height: "auto" }}
                >
                  {/* Links */}
                  {variableLinks.map((link, idx) => {
                    const srcFileMatch = matchFileForDomain(link.sourceDomain);
                    const dstFileMatch = matchFileForDomain(link.targetDomains[0] ?? link.sourceDomain);
                    const p1 = srcFileMatch ? nodeCenters.get(srcFileMatch) : undefined;
                    const p2 = dstFileMatch ? nodeCenters.get(dstFileMatch) : undefined;
                    if (!p1 || !p2) return null;
                    const x1 = p1.x;
                    const x2 = p2.x === p1.x ? p1.x + 24 : p2.x;
                    const yBase = nodeY + nodeH;
                    const arcY = yBase + 28 + idx * 24;
                    const stroke = link.status === "SAT" ? "#34d399" : "#fb7185";
                    const midX = (x1 + x2) / 2;
                    return (
                      <g key={`${link.symbol}:${idx}`}>
                        <path
                          d={`M ${x1} ${yBase} C ${x1} ${arcY}, ${x2} ${arcY}, ${x2} ${yBase}`}
                          fill="none"
                          stroke={stroke}
                          strokeWidth={2}
                          strokeDasharray={link.status === "SAT" ? undefined : "5 3"}
                        />
                        <rect
                          x={midX - 58}
                          y={arcY - 19}
                          width={116}
                          height={18}
                          rx={9}
                          fill={isDark ? "#161b22" : "#f8fafc"}
                          stroke={stroke}
                          strokeWidth={1}
                        />
                        <text
                          x={midX}
                          y={arcY - 7}
                          textAnchor="middle"
                          fontSize={10}
                          fontWeight={600}
                          fill={stroke}
                          fontFamily="var(--font-mono, monospace)"
                        >
                          {link.symbol} · {link.status}
                        </text>
                      </g>
                    );
                  })}

                  {/* Artifact Nodes */}
                  {fileNames.map((fName, idx) => {
                    const x = padX + idx * (colWidth + gapX);
                    const lang = detectLanguageFromFilename(fName);
                    const isActive = fName === activeFileName;
                    const stroke = isActive ? (isDark ? "#38bdf8" : "#0891b2") : border;
                    return (
                      <g key={fName} onClick={() => onSelectProjectFile?.(fName)} style={{ cursor: "pointer" }}>
                        <rect
                          x={x}
                          y={nodeY}
                          width={colWidth}
                          height={nodeH}
                          rx={8}
                          fill={isDark ? "#0d1117" : "#ffffff"}
                          stroke={stroke}
                          strokeWidth={isActive ? 2 : 1}
                        />
                        <text
                          x={x + 12}
                          y={nodeY + 22}
                          fontSize={12}
                          fontWeight={700}
                          fill={textPrimary}
                          fontFamily="var(--font-mono, monospace)"
                        >
                          {fName.length > 22 ? `${fName.slice(0, 20)}…` : fName}
                        </text>
                        <text
                          x={x + 12}
                          y={nodeY + 40}
                          fontSize={10}
                          fill={textMuted}
                          fontFamily="var(--font-sans, sans-serif)"
                        >
                          {lang.toUpperCase()} · {(symbolsByFile.get(fName) ?? []).length} symbols
                        </text>
                      </g>
                    );
                  })}
                </svg>
              </div>
            );
          })()}
        </div>
      )}

      {/* Workspace Artifacts Overview */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
        {fileNames.map((fName) => {
          const lang = detectLanguageFromFilename(fName);
          const syms = symbolsByFile.get(fName) ?? [];
          const isActive = fName === activeFileName;
          return (
            <div
              key={fName}
              style={{
                padding: 10,
                borderRadius: 8,
                border: `1px solid ${isActive ? (isDark ? "#38bdf8" : "#0891b2") : border}`,
                backgroundColor: cardBg,
                display: "flex",
                flexDirection: "column",
                gap: 6,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
                <button
                  type="button"
                  onClick={() => onSelectProjectFile?.(fName)}
                  style={{
                    border: "none",
                    background: "transparent",
                    padding: 0,
                    color: isActive ? (isDark ? "#38bdf8" : "#0891b2") : textPrimary,
                    fontWeight: 600,
                    fontFamily: "var(--font-mono, monospace)",
                    fontSize: 12,
                    cursor: "pointer",
                    textAlign: "left",
                  }}
                >
                  {fName}
                </button>
                <span
                  style={{
                    fontSize: 10,
                    padding: "1px 6px",
                    borderRadius: 999,
                    backgroundColor: subtleBg,
                    color: textMuted,
                    textTransform: "uppercase",
                  }}
                >
                  {lang}
                </span>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                {syms.slice(0, 8).map((s) => (
                  <button
                    key={`${s.name}:${s.line}`}
                    type="button"
                    onClick={() => {
                      onSelectProjectFile?.(fName);
                      setTimeout(() => onRevealLine?.(s.line, s.name), 60);
                    }}
                    style={{
                      fontSize: 11,
                      padding: "2px 6px",
                      borderRadius: 4,
                      border: `1px solid ${border}`,
                      backgroundColor: subtleBg,
                      color: textPrimary,
                      fontFamily: "var(--font-mono, monospace)",
                      cursor: "pointer",
                    }}
                  >
                    {s.name}
                    {s.value ? ` = ${s.value}` : ""}
                  </button>
                ))}
                {syms.length === 0 && <span style={{ fontSize: 11, color: textMuted }}>No scalar symbols indexed</span>}
              </div>
            </div>
          );
        })}
      </div>

      {/* Formal Verification Links & Conflicts */}
      {polyglotThread && (
        <div
          style={{
            padding: 12,
            borderRadius: 10,
            border: `1px solid ${border}`,
            backgroundColor: cardBg,
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontWeight: 600 }}>Cross-Artifact Formal Verification</span>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                padding: "2px 8px",
                borderRadius: 999,
                fontSize: 11,
                fontWeight: 700,
                backgroundColor: polyglotThread.isSat ? "rgba(52, 211, 153, 0.16)" : "rgba(251, 113, 133, 0.16)",
                color: polyglotThread.isSat ? "#34d399" : "#fb7185",
              }}
            >
              {polyglotThread.isSat ? <CheckCircleFillIcon size={12} /> : <AlertIcon size={12} />}
              {polyglotThread.isSat
                ? "SAT"
                : `UNSAT (${conflicts.length} conflict${conflicts.length === 1 ? "" : "s"})`}
            </span>
          </div>

          {variableLinks.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {variableLinks.map((link, idx) => (
                <div
                  key={`${link.canonicalFqn}:${idx}`}
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 8,
                    padding: "6px 10px",
                    borderRadius: 6,
                    backgroundColor: subtleBg,
                    fontSize: 12,
                  }}
                >
                  <div>
                    <strong style={{ fontFamily: "var(--font-mono, monospace)" }}>{link.symbol}</strong>{" "}
                    <span style={{ color: textMuted }}>({link.bindingMechanism})</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontFamily: "var(--font-mono, monospace)", color: textMuted }}>
                      {link.valueFormatted} {link.unit}
                    </span>
                    <span
                      style={{
                        fontWeight: 700,
                        fontSize: 11,
                        color: link.status === "SAT" ? "#34d399" : "#fb7185",
                      }}
                    >
                      {link.status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {conflicts.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "var(--ms-status-fail-fg, #fb7185)" }}>
                Detected Conflicts ({conflicts.length})
              </div>
              {conflicts.map((conflict, idx) => {
                const c = conflict as unknown as Record<string, unknown>;
                const msg =
                  (typeof c.message === "string" && c.message) ||
                  (typeof c.description === "string" && c.description) ||
                  (typeof c.reason === "string" && c.reason) ||
                  (typeof c.symbol === "string" ? `Conflict on '${c.symbol}'` : JSON.stringify(conflict));
                return (
                  <div
                    key={idx}
                    style={{
                      padding: "6px 10px",
                      borderRadius: 6,
                      backgroundColor: "var(--ms-status-fail-bg, rgba(251, 113, 133, 0.12))",
                      border: "1px solid var(--ms-status-fail-border, rgba(251, 113, 133, 0.32))",
                      color: "var(--ms-status-fail-fg, #fb7185)",
                      fontSize: 11.5,
                    }}
                  >
                    {msg}
                  </div>
                );
              })}
            </div>
          )}

          {suggestedEdits.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: textMuted }}>Suggested Reconciliations</div>
              {suggestedEdits.map((edit, idx) => (
                <div
                  key={idx}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 8,
                    padding: "6px 10px",
                    borderRadius: 6,
                    border: `1px solid ${border}`,
                    fontSize: 12,
                  }}
                >
                  <span>{edit.description || `Update ${edit.fileName ?? "file"} → ${edit.newText}`}</span>
                  <Button size="small" onClick={() => handleApplySuggestedEdit(edit)}>
                    Apply Fix
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Hypergraph Thread Slots */}
      {threadGraph && threadGraph.threads.length > 0 && (
        <div
          style={{
            padding: 12,
            borderRadius: 10,
            border: `1px solid ${border}`,
            backgroundColor: cardBg,
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          <div style={{ fontWeight: 600 }}>Hypergraph Threads ({threadGraph.summary.totalThreads})</div>
          {threadGraph.threads.map((t) => (
            <div
              key={String(t.threadId)}
              style={{
                padding: 8,
                borderRadius: 6,
                backgroundColor: subtleBg,
                display: "flex",
                flexDirection: "column",
                gap: 6,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 12 }}>
                <span style={{ fontWeight: 600 }}>
                  Thread #{String(t.threadId)} ({t.status})
                </span>
                {typeof t.threadId === "number" && (t.status === "conflict" || t.status === "stale") && (
                  <Button
                    size="small"
                    onClick={() =>
                      void reconcileThreadSlot(t.threadId as number, "physics-simplex").then(refreshThreadGraph)
                    }
                  >
                    Reconcile (Simplex)
                  </Button>
                )}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {t.nodes.map((n) => (
                  <button
                    key={`${n.domain}:${n.nodeId}`}
                    type="button"
                    onClick={() => void getBlastRadius(n.domain, n.nodeId).then(setBlastRadius)}
                    style={{
                      padding: "3px 8px",
                      borderRadius: 6,
                      border: `1px solid ${border}`,
                      backgroundColor: cardBg,
                      color: textPrimary,
                      fontSize: 11,
                      cursor: "pointer",
                    }}
                  >
                    [{n.domain}] {n.name}
                  </button>
                ))}
              </div>
            </div>
          ))}
          {blastRadius && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ fontSize: 11, color: textMuted }}>
                Blast Radius: {blastRadius.totalImpactedCount} impacted node(s) across{" "}
                {blastRadius.impactedThreads.length} thread(s).
              </div>
              {Array.isArray((blastRadius as unknown as { impactedNodes?: unknown[] }).impactedNodes) &&
                ((
                  blastRadius as unknown as {
                    impactedNodes?: Array<{ domain?: string; name?: string; nodeId?: string }>;
                  }
                ).impactedNodes?.length ?? 0) > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                    {(
                      blastRadius as unknown as {
                        impactedNodes: Array<{ domain?: string; name?: string; nodeId?: string }>;
                      }
                    ).impactedNodes
                      .slice(0, 24)
                      .map((node, idx) => (
                        <span
                          key={`${node.domain ?? ""}:${node.nodeId ?? idx}`}
                          style={{
                            fontSize: 10.5,
                            padding: "2px 6px",
                            borderRadius: 999,
                            backgroundColor: "var(--ms-status-warn-bg, rgba(245,158,11,0.12))",
                            color: "var(--ms-status-warn-fg, #d97706)",
                            border: "1px solid var(--ms-status-warn-border, rgba(245,158,11,0.3))",
                          }}
                        >
                          {node.domain ? `[${node.domain}] ` : ""}
                          {node.name ?? node.nodeId ?? "node"}
                        </span>
                      ))}
                  </div>
                )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
