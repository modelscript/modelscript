// SPDX-License-Identifier: AGPL-3.0-or-later

import { AlertIcon, PlusIcon, SearchIcon, ShareIcon, SyncIcon, XCircleFillIcon } from "@primer/octicons-react";
import { Flash, Heading, Spinner, Text, TextInput } from "@primer/react";
import React, { useContext, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import styled from "styled-components";
import { createRepo, getPopularRepos, getRepos } from "../api";
import { useAuth } from "../AuthContext";
import Box from "../components/Box";
import { ComposeContext } from "../components/ComposeContext";
import { CircleIconButton, PageTab as Tab, PageTabBar as TabBar } from "../components/SharedStyles";
import type { RepositoryDTO } from "../types/api";
import { usePageTitle } from "../util/title";

/* ─── styled helpers ─── */

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
  color: var(--color-text-primary);
  outline: none;

  &::placeholder {
    color: var(--color-text-muted);
    opacity: 0.6;
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
  usePageTitle("Repositories");
  const { token } = useAuth();
  const { openCompose } = useContext(ComposeContext);
  const [searchParams, setSearchParams] = useSearchParams();
  const [repos, setRepos] = useState<RepositoryDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [addRepoError, setAddRepoError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"all" | "my">(token ? "my" : "all");
  const [repoInput, setRepoInput] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [followedRepos, setFollowedRepos] = useState<Record<string, boolean>>(() => {
    try {
      const raw = localStorage.getItem("modelscript.followed_repos");
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  });
  const query = searchParams.get("q") || "";
  const [searchInput, setSearchInput] = useState(query);

  useEffect(() => {
    setSearchInput(query);
  }, [query]);

  useEffect(() => {
    const handler = setTimeout(() => {
      if (searchInput.trim() !== query) {
        if (searchInput.trim()) {
          setSearchParams({ q: searchInput.trim() });
        } else {
          setSearchParams({});
        }
      }
    }, 300);
    return () => clearTimeout(handler);
  }, [searchInput, query, setSearchParams]);

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

        const data = activeTab === "all" ? await getPopularRepos(50) : await getRepos();

        let fetchedRepos = data.repos || [];
        if (query) {
          const lowerQuery = query.toLowerCase();
          fetchedRepos = fetchedRepos.filter(
            (r: RepositoryDTO) =>
              r.project.toLowerCase().includes(lowerQuery) ||
              r.namespace.toLowerCase().includes(lowerQuery) ||
              Boolean(r.description && r.description.toLowerCase().includes(lowerQuery)),
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

    const timer = setTimeout(fetchRepos, query ? 300 : 0);
    return () => clearTimeout(timer);
  }, [query, token, activeTab, refreshKey]);

  const handleAddRepo = async (e: React.FormEvent) => {
    e.preventDefault();
    const url = repoInput.trim();
    if (!url || !token) return;

    let provider: string;
    let repo_full_name: string;
    try {
      const parsedUrl = new URL(url.startsWith("http") ? url : "https://" + url);
      const host = parsedUrl.hostname.toLowerCase();
      if (host === "github.com" || host.endsWith(".github.com")) provider = "github";
      else if (host === "gitlab.com" || host.endsWith(".gitlab.com")) provider = "gitlab";
      else throw new Error("Only GitHub and GitLab URLs are supported");

      const parts = parsedUrl.pathname.split("/").filter(Boolean);
      if (parts.length < 2) throw new Error("Invalid repository URL format");
      repo_full_name = `${parts[0]}/${parts[1]}`.replace(/\.git$/, "");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Invalid repository URL";
      setAddRepoError(msg);
      return;
    }

    setIsAdding(true);
    setAddRepoError(null);
    try {
      await createRepo({
        provider,
        repo_full_name,
        external_repo_id: repo_full_name,
      });

      setRepoInput("");
      setRefreshKey((k) => k + 1);
      setActiveTab("my");
    } catch (e: unknown) {
      if (e && typeof e === "object" && "response" in e) {
        const axErr = e as { response?: { data?: { error?: string | undefined } | undefined } | undefined };
        setAddRepoError(axErr.response?.data?.error || "Failed to add repository");
      } else if (e instanceof Error) {
        setAddRepoError(e.message);
      } else {
        setAddRepoError("Failed to add repository");
      }
    } finally {
      setIsAdding(false);
    }
  };

  return (
    <Box>
      <TabBar>
        {token && (
          <Tab $active={activeTab === "my"} onClick={() => setActiveTab("my")}>
            My Repositories
          </Tab>
        )}
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
            onChange={(e) => {
              setRepoInput(e.target.value);
              if (addRepoError) setAddRepoError(null);
            }}
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
        {addRepoError && (
          <Box mb={3}>
            <Flash variant="danger">{addRepoError}</Flash>
          </Box>
        )}

        {/* Search header */}
        <Box
          display="flex"
          alignItems="center"
          justifyContent="space-between"
          flexWrap="wrap"
          gap={3}
          style={{ marginBottom: "24px" }}
        >
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

          <Box style={{ maxWidth: "380px", width: "100%", flex: "1 1 260px" }}>
            <TextInput
              leadingVisual={SearchIcon}
              placeholder="Filter repositories by name or owner..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              trailingAction={
                searchInput ? (
                  <TextInput.Action
                    icon={XCircleFillIcon}
                    aria-label="Clear search"
                    onClick={() => {
                      setSearchInput("");
                      setSearchParams({});
                    }}
                  />
                ) : undefined
              }
              sx={{ width: "100%" }}
            />
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
                borderBottom="1px solid var(--color-border)"
              >
                <Box display="flex" gap="12px" flex={1}>
                  <Box
                    sx={{
                      width: 44,
                      height: 44,
                      borderRadius: "50%",
                      background: "var(--gradient-ai)",
                      boxShadow: "var(--glow-ai-sm)",
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
                      style={{ fontSize: "15px", fontWeight: "bold", margin: 0, color: "var(--color-text-heading)" }}
                    >
                      <Link
                        to={`/repos/${r.provider}/${r.namespace}/${r.project}`}
                        style={{ textDecoration: "none", color: "inherit" }}
                      >
                        {r.project}
                      </Link>
                    </Heading>
                    <Text color="var(--color-text-muted)" style={{ fontSize: "14px", display: "block" }}>
                      {r.provider}.com/{r.namespace}/{r.project}
                    </Text>
                    <Text
                      as="p"
                      style={{
                        fontSize: "14px",
                        margin: "4px 0 0 0",
                        color: "var(--color-text-primary)",
                        lineHeight: 1.4,
                      }}
                    >
                      {r.description || "No description provided."}
                    </Text>
                  </Box>
                </Box>
                <Box display="flex" alignItems="center" gap={2} ml={3}>
                  {openCompose && (
                    <button
                      style={{
                        backgroundColor: "rgba(255, 255, 255, 0.05)",
                        color: "var(--color-text-primary)",
                        border: "1px solid var(--color-border)",
                        borderRadius: "9999px",
                        padding: "6px 12px",
                        fontWeight: 600,
                        fontSize: "13px",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        gap: "6px",
                        transition: "all 0.2s ease",
                      }}
                      title="Share repository to feed"
                      onClick={(e) => {
                        e.preventDefault();
                        openCompose({
                          content: `Check out repository **${r.namespace}/${r.project}**! 🚀`,
                          repoPayload: {
                            namespace: r.namespace,
                            project: r.project,
                            provider: r.provider,
                            description: r.description || undefined,
                          },
                        });
                      }}
                    >
                      <ShareIcon size={14} /> Share
                    </button>
                  )}
                  {(() => {
                    const repoKey = `${r.namespace}/${r.project}`;
                    const isFollowing = Boolean(followedRepos[repoKey]);
                    return (
                      <button
                        type="button"
                        style={{
                          backgroundColor: isFollowing
                            ? "var(--color-btn-secondary-bg, transparent)"
                            : "var(--ms-brand, var(--color-accent-emphasis))",
                          color: isFollowing ? "var(--color-text-primary)" : "#ffffff",
                          border: isFollowing ? "1px solid var(--color-border)" : "1px solid transparent",
                          borderRadius: "9999px",
                          padding: "6px 16px",
                          fontWeight: 700,
                          fontSize: "14px",
                          cursor: "pointer",
                          transition: "all 0.2s ease",
                        }}
                        onClick={(e) => {
                          e.preventDefault();
                          setFollowedRepos((prev) => {
                            const next = { ...prev, [repoKey]: !prev[repoKey] };
                            try {
                              localStorage.setItem("modelscript.followed_repos", JSON.stringify(next));
                            } catch {
                              // Ignore storage error
                            }
                            return next;
                          });
                        }}
                      >
                        {isFollowing ? "Following" : "Follow"}
                      </button>
                    );
                  })()}
                </Box>
              </Box>
            ))}
          </CardList>
        )}
      </Box>
    </Box>
  );
};

export default RepositoryListPage;
