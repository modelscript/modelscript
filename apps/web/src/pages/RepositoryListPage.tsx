/* eslint-disable @typescript-eslint/no-explicit-any */
import { AlertIcon, PlusIcon, SearchIcon, SyncIcon } from "@primer/octicons-react";
import { Heading, Spinner, Text } from "@primer/react";
import React, { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import styled from "styled-components";
import { useAuth } from "../AuthContext";
import Box from "../components/Box";
import { CircleIconButton } from "../components/SharedStyles";
import { API_BASE_URL } from "../config";

/* ─── styled helpers ─── */

const TabBar = styled.div`
  display: flex;
  border-bottom: 1px solid var(--color-border-default);
  position: sticky;
  top: var(--dev-header-height, 0px);
  z-index: 10;
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  background: transparent;

  &::before {
    content: "";
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background-color: var(--color-canvas-default);
    opacity: 0.85;
    z-index: -1;
  }
`;

const Tab = styled.button<{ $active?: boolean }>`
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: none;
  border: none;
  color: ${(props) => (props.$active ? "var(--color-fg-default)" : "var(--color-fg-muted)")};
  font-weight: ${(props) => (props.$active ? "bold" : "normal")};
  cursor: pointer;
  transition: background-color 0.2s;
  position: relative;

  &:hover {
    background-color: var(--color-canvas-subtle);
  }

  &::after {
    content: "";
    position: absolute;
    bottom: 0;
    height: 4px;
    width: 56px;
    background-color: #1f1f1f;
    border-radius: 9999px;
    display: ${(props) => (props.$active ? "block" : "none")};
  }
`;

const ResultCount = styled.span`
  font-size: 14px;
  color: var(--color-text-muted);
  margin-left: 8px;
`;

const CardList = styled.div`
  display: flex;
  flex-direction: column;
`;

const InputSection = styled.form`
  display: flex;
  align-items: center;
  border-bottom: 1px solid var(--color-border);
  height: 56px;
  padding: 0 16px;
`;

const RepoInput = styled.input`
  flex: 1;
  height: 100%;
  border: none;
  background: transparent;
  font-size: 16px;
  color: var(--color-fg-default);
  outline: none;

  &::placeholder {
    color: var(--color-fg-muted);
    opacity: 0.5;
  }
`;

const SpinAnimation = styled.div`
  @keyframes spin {
    100% {
      transform: rotate(360deg);
    }
  }
  animation: spin 1s linear infinite;
  display: flex;
`;

/* ─── main page ─── */

const RepositoryListPage: React.FC = () => {
  const { token } = useAuth();
  const [searchParams] = useSearchParams();
  const [repos, setRepos] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"all" | "my">("my");
  const [repoInput, setRepoInput] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const query = searchParams.get("q") || "";

  useEffect(() => {
    document.title = "Repositories | ModelScript";
  }, []);

  useEffect(() => {
    const fetchRepos = async () => {
      try {
        setLoading(true);
        setError(null);

        if (activeTab === "my" && !token) {
          setRepos([]);
          setLoading(false);
          return;
        }

        const endpoint = activeTab === "all" ? `${API_BASE_URL}/repos/popular?limit=50` : `${API_BASE_URL}/repos`;
        const headers = token ? { Authorization: `Bearer ${token}` } : undefined;
        const res = await fetch(endpoint, { headers });
        if (!res.ok) throw new Error("Failed to load repositories");
        const data = await res.json();

        let fetchedRepos = data.repos || [];
        if (query) {
          const lowerQuery = query.toLowerCase();
          fetchedRepos = fetchedRepos.filter(
            (r: any) => r.project.toLowerCase().includes(lowerQuery) || r.namespace.toLowerCase().includes(lowerQuery),
          );
        }

        setRepos(fetchedRepos);
      } catch (err) {
        setError("Failed to load repositories");
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    const timer = setTimeout(fetchRepos, 300);
    return () => clearTimeout(timer);
  }, [query, token, activeTab, refreshKey]);

  const handleAddRepo = async (e: React.FormEvent) => {
    e.preventDefault();
    const url = repoInput.trim();
    if (!url || !token) return;

    let provider: string;
    let repo_full_name: string;
    try {
      const parsedUrl = new URL(url.startsWith("http") ? url : `https://${url}`);
      if (parsedUrl.hostname.includes("github.com")) provider = "github";
      else if (parsedUrl.hostname.includes("gitlab.com")) provider = "gitlab";
      else throw new Error("Only GitHub and GitLab URLs are supported");

      const parts = parsedUrl.pathname.split("/").filter(Boolean);
      if (parts.length < 2) throw new Error("Invalid repository URL format");
      repo_full_name = `${parts[0]}/${parts[1]}`.replace(/\.git$/, "");
    } catch (err: any) {
      setError(err.message || "Invalid repository URL");
      return;
    }

    setIsAdding(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE_URL}/repos`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          provider,
          repo_full_name,
          external_repo_id: repo_full_name,
        }),
      });

      if (!res.ok) {
        const text = await res.text();
        let data;
        try {
          data = JSON.parse(text);
        } catch {
          data = { error: text || `HTTP Error ${res.status}` };
        }
        setError(data.error || "Failed to add repository");
      } else {
        setRepoInput("");
        setRefreshKey((k) => k + 1);
        setActiveTab("my");
      }
    } catch (e: unknown) {
      const err = e as Error;
      setError(err.message || "An error occurred");
    } finally {
      setIsAdding(false);
    }
  };

  return (
    <Box>
      <TabBar>
        <Tab $active={activeTab === "my"} onClick={() => setActiveTab("my")}>
          My Repositories
        </Tab>
        <Tab $active={activeTab === "all"} onClick={() => setActiveTab("all")}>
          All Repositories
        </Tab>
      </TabBar>

      {token && activeTab === "my" && (
        <InputSection onSubmit={handleAddRepo}>
          <RepoInput
            type="text"
            placeholder="Enter a GitHub or GitLab repository URL"
            value={repoInput}
            onChange={(e) => setRepoInput(e.target.value)}
            disabled={isAdding}
            required
          />
          <CircleIconButton type="submit" disabled={isAdding}>
            {isAdding ? (
              <SpinAnimation>
                <SyncIcon size={16} />
              </SpinAnimation>
            ) : (
              <PlusIcon size={16} />
            )}
          </CircleIconButton>
        </InputSection>
      )}

      <Box p={4}>
        {/* Search header */}
        <Box display="flex" alignItems="center" justifyContent="space-between" style={{ marginBottom: "24px" }}>
          <Box display="flex" alignItems="baseline" gap="8px">
            <Heading as="h1" style={{ color: "var(--color-text-heading)", fontWeight: 800, fontSize: 24, margin: 0 }}>
              Repositories
            </Heading>
            {!loading && (
              <ResultCount>
                {repos.length} repositor{repos.length !== 1 ? "ies" : "y"}
              </ResultCount>
            )}
          </Box>
        </Box>

        {/* Content */}
        {loading && repos.length === 0 ? (
          <Box display="flex" justifyContent="center" p={12}>
            <SpinAnimation>
              <Spinner size="large" />
            </SpinAnimation>
          </Box>
        ) : error ? (
          <Box
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 16,
              padding: 60,
              textAlign: "center",
            }}
          >
            <AlertIcon size={48} fill="var(--color-error)" />
            <Heading as="h2" style={{ color: "var(--color-text-heading)", fontSize: 20, margin: 0 }}>
              Failed to load repositories
            </Heading>
            <Text as="p" style={{ color: "var(--color-text-muted)", fontSize: 14, margin: 0 }}>
              The server may be unavailable. Please try again later.
            </Text>
          </Box>
        ) : repos.length === 0 ? (
          <Box
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 16,
              padding: 60,
              textAlign: "center",
            }}
          >
            <SearchIcon size={48} fill="var(--color-text-muted)" />
            <Heading as="h2" style={{ color: "var(--color-text-heading)", fontSize: 20, margin: 0 }}>
              No repositories found
            </Heading>
            <Text as="p" style={{ color: "var(--color-text-muted)", fontSize: 14, margin: 0 }}>
              {query ? `No results matching "${query}"` : "No repositories have been connected yet."}
            </Text>
          </Box>
        ) : (
          <CardList>
            {repos.map((r) => (
              <Box
                key={r.id}
                display="flex"
                alignItems="flex-start"
                justifyContent="space-between"
                p={3}
                borderBottom="1px solid var(--color-border-subtle)"
              >
                <Box display="flex" gap="12px" flex={1}>
                  <Box
                    sx={{
                      width: 44,
                      height: 44,
                      borderRadius: "50%",
                      backgroundColor: "var(--color-accent-emphasis)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "white",
                      fontWeight: "bold",
                      backgroundSize: "cover",
                      backgroundImage: r.avatar_url ? `url(${r.avatar_url})` : "none",
                      flexShrink: 0,
                    }}
                  >
                    {!r.avatar_url && r.project.charAt(0).toUpperCase()}
                  </Box>
                  <Box flex={1}>
                    <Heading
                      as="h4"
                      style={{ fontSize: "15px", fontWeight: "bold", margin: 0, color: "var(--color-fg-default)" }}
                    >
                      <Link
                        to={`/repos/${r.provider}/${r.namespace}/${r.project}`}
                        style={{ textDecoration: "none", color: "inherit" }}
                      >
                        {r.project}
                      </Link>
                    </Heading>
                    <Text color="var(--color-fg-muted)" style={{ fontSize: "14px", display: "block" }}>
                      @{r.provider}.com/{r.namespace}/{r.project}
                    </Text>
                    <Text
                      as="p"
                      style={{
                        fontSize: "14px",
                        margin: "4px 0 0 0",
                        color: "var(--color-fg-default)",
                        lineHeight: 1.4,
                      }}
                    >
                      {r.description || "No description provided."}
                    </Text>
                  </Box>
                </Box>
                <button
                  style={{
                    backgroundColor: "var(--color-fg-default)",
                    color: "var(--color-canvas-default)",
                    border: "none",
                    borderRadius: "9999px",
                    padding: "6px 16px",
                    fontWeight: "bold",
                    fontSize: "14px",
                    cursor: "pointer",
                    marginLeft: "12px",
                  }}
                  onClick={(e) => {
                    e.preventDefault();
                    const btn = e.currentTarget;
                    if (btn.innerText === "Follow") {
                      btn.innerText = "Following";
                      btn.style.backgroundColor = "transparent";
                      btn.style.color = "var(--color-fg-default)";
                      btn.style.border = "1px solid var(--color-border-default)";
                    } else {
                      btn.innerText = "Follow";
                      btn.style.backgroundColor = "var(--color-fg-default)";
                      btn.style.color = "var(--color-canvas-default)";
                      btn.style.border = "none";
                    }
                  }}
                >
                  Follow
                </button>
              </Box>
            ))}
          </CardList>
        )}
      </Box>
    </Box>
  );
};

export default RepositoryListPage;
