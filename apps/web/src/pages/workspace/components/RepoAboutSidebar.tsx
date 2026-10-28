// SPDX-License-Identifier: AGPL-3.0-or-later

import { BookIcon, EyeIcon, LawIcon, RepoForkedIcon, StarIcon } from "@primer/octicons-react";
import { Heading, Text } from "@primer/react";
import React from "react";
import type { GitlabProject } from "../../../api";
import Box from "../../../components/Box";

export interface RepoAboutSidebarProps {
  repo: GitlabProject;
}

export const RepoAboutSidebar: React.FC<RepoAboutSidebarProps> = ({ repo }) => {
  const licenseLabel =
    typeof (repo as any).license === "string"
      ? (repo as any).license
      : (repo as any).license?.name || "No license specified";

  return (
    <Box display="flex" flexDirection="column" gap={4} style={{ paddingTop: "8px" }}>
      <Box>
        <Heading as="h2" style={{ fontSize: "16px", marginBottom: "16px" }}>
          About
        </Heading>
        <Text as="p" style={{ marginBottom: "16px", color: "var(--color-fg-default)" }}>
          {repo.description || "No description, website, or topics provided."}
        </Text>
        <Box display="flex" alignItems="center" gap={2} mb={3}>
          <BookIcon fill="var(--color-fg-muted)" />
          <Text style={{ color: "var(--color-fg-muted)", fontWeight: "bold" }}>Readme</Text>
        </Box>
        <Box display="flex" alignItems="center" gap={2} mb={3}>
          <LawIcon fill="var(--color-fg-muted)" />
          <Text style={{ color: "var(--color-fg-muted)", fontWeight: "bold" }}>{licenseLabel}</Text>
        </Box>
        <Box display="flex" alignItems="center" gap={2} mb={3}>
          <StarIcon fill="var(--color-fg-muted)" />
          <Text style={{ fontWeight: "bold", color: "var(--color-fg-default)" }}>
            {(repo as any).star_count ?? 0}
          </Text>{" "}
          <Text color="var(--color-fg-muted)">stars</Text>
        </Box>
        <Box display="flex" alignItems="center" gap={2} mb={3}>
          <EyeIcon fill="var(--color-fg-muted)" />
          <Text style={{ fontWeight: "bold", color: "var(--color-fg-default)" }}>
            {(repo as any).watchers_count ?? 0}
          </Text>{" "}
          <Text color="var(--color-fg-muted)">watching</Text>
        </Box>
        <Box display="flex" alignItems="center" gap={2} mb={3}>
          <RepoForkedIcon fill="var(--color-fg-muted)" />
          <Text style={{ fontWeight: "bold", color: "var(--color-fg-default)" }}>
            {(repo as any).forks_count ?? 0}
          </Text>{" "}
          <Text color="var(--color-fg-muted)">forks</Text>
        </Box>
      </Box>
    </Box>
  );
};

export default RepoAboutSidebar;
