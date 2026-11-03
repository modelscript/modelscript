// SPDX-License-Identifier: AGPL-3.0-or-later

import { Text } from "@primer/react";
import React from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { RepoAvatarBadge } from "../../../pages/RepositoryListPage";
import Box from "../../Box";
import { Card, CardHeader, CardTitle, PanelList, TrendingItem } from "../styles";

export interface PopularReposCardProps {
  popularRepos: any[];
}

export const PopularReposCard: React.FC<PopularReposCardProps> = ({ popularRepos }) => {
  const navigate = useNavigate();
  const location = useLocation();

  if (popularRepos.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Popular Repositories</CardTitle>
      </CardHeader>
      <PanelList>
        {popularRepos.map((repo) => {
          const provider = repo.provider || "github";
          const targetUrl = `/repos/${provider}/${repo.namespace}/${repo.project}`;
          const isActive = location.pathname === targetUrl || location.pathname.startsWith(`${targetUrl}/`);

          return (
            <TrendingItem
              key={repo.id || `${provider}:${repo.namespace}/${repo.project}`}
              $active={isActive}
              onClick={() => navigate(targetUrl)}
            >
              <Link
                to={targetUrl}
                onClick={(e) => e.stopPropagation()}
                style={{
                  flex: 1,
                  minWidth: 0,
                  textDecoration: "none",
                  color: "inherit",
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                  overflow: "hidden",
                }}
              >
                <RepoAvatarBadge
                  url={repo.avatar_url}
                  name={repo.project}
                  namespace={repo.namespace}
                  provider={provider}
                  description={repo.description}
                  size={34}
                />
                <Box flex={1} minWidth={0} display="flex" flexDirection="column">
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
                    title={`${repo.namespace}/${repo.project}`}
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
            </TrendingItem>
          );
        })}
      </PanelList>
    </Card>
  );
};
