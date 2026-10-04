// SPDX-License-Identifier: AGPL-3.0-or-later

import { LinkExternalIcon } from "@primer/octicons-react";
import React, { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import styled from "styled-components";
import MorselEditor from "../components/morsel/Morsel";
import { decompressMorselPayload } from "../components/morsel/util/permalink";

const EmbedContainer = styled.div`
  width: 100vw;
  height: 100vh;
  position: relative;
  overflow: hidden;
  background-color: var(--color-canvas-default, #0d1117);
`;

const WatermarkPill = styled.a`
  position: fixed;
  bottom: 12px;
  right: 12px;
  display: flex;
  align-items: center;
  gap: 6px;
  background: rgba(13, 17, 23, 0.85);
  border: 1px solid var(--color-border-default, #30363d);
  padding: 4px 10px;
  border-radius: 999px;
  color: var(--color-fg-muted, #8b949e);
  font-size: 11px;
  font-family: var(--font-mono, monospace);
  text-decoration: none;
  backdrop-filter: blur(8px);
  z-index: 100;
  transition: all 0.2s ease;

  &:hover {
    color: var(--color-accent-cyan, #06b6d4);
    border-color: rgba(6, 182, 212, 0.4);
    text-decoration: none;
  }
`;

export const EmbedPlaygroundPage: React.FC = () => {
  const location = useLocation();
  const [currentCode, setCurrentCode] = useState<string>("model Example\n\nend Example;");

  useEffect(() => {
    if (location.hash && location.hash.length > 1) {
      const payload = decompressMorselPayload(location.hash);
      if (payload && payload.code) {
        setCurrentCode(payload.code);
      }
    }
  }, [location.hash]);

  return (
    <EmbedContainer>
      <MorselEditor dataUrl={null} initialCode={currentCode} embed={true} />
      <WatermarkPill
        href={`/playground${location.hash}`}
        target="_blank"
        rel="noopener noreferrer"
        title="Open full interactive playground in ModelScript"
      >
        <span>ModelScript ⚡</span>
        <LinkExternalIcon size={12} />
      </WatermarkPill>
    </EmbedContainer>
  );
};

export default EmbedPlaygroundPage;
