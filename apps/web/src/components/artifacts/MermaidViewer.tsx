// SPDX-License-Identifier: AGPL-3.0-or-later

/* eslint-disable @typescript-eslint/no-explicit-any */
import { CheckIcon, CopyIcon, DownloadIcon, GraphIcon, SyncIcon } from "@primer/octicons-react";
import { Button, IconButton, Text, useTheme } from "@primer/react";
import mermaid from "mermaid";
import React, { useEffect, useRef, useState } from "react";
import styled from "styled-components";
import Box from "../Box";

interface MermaidViewerProps {
  viewConfig: any; // expects { code?: string, codeUrl?: string, title?: string }
  isFullScreen?: boolean;
}

const Wrapper = styled.div<{ $isFullScreen?: boolean }>`
  width: 100%;
  height: ${(props) => (props.$isFullScreen ? "100%" : "440px")};
  background: var(--color-canvas-default, #0d1117);
  border: ${(props) => (props.$isFullScreen ? "none" : "1px solid var(--color-border-default, #30363d)")};
  border-radius: ${(props) => (props.$isFullScreen ? "0" : "8px")};
  display: flex;
  flex-direction: column;
  overflow: hidden;
  position: relative;
`;

const Toolbar = styled.div`
  height: 42px;
  min-height: 42px;
  background: var(--surface-hud, rgba(14, 20, 36, 0.7));
  border-bottom: 1px solid var(--color-border-default, #30363d);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px;
  gap: 8px;
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  z-index: 10;
`;

