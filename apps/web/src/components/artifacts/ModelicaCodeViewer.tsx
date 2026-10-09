// SPDX-License-Identifier: AGPL-3.0-or-later

/* eslint-disable @typescript-eslint/no-explicit-any */
import Editor from "@monaco-editor/react";
import { CheckIcon, CodeIcon, CopyIcon, PlayIcon } from "@primer/octicons-react";
import { Button, Text, useTheme } from "@primer/react";
import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import styled from "styled-components";
import Box from "../Box";

interface ModelicaCodeViewerProps {
  viewConfig: any;
  isFullScreen?: boolean;
}

const Wrapper = styled.div<{ $isFullScreen?: boolean }>`
  width: 100%;
  height: ${(props) => (props.$isFullScreen ? "100%" : "340px")};
  background: var(--color-canvas-default, #0d1117);
  border: 1px solid var(--color-border-default, #30363d);
  border-radius: ${(props) => (props.$isFullScreen ? "0" : "8px")};
  display: flex;
  flex-direction: column;
  overflow: hidden;
`;

const Toolbar = styled.div`
  height: 40px;
  min-height: 40px;
  background: var(--color-canvas-subtle, #161b22);
  border-bottom: 1px solid var(--color-border-default, #30363d);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px;
`;

const ModelicaCodeViewer: React.FC<ModelicaCodeViewerProps> = ({ viewConfig, isFullScreen }) => {
  const navigate = useNavigate();
  const { resolvedColorMode } = useTheme();
  const [copied, setCopied] = useState(false);

  const code =
    viewConfig?.code ||
    viewConfig?.content ||
    `model ${viewConfig?.model || "Model"}\n  // Modelica source\nend ${viewConfig?.model || "Model"};`;

  const title = viewConfig?.title || (viewConfig?.model ? `${viewConfig.model}.mo` : "Modelica Source");

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Wrapper $isFullScreen={isFullScreen}>
      <Toolbar>
        <Box display="flex" alignItems="center" gap={2}>
          <CodeIcon size={16} fill="var(--color-accent-purple, #a855f7)" />
          <Text fontWeight="bold" fontSize="13px" color="var(--color-text-primary)">
            {title}
          </Text>
        </Box>
        <Box display="flex" alignItems="center" gap={2}>
          <Button size="small" leadingVisual={copied ? CheckIcon : CopyIcon} onClick={handleCopy}>
            {copied ? "Copied" : "Copy"}
          </Button>
          <Button
            size="small"
            leadingVisual={PlayIcon}
            onClick={() => {
              const fromArtifact = viewConfig?.artifactId ? `&fromArtifact=${viewConfig.artifactId}` : "";
              navigate(`/ide?source=${encodeURIComponent(code)}&title=${encodeURIComponent(title)}${fromArtifact}`);
            }}
          >
            Open in IDE
          </Button>
        </Box>
      </Toolbar>

      <Box flex={1} style={{ minHeight: "220px", height: "100%" }}>
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
      </Box>
    </Wrapper>
  );
};

export default ModelicaCodeViewer;
