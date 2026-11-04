// SPDX-License-Identifier: AGPL-3.0-or-later

import { GitBranchIcon, MarkGithubIcon, PlayIcon, RepoIcon } from "@primer/octicons-react";
import { Button, Text } from "@primer/react";
import React from "react";
import { useNavigate } from "react-router-dom";
import styled from "styled-components";
import { buildCitationFromRepo } from "../../util/citations";
import Box from "../Box";
import { CiteButton } from "../citations/CiteButton";

interface RepositoryViewCardProps {
  viewConfig: {
    namespace?: string | undefined;
    project?: string | undefined;
    provider?: string | undefined;
    description?: string | undefined;
    defaultBranch?: string | undefined;
    cloneUrl?: string | undefined;
    repoUrl?: string | undefined;
    url?: string | undefined;
    [key: string]: any;
  };
  isFullScreen?: boolean | undefined;
}

const CardWrapper = styled.div`
  background: var(--color-canvas-subtle);
  border: 1px solid var(--color-border-default);
  border-radius: 12px;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  transition: all 0.2s ease;

  &:hover {
    border-color: rgba(6, 182, 212, 0.3);
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
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
  background: var(--color-neutral-muted, rgba(148, 163, 184, 0.12));
  color: var(--color-fg-muted);
  border: 1px solid var(--color-border-default);
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
  color: var(--color-done-fg, #a855f7);
  border: 1px solid rgba(139, 92, 246, 0.25);
  font-weight: 600;
  text-transform: capitalize;
`;

export const RepositoryViewCard: React.FC<RepositoryViewCardProps> = ({ viewConfig }) => {
  const navigate = useNavigate();

  const rawUrl = String(viewConfig.cloneUrl || viewConfig.repoUrl || viewConfig.url || "");
  let hostname = "";
  let pathSegments: string[] = [];
  try {
    const normalized = rawUrl.startsWith("git@")
      ? `ssh://${rawUrl.replace(":", "/")}`
      : rawUrl.includes("://")
        ? rawUrl
        : `https://${rawUrl}`;
    const parsed = new URL(normalized);
    hostname = parsed.hostname.toLowerCase();
    pathSegments = parsed.pathname.split("/").filter(Boolean);
  } catch {
    // Ignore invalid URLs
  }

  const namespace = viewConfig.namespace || pathSegments[0] || "user";
  const project = (viewConfig.project || pathSegments[1] || "repository").replace(/\.git$/i, "");
  const fullName = `${namespace}/${project}`;
  const description = viewConfig.description || "Engineering model repository.";

  const isGitHub = hostname === "github.com" || hostname.endsWith(".github.com");
  const isGitLab = hostname === "gitlab.com" || hostname.endsWith(".gitlab.com");
  const provider = viewConfig.provider || (isGitHub ? "github" : isGitLab ? "gitlab" : "internal");
  const branch = viewConfig.defaultBranch || "main";

  const handleOpenIde = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigate(
      `/repos/${encodeURIComponent(provider)}/${encodeURIComponent(namespace)}/${encodeURIComponent(project)}/ide`,
    );
  };

  const handleBrowseRepo = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigate(`/repos/${encodeURIComponent(provider)}/${encodeURIComponent(namespace)}/${encodeURIComponent(project)}`);
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
            style={{ flexShrink: 0 }}
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
        <Box display="flex" alignItems="center" gap={2}>
          <CiteButton
            target={buildCitationFromRepo({
              provider,
              namespace,
              project,
              description,
              defaultBranch: branch,
            })}
            label="Cite"
            variant="button"
            testId="repo-card-cite-btn"
          />
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
