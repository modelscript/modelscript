// SPDX-License-Identifier: AGPL-3.0-or-later

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
      <Box display="flex" alignItems="center" gap={2} mb={2}>
        <Text
          as="h2"
          style={{
            fontSize: "15px",
            lineHeight: "20px",
            fontWeight: 700,
            margin: 0,
            color: "var(--color-text-heading)",
          }}
        >
          Popular Repositories
        </Text>
      </Box>
      <Box display="flex" flexDirection="column" gap={2}>
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
                    fontWeight: 600,
                    fontSize: "13px",
                    lineHeight: "18px",
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
                    fontSize: "12px",
                    lineHeight: "16px",
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
