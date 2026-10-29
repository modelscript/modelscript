// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  AlertIcon,
  CodeIcon,
  GitBranchIcon,
  LinkExternalIcon,
  MarkGithubIcon,
  PlusIcon,
  RepoIcon,
  SearchIcon,
  ShareIcon,
  SyncIcon,
  XCircleFillIcon,
} from "@primer/octicons-react";
import { Flash, Heading, Spinner, Text, TextInput } from "@primer/react";
import React, { useContext, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
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
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text-muted);
  background: var(--color-bg-elevated, rgba(127, 140, 154, 0.12));
  padding: 2px 8px;
  border-radius: 9999px;
`;

const CardList = styled.div`
  display: flex;
  flex-direction: column;
`;

const RepoCard = styled.div`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 18px 20px;
  border-bottom: 1px solid var(--color-border);
  transition: background-color 0.15s ease;

  &:hover {
    background-color: var(--color-bg-hover, rgba(127, 140, 154, 0.04));
  }

  @media (max-width: 640px) {
    flex-direction: column;
  }
`;

const InputSection = styled.form`
  display: flex;
  align-items: center;
  gap: 10px;
  border-bottom: 1px solid var(--color-border);
  min-height: 56px;
  padding: 8px 16px;
  background: var(--color-bg-elevated, transparent);
`;

const RepoInput = styled.input`
  flex: 1;
  height: 40px;
  border: none;
  background: transparent;
  font-size: 15px;
  color: var(--color-text-primary);
  outline: none;

  &::placeholder {
    color: var(--color-text-muted);
    opacity: 0.7;
  }
