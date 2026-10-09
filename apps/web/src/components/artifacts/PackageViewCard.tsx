// SPDX-License-Identifier: AGPL-3.0-or-later

import { CheckIcon, CopyIcon, PackageIcon } from "@primer/octicons-react";
import { Button, Text } from "@primer/react";
import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import styled from "styled-components";
import Box from "../Box";

interface PackageViewCardProps {
  viewConfig: {
    name?: string;
    version?: string;
    description?: string;
    license?: string;
    dialect?: string;
    keywords?: string[];
    [key: string]: any;
  };
  isFullScreen?: boolean;
}

const CardWrapper = styled.div`
  background: var(--surface-overlay, rgba(14, 20, 36, 0.95));
  border: 1px solid var(--color-border-glass, rgba(255, 255, 255, 0.08));
  border-radius: 12px;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  transition: all 0.2s ease;

  &:hover {
    border-color: rgba(6, 182, 212, 0.3);
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
  }
`;

const DialectBadge = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  font-family: var(--font-mono, monospace);
  padding: 2px 8px;
  border-radius: 6px;
  background: rgba(6, 182, 212, 0.12);
  color: var(--color-accent-cyan, #06b6d4);
  border: 1px solid rgba(6, 182, 212, 0.25);
  font-weight: 600;
`;

const VersionPill = styled.span`
  font-family: var(--font-mono, monospace);
  font-size: 11px;
  padding: 2px 7px;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.06);
  color: var(--color-text-muted, #8b949e);
  border: 1px solid var(--color-border, #30363d);
`;

const CodeSnippetBox = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: rgba(0, 0, 0, 0.4);
  border: 1px solid var(--color-border, #30363d);
  border-radius: 6px;
  padding: 6px 10px;
  font-family: var(--font-mono, monospace);
  font-size: 12px;
  color: var(--color-fg-default, #c9d1d9);
`;

export const PackageViewCard: React.FC<PackageViewCardProps> = ({ viewConfig }) => {
  const navigate = useNavigate();
  const [copied, setCopied] = useState(false);

  const name = viewConfig.name || "Unnamed Package";
  const version = viewConfig.version || "1.0.0";
  const description = viewConfig.description || "No description provided.";
  const dialect = (viewConfig.dialect || "modelica").toUpperCase();
  const installCmd = `msx install ${name}`;

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(installCmd);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleView = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigate(`/packages/${encodeURIComponent(name)}`);
  };

  return (
    <CardWrapper>
      <Box display="flex" justifyContent="space-between" alignItems="flex-start" gap={2}>
        <Box display="flex" alignItems="center" gap={2} flex={1}>
          <Box
            width="36px"
            height="36px"
            borderRadius="8px"
            bg="rgba(139, 92, 246, 0.15)"
            color="var(--color-accent-purple, #a855f7)"
            display="flex"
            alignItems="center"
            justifyContent="center"
            flexShrink={0}
          >
            <PackageIcon size={20} />
          </Box>
          <Box flex={1}>
            <Box display="flex" alignItems="center" gap={2} flexWrap="wrap">
              <span style={{ fontWeight: 700, fontSize: "15px", color: "var(--color-fg-default)" }}>{name}</span>
              <VersionPill>v{version}</VersionPill>
              <DialectBadge>⚡ {dialect}</DialectBadge>
            </Box>
            {viewConfig.license && (
              <span style={{ fontSize: "11px", color: "var(--color-text-muted)" }}>License: {viewConfig.license}</span>
            )}
          </Box>
        </Box>
        <Button size="small" variant="default" onClick={handleView}>
          View Package
        </Button>
      </Box>

      <Text as="p" style={{ fontSize: "13px", color: "var(--color-fg-muted)", margin: 0 }}>
        {description}
      </Text>

      <CodeSnippetBox>
        <span>{installCmd}</span>
        <button
          onClick={handleCopy}
          style={{
            background: "transparent",
            border: "none",
            color: copied ? "var(--color-status-verified, #10b981)" : "var(--color-text-muted, #8b949e)",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            padding: "2px 4px",
          }}
          title="Copy install command"
        >
          {copied ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
        </button>
      </CodeSnippetBox>
    </CardWrapper>
  );
};

export default PackageViewCard;
