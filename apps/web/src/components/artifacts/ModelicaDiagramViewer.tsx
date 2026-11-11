// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  CheckIcon,
  CodeIcon,
  CopyIcon,
  DownloadIcon,
  PulseIcon,
  StackIcon,
  SyncIcon,
  TableIcon,
  WorkflowIcon,
} from "@primer/octicons-react";
import { Button, Text } from "@primer/react";
import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import styled from "styled-components";
import { updateArtifactView } from "../../api/artifacts";
import { useAuth } from "../../AuthContext";
import { useTheme } from "../../theme";
import { buildEditorUrlForArtifact } from "../../util/editor-routing";
import Box from "../Box";
import { DraftingTriangleIcon } from "../icons";
import { useToast } from "../ToastContext";
import { CompactTabStrip, FloatingToolBtn, FloatingTools, FooterTabs, useHasFooterSlot } from "./card/CardFooterSlot";
import type { ModelicaPreviewMetadata, ModelicaPreviewMode } from "./modelica-preview-mode.js";
import {
  hasModelica3dVisualizers as hasModelica3dVisualizersHelper,
  inferModelicaPreviewMode as inferModelicaPreviewModeHelper,
} from "./modelica-preview-mode.js";
import { highlightPolyglotLine, sanitizeSvgMarkup } from "./PolyglotArtifactViewer";

const MorselEditorLazy = React.lazy(() => import("../morsel/Morsel"));

export type { ModelicaPreviewMetadata, ModelicaPreviewMode } from "./modelica-preview-mode.js";

export function hasModelica3dVisualizers(code: string): boolean {
  return hasModelica3dVisualizersHelper(code);
}

export function inferModelicaPreviewMode(
  code: string,
  explicitMode?: string | undefined,
  svg?: string | undefined,
  thumbUrl?: string | undefined,
  modelMetadata?: ModelicaPreviewMetadata | undefined,
): ModelicaPreviewMode {
  return inferModelicaPreviewModeHelper(code, explicitMode, svg, thumbUrl, modelMetadata);
}

type CardTabMode = "diagram" | "simulation" | "3d" | "inspector" | "code";

interface ModelicaDiagramViewerProps {
  viewConfig: {
    code?: string | undefined;
    content?: string | undefined;
    url?: string | undefined;
    dialect?: string | undefined;
    title?: string | undefined;
    svg?: string | undefined;
    thumbnail_url?: string | undefined;
    thumbnailUrl?: string | undefined;
    previewMode?: ModelicaPreviewMode | undefined;
    metadata?: Record<string, unknown> | undefined;
    artifactId?: string | number | undefined;
    [key: string]: unknown;
  };
  artifactId?: string | number | undefined;
  isFullScreen?: boolean | undefined;
  onSaved?: ((updatedArtifact: any) => void) | undefined;
}

const CardWrapper = styled.div<{ $isFullScreen: boolean; $standalone?: boolean | undefined }>`
  position: relative;
  width: 100%;
  height: ${(props) => (props.$isFullScreen ? "100%" : "380px")};
  background: var(--color-canvas-default, #0d1117);
  border-radius: ${(props) => (props.$isFullScreen || !props.$standalone ? "0" : "8px")};
  border: ${(props) =>
    props.$isFullScreen || !props.$standalone ? "none" : "1px solid var(--color-border-default, #30363d)"};
  overflow: hidden;
  display: flex;
  flex-direction: column;
`;

const CardToolbar = styled.div`
  height: 36px;
  min-height: 36px;
  background: var(--color-canvas-subtle, #161b22);
  border-bottom: 1px solid var(--color-border-default, #30363d);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px;
  gap: 8px;
  z-index: 10;
`;

const ToolbarLeft = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex: 1;
`;

const ToolbarRight = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
`;

