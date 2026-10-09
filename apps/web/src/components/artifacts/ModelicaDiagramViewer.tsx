// SPDX-License-Identifier: AGPL-3.0-or-later

import { CheckIcon, CopyIcon, DownloadIcon, PlayIcon, ZapIcon } from "@primer/octicons-react";
import { Button, Text } from "@primer/react";
import React, { Suspense, useRef, useState } from "react";
import styled from "styled-components";
import Box from "../Box";
import { compressMorselPayload } from "../morsel/util/permalink";

const MorselEditorLazy = React.lazy(() => import("../morsel/Morsel"));

interface ModelicaDiagramViewerProps {
  viewConfig: Record<string, unknown>;
  isFullScreen?: boolean;
}

const CardWrapper = styled.div<{ $isFullScreen: boolean }>`
  position: relative;
  width: 100%;
  height: ${(props) => (props.$isFullScreen ? "100%" : "380px")};
  background: var(--color-canvas-default, #0d1117);
  border-radius: ${(props) => (props.$isFullScreen ? "0" : "8px")};
  border: ${(props) => (props.$isFullScreen ? "none" : "1px solid var(--color-border-default, #30363d)")};
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
  z-index: 10;
`;

const ToolbarLeft = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`;

const ToolbarRight = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`;

const Badge = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 10px;
  font-family: var(--font-mono, monospace);
  padding: 1px 6px;
  border-radius: 4px;
  background: rgba(6, 182, 212, 0.12);
  color: var(--color-accent-cyan, #06b6d4);
  border: 1px solid rgba(6, 182, 212, 0.25);
  font-weight: 600;
`;

const EditorContainer = styled.div`
  flex: 1;
  width: 100%;
  height: calc(100% - 36px);
  position: relative;
  overflow: hidden;
`;

export const ModelicaDiagramViewer: React.FC<ModelicaDiagramViewerProps> = ({ viewConfig, isFullScreen = false }) => {
  const code = (viewConfig.code as string) || "model Example\n\nend Example;";
  const dialect = (viewConfig.dialect as string) || "modelica";
  const title = (viewConfig.title as string) || "Interactive System";
  const [interactive, setInteractive] = useState(!viewConfig.thumbnail_url);
  const [viewMode, setViewMode] = useState<"diagram" | "code">("diagram");
  const [copied, setCopied] = useState(false);
  const [copiedSvg, setCopiedSvg] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleExportSvg = (e: React.MouseEvent) => {
    e.stopPropagation();
    const svgEl = containerRef.current?.querySelector("svg");
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
    } else {
      handleCopy(e);
    }
  };

  const getForkUrl = () => {
    const hash = compressMorselPayload({
      v: 1,
      lang: dialect,
      code,
      title,
    });
    const fromArtifact = viewConfig?.artifactId ? `?fromArtifact=${viewConfig.artifactId}` : "";
    return `/playground${fromArtifact}#m=${hash}`;
  };

  const handleFork = () => {
    window.open(getForkUrl(), "_blank", "noopener,noreferrer");
  };

  return (
    <CardWrapper $isFullScreen={isFullScreen}>
      <CardToolbar>
        <ToolbarLeft>
          <Badge>⚡ {dialect.toUpperCase()}</Badge>
          <Text style={{ fontSize: "12px", fontWeight: "bold", color: "var(--color-fg-default)" }}>{title}</Text>
        </ToolbarLeft>

        <ToolbarRight>
          <Box
            display="flex"
            bg="rgba(0,0,0,0.25)"
            borderRadius="6px"
            p="2px"
            border="1px solid var(--color-border-default)"
          >
            <button
              type="button"
              onClick={() => setViewMode("diagram")}
              style={{
                background: viewMode === "diagram" ? "rgba(6, 182, 212, 0.2)" : "transparent",
                color: viewMode === "diagram" ? "#06b6d4" : "var(--color-fg-muted)",
                border: "none",
                borderRadius: "4px",
                padding: "2px 8px",
                fontSize: "11px",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Schematic
            </button>
            <button
              type="button"
              onClick={() => setViewMode("code")}
              style={{
                background: viewMode === "code" ? "rgba(6, 182, 212, 0.2)" : "transparent",
                color: viewMode === "code" ? "#06b6d4" : "var(--color-fg-muted)",
                border: "none",
                borderRadius: "4px",
                padding: "2px 8px",
                fontSize: "11px",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Code
            </button>
          </Box>
          {viewMode === "diagram" && (
            <Button
              size="small"
              variant="default"
              leadingVisual={copiedSvg ? CheckIcon : DownloadIcon}
              onClick={handleExportSvg}
              title="Download or copy schematic SVG"
            >
              {copiedSvg ? "Exported" : "SVG"}
            </Button>
          )}
          <Button size="small" variant="default" leadingVisual={copied ? CheckIcon : CopyIcon} onClick={handleCopy}>
            {copied ? "Copied" : "Copy"}
          </Button>
          {!interactive && viewConfig.thumbnail_url && (
            <Button size="small" variant="default" leadingVisual={PlayIcon} onClick={() => setInteractive(true)}>
              Interact
            </Button>
          )}
          <Button size="small" variant="primary" leadingVisual={ZapIcon} onClick={handleFork}>
            Playground
          </Button>
        </ToolbarRight>
      </CardToolbar>

      <EditorContainer ref={containerRef}>
        {viewMode === "code" ? (
          <Box p={3} height="100%" overflow="auto" bg="var(--color-canvas-default)">
            <pre
              style={{
                margin: 0,
                fontFamily: "var(--font-mono, monospace)",
                fontSize: "12px",
                lineHeight: "1.6",
                color: "var(--color-fg-default)",
                whiteSpace: "pre-wrap",
              }}
            >
              <code>{code}</code>
            </pre>
          </Box>
        ) : interactive || !viewConfig.thumbnail_url ? (
          <Suspense
            fallback={
              <Box display="flex" alignItems="center" justifyContent="center" height="100%">
                <Text style={{ color: "var(--color-fg-muted)" }}>Loading interactive diagram canvas…</Text>
              </Box>
            }
          >
            <MorselEditorLazy dataUrl={null} initialCode={code} embed={true} />
          </Suspense>
        ) : (
          <Box
            display="flex"
            alignItems="center"
            justifyContent="center"
            height="100%"
            style={{ cursor: "pointer", position: "relative" }}
            onClick={() => setInteractive(true)}
          >
            <img
              src={viewConfig.thumbnail_url}
              alt={title}
              style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }}
            />
            <div
              style={{
                position: "absolute",
                bottom: "16px",
                background: "rgba(13, 17, 23, 0.8)",
                padding: "6px 14px",
                borderRadius: "20px",
                border: "1px solid var(--color-border-default)",
                backdropFilter: "blur(6px)",
              }}
            >
              <Text style={{ fontSize: "12px", color: "var(--color-fg-default)" }}>
                ▶ Click to launch interactive diagram & simulation
              </Text>
            </div>
          </Box>
        )}
      </EditorContainer>
    </CardWrapper>
  );
};

export default ModelicaDiagramViewer;
