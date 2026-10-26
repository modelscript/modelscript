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
import React from "react";
import { Link } from "react-router-dom";
import Box from "../../../components/Box";

export interface WorkspaceHeaderProps {
  namespace: string;
  project: string;
  basePath: string;
  currentTab: string | undefined;
}

export const WorkspaceHeader: React.FC<WorkspaceHeaderProps> = ({ namespace, project, basePath, currentTab }) => {
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
            <Button leadingVisual={EyeIcon} trailingVisual={TriangleDownIcon} size="small" variant="default">
              Watch
            </Button>
            <Button leadingVisual={RepoForkedIcon} size="small" variant="default">
              Fork
            </Button>
            <Button leadingVisual={StarIcon} size="small" variant="default">
              Star
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
