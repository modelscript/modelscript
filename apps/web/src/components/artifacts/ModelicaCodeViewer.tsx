// SPDX-License-Identifier: AGPL-3.0-or-later
import { CheckIcon, CodeIcon, CopyIcon, GraphIcon, PlayIcon, StackIcon, WorkflowIcon } from "@primer/octicons-react";
import { Button, Spinner, Text, useTheme } from "@primer/react";
import React, { Suspense, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import styled from "styled-components";
import Box from "../Box";
import { compressMorselPayload } from "../morsel/util/permalink";
import { highlightPolyglotLine, sanitizeSvgMarkup } from "./PolyglotArtifactViewer";

const MonacoEditor = React.lazy(() => import("@monaco-editor/react"));
const MorselEditor = React.lazy(() => import("../morsel/Morsel"));

interface ModelicaCodeViewerProps {
  viewConfig: any;
  isFullScreen?: boolean | undefined;
}

type CodeViewerTab = "code" | "diagram" | "simulate" | "3d" | "split";

const Wrapper = styled.div<{ $isFullScreen?: boolean | undefined }>`
  width: 100%;
  height: ${(props) => (props.$isFullScreen ? "100%" : "360px")};
  background: var(--color-canvas-default);
  border: ${(props) => (props.$isFullScreen ? "none" : "1px solid var(--color-border-default)")};
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
  const [viewMode, setViewMode] = useState<CodeViewerTab>("code");
  const [isInteractiveDiagram, setIsInteractiveDiagram] = useState(false);
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

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const codeLines = useMemo(() => code.split(/\r?\n/), [code]);

  const usesMorselRuntime =
    viewMode === "simulate" ||
    viewMode === "3d" ||
    viewMode === "split" ||
    (viewMode === "diagram" && (!svgMarkup || isInteractiveDiagram || isFullScreen));

  const morselInitialView =
    viewMode === "simulate"
      ? "simulation"
      : viewMode === "3d"
        ? "3d"
        : viewMode === "split"
          ? "split-columns"
          : "diagram";

  return (
    <Wrapper $isFullScreen={isFullScreen}>
      <Toolbar>
        <Box display="flex" alignItems="center" gap={2}>
          {!isFullScreen && (
            <>
              <CodeIcon size={16} fill="var(--color-accent-fg)" />
              <Text style={{ fontWeight: "bold", fontSize: "13px", color: "var(--color-text-primary)" }}>{title}</Text>
            </>
          )}
          <Box
            display="flex"
            bg="rgba(0,0,0,0.2)"
            borderRadius="6px"
            p="2px"
            border="1px solid var(--color-border-default)"
            role="tablist"
            aria-label="Modelica viewer mode"
          >
            <button
              type="button"
              role="tab"
              aria-selected={viewMode === "code"}
              onClick={() => setViewMode("code")}
              style={{
                background: viewMode === "code" ? "rgba(6, 182, 212, 0.2)" : "transparent",
                color: viewMode === "code" ? "var(--ms-accent-cyan)" : "var(--color-fg-muted)",
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
            <button
              type="button"
              role="tab"
              aria-selected={viewMode === "diagram"}
              onClick={() => setViewMode("diagram")}
              style={{
                background: viewMode === "diagram" ? "rgba(6, 182, 212, 0.2)" : "transparent",
                color: viewMode === "diagram" ? "var(--ms-accent-cyan)" : "var(--color-fg-muted)",
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
              role="tab"
              aria-selected={viewMode === "simulate"}
              onClick={() => setViewMode("simulate")}
              style={{
                background: viewMode === "simulate" ? "rgba(6, 182, 212, 0.2)" : "transparent",
                color: viewMode === "simulate" ? "var(--ms-accent-cyan)" : "var(--color-fg-muted)",
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
              <GraphIcon size={12} /> Simulate
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={viewMode === "3d"}
              onClick={() => setViewMode("3d")}
              style={{
                background: viewMode === "3d" ? "rgba(6, 182, 212, 0.2)" : "transparent",
                color: viewMode === "3d" ? "var(--ms-accent-cyan)" : "var(--color-fg-muted)",
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
              <StackIcon size={12} /> 3D
            </button>
            {isFullScreen && (
              <button
                type="button"
                role="tab"
                aria-selected={viewMode === "split"}
                onClick={() => setViewMode("split")}
                style={{
                  background: viewMode === "split" ? "rgba(6, 182, 212, 0.2)" : "transparent",
                  color: viewMode === "split" ? "var(--ms-accent-cyan)" : "var(--color-fg-muted)",
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
                Split
              </button>
            )}
          </Box>
        </Box>
        <Box display="flex" alignItems="center" gap={2}>
          {viewMode === "diagram" && svgMarkup && !isInteractiveDiagram && !isFullScreen && (
            <Button size="small" onClick={() => setIsInteractiveDiagram(true)}>
              Interactive Canvas
            </Button>
          )}
          <Button size="small" leadingVisual={copied ? CheckIcon : CopyIcon} onClick={handleCopy}>
            {copied ? "Copied" : "Copy"}
          </Button>
          {Boolean(viewConfig?.standalone) && !isFullScreen && (
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

      <Box flex={1} style={{ minHeight: "220px", height: "100%", overflow: "auto", position: "relative" }}>
        {usesMorselRuntime ? (
          <Suspense
            fallback={
              <Box display="flex" alignItems="center" justifyContent="center" height="100%" gap={2}>
                <Spinner size="small" />
                <Text fontSize="12px" color="var(--color-fg-muted)">
                  Initializing interactive runtime…
                </Text>
              </Box>
            }
          >
            <MorselEditor
              dataUrl={null}
              initialCode={code}
              embed={true}
              initialDialect={dialect}
              initialView={morselInitialView}
              simulateTriggerCount={viewMode === "simulate" || viewMode === "3d" ? 1 : undefined}
              showParameterRibbon={true}
              hideFloatingDock={true}
            />
          </Suspense>
        ) : viewMode === "diagram" && svgMarkup ? (
          <Box
            p={3}
            display="flex"
            justifyContent="center"
            alignItems="center"
            height="100%"
            dangerouslySetInnerHTML={{ __html: svgMarkup }}
          />
        ) : !isFullScreen ? (
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
        ) : (
          <Suspense
            fallback={
              <Box display="flex" alignItems="center" justifyContent="center" height="100%">
                <Spinner size="small" />
              </Box>
            }
          >
            <MonacoEditor
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
          </Suspense>
        )}
      </Box>
    </Wrapper>
  );
};

export default ModelicaCodeViewer;
