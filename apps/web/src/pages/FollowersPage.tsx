// SPDX-License-Identifier: AGPL-3.0-or-later

import { Spinner, Text } from "@primer/react";
import React, { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import styled from "styled-components";
import { getUserFollowers } from "../api";
import { useAuth } from "../AuthContext";
import Box from "../components/Box";
import FederatedDomainPill from "../components/FederatedDomainPill";
import FollowButton from "../components/FollowButton";
import PageHeader from "../components/PageHeader";
import { parseFederatedHandle } from "../util/federation";
import { usePageTitle } from "../util/title";
import { safeCssImageUrl } from "../util/url";

const Avatar = styled.div<{ $url?: string | undefined; $letter?: string | undefined }>`
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background-color: var(--color-canvas-subtle);
  background-image: ${(props) => safeCssImageUrl(props.$url)};
  background-size: cover;
  background-position: center;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: bold;
  font-size: 20px;
  color: var(--color-fg-muted);
  &::before {
    content: "${(props) => (!props.$url && props.$letter ? props.$letter : "")}";
  }
`;

const UserRow = styled.div`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--color-border);
  transition: background-color 0.2s;
  cursor: pointer;

  &:hover {
    background-color: var(--color-canvas-subtle);
  }
`;

const TabBar = styled.div`
  display: flex;
  border-bottom: 1px solid var(--color-border);
  position: sticky;
  top: calc(var(--dev-header-height, 0px) + 53px);
  background: var(--surface-hud, rgba(6, 8, 15, 0.85));
  backdrop-filter: blur(12px);
  z-index: 9;
`;

const TabButton = styled(Link)<{ $active?: boolean | undefined }>`
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
  height: 53px;
  padding: 0 16px;
  font-size: 15px;
  line-height: 20px;
  font-weight: ${(props) => (props.$active ? "700" : "500")};
  color: ${(props) => (props.$active ? "var(--color-fg-default)" : "var(--color-fg-muted)")};
  text-decoration: none;
  position: relative;
  transition: all 0.15s;

  &:hover {
    background-color: var(--surface-row-hover);
    color: var(--color-fg-default);
    text-decoration: none;
  }

  &::after {
    content: "";
    position: absolute;
    bottom: 0;
    left: 50%;
    transform: translateX(-50%);
    width: ${(props) => (props.$active ? "60px" : "0")};
    height: 3px;
    background: var(--gradient-cta);
    border-radius: 9999px;
    box-shadow: 0 0 8px rgba(139, 92, 246, 0.5);
    transition: width 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  }
`;

export interface FollowUser {
  id: string | number;
  username: string;
  display_name?: string | undefined;
  avatar_url?: string | undefined;
  bio?: string | undefined;
  is_following?: boolean | undefined;
}

export interface FollowListPageLayoutProps {
  username: string | undefined;
  activeTab: "followers" | "following";
  users: FollowUser[];
  loading: boolean;
  emptyMessage: string;
}

export const FollowListPageLayout: React.FC<FollowListPageLayoutProps> = ({
  username,
  activeTab,
  users,
  loading,
  emptyMessage,
}) => {
  const navigate = useNavigate();
  const { user: currentUser } = useAuth();

  return (
    <Box>
      <PageHeader back={() => navigate(`/${username}`)} title={`@${username}`} divider={false} />

      <TabBar>
        <TabButton to={`/${username}/followers`} $active={activeTab === "followers"}>
          Followers
        </TabButton>
        <TabButton to={`/${username}/following`} $active={activeTab === "following"}>
          Following
        </TabButton>
      </TabBar>
      {loading ? (
        <Box p={4} display="flex" justifyContent="center">
          <Spinner />
        </Box>
      ) : users.length === 0 ? (
        <Box p={6} textAlign="center">
          <Text style={{ color: "var(--color-fg-muted)", fontSize: "15px", lineHeight: "20px" }}>{emptyMessage}</Text>
        </Box>
      ) : (
        <Box display="flex" flexDirection="column">
          {users.map((u) => {
            const parsed = parseFederatedHandle(u.username);
            return (
              <UserRow key={u.id}>
                <Link
                  to={`/${u.username}`}
                  style={{
                    textDecoration: "none",
                    color: "inherit",
                    display: "flex",
                    gap: "12px",
                    flex: 1,
                    minWidth: 0,
                  }}
                >
                  <Avatar $url={u.avatar_url} $letter={u.username.charAt(0).toUpperCase()} />
                  <Box display="flex" flexDirection="column" flex={1} style={{ minWidth: 0 }}>
                    <Box display="flex" flexDirection="column">
                      <Text
                        style={{
                          fontWeight: 700,
                          fontSize: "15px",
                          lineHeight: "20px",
                          color: "var(--color-fg-default)",
                        }}
                      >
                        {u.display_name || u.username}
                      </Text>
                      <Box display="flex" alignItems="center" gap={1} flexWrap="wrap">
                        <Text className="handle-text" style={{ fontSize: "15px", lineHeight: "20px" }}>
                          @{parsed.localUsername}
                        </Text>
                        {parsed.isFederated && parsed.remoteDomain && (
                          <FederatedDomainPill domain={parsed.remoteDomain} />
                        )}
                      </Box>
                    </Box>
                    {u.bio && (
                      <Text
                        style={{
                          fontSize: "15px",
                          lineHeight: "20px",
                          marginTop: "4px",
                          color: "var(--color-fg-default)",
                        }}
                      >
                        {u.bio}
                      </Text>
                    )}
                  </Box>
                </Link>
                {currentUser?.username !== u.username && (
                  <Box ml={3} flexShrink={0}>
                    <FollowButton username={u.username} initialIsFollowing={Boolean(u.is_following)} />
                  </Box>
                )}
              </UserRow>
            );
          })}
        </Box>
      )}
    </Box>
  );
};

const FollowersPage: React.FC = () => {
  const { username } = useParams();
  usePageTitle(username ? `@${username}'s Followers` : "Followers");
  const { token } = useAuth();
  const [users, setUsers] = useState<FollowUser[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      if (!username) return;
      setLoading(true);
      try {
        const data = await getUserFollowers(username);
        setUsers(data.followers || []);
      } catch (err) {
        console.error("Failed to load followers", err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [username, token]);

  return (
    <FollowListPageLayout
      username={username}
      activeTab="followers"
      users={users}
      loading={loading}
      emptyMessage={`@${username} doesn't have any followers yet.`}
    />
  );
};

export default FollowersPage;