const Badge = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 10.5px;
  font-family: var(--font-mono, monospace);
  padding: 2px 7px;
  border-radius: 4px;
  background: rgba(6, 182, 212, 0.12);
  color: var(--color-accent-cyan, #06b6d4);
  border: 1px solid rgba(6, 182, 212, 0.25);
  font-weight: 600;
`;

const ZoomBadge = styled.span`
  font-size: 11px;
  font-family: var(--font-mono, monospace);
  color: var(--color-fg-muted, #8b949e);
  background: rgba(255, 255, 255, 0.05);
  padding: 2px 6px;
  border-radius: 4px;
`;

const CanvasViewport = styled.div<{ $isDragging: boolean }>`
  flex: 1;
  width: 100%;
  height: 100%;
  overflow: hidden;
  position: relative;
  background: var(--color-canvas-default, #0d1117);
  cursor: ${(props) => (props.$isDragging ? "grabbing" : "grab")};
  user-select: none;
`;

const SvgTransformLayer = styled.div<{ $zoom: number; $panX: number; $panY: number }>`
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  transform: translate(${(props) => props.$panX}px, ${(props) => props.$panY}px) scale(${(props) => props.$zoom});
  transform-origin: center center;
  transition: ${(props) =>
    props.$zoom === 1 && props.$panX === 0 && props.$panY === 0 ? "transform 0.2s ease" : "none"};

  svg {
    max-width: 95%;
    max-height: 95%;
    height: auto;
    filter: drop-shadow(0 4px 12px rgba(0, 0, 0, 0.35));
  }
`;

const MermaidViewer: React.FC<MermaidViewerProps> = ({ viewConfig, isFullScreen }) => {
  const { resolvedColorMode } = useTheme();
  const containerRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);

  const [code, setCode] = useState<string | null>(null);
  const [svgString, setSvgString] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showCode, setShowCode] = useState(false);

  // Pan & Zoom State
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef({ x: 0, y: 0 });
  const panStartRef = useRef({ x: 0, y: 0 });

  const [copiedSvg, setCopiedSvg] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);

  const title = viewConfig?.title || "Architecture Diagram";

  useEffect(() => {
    async function fetchCode() {
      if (viewConfig?.codeUrl) {
        try {
          const res = await fetch(viewConfig.codeUrl);
          if (!res.ok) throw new Error(`HTTP ${res.status}: Failed to fetch Mermaid code`);
          const text = await res.text();
          setCode(text);
        } catch (err: any) {
          setError(err.message || "Failed to fetch Mermaid code");
        }
      } else if (viewConfig?.code) {
        setCode(viewConfig.code);
      }
    }
    fetchCode();
  }, [viewConfig]);

  useEffect(() => {
    if (!code) return;

    const isDark = resolvedColorMode === "dark";

    mermaid.initialize({
      startOnLoad: false,
      theme: isDark ? "dark" : "default",
      themeVariables: isDark
        ? {
            darkMode: true,
            background: "transparent",
            primaryColor: "#1e293b",
            primaryBorderColor: "#38bdf8",
            primaryTextColor: "#f1f5f9",
            lineColor: "#64748b",
            secondaryColor: "#0f172a",
            tertiaryColor: "#1e293b",
            mainBkg: "#161b22",
            nodeBorder: "#38bdf8",
            clusterBkg: "#0d1117",
            clusterBorder: "#30363d",
            titleColor: "#f1f5f9",
            edgeLabelBackground: "#161b22",
          }
        : {
            background: "transparent",
          },
      securityLevel: "loose",
    });

    const renderMermaid = async () => {
      try {
        setError(null);
        const id = `mermaid-${Math.random().toString(36).substring(2, 9)}`;
        const { svg } = await mermaid.render(id, code);
        setSvgString(svg);
        if (containerRef.current) {
          containerRef.current.innerHTML = svg;
        }
      } catch (err: any) {
        console.error("Mermaid rendering failed:", err);
        setError(err.message || "Failed to render Mermaid diagram");
      }
    };

    renderMermaid();
  }, [code, resolvedColorMode]);

  // Pan / Drag Handlers
  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return; // Left mouse button only
    setIsDragging(true);
    dragStartRef.current = { x: e.clientX, y: e.clientY };
    panStartRef.current = { ...pan };
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;
    const dx = e.clientX - dragStartRef.current.x;
    const dy = e.clientY - dragStartRef.current.y;
    setPan({
      x: panStartRef.current.x + dx,
      y: panStartRef.current.y + dy,
    });
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.15 : 0.85;
    setZoom((prev) => Math.min(Math.max(0.3, prev * factor), 4.0));
  };

  const handleResetZoom = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  const handleCopySvg = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!svgString) return;
    navigator.clipboard.writeText(svgString);
    setCopiedSvg(true);
    setTimeout(() => setCopiedSvg(false), 2000);
  };

  const handleCopyCode = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!code) return;
    navigator.clipboard.writeText(code);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  const handleDownloadSvg = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!svgString) return;
    const blob = new Blob([svgString], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `${title.replace(/\s+/g, "_").toLowerCase()}.svg`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  if (!viewConfig || (!viewConfig.code && !viewConfig.codeUrl)) {
    return (
      <Box p={3} backgroundColor="var(--color-canvas-subtle)" borderRadius="6px">
        <Text color="var(--color-danger-fg)">Invalid Mermaid configuration: no code or codeUrl provided.</Text>
      </Box>
    );
  }

  return (
    <Wrapper $isFullScreen={isFullScreen}>
      <Toolbar>
        <Box display="flex" alignItems="center" gap={2} overflow="hidden">
          <Badge>
            <GraphIcon size={13} />
            MERMAID
          </Badge>
          <Text
            fontWeight="bold"
            fontSize="12.5px"
            color="var(--color-fg-default)"
            style={{ textOverflow: "ellipsis", overflow: "hidden", whiteSpace: "nowrap" }}
          >
            {title}
          </Text>
          <ZoomBadge>{Math.round(zoom * 100)}%</ZoomBadge>
        </Box>

        <Box display="flex" alignItems="center" gap={1}>
          <Button
            size="small"
            onClick={() => setZoom((z) => Math.max(0.3, z * 0.85))}
            title="Zoom Out"
            style={{ padding: "3px 8px" }}
          >
            −
          </Button>
          <Button
            size="small"
            onClick={() => setZoom((z) => Math.min(4.0, z * 1.15))}
            title="Zoom In"
            style={{ padding: "3px 8px" }}
          >
            +
          </Button>
          {(zoom !== 1 || pan.x !== 0 || pan.y !== 0) && (
            <IconButton
              size="small"
              icon={SyncIcon}
              aria-label="Reset View"
              title="Reset Zoom & Pan"
              onClick={handleResetZoom}
            />
          )}
          <Button
            size="small"
            leadingVisual={copiedSvg ? CheckIcon : CopyIcon}
            onClick={handleCopySvg}
            title="Copy SVG XML to clipboard"
          >
            {copiedSvg ? "Copied" : "SVG"}
          </Button>
          <Button
            size="small"
            leadingVisual={copiedCode ? CheckIcon : CopyIcon}
            onClick={handleCopyCode}
            title="Copy Mermaid source syntax"
          >
            {copiedCode ? "Copied" : "Code"}
          </Button>
          <IconButton
            size="small"
            icon={DownloadIcon}
            aria-label="Download SVG"
            title="Download SVG file"
            onClick={handleDownloadSvg}
          />
        </Box>
      </Toolbar>

      {error ? (
        <Box p={4} display="flex" flexDirection="column" gap={3} bg="var(--color-canvas-subtle)" flex={1}>
          <Box p={3} bg="rgba(239, 68, 68, 0.1)" border="1px solid rgba(239, 68, 68, 0.3)" borderRadius="6px">
            <Text color="var(--color-danger-fg)" fontWeight="bold" fontSize="13px">
              Mermaid Parsing Error:
            </Text>
            <Text color="var(--color-fg-muted)" fontSize="12px" display="block" mt={1}>
              {error}
            </Text>
          </Box>
          <Box>
            <Button size="small" onClick={() => setShowCode(!showCode)}>
              {showCode ? "Hide Source Code" : "Show Mermaid Source"}
            </Button>
            {showCode && code && (
              <Box mt={2} p={3} bg="var(--color-canvas-default)" borderRadius="6px" overflow="auto" maxHeight="200px">
                <pre
                  style={{
                    margin: 0,
                    fontFamily: "var(--font-mono)",
                    fontSize: "11.5px",
                    color: "var(--color-fg-default)",
                  }}
                >
                  {code}
                </pre>
              </Box>
            )}
          </Box>
        </Box>
      ) : (
        <CanvasViewport
          ref={viewportRef}
          $isDragging={isDragging}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onWheel={handleWheel}
        >
          <SvgTransformLayer $zoom={zoom} $panX={pan.x} $panY={pan.y}>
            <div
              ref={containerRef}
              style={{ width: "100%", height: "100%", display: "flex", justifyContent: "center", alignItems: "center" }}
            />
          </SvgTransformLayer>
        </CanvasViewport>
      )}
    </Wrapper>
  );
};

export default MermaidViewer;
