// SPDX-License-Identifier: AGPL-3.0-or-later

/* eslint-disable @typescript-eslint/no-explicit-any */
import { RepoIcon } from "@primer/octicons-react";
import { Text } from "@primer/react";
import React from "react";
import { Link } from "react-router-dom";
import Box from "../../Box";
import { Avatar, Card } from "../styles";

export interface PopularReposCardProps {
  popularRepos: any[];
}

export const PopularReposCard: React.FC<PopularReposCardProps> = ({ popularRepos }) => {
  if (popularRepos.length === 0) return null;

  return (
    <Card>
      <Box display="flex" alignItems="center" gap={2} mb={3}>
        <RepoIcon size={14} style={{ color: "var(--color-accent-cyan)" }} />
        <Text
          style={{
            fontSize: "12px",
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            color: "var(--color-text-muted)",
          }}
        >
          Popular Repositories
        </Text>
      </Box>
      <Box display="flex" flexDirection="column" gap={3}>
        {popularRepos.map((repo) => (
          <Box key={repo.id} display="flex" alignItems="center" justifyContent="space-between">
            <Link
              to={`/repos/${repo.provider}/${repo.namespace}/${repo.project}`}
              style={{
                flex: 1,
                minWidth: 0,
                textDecoration: "none",
                color: "inherit",
                display: "flex",
                alignItems: "center",
                gap: "8px",
                overflow: "hidden",
              }}
            >
              <Avatar $url={repo.avatar_url} $letter={repo.project.charAt(0).toUpperCase()} />
              <Box flex={1} minWidth={0} mr={2} display="flex" flexDirection="column">
                <Text
                  style={{
                    fontWeight: "bold",
                    fontSize: "15px",
                    color: "var(--color-text-heading)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                  title={repo.project}
                >
                  {repo.project}
                </Text>
                <Text
                  style={{
                    color: "var(--color-text-muted)",
                    fontSize: "14px",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                  title={repo.namespace}
                >
                  {repo.namespace}
                </Text>
              </Box>
            </Link>
          </Box>
        ))}
      </Box>
    </Card>
  );
};
