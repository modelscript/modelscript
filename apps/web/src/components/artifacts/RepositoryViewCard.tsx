// SPDX-License-Identifier: AGPL-3.0-or-later

import { GitBranchIcon, MarkGithubIcon, PlayIcon, RepoIcon } from "@primer/octicons-react";
import { Button, Text } from "@primer/react";
import React from "react";
import { useNavigate } from "react-router-dom";
import styled from "styled-components";
import Box from "../Box";

interface RepositoryViewCardProps {
  viewConfig: {
    namespace?: string;
    project?: string;
    provider?: string;
    description?: string;
    defaultBranch?: string;
    cloneUrl?: string;
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

const BranchPill = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-family: var(--font-mono, monospace);
  font-size: 11px;
  padding: 2px 7px;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.06);
  color: var(--color-text-muted, #8b949e);
  border: 1px solid var(--color-border, #30363d);
`;

const ProviderBadge = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  font-family: var(--font-mono, monospace);
  padding: 2px 8px;
  border-radius: 6px;
  background: rgba(139, 92, 246, 0.12);
  color: var(--color-accent-purple, #a855f7);
  border: 1px solid rgba(139, 92, 246, 0.25);
  font-weight: 600;
  text-transform: capitalize;
`;

export const RepositoryViewCard: React.FC<RepositoryViewCardProps> = ({ viewConfig }) => {
  const navigate = useNavigate();

  const namespace = viewConfig.namespace || "user";
  const project = viewConfig.project || "repository";
  const fullName = `${namespace}/${project}`;
  const description = viewConfig.description || "Engineering model repository.";
  const provider = viewConfig.provider || "github";
  const branch = viewConfig.defaultBranch || "main";

  const handleOpenIde = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigate(`/ide?repo=${encodeURIComponent(fullName)}`);
  };

  const handleBrowseRepo = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigate(`/repos/${encodeURIComponent(namespace)}/${encodeURIComponent(project)}`);
  };

  return (
    <CardWrapper>
      <Box display="flex" justifyContent="space-between" alignItems="flex-start" gap={2}>
        <Box display="flex" alignItems="center" gap={2} flex={1}>
          <Box
            width="36px"
            height="36px"
            borderRadius="8px"
            bg="rgba(6, 182, 212, 0.12)"
            color="var(--color-accent-cyan, #06b6d4)"
            display="flex"
            alignItems="center"
            justifyContent="center"
            flexShrink={0}
          >
            <RepoIcon size={20} />
          </Box>
          <Box flex={1}>
            <Box display="flex" alignItems="center" gap={2} flexWrap="wrap">
              <span style={{ fontWeight: 700, fontSize: "15px", color: "var(--color-fg-default)" }}>{fullName}</span>
              <BranchPill>
                <GitBranchIcon size={12} />
                {branch}
              </BranchPill>
              <ProviderBadge>
                {provider === "github" ? <MarkGithubIcon size={12} /> : null}
                {provider}
              </ProviderBadge>
            </Box>
          </Box>
        </Box>
        <Box display="flex" gap={2}>
          <Button size="small" variant="default" onClick={handleBrowseRepo}>
            Browse
          </Button>
          <Button size="small" variant="primary" leadingVisual={PlayIcon} onClick={handleOpenIde}>
            Open in IDE
          </Button>
        </Box>
      </Box>

      <Text as="p" style={{ fontSize: "13px", color: "var(--color-fg-muted)", margin: 0 }}>
        {description}
      </Text>
    </CardWrapper>
  );
};

export default RepositoryViewCard;
