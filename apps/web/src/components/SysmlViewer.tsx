// SPDX-License-Identifier: AGPL-3.0-or-later

import React from "react";
import styled, { css, keyframes } from "styled-components";

interface SysmlViewerProps {
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

const DiagramArea = styled.div`
  position: relative;
  width: 100%;
  height: 300px;
  background: var(--color-bg-inset);
  border-radius: 6px;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--color-border);
  background-image: radial-gradient(var(--color-border-strong) 1px, transparent 0);
  background-size: 20px 20px;
`;

const NodeBox = styled.div`
  ${glassCard}
  padding: 12px 24px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  border: 2px solid var(--color-accent);
`;

const SysmlViewer: React.FC<SysmlViewerProps> = ({ artifactPath }) => {
  return (
    <ViewerWrap>
      <Header>
        <Title>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
            <line x1="3" y1="9" x2="21" y2="9" />
            <line x1="9" y1="21" x2="9" y2="9" />
          </svg>
          {artifactPath.split("/").pop() || artifactPath}
        </Title>
      </Header>
      <DiagramArea>
        {/* Placeholder for actual AntV X6 or ReactFlow rendering */}
        <NodeBox>
          <div style={{ fontSize: 11, color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: 1 }}>
            block
          </div>
          <div style={{ fontSize: 16, fontWeight: 600, color: "var(--color-text-heading)" }}>System Architecture</div>
          <div style={{ fontSize: 12, color: "var(--color-text-primary)", marginTop: 8 }}>
            [Interactive SysML Diagram Placeholder]
          </div>
        </NodeBox>
      </DiagramArea>
    </ViewerWrap>
  );
};

export default SysmlViewer;
