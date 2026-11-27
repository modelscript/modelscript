// SPDX-License-Identifier: AGPL-3.0-or-later

import type { editor } from "monaco-editor";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { didOpen, runFormalLints, type AnsatzOnDemandLintMode } from "../util/lsp-bridge";

export interface UseAnsatzDiagnosticsOptions {
  documentUri: string;
  documentUriRef: React.RefObject<string>;
  editor: editor.ICodeEditor | null;
  content: string;
  dialect: string;
  projectFiles?: Record<string, string> | undefined;
  embedRootPrefix: string;
  toast: {
    error(message: string): void;
    success(message: string): void;
    warning(message: string): void;
  };
}

export function useAnsatzDiagnostics({
  documentUri,
  documentUriRef,
  editor,
  content,
  dialect,
  projectFiles,
  embedRootPrefix,
  toast,
}: UseAnsatzDiagnosticsOptions) {
  const [editorDiagnostics, setEditorDiagnostics] = useState<editor.IMarkerData[]>([]);
  const [diagnosticsByUri, setDiagnosticsByUri] = useState<Map<string, editor.IMarkerData[]>>(() => new Map());
  const [onDemandMarkersByUri, setOnDemandMarkersByUri] = useState<Map<string, editor.IMarkerData[]>>(() => new Map());
  const [isRunningOnDemandLints, setIsRunningOnDemandLints] = useState(false);
  const [isDiagnosticsExpanded, setIsDiagnosticsExpanded] = useState(false);
  const [diagnosticsPanelHeight, setDiagnosticsPanelHeight] = useState(160);
  const userToggledDiagnosticsRef = useRef(false);

  const handleDiagnosticsChange = useCallback(
    (markers: editor.IMarkerData[], uri?: string) => {
      const targetUri = uri || documentUriRef.current;
      const markersEqual = (a: editor.IMarkerData[], b: editor.IMarkerData[]) =>
        a.length === b.length &&
        a.every(
          (m, i) =>
            m.message === b[i]!.message &&
            m.severity === b[i]!.severity &&
            m.startLineNumber === b[i]!.startLineNumber &&
            m.startColumn === b[i]!.startColumn &&
            m.code === b[i]!.code,
        );

      setDiagnosticsByUri((prev) => {
        const existing = prev.get(targetUri);
        if (existing ? markersEqual(existing, markers) : markers.length === 0) {
          return prev;
        }
        const next = new Map(prev);
        if (markers.length === 0) {
          next.delete(targetUri);
        } else {
          next.set(targetUri, markers);
        }
        return next;
      });
      if (!uri || uri === documentUriRef.current) {
        setEditorDiagnostics((prev) => (markersEqual(prev, markers) ? prev : markers));
      }
      if (!userToggledDiagnosticsRef.current && markers.length > 0) {
        setIsDiagnosticsExpanded(true);
      }
    },
    [documentUriRef],
  );

  useEffect(() => {
    setEditorDiagnostics(diagnosticsByUri.get(documentUri) ?? []);
  }, [documentUri, diagnosticsByUri]);

  const activeOnDemandMarkers = useMemo(
    () => onDemandMarkersByUri.get(documentUri) ?? [],
    [documentUri, onDemandMarkersByUri],
  );

  const mergedEditorDiagnostics = useMemo(() => {
    if (activeOnDemandMarkers.length === 0) return editorDiagnostics;
    const seen = new Set<string>();
    const out: editor.IMarkerData[] = [];
    for (const m of editorDiagnostics) {
      const codeVal = typeof m.code === "object" && m.code !== null ? m.code.value : (m.code ?? "");
      seen.add(`${m.startLineNumber}:${m.startColumn}:${codeVal}:${m.message}`);
      out.push(m);
    }
    for (const m of activeOnDemandMarkers) {
      const codeVal = typeof m.code === "object" && m.code !== null ? m.code.value : (m.code ?? "");
      const key = `${m.startLineNumber}:${m.startColumn}:${codeVal}:${m.message}`;
      if (!seen.has(key)) {
        seen.add(key);
        out.push(m);
      }
    }
    return out;
  }, [editorDiagnostics, activeOnDemandMarkers]);

  const handleClearOnDemandLints = useCallback(() => {
    const targetUri = documentUriRef.current;
    setOnDemandMarkersByUri((prev) => {
      if (!prev.has(targetUri)) return prev;
      const next = new Map(prev);
      next.delete(targetUri);
      return next;
    });
  }, [documentUriRef]);

  const handleRunOnDemandLints = useCallback(
    async (mode: AnsatzOnDemandLintMode = "all") => {
      const targetUri = documentUriRef.current;
      const currentCode = editor?.getValue() ?? content;
      setIsRunningOnDemandLints(true);
      try {
        await didOpen(targetUri, currentCode, dialect);
        const res = await runFormalLints(targetUri, {
          includeFormal: mode === "all" || mode === "formal",
          includeCompilerLints: mode === "all" || mode === "compiler",
        });
        if (!res.ok) {
          toast.error(res.error || "On-demand verification failed.");
          return;
        }
        const converted: editor.IMarkerData[] = (res.diagnostics ?? []).map((d) => ({
          startLineNumber: (d.range?.start?.line ?? 0) + 1,
          startColumn: (d.range?.start?.character ?? 0) + 1,
          endLineNumber: (d.range?.end?.line ?? 0) + 1,
          endColumn: Math.max((d.range?.end?.character ?? 0) + 1, (d.range?.start?.character ?? 0) + 2),
          severity: d.severity === 1 ? 8 : d.severity === 2 ? 4 : 2,
          message: d.message,
          ...(d.code !== undefined ? { code: String(d.code) } : {}),
          source: d.source ?? "modelscript-formal",
        }));
        setOnDemandMarkersByUri((prev) => {
          const next = new Map(prev);
          if (converted.length === 0) {
            next.delete(targetUri);
          } else {
            next.set(targetUri, converted);
          }
          return next;
        });
        const modeLabel =
          mode === "formal"
            ? "Formal verification"
            : mode === "compiler"
              ? "WASM compiler lints"
              : "Formal & compiler verification";
        if (converted.length === 0) {
          toast.success(`${modeLabel} passed with no diagnostics.`);
        } else {
          setIsDiagnosticsExpanded(true);
          toast.warning(
            `${modeLabel} found ${converted.length} diagnostic(s) (${res.formalCount ?? 0} formal, ${res.compilerCount ?? 0} compiler).`,
          );
        }
      } catch (err) {
        toast.error(`Failed to run on-demand verification: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        setIsRunningOnDemandLints(false);
      }
    },
    [documentUriRef, editor, content, dialect, toast],
  );

  const projectDiagnostics = useMemo(() => {
    if (!projectFiles) return undefined;
    const result: Array<{ fileName: string; uri: string; markers: editor.IMarkerData[] }> = [];
    for (const fileName of Object.keys(projectFiles)) {
      const cleanName = fileName.replace(/^\/+/, "");
      const uri = `${embedRootPrefix}/${cleanName}`;
      const baseMarkers = diagnosticsByUri.get(uri) ?? [];
      const extraMarkers = onDemandMarkersByUri.get(uri) ?? [];
      const markers = extraMarkers.length > 0 ? [...baseMarkers, ...extraMarkers] : baseMarkers;
      if (markers.length > 0) {
        result.push({ fileName, uri, markers });
      }
    }
    return result;
  }, [projectFiles, embedRootPrefix, diagnosticsByUri, onDemandMarkersByUri]);

  const fileDiagnosticCounts = useMemo(() => {
    if (!projectFiles) return undefined;
    const counts: Record<string, { errors: number; warnings: number }> = {};
    for (const fileName of Object.keys(projectFiles)) {
      const cleanName = fileName.replace(/^\/+/, "");
      const uri = `${embedRootPrefix}/${cleanName}`;
      const baseMarkers = diagnosticsByUri.get(uri) ?? [];
      const extraMarkers = onDemandMarkersByUri.get(uri) ?? [];
      const markers = extraMarkers.length > 0 ? [...baseMarkers, ...extraMarkers] : baseMarkers;
      if (markers.length > 0) {
        let errors = 0;
        let warnings = 0;
        for (const m of markers) {
          if (m.severity >= 8) errors++;
          else if (m.severity >= 4) warnings++;
        }
        if (errors > 0 || warnings > 0) {
          counts[fileName] = { errors, warnings };
        }
      }
    }
    return counts;
  }, [projectFiles, embedRootPrefix, diagnosticsByUri, onDemandMarkersByUri]);

  const handleToggleDiagnostics = useCallback(() => {
    userToggledDiagnosticsRef.current = true;
    setIsDiagnosticsExpanded((prev) => !prev);
  }, []);

  return {
    editorDiagnostics,
    isRunningOnDemandLints,
    isDiagnosticsExpanded,
    diagnosticsPanelHeight,
    setDiagnosticsPanelHeight,
    handleDiagnosticsChange,
    activeOnDemandMarkers,
    mergedEditorDiagnostics,
    handleClearOnDemandLints,
    handleRunOnDemandLints,
    projectDiagnostics,
    fileDiagnosticCounts,
    handleToggleDiagnostics,
  };
}
