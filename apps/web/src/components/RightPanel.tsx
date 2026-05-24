/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars, react-hooks/set-state-in-effect */
import { MarkGithubIcon, SearchIcon } from "@primer/octicons-react";
import { Heading, Text } from "@primer/react";
import React, { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import styled from "styled-components";
import { useAuth } from "../AuthContext";
import { API_BASE_URL } from "../config";
import Box from "./Box";
import FollowButton from "./FollowButton";

const PanelContainer = styled.aside`
  width: 350px;
  height: 100vh;
  position: sticky;
  top: 0;
  padding: 12px 24px;
  box-sizing: border-box;

  @media (max-width: 1000px) {
    display: none;
  }
`;

const GitLabIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path
      d="M15.82 7.42L14.07 2.05C13.98 1.77 13.58 1.77 13.49 2.05L11.83 7.15H4.17L2.51 2.05C2.42 1.77 2.02 1.77 1.93 2.05L0.18 7.42C0.09 7.69 0.19 8.01 0.43 8.18L8 13.68L15.57 8.18C15.81 8.01 15.91 7.69 15.82 7.42Z"
      fill="#FC6D26"
    />
    <path d="M8 13.68L4.17 7.15H11.83L8 13.68Z" fill="#E24329" />
    <path
      d="M8 13.68L11.83 7.15H15.57C15.81 8.01 15.91 7.69 15.82 7.42L14.07 2.05C13.98 1.77 13.58 1.77 13.49 2.05L11.83 7.15Z"
      fill="#FCA326"
    />
    <path
      d="M8 13.68L4.17 7.15H0.43C0.19 8.01 0.09 7.69 0.18 7.42L1.93 2.05C2.02 1.77 2.42 1.77 2.51 2.05L4.17 7.15Z"
      fill="#FCA326"
    />
  </svg>
);

const SearchWrapper = styled.div`
  margin-bottom: 16px;
  width: 100%;
  position: relative;
  display: flex;
  align-items: center;

  svg {
    position: absolute;
    left: 16px;
    color: var(--color-fg-muted);
  }

  input {
    width: 100%;
    padding: 12px 16px 12px 42px;
    border-radius: 9999px;
    background-color: var(--color-canvas-subtle);
    border: 1px solid #cfd9de;
    font-size: 15px;
    outline: none;
    box-sizing: border-box;

    &:focus {
      background-color: var(--color-canvas-default);
      border-color: #1d9bf0;
    }
  }
`;

const DropdownWrapper = styled.div`
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  background: var(--color-bg-primary);
  border: 1px solid var(--color-border-subtle);
  border-radius: 12px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  margin-top: 4px;
  z-index: 100;
  max-height: 500px;
  overflow-y: auto;
  overflow-x: hidden;
`;

const DropdownSection = styled.div`
  padding: 8px 0;
  border-bottom: 1px solid var(--color-border-subtle);

  &:last-child {
    border-bottom: none;
  }
`;

const DropdownTitle = styled.div`
  font-size: 13px;
  font-weight: bold;
  color: var(--color-fg-muted);
  padding: 4px 16px;
`;

const DropdownItem = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  cursor: pointer;

  &:hover {
    background-color: var(--color-canvas-subtle);
  }
`;

const Card = styled.div`
  background-color: transparent;
  border: 1px solid var(--color-border-subtle);
  border-radius: 16px;
  padding: 16px;
  margin-bottom: 16px;
`;

const Avatar = styled.div<{ $url?: string; $letter?: string }>`
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background-color: var(--color-done-emphasis);
  background-image: ${(props) => (props.$url ? `url(${props.$url})` : "none")};
  background-size: cover;
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  font-weight: bold;
  flex-shrink: 0;

  &::after {
    content: "${(props) => (!props.$url && props.$letter ? props.$letter : "")}";
  }
`;

const ProviderButton = styled.button`
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  height: 40px;
  background: var(--color-canvas-default);
  color: var(--color-fg-default);
  border: 1px solid #cfd9de;
  border-radius: 9999px;
  font-size: 15px;
  font-weight: bold;
  cursor: pointer;
  transition: background-color 0.2s;
  width: 100%;

  &:hover {
    background: var(--color-canvas-subtle);
  }
