// SPDX-License-Identifier: AGPL-3.0-or-later

import { BookIcon, EyeIcon, LawIcon, LinkExternalIcon, RepoForkedIcon, StarIcon } from "@primer/octicons-react";
import { Heading, Text } from "@primer/react";
import React from "react";
import type { GitlabProject } from "../../../api";
import Box from "../../../components/Box";

export interface RepoAboutSidebarProps {
  repo: GitlabProject;
}

export const RepoAboutSidebar: React.FC<RepoAboutSidebarProps> = ({ repo }) => {
  const licenseLabel =
    typeof repo.license === "string"
      ? repo.license
      : repo.license?.spdx_id || repo.license?.name || "No license specified";
  const topics = Array.isArray(repo.topics) ? repo.topics : [];

  return (
    <Box display="flex" flexDirection="column" gap={4} style={{ paddingTop: "8px" }}>
      <Box>
        <Heading as="h2" style={{ fontSize: "16px", marginBottom: "12px" }}>
          About
        </Heading>
        <Text as="p" style={{ marginBottom: "14px", color: "var(--color-fg-default)", lineHeight: 1.5 }}>
          {repo.description || "No description, website, or topics provided."}
        </Text>

        {repo.web_url && (
          <Box display="flex" alignItems="center" gap={2} mb={3}>
            <LinkExternalIcon fill="var(--color-fg-muted)" />
            <a
              href={repo.web_url}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                color: "var(--color-accent-fg)",
                fontWeight: 600,
                fontSize: "13px",
                textDecoration: "none",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {repo.web_url.replace(/^https?:\/\//, "")}
            </a>
          </Box>
        )}

        {topics.length > 0 && (
          <Box display="flex" flexWrap="wrap" gap={1} mb={3}>
            {topics.slice(0, 8).map((topic) => (
              <span
                key={topic}
                style={{
                  fontSize: "12px",
                  fontWeight: 600,
                  padding: "2px 10px",
                  borderRadius: "9999px",
                  backgroundColor: "rgba(15, 118, 110, 0.1)",
                  color: "var(--ms-brand, #0f766e)",
                }}
              >
                {topic}
              </span>
            ))}
          </Box>
        )}

        <Box display="flex" alignItems="center" gap={2} mb={2}>
          <BookIcon fill="var(--color-fg-muted)" />
          <Text style={{ color: "var(--color-fg-muted)", fontWeight: 600, fontSize: "13px" }}>Readme</Text>
        </Box>
        <Box display="flex" alignItems="center" gap={2} mb={2}>
          <LawIcon fill="var(--color-fg-muted)" />
          <Text style={{ color: "var(--color-fg-muted)", fontWeight: 600, fontSize: "13px" }}>{licenseLabel}</Text>
        </Box>
        <Box display="flex" alignItems="center" gap={2} mb={2}>
          <StarIcon fill="var(--color-fg-muted)" />
          <Text style={{ fontWeight: "bold", color: "var(--color-fg-default)", fontSize: "13px" }}>
            {(repo.star_count ?? 0).toLocaleString()}
          </Text>{" "}
          <Text color="var(--color-fg-muted)" style={{ fontSize: "13px" }}>
            stars
          </Text>
        </Box>
        <Box display="flex" alignItems="center" gap={2} mb={2}>
          <EyeIcon fill="var(--color-fg-muted)" />
          <Text style={{ fontWeight: "bold", color: "var(--color-fg-default)", fontSize: "13px" }}>
            {(repo.watchers_count ?? 0).toLocaleString()}
          </Text>{" "}
          <Text color="var(--color-fg-muted)" style={{ fontSize: "13px" }}>
            watching
          </Text>
        </Box>
        <Box display="flex" alignItems="center" gap={2} mb={2}>
          <RepoForkedIcon fill="var(--color-fg-muted)" />
          <Text style={{ fontWeight: "bold", color: "var(--color-fg-default)", fontSize: "13px" }}>
            {(repo.forks_count ?? 0).toLocaleString()}
          </Text>{" "}
          <Text color="var(--color-fg-muted)" style={{ fontSize: "13px" }}>
            forks
          </Text>
        </Box>
      </Box>
    </Box>
  );
};

export default RepoAboutSidebar;