const Badge = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  line-height: 16px;
  font-family: var(--font-mono, monospace);
  padding: 2px 7px;
  border-radius: 5px;
  background: var(--color-canvas-default);
  color: var(--ms-brand, #0e7490);
  border: 1px solid var(--color-accent-blue-border, color-mix(in srgb, var(--ms-brand, #0e7490) 35%, transparent));
  font-weight: 700;
  white-space: nowrap;
  flex-shrink: 0;
`;

const IconActionButton = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  height: 26px;
  padding: 0 8px;
  border-radius: 5px;
  border: 1px solid var(--color-border-default, #30363d);
  background: var(--color-canvas-default, #0d1117);
  color: var(--color-fg-default, #e6edf3);
  font-size: 11px;
  line-height: 16px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  transition:
    background-color 0.15s ease,
    color 0.15s ease,
    border-color 0.15s ease;

  &:hover {
    background: var(--color-canvas-inset, rgba(148, 163, 184, 0.14));
    color: var(--color-fg-default, #e6edf3);
    border-color: var(--color-border-muted, #484f58);
  }
`;

const EditorContainer = styled.div<{ $isFullScreen: boolean }>`
  flex: 1;
  width: 100%;
  height: ${(props) => (props.$isFullScreen ? "100%" : "calc(100% - 36px)")};
  position: relative;
  overflow: hidden;
`;

export function isLegacyBogusModelicaSvg(svg: string, inferredMode: ModelicaPreviewMode): boolean {
  if (!svg) return false;
  if (svg.includes("RC Step Response") && svg.includes("V_c(t)")) return true;
  if (svg.includes("data-preview-mode=")) return false;
  if (svg.includes("<!-- Procedural 3D Shaders")) {
    if (inferredMode !== "diagram") return true;
    if (/:\s*(?:Real|Integer|Boolean|String)\b/.test(svg)) return true;
  }
  return false;
}

function escapeXml(str: string): string {
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function buildClientCodeFallbackSvg(code: string, title: string): string {
  const lines = code.replace(/\r\n/g, "\n").split("\n");
  const visible = lines.slice(0, 15);
  const isPartial = /\bpartial\s+/.test(code);
  const kindMatch = code.match(
    /\b(model|class|block|connector|record|package|function|type)\s+([A-Za-z_][A-Za-z0-9_]*)/,
  );
  const kind = (kindMatch?.[1] || "model").toUpperCase();
  const displayTitle = kindMatch?.[2] || title || "Model";
  const badge = `${isPartial ? "PARTIAL " : ""}${kind} · CODE`;

  const rows = visible
    .map((line, i) => {
      const y = 78 + i * 21;
      const clipped = line.length > 86 ? `${line.slice(0, 83)}...` : line;
      return `<g><text x="48" y="${y}" text-anchor="end" fill="#484f58" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="12">${i + 1}</text><text x="64" y="${y}" xml:space="preserve" fill="#e6edf3" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="12.5">${escapeXml(clipped)}</text></g>`;
    })
    .join("\n  ");

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 450" width="100%" height="100%" data-preview-mode="code">
  <rect width="800" height="450" fill="#0d1117"/>
  <g transform="translate(20, 14)">
    <rect x="0" y="0" width="136" height="22" rx="4" fill="rgba(56, 139, 253, 0.15)" stroke="rgba(56, 139, 253, 0.4)"/>
    <text x="68" y="15" text-anchor="middle" fill="#58a6ff" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="10" font-weight="700">${escapeXml(badge)}</text>
    <text x="148" y="16" fill="#f0f6fc" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" font-size="14" font-weight="700">${escapeXml(displayTitle)}</text>
    <text x="760" y="15" text-anchor="end" fill="#8b949e" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="11">${lines.length} lines</text>
  </g>
  <rect x="20" y="46" width="760" height="384" rx="8" fill="#161b22" stroke="#30363d" stroke-width="1"/>
  <line x1="56" y1="46" x2="56" y2="430" stroke="#21262d" stroke-width="1"/>
  ${rows}
</svg>`;
}

export const ModelicaDiagramViewer: React.FC<ModelicaDiagramViewerProps> = ({
  viewConfig,
  artifactId: propArtifactId,
  isFullScreen = false,
  onSaved,
}) => {
  const { token } = useAuth();
  const toast = useToast();
  const targetArtifactId = propArtifactId || viewConfig.artifactId;
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const inlineCode = (viewConfig.code as string) || (viewConfig.content as string) || "";
  const [fetchedCode, setFetchedCode] = useState<string | null>(null);
  const [isFetchingCode, setIsFetchingCode] = useState<boolean>(
    () => !inlineCode && typeof viewConfig.url === "string" && Boolean(viewConfig.url),
  );
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const svgTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      if (svgTimerRef.current) clearTimeout(svgTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (inlineCode || typeof viewConfig.url !== "string" || !viewConfig.url) {
      setIsFetchingCode(false);
      return;
    }
    const controller = new AbortController();
    setIsFetchingCode(true);
    fetch(viewConfig.url, { signal: controller.signal })
      .then((r) => (r.ok ? r.text() : ""))
      .then((txt) => {
        if (txt) setFetchedCode(txt);
      })
      .catch(() => {})
      .finally(() => {
        if (!controller.signal.aborted) {
          setIsFetchingCode(false);
        }
      });
    return () => controller.abort();
  }, [inlineCode, viewConfig.url]);

  const baseCode = inlineCode || fetchedCode || "model Example\n\nend Example;";
  const [editedCode, setEditedCode] = useState<string | null>(null);
  const [savedBaselineCode, setSavedBaselineCode] = useState<string>(baseCode);

  useEffect(() => {
    setSavedBaselineCode(baseCode);
  }, [baseCode]);

  const code = editedCode ?? baseCode;
  const hasUnsavedChanges = Boolean(editedCode && editedCode !== savedBaselineCode);

  const handleSave = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (!targetArtifactId) return;
    if (!token) {
      toast.error("Please log in to save changes to this artifact");
      return;
    }
    setIsSaving(true);
    try {
      const updated = await updateArtifactView(targetArtifactId, {
        view_config: {
          ...viewConfig,
          code: editedCode,
        },
        title: (viewConfig.title as string) || undefined,
      });
      if (editedCode !== null) {
        setSavedBaselineCode(editedCode);
      }
      setSaveSuccess(true);
      toast.success("Artifact changes saved successfully!");
      onSaved?.(updated);
      window.dispatchEvent(
        new CustomEvent("modelscript:artifact-updated", {
          detail: { artifactId: targetArtifactId, artifactView: updated?.artifactView },
        }),
      );
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => setSaveSuccess(false), 2500);
    } catch (err: unknown) {
      console.error("Failed to save artifact:", err);
      toast.error("Failed to save changes. Make sure you own this artifact.");
    } finally {
      setIsSaving(false);
    }
  };
  const dialect = (viewConfig.dialect as string) || "modelica";
  const title = (viewConfig.title as string) || "Interactive System";

  const rawSvg = typeof viewConfig.svg === "string" ? viewConfig.svg : "";
  const rawThumbUrl =
    (typeof viewConfig.thumbnail_url === "string" && viewConfig.thumbnail_url) ||
    (typeof viewConfig.thumbnailUrl === "string" && viewConfig.thumbnailUrl) ||
    "";
  const [thumbError, setThumbError] = useState(false);

  useEffect(() => {
    setThumbError(false);
  }, [rawThumbUrl]);

  const explicitMode =
    (viewConfig.previewMode as string | undefined) ||
    (typeof viewConfig.metadata === "object" && viewConfig.metadata !== null
      ? (viewConfig.metadata["previewMode"] as string | undefined)
      : undefined) ||
    (viewConfig.simulationPreview ? "simulation" : undefined) ||
    (typeof viewConfig.nodeCount === "number" && viewConfig.nodeCount > 0 ? "diagram" : undefined);

  const metadataRecord =
    typeof viewConfig.metadata === "object" && viewConfig.metadata !== null
      ? (viewConfig.metadata as Record<string, unknown>)
      : undefined;

  const modelMetadata: ModelicaPreviewMetadata | undefined = useMemo(() => {
    if (!metadataRecord) return undefined;
    const nested =
      typeof metadataRecord.modelMetadata === "object" && metadataRecord.modelMetadata !== null
        ? (metadataRecord.modelMetadata as ModelicaPreviewMetadata)
        : undefined;
    return {
      isPartial: typeof metadataRecord.isPartial === "boolean" ? metadataRecord.isPartial : nested?.isPartial,
      hasIcon: typeof metadataRecord.hasIcon === "boolean" ? metadataRecord.hasIcon : nested?.hasIcon,
      hasDiagram: typeof metadataRecord.hasDiagram === "boolean" ? metadataRecord.hasDiagram : nested?.hasDiagram,
      has3d: typeof metadataRecord.has3d === "boolean" ? metadataRecord.has3d : nested?.has3d,
      hasEquations:
        typeof metadataRecord.hasEquations === "boolean" ? metadataRecord.hasEquations : nested?.hasEquations,
      hasConnect: typeof metadataRecord.hasConnect === "boolean" ? metadataRecord.hasConnect : nested?.hasConnect,
      kind: typeof metadataRecord.kind === "string" ? metadataRecord.kind : nested?.kind,
    };
  }, [metadataRecord]);

  const previewMode = useMemo(
    () => inferModelicaPreviewMode(code, explicitMode, rawSvg, rawThumbUrl, modelMetadata),
    [code, explicitMode, rawSvg, rawThumbUrl, modelMetadata],
  );

  const { theme } = useTheme();
  const isDark = theme === "dark";

  const fallbackCodeSvg = useMemo(
    () => sanitizeSvgMarkup(buildClientCodeFallbackSvg(code, title), { isFullScreen, isDark }),
    [code, title, isFullScreen, isDark],
  );

  const validInlineSvg = useMemo(() => {
    if (rawSvg && !isLegacyBogusModelicaSvg(rawSvg, previewMode)) {
      return sanitizeSvgMarkup(rawSvg, { isFullScreen, isDark });
    }
    if (!rawThumbUrl || thumbError) {
      return fallbackCodeSvg;
    }
    return "";
  }, [rawSvg, rawThumbUrl, thumbError, previewMode, fallbackCodeSvg, isFullScreen, isDark]);

  const [interactive, setInteractive] = useState(isFullScreen);
  const [hasBeenActive, setHasBeenActive] = useState(isFullScreen);

  useEffect(() => {
    if (interactive) {
      setHasBeenActive(true);
    }
  }, [interactive]);

  const [viewMode, setViewMode] = useState<CardTabMode>(() =>
    previewMode === "simulation" ? "simulation" : previewMode === "3d" ? "3d" : "diagram",
  );
  const [simTriggerCount, setSimTriggerCount] = useState<number>(() =>
    previewMode === "simulation" || previewMode === "3d" ? 1 : 0,
  );
  const simPreview = viewConfig?.simulationPreview as Record<string, unknown> | undefined;
  const initialSimVars = useMemo(() => {
    if (Array.isArray(simPreview?.states) && simPreview.states.length > 0) {
      return simPreview.states as string[];
    }
    if (Array.isArray(viewConfig?.simulationVariables) && (viewConfig.simulationVariables as string[]).length > 0) {
      return viewConfig.simulationVariables as string[];
    }
    if (Array.isArray(viewConfig?.states) && (viewConfig.states as string[]).length > 0) {
      return viewConfig.states as string[];
    }
    return undefined;
  }, [simPreview, viewConfig]);
  const initialStartTime = typeof simPreview?.startTime === "number" ? (simPreview.startTime as number) : undefined;
  const initialStopTime = typeof simPreview?.stopTime === "number" ? (simPreview.stopTime as number) : undefined;

  const [copied, setCopied] = useState(false);
  const [copiedSvg, setCopiedSvg] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isFullScreen) {
      setInteractive(true);
    }
  }, [isFullScreen]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      (window as any).__ARTIFACT_READY = true;
    }
  }, [validInlineSvg, previewMode]);

  // Hibernate heavy Morsel runtime when scrolled out of view in feed mode
  useEffect(() => {
    if (!interactive || isFullScreen) return;
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) {
            setInteractive(false);
          }
        });
      },
      { threshold: 0.0 },
    );
    if (containerRef.current) {
      observer.observe(containerRef.current);
    }
    return () => observer.disconnect();
  }, [interactive, isFullScreen]);

  const handleActiveViewChange = useCallback((nextView: "diagram" | "simulation" | "3d" | "inspector" | "code") => {
    if (nextView === "simulation") {
      setViewMode("simulation");
    } else if (nextView === "3d") {
      setViewMode("3d");
    } else if (nextView === "inspector") {
      setViewMode("inspector");
    } else if (nextView === "code") {
      setViewMode("code");
    } else if (nextView === "diagram") {
      setViewMode("diagram");
    }
  }, []);

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(code);
    setCopied(true);
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    copyTimerRef.current = setTimeout(() => setCopied(false), 2000);
  };

  const handleExportSvg = (e: React.MouseEvent) => {
    e.stopPropagation();
    const svgEl =
      containerRef.current?.querySelector(".x6-graph-svg") ||
      containerRef.current?.querySelector("svg.morsel-diagram-svg") ||
      Array.from(containerRef.current?.querySelectorAll("svg") || []).find((el) => (el.clientWidth || 0) > 48);
    if (svgEl) {
      const serializer = new XMLSerializer();
      const svgStr = serializer.serializeToString(svgEl);
      const blob = new Blob([svgStr], { type: "image/svg+xml;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${title.replace(/\s+/g, "_").toLowerCase()}_schematic.svg`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      setCopiedSvg(true);
      if (svgTimerRef.current) clearTimeout(svgTimerRef.current);
      svgTimerRef.current = setTimeout(() => setCopiedSvg(false), 2000);
    } else if (validInlineSvg) {
      const blob = new Blob([validInlineSvg], { type: "image/svg+xml;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${title.replace(/\s+/g, "_").toLowerCase()}_${previewMode}.svg`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      setCopiedSvg(true);
      if (svgTimerRef.current) clearTimeout(svgTimerRef.current);
      svgTimerRef.current = setTimeout(() => setCopiedSvg(false), 2000);
    } else {
      handleCopy(e);
    }
  };

  const getForkUrl = () => {
    if (!viewConfig?.artifactId && !artifactId) {
      return `/morsel#m=${encodeURIComponent(code)}`;
    }
    return buildEditorUrlForArtifact({
      artifactId: (viewConfig?.artifactId ?? artifactId) as string | number | undefined,
      viewType: "modelica-diagram",
      viewConfig,
      code,
      title,
      dialect,
    });
  };

  const handleFork = () => {
    window.open(getForkUrl(), "_blank", "noopener,noreferrer");
  };

  const codeLines = code.split(/\r?\n/);

  const schematicTabLabel = previewMode === "icon" ? "Icon" : "Schematic";

  const ctaLabel = hasBeenActive
    ? "▶ Resume Interactive Model"
    : previewMode === "3d"
      ? "▶ Interactive 3D Animation"
      : previewMode === "simulation"
        ? "▶ Interactive Simulation"
        : previewMode === "icon"
          ? "▶ Inspect Component"
          : previewMode === "code"
            ? "▶ Interactive Editor"
            : "▶ Interactive Schematic";

  const activeMorselView =
    viewMode === "simulation"
      ? "plot"
      : viewMode === "3d"
        ? "3d"
        : viewMode === "inspector"
          ? "inspector"
          : viewMode === "code"
            ? "code"
            : "diagram";

  const hasFooter = useHasFooterSlot();
  const navTabs: Array<{ id: CardTabMode; label: string; icon: React.ReactNode }> = [
    { id: "diagram", label: schematicTabLabel, icon: <WorkflowIcon size={12} /> },
    { id: "simulation", label: "Simulate", icon: <PulseIcon size={12} /> },
    { id: "3d", label: "3D", icon: <StackIcon size={12} /> },
    { id: "inspector", label: "Inspector", icon: <TableIcon size={12} /> },
    { id: "code", label: "Code", icon: <CodeIcon size={12} /> },
  ];

  const selectTab = (id: CardTabMode) => {
    setViewMode(id);
    if (id === "simulation" || id === "3d") {
      setInteractive(true);
      setSimTriggerCount((c) => Math.max(1, c));
    } else if (id === "inspector") {
      setInteractive(true);
    } else if (id === "diagram" && previewMode !== "diagram" && previewMode !== "icon") {
      setInteractive(true);
    }
  };

  return (
    <CardWrapper $isFullScreen={isFullScreen} $standalone={Boolean(viewConfig?.standalone)}>
      {!isFullScreen && hasFooter && (
        <>
          <FooterTabs>
            <CompactTabStrip
              ariaLabel={`${dialect.toUpperCase()} views`}
              active={viewMode}
              onChange={(id) => selectTab(id as CardTabMode)}
              tabs={navTabs.map((t) => ({
                id: t.id,
                label: t.id === "diagram" ? "Schematic" : t.label,
                icon: t.icon,
                title: t.label,
              }))}
            />
          </FooterTabs>
          {(!interactive || viewMode === "code") && (
            <FloatingTools>
              {(hasUnsavedChanges || saveSuccess) && targetArtifactId && (
                <FloatingToolBtn
                  type="button"
                  $success={saveSuccess}
                  disabled={isSaving}
                  title={saveSuccess ? "Saved!" : isSaving ? "Saving…" : "Save changes to artifact"}
                  aria-label="Save changes to artifact"
                  onClick={handleSave}
                >
                  {saveSuccess ? <CheckIcon size={14} /> : <SyncIcon size={14} />}
                </FloatingToolBtn>
              )}
              {viewMode === "diagram" && (
                <FloatingToolBtn type="button" title="Download SVG" aria-label="Download SVG" onClick={handleExportSvg}>
                  {copiedSvg ? <CheckIcon size={14} /> : <DownloadIcon size={14} />}
                </FloatingToolBtn>
              )}
              <FloatingToolBtn
                type="button"
                $success={copied}
                title={copied ? "Copied" : "Copy source code"}
                aria-label="Copy source code"
                onClick={handleCopy}
              >
                {copied ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
              </FloatingToolBtn>
            </FloatingTools>
          )}
          {interactive && viewMode !== "code" && (hasUnsavedChanges || saveSuccess) && targetArtifactId && (
            <FloatingTools style={{ top: "auto", bottom: "12px", right: "12px", zIndex: 95, opacity: 1 }}>
              <FloatingToolBtn
                type="button"
                $success={saveSuccess}
                disabled={isSaving}
                title={saveSuccess ? "Saved!" : isSaving ? "Saving…" : "Save changes to artifact"}
                aria-label="Save changes to artifact"
                onClick={handleSave}
                style={{
                  background: saveSuccess ? "rgba(16, 185, 129, 0.9)" : "var(--ms-brand, #0e7490)",
                  color: "#ffffff",
                  borderColor: "rgba(255, 255, 255, 0.2)",
                  boxShadow: "0 4px 12px rgba(0, 0, 0, 0.35)",
                }}
              >
                {saveSuccess ? <CheckIcon size={14} /> : <SyncIcon size={14} />}
                <span style={{ fontSize: "11px", fontWeight: 600, paddingRight: 2 }}>
                  {saveSuccess ? "Saved" : isSaving ? "Saving…" : "Save Artifact"}
                </span>
              </FloatingToolBtn>
            </FloatingTools>
          )}
        </>
      )}
      {!isFullScreen && !hasFooter && (
        <CardToolbar>
          <ToolbarLeft>
            <Badge>⚡ {dialect.toUpperCase()}</Badge>
            <Text
              style={{
                fontSize: "13px",
                lineHeight: "16px",
                fontWeight: 600,
                color: "var(--color-fg-default)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
              title={title}
            >
              {title}
            </Text>
          </ToolbarLeft>

          <ToolbarRight>
            <Box
              display="flex"
              bg="var(--color-canvas-default)"
              borderRadius="6px"
              p="2px"
              border="1px solid var(--color-border-default)"
              style={{ gap: "2px" }}
            >
              {navTabs.map((tab) => {
                const isActive = viewMode === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => {
                      setViewMode(tab.id);
                      if (tab.id === "simulation" || tab.id === "3d") {
                        setInteractive(true);
                        setSimTriggerCount((c) => Math.max(1, c));
                      } else if (tab.id === "inspector") {
                        setInteractive(true);
                      } else if (tab.id === "diagram" && previewMode !== "diagram" && previewMode !== "icon") {
                        setInteractive(true);
                      }
                    }}
                    style={{
                      background: isActive ? "var(--ms-brand, #0e7490)" : "transparent",
                      color: isActive ? "#ffffff" : "var(--color-fg-default)",
                      opacity: isActive ? 1 : 0.82,
                      border: "none",
                      borderRadius: "4px",
                      padding: "2px 8px",
                      fontSize: "11px",
                      lineHeight: "16px",
                      fontWeight: 600,
                      cursor: "pointer",
                      whiteSpace: "nowrap",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "4px",
                      boxShadow: isActive ? "0 1px 2px rgba(0, 0, 0, 0.12)" : "none",
                      transition: "all 0.15s ease",
                    }}
                  >
                    {tab.icon}
                    <span>{tab.label}</span>
                  </button>
                );
              })}
            </Box>
            {viewMode === "diagram" && (
              <IconActionButton type="button" onClick={handleExportSvg} title="Download SVG">
                {copiedSvg ? <CheckIcon size={12} /> : <DownloadIcon size={12} />}
                <span>{copiedSvg ? "Saved" : "SVG"}</span>
              </IconActionButton>
            )}
            <IconActionButton type="button" onClick={handleCopy} title="Copy source code">
              {copied ? <CheckIcon size={12} /> : <CopyIcon size={12} />}
              <span>{copied ? "Copied" : "Copy"}</span>
            </IconActionButton>
            {(hasUnsavedChanges || saveSuccess) && targetArtifactId && (
              <button
                type="button"
                onClick={handleSave}
                disabled={isSaving}
                style={{
                  background: saveSuccess ? "rgba(16, 185, 129, 0.2)" : "var(--ms-brand, #0e7490)",
                  color: saveSuccess ? "#10b981" : "#ffffff",
                  border: "1px solid " + (saveSuccess ? "rgba(16, 185, 129, 0.4)" : "var(--ms-brand, #0e7490)"),
                  borderRadius: "4px",
                  padding: "2px 8px",
                  fontSize: "11px",
                  lineHeight: "16px",
                  fontWeight: 700,
                  cursor: isSaving ? "not-allowed" : "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "4px",
                  boxShadow: "0 1px 2px rgba(0, 0, 0, 0.12)",
                  transition: "all 0.15s ease",
                }}
                title="Save changes directly to this model artifact"
              >
                {saveSuccess ? <CheckIcon size={12} /> : isSaving ? <SyncIcon size={12} /> : null}
                <span>{saveSuccess ? "Saved!" : isSaving ? "Saving…" : "Save Artifact"}</span>
              </button>
            )}
            {Boolean(viewConfig?.standalone) && (
              <Button size="small" variant="primary" leadingVisual={DraftingTriangleIcon} onClick={handleFork}>
                Morsel
              </Button>
            )}
          </ToolbarRight>
        </CardToolbar>
      )}

      <EditorContainer ref={containerRef} $isFullScreen={isFullScreen}>
        {viewMode === "code" && !isFullScreen && (
          <Box
            py={2}
            height="100%"
            overflow="auto"
            bg="var(--color-canvas-default)"
            style={{
              fontFamily: '"JetBrains Mono", "Fira Code", var(--font-mono, monospace)',
              fontSize: "12px",
              lineHeight: 1.55,
            }}
          >
            {codeLines.map((line, idx) => (
              <div key={idx} style={{ display: "flex", padding: "0 14px" }}>
                <span
                  style={{
                    userSelect: "none",
                    width: "36px",
                    minWidth: "36px",
                    textAlign: "right",
                    paddingRight: "12px",
                    color: "var(--color-fg-subtle)",
                    fontSize: "11px",
                  }}
                >
                  {idx + 1}
                </span>
                <span style={{ whiteSpace: "pre", color: "var(--color-fg-default)" }}>
                  {highlightPolyglotLine(line, dialect)}
                </span>
              </div>
            ))}
          </Box>
        )}

        {interactive && (
          <div
            style={{
              width: "100%",
              height: "100%",
              display: viewMode === "code" && !isFullScreen ? "none" : "block",
            }}
          >
            {isFetchingCode && !inlineCode && !fetchedCode && !editedCode ? (
              <Box display="flex" alignItems="center" justifyContent="center" height="100%">
                <Text style={{ color: "var(--color-fg-muted)" }}>Loading model source…</Text>
              </Box>
            ) : (
              <Suspense
                fallback={
                  <Box display="flex" alignItems="center" justifyContent="center" height="100%">
                    <Text style={{ color: "var(--color-fg-muted)" }}>Loading interactive modeling environment…</Text>
                  </Box>
                }
              >
                <MorselEditorLazy
                  dataUrl={null}
                  initialCode={code}
                  initialDialect={dialect}
                  initialView={activeMorselView}
                  initialClassName={typeof viewConfig.primaryClass === "string" ? viewConfig.primaryClass : undefined}
                  initialSimulationVariables={initialSimVars}
                  initialStartTime={initialStartTime}
                  initialStopTime={initialStopTime}
                  hideCenterFloatingToolbar={!isFullScreen}
                  defaultRibbonExpanded={Boolean(isFullScreen && (viewMode === "simulation" || viewMode === "3d"))}
                  simulateTriggerCount={simTriggerCount > 0 ? simTriggerCount : undefined}
                  onActiveViewChange={handleActiveViewChange}
                  onCodeChange={setEditedCode}
                  embed={true}
                />
              </Suspense>
            )}
          </div>
        )}

        {!interactive && viewMode !== "code" && (
          <Box
            display="flex"
            alignItems="center"
            justifyContent="center"
            height="100%"
            style={{
              cursor: "pointer",
              position: "relative",
              background: "var(--color-canvas-default, #0d1117)",
            }}
            onClick={() => {
              setInteractive(true);
              if (previewMode === "simulation" || previewMode === "3d") {
                setSimTriggerCount((c) => Math.max(1, c));
              }
            }}
          >
            {validInlineSvg ? (
              <div
                style={{
                  width: "100%",
                  height: "100%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
                dangerouslySetInnerHTML={{ __html: validInlineSvg }}
              />
            ) : (
              <img
                src={rawThumbUrl}
                alt={title}
                onError={() => setThumbError(true)}
                style={{ width: "100%", height: "100%", objectFit: "contain" }}
              />
            )}
            <div
              style={{
                position: "absolute",
                bottom: "12px",
                right: "12px",
                background: "var(--ms-brand, #0e7490)",
                padding: "6px 14px",
                borderRadius: "9999px",
                border: "1px solid rgba(255, 255, 255, 0.25)",
                boxShadow: "0 4px 14px rgba(0, 0, 0, 0.45)",
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
              }}
            >
              <Text style={{ fontSize: "12px", lineHeight: "16px", color: "#ffffff", fontWeight: 600 }}>
                {ctaLabel}
              </Text>
            </div>
          </Box>
        )}
      </EditorContainer>
    </CardWrapper>
  );
};

export default ModelicaDiagramViewer;