`;

const FilterPill = styled.button<{ $active?: boolean }>`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 12px;
  border-radius: 9999px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
  border: 1px solid ${({ $active }) => ($active ? "var(--ms-brand, #0f766e)" : "var(--color-border)")};
  background: ${({ $active }) => ($active ? "rgba(15, 118, 110, 0.12)" : "transparent")};
  color: ${({ $active }) => ($active ? "var(--ms-brand, #0f766e)" : "var(--color-text-muted)")};

  &:hover {
    border-color: var(--ms-brand, #0f766e);
    color: var(--color-text-heading);
  }
`;

const MetaBadge = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 9999px;
  border: 1px solid var(--color-border);
  color: var(--color-text-muted);
  background: var(--color-bg-elevated, rgba(127, 140, 154, 0.06));
`;

const TopicTag = styled.span<{ $color?: string }>`
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  font-weight: 600;
  padding: 2px 9px;
  border-radius: 9999px;
  background: rgba(15, 118, 110, 0.09);
  color: var(--ms-brand, #0f766e);
`;

const ActionPillButton = styled.button`
  background-color: transparent;
  color: var(--color-text-primary);
  border: 1px solid var(--color-border);
  border-radius: 9999px;
  padding: 6px 12px;
  font-weight: 600;
  font-size: 13px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  transition: all 0.15s ease;
  white-space: nowrap;

  &:hover {
    border-color: var(--color-text-muted);
    background-color: rgba(127, 140, 154, 0.08);
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

function inferRepoDomainTags(repo: RepositoryDTO): { label: string; color: string }[] {
  const hay = `${repo.namespace}/${repo.project} ${repo.description || ""}`.toLowerCase();
  const tags: { label: string; color: string }[] = [];
  if (hay.includes("modelica")) tags.push({ label: "Modelica", color: "#0284c7" });
  if (hay.includes("sysml") || hay.includes("kerml")) tags.push({ label: "SysML v2", color: "#7c3aed" });
  if (hay.includes("fmi") || hay.includes("fmu") || hay.includes("ssp"))
    tags.push({ label: "FMI / SSP", color: "#0f766e" });
  if (hay.includes("openscad") || hay.includes("cad") || hay.includes("csg"))
    tags.push({ label: "3D CAD / CSG", color: "#d97706" });
  if (hay.includes("su2") || hay.includes("cfd") || hay.includes("aerodynamic"))
    tags.push({ label: "CFD / Multiphysics", color: "#2563eb" });
  if (hay.includes("eigen") || hay.includes("linear algebra") || hay.includes("solver"))
    tags.push({ label: "Numerical Solvers", color: "#059669" });
  if (hay.includes("graphviz") || hay.includes("svg") || hay.includes("inkscape") || hay.includes("schematic")) {
    tags.push({ label: "Schematic & Vector", color: "#db2777" });
  }
  if (tags.length === 0) {
    tags.push({ label: "Engineering", color: "#0f766e" });
  }
  return tags.slice(0, 3);
}

const GitlabSvgIcon: React.FC<{ size?: number }> = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M22.65 14.39L12 22.13 1.35 14.39a.84.84 0 0 1-.3-.94l1.22-3.78 2.44-7.51A.42.42 0 0 1 4.82 2a.43.43 0 0 1 .58 0 .42.42 0 0 1 .11.18l2.44 7.49h8.1l2.44-7.51A.42.42 0 0 1 18.6 2a.43.43 0 0 1 .58 0 .42.42 0 0 1 .11.18l2.44 7.51L23 13.45a.84.84 0 0 1-.35.94z" />
  </svg>
);

const RepoAvatarBadge: React.FC<{ url?: string | null; name: string }> = ({ url, name }) => {
  const [imgFailed, setImgFailed] = useState(false);
  const letter = (name || "R").charAt(0).toUpperCase();
  const showImage = Boolean(url && !imgFailed);

  return (
    <div
      style={{
        width: 44,
        height: 44,
        borderRadius: "12px",
        background: showImage
          ? "var(--color-bg-elevated, #f8fafc)"
          : "linear-gradient(135deg, #0f766e 0%, #0284c7 100%)",
        border: "1px solid var(--color-border)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "#ffffff",
        fontWeight: 800,
        fontSize: "18px",
        flexShrink: 0,
        overflow: "hidden",
        boxShadow: "0 1px 3px rgba(0, 0, 0, 0.06)",
      }}
    >
      {showImage ? (
        <img
          src={url!}
          alt={name}
          onError={() => setImgFailed(true)}
          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
        />
      ) : (
        letter
      )}
    </div>
  );
};

/* ─── main page ─── */

const RepositoryListPage: React.FC = () => {
  usePageTitle("Repositories");
  const { token } = useAuth();
  const navigate = useNavigate();
  const { openCompose } = useContext(ComposeContext);
  const [searchParams, setSearchParams] = useSearchParams();
  const [repos, setRepos] = useState<RepositoryDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [addRepoError, setAddRepoError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"all" | "my">(token ? "my" : "all");
  const [providerFilter, setProviderFilter] = useState<"all" | "github" | "gitlab">("all");
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
        setRepos(data.repos || []);
      } catch (err) {
        setError("Failed to load repositories");
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    const timer = setTimeout(fetchRepos, query ? 150 : 0);
    return () => clearTimeout(timer);
  }, [query, token, activeTab, refreshKey]);

  const filteredRepos = useMemo(() => {
    return repos.filter((r) => {
      if (providerFilter !== "all" && r.provider !== providerFilter) {
        return false;
      }
      if (!query) return true;
      const lowerQuery = query.toLowerCase();
      return (
        r.project.toLowerCase().includes(lowerQuery) ||
        r.namespace.toLowerCase().includes(lowerQuery) ||
        r.provider.toLowerCase().includes(lowerQuery) ||
        Boolean(r.description && r.description.toLowerCase().includes(lowerQuery))
      );
    });
  }, [repos, providerFilter, query]);

  const countsByProvider = useMemo(() => {
    let github = 0;
    let gitlab = 0;
    for (const r of repos) {
      if (r.provider === "github") github++;
      else if (r.provider === "gitlab") gitlab++;
    }
    return { all: repos.length, github, gitlab };
  }, [repos]);

  const detectedInputProvider = useMemo(() => {
    const lower = repoInput.trim().toLowerCase();
    if (lower.includes("github.com")) return "github";
    if (lower.includes("gitlab.com")) return "gitlab";
    return null;
  }, [repoInput]);

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
          <Box display="flex" alignItems="center" color="var(--color-text-muted)">
            {detectedInputProvider === "github" ? (
              <MarkGithubIcon size={18} />
            ) : detectedInputProvider === "gitlab" ? (
              <span style={{ color: "#e24329", display: "inline-flex" }}>
                <GitlabSvgIcon size={18} />
              </span>
            ) : (
              <RepoIcon size={18} />
            )}
          </Box>
          <RepoInput
            type="text"
            placeholder="Connect a GitHub or GitLab repository URL (e.g. github.com/modelica/ModelicaStandardLibrary)"
            value={repoInput}
            onChange={(e) => {
              setRepoInput(e.target.value);
              if (addRepoError) setAddRepoError(null);
            }}
            disabled={isAdding}
            required
          />
          {detectedInputProvider && (
            <MetaBadge style={{ textTransform: "capitalize" }}>{detectedInputProvider}</MetaBadge>
          )}
          <CircleIconButton type="submit" disabled={isAdding} title="Connect repository">
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

        {/* Header + Filter & Search Toolbar */}
        <Box
          display="flex"
          alignItems="center"
          justifyContent="space-between"
          flexWrap="wrap"
          gap={3}
          style={{ marginBottom: "16px" }}
        >
          <Box display="flex" alignItems="center" gap="10px" flexWrap="wrap">
            <Heading as="h1" style={{ color: "var(--color-text-heading)", fontWeight: 800, fontSize: 22, margin: 0 }}>
              Repositories
            </Heading>
            {!loading && (
              <ResultCount>
                {filteredRepos.length} {filteredRepos.length === 1 ? "repository" : "repositories"}
              </ResultCount>
            )}
          </Box>

          <Box style={{ maxWidth: "340px", width: "100%", flex: "1 1 260px" }}>
            <TextInput
              leadingVisual={SearchIcon}
              placeholder="Filter by name, owner, or domain..."
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

        {/* Provider Filter Bar */}
        <Box display="flex" alignItems="center" gap={2} flexWrap="wrap" style={{ marginBottom: "20px" }}>
          <FilterPill $active={providerFilter === "all"} onClick={() => setProviderFilter("all")} type="button">
            All Providers ({countsByProvider.all})
          </FilterPill>
          <FilterPill $active={providerFilter === "github"} onClick={() => setProviderFilter("github")} type="button">
            <MarkGithubIcon size={14} /> GitHub ({countsByProvider.github})
          </FilterPill>
          <FilterPill $active={providerFilter === "gitlab"} onClick={() => setProviderFilter("gitlab")} type="button">
            <span style={{ color: "#e24329", display: "inline-flex" }}>
              <GitlabSvgIcon size={14} />
            </span>
            GitLab ({countsByProvider.gitlab})
          </FilterPill>
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
        ) : filteredRepos.length === 0 ? (
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
              {query || providerFilter !== "all"
                ? `No repositories matching your active filters.`
                : "No repositories have been connected yet."}
            </Text>
          </Box>
        ) : (
          <CardList>
            {filteredRepos.map((r) => {
              const branch = (r as RepositoryDTO & { default_branch?: string }).default_branch || "main";
              const externalHost = r.provider === "gitlab" ? "gitlab.com" : "github.com";
              const externalUrl = `https://${externalHost}/${r.namespace}/${r.project}`;
              const domainTags = inferRepoDomainTags(r);
              const repoKey = `${r.namespace}/${r.project}`;
              const isFollowing = Boolean(followedRepos[repoKey]);

              return (
                <RepoCard key={r.id}>
                  <Box display="flex" gap="14px" flex={1} style={{ minWidth: 0 }}>
                    <RepoAvatarBadge url={r.avatar_url} name={r.project} />
                    <Box flex={1} style={{ minWidth: 0 }}>
                      <Box display="flex" alignItems="center" gap="8px" flexWrap="wrap">
                        <Heading
                          as="h4"
                          style={{
                            fontSize: "16px",
                            fontWeight: 700,
                            margin: 0,
                            color: "var(--color-text-heading)",
                            lineHeight: 1.3,
                          }}
                        >
                          <Link
                            to={`/repos/${r.provider}/${r.namespace}/${r.project}`}
                            style={{ textDecoration: "none", color: "inherit" }}
                          >
                            <span style={{ color: "var(--color-text-muted)", fontWeight: 500 }}>{r.namespace} / </span>
                            {r.project}
                          </Link>
                        </Heading>

                        <MetaBadge title={`Hosted on ${externalHost}`}>
                          {r.provider === "gitlab" ? (
                            <span style={{ color: "#e24329", display: "inline-flex" }}>
                              <GitlabSvgIcon size={12} />
                            </span>
                          ) : (
                            <MarkGithubIcon size={12} />
                          )}
                          {r.provider === "gitlab" ? "GitLab" : "GitHub"}
                        </MetaBadge>

                        <MetaBadge title={`Default branch: ${branch}`}>
                          <GitBranchIcon size={12} />
                          {branch}
                        </MetaBadge>
                      </Box>

                      <Box display="flex" alignItems="center" gap="6px" mt={1}>
                        <a
                          href={externalUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{
                            fontSize: "13px",
                            color: "var(--color-text-muted)",
                            textDecoration: "none",
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "4px",
                          }}
                          title={`Open ${externalUrl} in new tab`}
                        >
                          {externalHost}/{r.namespace}/{r.project}
                          <LinkExternalIcon size={12} />
                        </a>
                      </Box>

                      <Text
                        as="p"
                        style={{
                          fontSize: "14px",
                          margin: "8px 0 10px 0",
                          color: "var(--color-text-primary)",
                          lineHeight: 1.45,
                        }}
                      >
                        {r.description || "No description provided."}
                      </Text>

                      <Box display="flex" alignItems="center" gap="6px" flexWrap="wrap">
                        {domainTags.map((tag) => (
                          <TopicTag key={tag.label}>
                            <span
                              style={{
                                width: 7,
                                height: 7,
                                borderRadius: "50%",
                                backgroundColor: tag.color,
                                display: "inline-block",
                              }}
                            />
                            {tag.label}
                          </TopicTag>
                        ))}
                      </Box>
                    </Box>
                  </Box>

                  <Box display="flex" alignItems="center" gap={2} flexWrap="wrap" style={{ flexShrink: 0 }}>
                    <ActionPillButton
                      type="button"
                      title="Open repository in ModelScript Web IDE"
                      onClick={() => {
                        navigate(
                          `/repos/${r.provider}/${r.namespace}/${r.project}/ide?ref=${encodeURIComponent(branch)}`,
                        );
                      }}
                    >
                      <CodeIcon size={14} /> IDE
                    </ActionPillButton>

                    {openCompose && (
                      <ActionPillButton
                        type="button"
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
                      </ActionPillButton>
                    )}

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
                        fontSize: "13px",
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
                  </Box>
                </RepoCard>
              );
            })}
          </CardList>
        )}
      </Box>
    </Box>
  );
};

export default RepositoryListPage;