`;

const RightPanel: React.FC = () => {
  const { token, user } = useAuth();
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [trending, setTrending] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchCompletions, setSearchCompletions] = useState<{
    topics: any[];
    users: any[];
    packages: any[];
    repositories: any[];
  } | null>(null);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const query = searchParams.get("q") || "";

  const handleSearch = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && searchQuery.trim()) {
      navigate(`/explore?q=${encodeURIComponent(searchQuery.trim())}`);
    }
  };

  useEffect(() => {
    if (query) {
      setSearchQuery(query);
    }
  }, [query]);

  useEffect(() => {
    if (searchQuery.trim().length === 0) {
      setSearchCompletions(null);
      return;
    }

    const timeoutId = setTimeout(async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/search/completions?q=${encodeURIComponent(searchQuery)}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (res.ok) {
          setSearchCompletions(await res.json());
        }
      } catch (err) {
        // ignore
      }
    }, 200);

    return () => clearTimeout(timeoutId);
  }, [searchQuery, token]);

  useEffect(() => {
    async function fetchSuggestions() {
      try {
        const res = await fetch(`${API_BASE_URL}/users/suggestions?limit=3`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (res.ok) {
          const data = await res.json();
          setSuggestions(data.suggestions);
        }
      } catch (err) {
        console.error(err);
      }
    }
    fetchSuggestions();
  }, [token]);

  useEffect(() => {
    async function fetchTrending() {
      try {
        const res = await fetch(`${API_BASE_URL}/social/trending?limit=4`);
        if (res.ok) {
          const data = await res.json();
          setTrending(data.topics);
        }
      } catch (err) {
        console.error(err);
      }
    }
    fetchTrending();
  }, []);

  return (
    <PanelContainer>
      {query ? (
        <Card style={{ padding: "16px" }}>
          <Heading
            as="h3"
            style={{
              fontSize: "18px",
              fontWeight: 800,
              marginBottom: "16px",
              fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
            }}
          >
            Search filters
          </Heading>
          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            <div>
              <Text
                style={{
                  fontWeight: "bold",
                  fontSize: "14px",
                  display: "block",
                  marginBottom: "8px",
                  color: "var(--color-fg-default)",
                }}
              >
                People
              </Text>
              <label
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  fontSize: "14px",
                  cursor: "pointer",
                  marginBottom: "8px",
                  color: "var(--color-fg-default)",
                }}
              >
                <span>From anyone</span>
                <input
                  type="radio"
                  name="people-filter"
                  defaultChecked
                  style={{ accentColor: "#1d9bf0", width: "16px", height: "16px" }}
                />
              </label>
              <label
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  fontSize: "14px",
                  cursor: "pointer",
                  color: "var(--color-fg-default)",
                }}
              >
                <span>People you follow</span>
                <input
                  type="radio"
                  name="people-filter"
                  style={{ accentColor: "#1d9bf0", width: "16px", height: "16px" }}
                />
              </label>
            </div>

            <div style={{ height: "1px", backgroundColor: "var(--color-border-subtle)" }} />

            <div>
              <Text
                style={{
                  fontWeight: "bold",
                  fontSize: "14px",
                  display: "block",
                  marginBottom: "8px",
                  color: "var(--color-fg-default)",
                }}
              >
                Location
              </Text>
              <label
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  fontSize: "14px",
                  cursor: "pointer",
                  marginBottom: "8px",
                  color: "var(--color-fg-default)",
                }}
              >
                <span>Anywhere</span>
                <input
                  type="radio"
                  name="location-filter"
                  defaultChecked
                  style={{ accentColor: "#1d9bf0", width: "16px", height: "16px" }}
                />
              </label>
              <label
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  fontSize: "14px",
                  cursor: "pointer",
                  color: "var(--color-fg-default)",
                }}
              >
                <span>Near you</span>
                <input
                  type="radio"
                  name="location-filter"
                  style={{ accentColor: "#1d9bf0", width: "16px", height: "16px" }}
                />
              </label>
            </div>

            <div style={{ height: "1px", backgroundColor: "var(--color-border-subtle)" }} />

            <a
              href="#advanced"
              style={{ color: "#1d9bf0", textDecoration: "none", fontSize: "14px", fontWeight: "500" }}
            >
              Advanced search
            </a>
          </div>
        </Card>
      ) : (
        <SearchWrapper>
          <SearchIcon size={16} />
          <input
            type="text"
            placeholder="Search ModelScript"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={handleSearch}
          />
          {searchCompletions &&
            (searchCompletions.topics.length > 0 ||
              searchCompletions.users.length > 0 ||
              searchCompletions.packages.length > 0 ||
              searchCompletions.repositories.length > 0) && (
              <DropdownWrapper>
                {searchCompletions.topics.length > 0 && (
                  <DropdownSection>
                    <DropdownTitle>Topics</DropdownTitle>
                    {searchCompletions.topics.map((t, i) => (
                      <DropdownItem
                        key={`topic-${i}`}
                        onClick={() => navigate(`/explore?topic=${encodeURIComponent(t.concept)}`)}
                      >
                        <SearchIcon size={16} />
                        <Text style={{ fontWeight: "bold" }}>{t.display_name}</Text>
                      </DropdownItem>
                    ))}
                  </DropdownSection>
                )}
                {searchCompletions.users.length > 0 && (
                  <DropdownSection>
                    <DropdownTitle>People</DropdownTitle>
                    {searchCompletions.users.map((u, i) => (
                      <DropdownItem key={`user-${i}`} onClick={() => navigate(`/${u.username}`)}>
                        <Avatar $url={u.avatar_url} $letter={u.username.charAt(0).toUpperCase()} />
                        <Box display="flex" flexDirection="column">
                          <Text style={{ fontWeight: "bold", fontSize: "15px" }}>{u.display_name || u.username}</Text>
                          <Text color="var(--color-fg-muted)">@{u.username}</Text>
                        </Box>
                      </DropdownItem>
                    ))}
                  </DropdownSection>
                )}
                {searchCompletions.packages.length > 0 && (
                  <DropdownSection>
                    <DropdownTitle>Packages</DropdownTitle>
                    {searchCompletions.packages.map((p, i) => (
                      <DropdownItem key={`pkg-${i}`} onClick={() => navigate(`/packages/${p.name}`)}>
                        <Box display="flex" flexDirection="column">
                          <Text style={{ fontWeight: "bold", fontSize: "15px" }}>{p.name}</Text>
                          <Text color="var(--color-fg-muted)" style={{ fontSize: "13px" }}>
                            {p.description || "No description"}
                          </Text>
                        </Box>
                      </DropdownItem>
                    ))}
                  </DropdownSection>
                )}
                {searchCompletions.repositories.length > 0 && (
                  <DropdownSection>
                    <DropdownTitle>Repositories</DropdownTitle>
                    {searchCompletions.repositories.map((r, i) => (
                      <DropdownItem
                        key={`repo-${i}`}
                        onClick={() => window.open(`https://gitlab.com/${r.repo_full_name}`, "_blank")}
                      >
                        <Avatar $url={r.avatar_url} $letter={r.project.charAt(0).toUpperCase()} />
                        <Box display="flex" flexDirection="column">
                          <Text style={{ fontWeight: "bold", fontSize: "15px" }}>{r.project}</Text>
                          <Text color="var(--color-fg-muted)" style={{ fontSize: "13px" }}>
                            {r.namespace}
                          </Text>
                        </Box>
                      </DropdownItem>
                    ))}
                  </DropdownSection>
                )}
              </DropdownWrapper>
            )}
        </SearchWrapper>
      )}

      {!user && (
        <Card>
          <Heading as="h2" style={{ fontSize: "20px", marginBottom: "8px", fontWeight: 800 }}>
            New to ModelScript?
          </Heading>
          <Text
            as="p"
            color="var(--color-fg-muted)"
            style={{ fontSize: "14px", marginBottom: "16px", lineHeight: 1.4 }}
          >
            Sign up now to get your own personalized timeline!
          </Text>
          <Box display="flex" flexDirection="column" gap={2}>
            <ProviderButton onClick={() => (window.location.href = "/api/v1/auth/login/github")}>
              <MarkGithubIcon size={16} />
              Sign up with GitHub
            </ProviderButton>
            <ProviderButton onClick={() => (window.location.href = "/api/v1/auth/login/gitlab")}>
              <GitLabIcon />
              Sign up with GitLab
            </ProviderButton>
            <div
              style={{ display: "flex", alignItems: "center", margin: "4px 0", color: "var(--color-border-default)" }}
            >
              <div style={{ flex: 1, borderBottom: "1px solid currentColor" }}></div>
              <span style={{ margin: "0 8px", fontSize: "13px", color: "var(--color-fg-muted)" }}>or</span>
              <div style={{ flex: 1, borderBottom: "1px solid currentColor" }}></div>
            </div>
            <button
              onClick={() => navigate("/signup")}
              style={{
                height: 40,
                backgroundColor: "#1f1f1f",
                color: "#fff",
                border: "none",
                borderRadius: 9999,
                fontSize: 15,
                fontWeight: "bold",
                cursor: "pointer",
                width: "100%",
              }}
            >
              Create account
            </button>
          </Box>
          <Text as="p" color="var(--color-fg-muted)" style={{ fontSize: "12px", marginTop: "16px", lineHeight: 1.4 }}>
            By signing up, you agree to the{" "}
            <a href="#" style={{ color: "#1d9bf0", textDecoration: "none" }}>
              Terms of Service
            </a>{" "}
            and{" "}
            <a href="#" style={{ color: "#1d9bf0", textDecoration: "none" }}>
              Privacy Policy
            </a>
            , including{" "}
            <a href="#" style={{ color: "#1d9bf0", textDecoration: "none" }}>
              Cookie Use
            </a>
            .
          </Text>
        </Card>
      )}

      <Card>
        <Heading
          as="h2"
          style={{
            fontSize: "20px",
            fontWeight: 800,
            marginBottom: "16px",
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
          }}
        >
          What's happening
        </Heading>
        <Box display="flex" flexDirection="column" gap="16px">
          {trending.length > 0 ? (
            trending.map((topic, index) => (
              <Box
                key={topic.id}
                onClick={() => navigate(`/explore?topic=${encodeURIComponent(topic.concept)}`)}
                style={{ cursor: "pointer" }}
              >
                <Text color="var(--color-fg-muted)" sx={{ fontSize: "13px", display: "block", marginBottom: "2px" }}>
                  {index + 1} · Trending
                </Text>
                <Text as="div" sx={{ fontWeight: "bold", fontSize: "15px", color: "var(--color-fg-default)" }}>
                  {topic.display_name}
                </Text>
              </Box>
            ))
          ) : (
            <Text color="var(--color-fg-muted)" sx={{ fontSize: "14px" }}>
              No trending topics yet.
            </Text>
          )}

          <Link to="/explore" style={{ color: "#1d9bf0", textDecoration: "none", fontSize: "15px", marginTop: "8px" }}>
            Show more
          </Link>
        </Box>
      </Card>

      {user && (
        <Card>
          <Heading as="h2" style={{ fontSize: "20px", marginBottom: "16px" }}>
            Who to follow
          </Heading>
          <Box display="flex" flexDirection="column" gap={3}>
            {suggestions.map((u) => (
              <Box key={u.id} display="flex" alignItems="center" justifyContent="space-between">
                <Link
                  to={`/${u.username}`}
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
                  <Avatar $url={u.avatar_url} $letter={u.username.charAt(0).toUpperCase()} />
                  <Box flex={1} minWidth={0} mr={2} display="flex" flexDirection="column">
                    <Text
                      style={{
                        fontWeight: "bold",
                        fontSize: "15px",
                        color: "var(--color-fg-default)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                      title={u.display_name || u.username}
                    >
                      {u.display_name || u.username}
                    </Text>
                    <Text
                      style={{
                        color: "var(--color-fg-muted)",
                        fontSize: "14px",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                      title={`@${u.username}`}
                    >
                      @{u.username}
                    </Text>
                  </Box>
                </Link>
                <div style={{ flexShrink: 0 }}>
                  <FollowButton username={u.username} initialIsFollowing={false} size="small" />
                </div>
              </Box>
            ))}
            {suggestions.length === 0 && (
              <Text color="var(--color-fg-muted)" sx={{ fontSize: "14px" }}>
                No suggestions at this time.
              </Text>
            )}
          </Box>
        </Card>
      )}
    </PanelContainer>
  );
};

export default RightPanel;
