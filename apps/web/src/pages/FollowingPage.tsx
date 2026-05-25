/* eslint-disable */
import { Heading, Spinner, Text } from "@primer/react";
import React, { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import styled from "styled-components";
import { useAuth } from "../AuthContext";
import Box from "../components/Box";
import FollowButton from "../components/FollowButton";
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

const FollowingPage: React.FC = () => {
  const { username } = useParams();
  const { token, user: currentUser } = useAuth();
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const headers: Record<string, string> = {};
        if (token) {
          headers["Authorization"] = `Bearer ${token}`;
        }
        const res = await fetch(`${API_BASE_URL}/users/${username}/following`, { headers });
        if (res.ok) {
          const data = await res.json();
          setUsers(data.following);
        }
      } catch (err) {
        console.error("Failed to load following", err);
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
      >
        <Heading as="h2" style={{ fontSize: "20px" }}>
          @{username} is following
        </Heading>
      </Box>
      {loading ? (
        <Box p={4} display="flex" justifyContent="center">
          <Spinner />
        </Box>
      ) : users.length === 0 ? (
        <Box p={6} textAlign="center">
          <Text style={{ color: "var(--color-fg-muted)", fontSize: "15px" }}>
            @{username} isn't following anyone yet.
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

export default FollowingPage;
