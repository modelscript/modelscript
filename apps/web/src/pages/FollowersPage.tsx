// SPDX-License-Identifier: AGPL-3.0-or-later

import { ArrowLeftIcon } from "@primer/octicons-react";
import { Heading, Spinner, Text } from "@primer/react";
import React, { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import styled from "styled-components";
import { useAuth } from "../AuthContext";
import Box from "../components/Box";
import FollowButton from "../components/FollowButton";
import { CircleIconButton } from "../components/SharedStyles";
import { API_BASE_URL } from "../config";

const Avatar = styled.div<{ $url?: string; $letter?: string }>`
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background-color: var(--color-canvas-subtle);
  background-image: ${(props) => (props.$url ? `url(${props.$url})` : "none")};
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
  background: var(--color-canvas-default);
  z-index: 9;
`;

const TabButton = styled(Link)<{ $active?: boolean }>`
  flex: 1;
  text-align: center;
  padding: 14px 16px;
  font-weight: ${(props) => (props.$active ? "700" : "500")};
  color: ${(props) => (props.$active ? "var(--color-fg-default)" : "var(--color-fg-muted)")};
  text-decoration: none;
  position: relative;
  transition: all 0.15s;

  &:hover {
    background-color: var(--color-canvas-subtle);
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
    background: var(--color-accent-cyan, #58a6ff);
    border-radius: 9999px;
    transition: width 0.2s;
  }
`;

interface FollowUser {
  id: string | number;
  username: string;
  display_name?: string;
  avatar_url?: string;
  bio?: string;
  is_following?: boolean;
}

const FollowersPage: React.FC = () => {
  const { username } = useParams();
  const navigate = useNavigate();
  const { token, user: currentUser } = useAuth();
  const [users, setUsers] = useState<FollowUser[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const headers: Record<string, string> = {};
        if (token) {
          headers["Authorization"] = `Bearer ${token}`;
        }
        const res = await fetch(`${API_BASE_URL}/users/${username}/followers`, { headers });
        if (res.ok) {
          const data = await res.json();
          setUsers(data.followers);
        }
      } catch (err) {
        console.error("Failed to load followers", err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [username, token]);

  return (
    <Box>
      <Box
        p={3}
        borderBottom="1px solid var(--color-border)"
        position="sticky"
        top="var(--dev-header-height, 0px)"
        bg="var(--color-canvas-default)"
        zIndex={10}
        display="flex"
        alignItems="center"
        gap={3}
      >
        <CircleIconButton onClick={() => navigate(`/${username}`)} aria-label="Back">
          <ArrowLeftIcon size={20} />
        </CircleIconButton>
        <Box display="flex" flexDirection="column">
          <Heading as="h2" style={{ fontSize: "18px", margin: 0, fontWeight: 700 }}>
            @{username}
          </Heading>
        </Box>
      </Box>

      <TabBar>
        <TabButton to={`/${username}/followers`} $active={true}>
          Followers
        </TabButton>
        <TabButton to={`/${username}/following`} $active={false}>
          Following
        </TabButton>
      </TabBar>
      {loading ? (
        <Box p={4} display="flex" justifyContent="center">
          <Spinner />
        </Box>
      ) : users.length === 0 ? (
        <Box p={6} textAlign="center">
          <Text style={{ color: "var(--color-fg-muted)", fontSize: "15px" }}>
            @{username} doesn't have any followers yet.
          </Text>
        </Box>
      ) : (
        <Box display="flex" flexDirection="column">
          {users.map((u) => (
            <Link to={`/${u.username}`} key={u.id} style={{ textDecoration: "none", color: "inherit" }}>
              <UserRow>
                <Box display="flex" gap={3} flex={1}>
                  <Avatar $url={u.avatar_url} $letter={u.username.charAt(0).toUpperCase()} />
                  <Box display="flex" flexDirection="column" flex={1}>
                    <Box display="flex" justifyContent="space-between" alignItems="flex-start">
                      <Box display="flex" flexDirection="column">
                        <Text style={{ fontWeight: "bold", fontSize: "15px", color: "var(--color-fg-default)" }}>
                          {u.display_name || u.username}
                        </Text>
                        <Text className="handle-text">@{u.username}</Text>
                      </Box>
                      {currentUser?.username !== u.username && (
                        <Box onClick={(e) => e.preventDefault()}>
                          <FollowButton username={u.username} initialIsFollowing={u.is_following} />
                        </Box>
                      )}
                    </Box>
                    {u.bio && (
                      <Text style={{ fontSize: "15px", marginTop: "4px", color: "var(--color-fg-default)" }}>
                        {u.bio}
                      </Text>
                    )}
                  </Box>
                </Box>
              </UserRow>
            </Link>
          ))}
        </Box>
      )}
    </Box>
  );
};

export default FollowersPage;
