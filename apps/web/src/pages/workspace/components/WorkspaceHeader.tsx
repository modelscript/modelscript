// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  BookIcon,
  CodeIcon,
  EyeIcon,
  GearIcon,
  GitPullRequestIcon,
  IssueOpenedIcon,
  PlayIcon,
  RepoForkedIcon,
  StarIcon,
  TriangleDownIcon,
} from "@primer/octicons-react";
import { Button, Heading, Label, Link as PrimerLink, Text, UnderlineNav } from "@primer/react";
import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Box from "../../../components/Box";
import { useToast } from "../../../components/ToastContext";

export interface WorkspaceHeaderProps {
  namespace: string;
  project: string;
  basePath: string;
  currentTab: string | undefined;
}

export const WorkspaceHeader: React.FC<WorkspaceHeaderProps> = ({ namespace, project, basePath, currentTab }) => {
  const { showToast } = useToast();
  const repoKey = `${namespace}/${project}`;
  const [watching, setWatching] = useState(false);
  const [starred, setStarred] = useState(false);
  const [forked, setForked] = useState(false);

  useEffect(() => {
    try {
      setWatching(localStorage.getItem(`modelscript.repo.watch.${repoKey}`) === "1");
      setStarred(localStorage.getItem(`modelscript.repo.star.${repoKey}`) === "1");
      setForked(localStorage.getItem(`modelscript.repo.fork.${repoKey}`) === "1");
    } catch {
      // Ignore storage errors
    }
  }, [repoKey]);

  const toggleWatch = () => {
    const next = !watching;
    setWatching(next);
    try {
      localStorage.setItem(`modelscript.repo.watch.${repoKey}`, next ? "1" : "0");
    } catch {
      // Ignore
    }
    showToast(next ? `Watching ${repoKey}` : `Unwatched ${repoKey}`, "info");
  };

  const toggleStar = () => {
    const next = !starred;
    setStarred(next);
    try {
      localStorage.setItem(`modelscript.repo.star.${repoKey}`, next ? "1" : "0");
    } catch {
      // Ignore
    }
    showToast(next ? `Starred ${repoKey}` : `Unstarred ${repoKey}`, "info");
  };

  const handleFork = () => {
    setForked(true);
    try {
      localStorage.setItem(`modelscript.repo.fork.${repoKey}`, "1");
    } catch {
      // Ignore
    }
    showToast(`Forked ${repoKey} to your workspace`, "success");
  };

  return (
    <Box style={{ borderBottom: "1px solid var(--color-border-default)", paddingTop: "16px" }}>
      <Box maxWidth="1280px" mx="auto" px={4}>
        <Box display="flex" justifyContent="space-between" alignItems="flex-start" mb={4}>
          <Box display="flex" alignItems="center" gap={2}>
            <BookIcon size={24} fill="var(--color-fg-muted)" />
            <Heading as="h1" style={{ fontSize: "20px", fontWeight: "normal", color: "var(--color-fg-default)" }}>
              <PrimerLink as={Link} to={basePath} style={{ color: "var(--color-accent-fg)" }}>
                {namespace}
              </PrimerLink>
              <Text color="var(--color-fg-muted)" style={{ margin: "0 4px" }}>
                /
              </Text>
              <PrimerLink as={Link} to={basePath} style={{ color: "var(--color-accent-fg)", fontWeight: "bold" }}>
                {project}
              </PrimerLink>
            </Heading>
            <Label variant="secondary" style={{ marginLeft: "8px" }}>
              Public
            </Label>
          </Box>
          <Box display="flex" gap={2}>
            <Button
              leadingVisual={EyeIcon}
              trailingVisual={TriangleDownIcon}
              size="small"
              variant={watching ? "primary" : "default"}
              onClick={toggleWatch}
            >
              {watching ? "Watching" : "Watch"}
            </Button>
            <Button
              leadingVisual={RepoForkedIcon}
              size="small"
              variant={forked ? "primary" : "default"}
              onClick={handleFork}
            >
              {forked ? "Forked" : "Fork"}
            </Button>
            <Button
              leadingVisual={StarIcon}
              size="small"
              variant={starred ? "primary" : "default"}
              onClick={toggleStar}
            >
              {starred ? "Starred" : "Star"}
            </Button>
          </Box>
        </Box>

        <UnderlineNav aria-label="Repository">
          <UnderlineNav.Item
            as={Link}
            to={basePath}
            aria-current={currentTab === "code" ? "page" : undefined}
            icon={CodeIcon}
          >
            Code
          </UnderlineNav.Item>
          <UnderlineNav.Item
            as={Link}
            to={`${basePath}/issues`}
            aria-current={currentTab === "issues" ? "page" : undefined}
            icon={IssueOpenedIcon}
          >
            Issues
          </UnderlineNav.Item>
          <UnderlineNav.Item
            as={Link}
            to={`${basePath}/pulls`}
            aria-current={currentTab === "pulls" ? "page" : undefined}
            icon={GitPullRequestIcon}
          >
            Pull Requests
          </UnderlineNav.Item>
          <UnderlineNav.Item
            as={Link}
            to={`${basePath}/actions`}
            aria-current={currentTab === "actions" ? "page" : undefined}
            icon={PlayIcon}
          >
            Actions
          </UnderlineNav.Item>
          <UnderlineNav.Item
            as={Link}
            to={`${basePath}/settings`}
            aria-current={currentTab === "settings" ? "page" : undefined}
            icon={GearIcon}
          >
            Settings
          </UnderlineNav.Item>
        </UnderlineNav>
      </Box>
    </Box>
  );
};

export default WorkspaceHeader;
