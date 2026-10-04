// SPDX-License-Identifier: AGPL-3.0-or-later

import { PlayIcon, ZapIcon } from "@primer/octicons-react";
import { Button, Text } from "@primer/react";
import React, { Suspense, useState } from "react";
import styled from "styled-components";
import Box from "../Box";
import { compressMorselPayload } from "../morsel/util/permalink";

const MorselEditorLazy = React.lazy(() => import("../morsel/Morsel"));

interface ModelicaDiagramViewerProps {
  viewConfig: any;
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
  const code = viewConfig.code || "model Example\n\nend Example;";
  const dialect = viewConfig.dialect || "modelica";
  const title = viewConfig.title || "Interactive System";
  const [interactive, setInteractive] = useState(!viewConfig.thumbnail_url);

  const getForkUrl = () => {
    const hash = compressMorselPayload({
      v: 1,
      lang: dialect,
      code,
      title,
    });
    return `/playground#m=${hash}`;
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
          {!interactive && viewConfig.thumbnail_url && (
            <Button size="small" variant="default" leadingVisual={PlayIcon} onClick={() => setInteractive(true)}>
              Interact
            </Button>
          )}
          <Button size="small" variant="primary" leadingVisual={ZapIcon} onClick={handleFork}>
            Fork in Playground
          </Button>
        </ToolbarRight>
      </CardToolbar>

      <EditorContainer>
        {interactive || !viewConfig.thumbnail_url ? (
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
