// SPDX-License-Identifier: AGPL-3.0-or-later

import React, { useState } from "react";
import styled, { css, keyframes } from "styled-components";

interface CadViewerProps {
  config: Record<string, unknown>;
  artifactPath: string;
}

const fadeIn = keyframes`
  from { opacity: 0; transform: translateY(4px); }
  to   { opacity: 1; transform: translateY(0); }
`;

const glassCard = css`
  background: var(--color-glass-bg);
  backdrop-filter: blur(12px);
  border: 1px solid var(--color-glass-border);
  border-radius: 8px;
`;

const ViewerWrap = styled.div`
  ${glassCard}
  padding: 16px;
  margin-bottom: 16px;
  animation: ${fadeIn} 0.3s ease;
  display: flex;
  flex-direction: column;
  gap: 12px;
`;

const Header = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--color-border);
`;

const Title = styled.h3`
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--color-text-heading);
  display: flex;
  align-items: center;
  gap: 8px;
`;

const CanvasArea = styled.div`
  position: relative;
  width: 100%;
  height: 400px;
  background: #111111; /* sleek dark background for CAD */
  border-radius: 6px;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--color-border-strong);
`;

const ControlsOverlay = styled.div`
  position: absolute;
  top: 16px;
  right: 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  ${glassCard}
  background: rgba(30, 30, 30, 0.6);
  padding: 8px;
`;

const IconButton = styled.button<{ $active?: boolean }>`
  background: ${(p) => (p.$active ? "var(--color-accent)" : "transparent")};
  color: ${(p) => (p.$active ? "#ffffff" : "var(--color-text-muted)")};
  border: none;
  border-radius: 4px;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.2s;

  &:hover {
    color: #ffffff;
    background: ${(p) => (p.$active ? "var(--color-accent-hover)" : "rgba(255, 255, 255, 0.1)")};
  }
`;

const PlaceholderText = styled.div`
  color: var(--color-text-muted);
  font-family: "SFMono-Regular", Consolas, monospace;
  font-size: 13px;
  text-align: center;
`;

const CadStepViewer: React.FC<CadViewerProps> = ({ artifactPath }) => {
  const [wireframe, setWireframe] = useState(false);
  const [exploded, setExploded] = useState(false);

  return (
    <ViewerWrap>
      <Header>
        <Title>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
            <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
            <line x1="12" y1="22.08" x2="12" y2="12" />
          </svg>
          {artifactPath.split("/").pop() || artifactPath}
        </Title>
      </Header>
      <CanvasArea>
        <PlaceholderText>
          [WebGL 3D Canvas Placeholder]
          <br />
          <span style={{ fontSize: 11, opacity: 0.6 }}>Loading {artifactPath}...</span>
        </PlaceholderText>
        <ControlsOverlay>
          <IconButton title="Rotate" $active>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.59-9.21l5.67-1.42" />
            </svg>
          </IconButton>
          <IconButton title="Pan">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="5 9 2 12 5 15" />
              <polyline points="9 5 12 2 15 5" />
              <polyline points="19 9 22 12 19 15" />
              <polyline points="9 19 12 22 15 19" />
              <line x1="2" y1="12" x2="22" y2="12" />
              <line x1="12" y1="2" x2="12" y2="22" />
            </svg>
          </IconButton>
          <IconButton title="Wireframe Toggle" $active={wireframe} onClick={() => setWireframe(!wireframe)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
              <line x1="3" y1="9" x2="21" y2="9" />
              <line x1="9" y1="21" x2="9" y2="9" />
            </svg>
          </IconButton>
          <IconButton title="Explode Assembly" $active={exploded} onClick={() => setExploded(!exploded)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
            </svg>
          </IconButton>
        </ControlsOverlay>
      </CanvasArea>
    </ViewerWrap>
  );
};

export default CadStepViewer;
