// SPDX-License-Identifier: AGPL-3.0-or-later

import Editor from "@monaco-editor/react";
import { CheckIcon, CodeIcon, CopyIcon, PlayIcon, WorkflowIcon } from "@primer/octicons-react";
import { Button, Text, useTheme } from "@primer/react";
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import styled from "styled-components";
import Box from "../Box";
import { compressMorselPayload } from "../morsel/util/permalink";
import { sanitizeSvgMarkup } from "./PolyglotArtifactViewer";

interface ModelicaCodeViewerProps {
  viewConfig: any;
  isFullScreen?: boolean | undefined;
}

const Wrapper = styled.div<{ $isFullScreen?: boolean | undefined }>`
  width: 100%;
  height: ${(props) => (props.$isFullScreen ? "100%" : "360px")};
  background: var(--color-canvas-default);
  border: 1px solid var(--color-border-default);
  border-radius: ${(props) => (props.$isFullScreen ? "0" : "8px")};
  display: flex;
  flex-direction: column;
  overflow: hidden;
`;

const Toolbar = styled.div`
  height: 40px;
  min-height: 40px;
  background: var(--color-canvas-subtle);
  border-bottom: 1px solid var(--color-border-default);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px;
`;

const ModelicaCodeViewer: React.FC<ModelicaCodeViewerProps> = ({ viewConfig, isFullScreen }) => {
  const navigate = useNavigate();
  const { resolvedColorMode } = useTheme();
  const [copied, setCopied] = useState(false);
  const [viewMode, setViewMode] = useState<"code" | "diagram">("code");
  const [fetchedCode, setFetchedCode] = useState<string | null>(null);

  const inlineCode = viewConfig?.code || viewConfig?.content || "";
  useEffect(() => {
    if (!inlineCode && viewConfig?.url) {
      fetch(viewConfig.url)
        .then((r) => (r.ok ? r.text() : ""))
        .then((txt) => {
          if (txt) setFetchedCode(txt);
        })
        .catch(() => {});
    }
  }, [inlineCode, viewConfig?.url]);

  const code =
    inlineCode ||
    fetchedCode ||
    `model ${viewConfig?.model || "Model"}\n  // Modelica source\nend ${viewConfig?.model || "Model"};`;

  const title = viewConfig?.title || (viewConfig?.model ? `${viewConfig.model}.mo` : "Modelica Source");
  const dialect = viewConfig?.dialect || "modelica";
  const pregenSvg = typeof viewConfig?.svg === "string" ? viewConfig.svg : "";

  const svgMarkup = useMemo(() => {
    if (pregenSvg) {
      return sanitizeSvgMarkup(pregenSvg);
    }
    return "";
  }, [pregenSvg]);

  const effectiveViewMode: "code" | "diagram" = viewMode === "diagram" && svgMarkup ? "diagram" : "code";

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Wrapper $isFullScreen={isFullScreen}>
      <Toolbar>
        <Box display="flex" alignItems="center" gap={2}>
          <CodeIcon size={16} fill="var(--color-accent-fg)" />
          <Text style={{ fontWeight: "bold", fontSize: "13px", color: "var(--color-text-primary)" }}>{title}</Text>
        </Box>
        <Box display="flex" alignItems="center" gap={2}>
          {svgMarkup && (
            <Box
              display="flex"
              bg="rgba(0,0,0,0.2)"
              borderRadius="6px"
              p="2px"
              border="1px solid var(--color-border-default)"
            >
              <button
                type="button"
                onClick={() => setViewMode("diagram")}
                style={{
                  background: effectiveViewMode === "diagram" ? "rgba(6, 182, 212, 0.2)" : "transparent",
                  color: effectiveViewMode === "diagram" ? "var(--ms-accent-cyan)" : "var(--color-fg-muted)",
                  border: "none",
                  borderRadius: "4px",
                  padding: "2px 8px",
                  fontSize: "11px",
                  fontWeight: 600,
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "4px",
                }}
              >
                <WorkflowIcon size={12} /> Diagram
              </button>
              <button
                type="button"
                onClick={() => setViewMode("code")}
                style={{
                  background: effectiveViewMode === "code" ? "rgba(6, 182, 212, 0.2)" : "transparent",
                  color: effectiveViewMode === "code" ? "var(--ms-accent-cyan)" : "var(--color-fg-muted)",
                  border: "none",
                  borderRadius: "4px",
                  padding: "2px 8px",
                  fontSize: "11px",
                  fontWeight: 600,
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "4px",
                }}
              >
                <CodeIcon size={12} /> Code
              </button>
            </Box>
          )}
          <Button size="small" leadingVisual={copied ? CheckIcon : CopyIcon} onClick={handleCopy}>
            {copied ? "Copied" : "Copy"}
          </Button>
          {Boolean(viewConfig?.standalone) && (
            <Button
              size="small"
              variant="primary"
              leadingVisual={PlayIcon}
              onClick={() => {
                const hash = compressMorselPayload({
                  v: 1,
                  lang: dialect as any,
                  code,
                  title,
                });
                const fromArtifact = viewConfig?.artifactId ? `?fromArtifact=${viewConfig.artifactId}` : "";
                navigate(`/playground${fromArtifact}#m=${hash}`);
              }}
            >
              Open in Playground
            </Button>
          )}
        </Box>
      </Toolbar>

      <Box flex={1} style={{ minHeight: "220px", height: "100%", overflow: "auto" }}>
        {effectiveViewMode === "diagram" && svgMarkup ? (
          <Box
            p={3}
            display="flex"
            justifyContent="center"
            alignItems="center"
            height="100%"
            dangerouslySetInnerHTML={{ __html: svgMarkup }}
          />
        ) : (
          <Editor
            height="100%"
            language="modelica"
            theme={resolvedColorMode === "dark" ? "vs-dark" : "light"}
            value={code}
            options={{
              readOnly: true,
              minimap: { enabled: false },
              lineNumbers: "on",
              scrollBeyondLastLine: false,
              fontSize: 13,
              wordWrap: "on",
              padding: { top: 12, bottom: 12 },
              automaticLayout: true,
              tabSize: 2,
            }}
          />
        )}
      </Box>
    </Wrapper>
  );
};

export default ModelicaCodeViewer;
