// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  CheckIcon,
  CodeIcon,
  CopyIcon,
  DownloadIcon,
  PulseIcon,
  StackIcon,
  TableIcon,
  WorkflowIcon,
  ZapIcon,
} from "@primer/octicons-react";
import { Button, Text } from "@primer/react";
import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import styled from "styled-components";
import { useTheme } from "../../theme";
import Box from "../Box";
import { compressMorselPayload } from "../morsel/util/permalink";
import { highlightPolyglotLine, sanitizeSvgMarkup } from "./PolyglotArtifactViewer";

const MorselEditorLazy = React.lazy(() => import("../morsel/Morsel"));

export type ModelicaPreviewMode = "diagram" | "icon" | "simulation" | "3d" | "code";
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
  isFullScreen?: boolean | undefined;
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
  background: var(--ms-brand-soft, var(--color-canvas-subtle, #161b22));
  border-bottom: 1px solid var(--color-accent-blue-border, var(--color-border-default, #30363d));
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

export function hasModelica3dVisualizers(code: string): boolean {
  if (!code || typeof code !== "string") return false;
  return (
    /\b(?:Modelica\.Mechanics\.MultiBody\.)?Visualizers\./.test(code) ||
    /\bModelica\.Mechanics\.MultiBody\.(?:Parts|Joints|Forces|World)\b/.test(code) ||
    /\bannotation\s*\([\s\S]*?\b(?:CAD|cad|CADPort)\s*\(/.test(code)
  );
}

export function inferModelicaPreviewMode(
  code: string,
  explicitMode?: string | undefined,
  svg?: string | undefined,
  thumbUrl?: string | undefined,
): ModelicaPreviewMode {
  if (
    explicitMode === "diagram" ||
    explicitMode === "icon" ||
    explicitMode === "simulation" ||
    explicitMode === "3d" ||
    explicitMode === "code"
  ) {
    return explicitMode;
  }
  if (explicitMode === "cad" || explicitMode === "animation" || explicitMode === "3d-animation") {
    return "3d";
  }
  if (svg) {
    const modeMatch = svg.match(/data-preview-mode=["'](diagram|icon|simulation|3d|code)["']/i);
    if (modeMatch && modeMatch[1]) {
      return modeMatch[1].toLowerCase() as ModelicaPreviewMode;
    }
  }
  if (thumbUrl) {
    const thumbMatch = thumbUrl.match(/[._-](diagram|icon|simulation|3d|code)(?:\.thumb)?\.svg/i);
    if (thumbMatch && thumbMatch[1]) {
      return thumbMatch[1].toLowerCase() as ModelicaPreviewMode;
    }
  }
  const has3d = hasModelica3dVisualizers(code);
  const hasDiagram =
    /\bPlacement\s*\(/i.test(code) || /\bDiagram\s*\(\s*(?:coordinateSystem[\s\S]*?)?graphics\s*=/i.test(code);
  if (has3d && !hasDiagram) return "3d";
  if (hasDiagram) return "diagram";

  const hasIcon =
    /\bIcon\s*\(\s*(?:coordinateSystem[\s\S]*?)?graphics\s*=/i.test(code) ||
    /\bextends\s+[A-Za-z0-9_.]*(?:Icon|OnePort|TwoPin|TwoPort|SISO|SO|MI|MO|Interfaces\.)/i.test(code);
  if (hasIcon) return "icon";

  if (has3d) return "3d";

  const isPartial =
    /\bpartial\s+(?:encapsulated\s+|expandable\s+)*(?:model|class|block|connector|record|function|package|type|operator)\b/.test(
      code,
    );
  const codeWithoutWithin = code.replace(/^\s*within\b[^;]*;/gm, "");
  const isNonSimKind = /^\s*(?:encapsulated\s+)?(?:package|connector|record|function|type|operator)\b/m.test(
    codeWithoutWithin,
  );
  const hasEquations =
    /\b(?:equation|algorithm)\b/.test(code) &&
    (/\bder\s*\(/.test(code) || /(?:^|\n)\s*[A-Za-z0-9_.(),\s+-/*]+\s*:?=\s*[^;=]+;/m.test(code));

  if (!isPartial && !isNonSimKind && hasEquations) {
    return "simulation";
  }
  if (/\bconnect\s*\(/i.test(code)) {
    return "diagram";
  }
  return "code";
}

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

export const ModelicaDiagramViewer: React.FC<ModelicaDiagramViewerProps> = ({ viewConfig, isFullScreen = false }) => {
  const inlineCode = (viewConfig.code as string) || (viewConfig.content as string) || "";
  const [fetchedCode, setFetchedCode] = useState<string | null>(null);

  useEffect(() => {
    if (!inlineCode && typeof viewConfig.url === "string") {
      fetch(viewConfig.url)
        .then((r) => (r.ok ? r.text() : ""))
        .then((txt) => {
          if (txt) setFetchedCode(txt);
        })
        .catch(() => {});
    }
  }, [inlineCode, viewConfig.url]);

  const baseCode = inlineCode || fetchedCode || "model Example\n\nend Example;";
  const [editedCode, setEditedCode] = useState<string | null>(null);
  const code = editedCode ?? baseCode;
  const dialect = (viewConfig.dialect as string) || "modelica";
  const title = (viewConfig.title as string) || "Interactive System";

  const rawSvg = typeof viewConfig.svg === "string" ? viewConfig.svg : "";
  const rawThumbUrl =
    (typeof viewConfig.thumbnail_url === "string" && viewConfig.thumbnail_url) ||
    (typeof viewConfig.thumbnailUrl === "string" && viewConfig.thumbnailUrl) ||
    "";

  const explicitMode =
    (viewConfig.previewMode as string | undefined) ||
    (typeof viewConfig.metadata === "object" && viewConfig.metadata !== null
      ? (viewConfig.metadata["previewMode"] as string | undefined)
      : undefined) ||
    (viewConfig.simulationPreview ? "simulation" : undefined) ||
    (typeof viewConfig.nodeCount === "number" && viewConfig.nodeCount > 0 ? "diagram" : undefined);

  const previewMode = useMemo(
    () => inferModelicaPreviewMode(code, explicitMode, rawSvg, rawThumbUrl),
    [code, explicitMode, rawSvg, rawThumbUrl],
  );

  const { theme } = useTheme();
  const isDark = theme === "dark";

  const validInlineSvg = useMemo(() => {
    if (rawSvg && !isLegacyBogusModelicaSvg(rawSvg, previewMode)) {
      return sanitizeSvgMarkup(rawSvg, { isFullScreen, isDark });
    }
    if (!rawThumbUrl) {
      return sanitizeSvgMarkup(buildClientCodeFallbackSvg(code, title), { isFullScreen, isDark });
    }
    return "";
  }, [rawSvg, rawThumbUrl, previewMode, code, title, isFullScreen, isDark]);

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
  const [copied, setCopied] = useState(false);
  const [copiedSvg, setCopiedSvg] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isFullScreen) {
      setInteractive(true);
    }
  }, [isFullScreen]);

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
    setTimeout(() => setCopied(false), 2000);
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
      setTimeout(() => setCopiedSvg(false), 2000);
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
      setTimeout(() => setCopiedSvg(false), 2000);
    } else {
      handleCopy(e);
    }
  };

  const getForkUrl = () => {
    const hash = compressMorselPayload({
      v: 1,
      lang: dialect as any,
      code,
      title,
    });
    const fromArtifact = viewConfig?.artifactId ? `?fromArtifact=${viewConfig.artifactId}` : "";
    return `/playground${fromArtifact}#m=${hash}`;
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

  const navTabs: Array<{ id: CardTabMode; label: string; icon: React.ReactNode }> = [
    { id: "diagram", label: schematicTabLabel, icon: <WorkflowIcon size={12} /> },
    { id: "simulation", label: "Simulate", icon: <PulseIcon size={12} /> },
    { id: "3d", label: "3D", icon: <StackIcon size={12} /> },
    { id: "inspector", label: "Inspector", icon: <TableIcon size={12} /> },
    { id: "code", label: "Code", icon: <CodeIcon size={12} /> },
  ];

  return (
    <CardWrapper $isFullScreen={isFullScreen} $standalone={Boolean(viewConfig?.standalone)}>
      {!isFullScreen && (
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
            {Boolean(viewConfig?.standalone) && (
              <Button size="small" variant="primary" leadingVisual={ZapIcon} onClick={handleFork}>
                Playground
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
            <Suspense
              fallback={
                <Box display="flex" alignItems="center" justifyContent="center" height="100%">
                  <Text style={{ color: "var(--color-fg-muted)" }}>Loading interactive modeling environment…</Text>
                </Box>
              }
            >
              <MorselEditorLazy
                dataUrl={null}
                initialCode={baseCode}
                initialDialect={dialect}
                initialView={activeMorselView}
                hideCenterFloatingToolbar={!isFullScreen}
                defaultRibbonExpanded={Boolean(isFullScreen && (viewMode === "simulation" || viewMode === "3d"))}
                simulateTriggerCount={simTriggerCount > 0 ? simTriggerCount : undefined}
                onActiveViewChange={handleActiveViewChange}
                onCodeChange={setEditedCode}
                embed={true}
              />
            </Suspense>
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
              <img src={rawThumbUrl} alt={title} style={{ width: "100%", height: "100%", objectFit: "contain" }} />
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
