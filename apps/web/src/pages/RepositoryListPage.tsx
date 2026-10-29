// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  AlertIcon,
  CheckIcon,
  CodeIcon,
  CopyIcon,
  FileDirectoryIcon,
  GitBranchIcon,
  LinkExternalIcon,
  MarkGithubIcon,
  PlusIcon,
  RepoIcon,
  SearchIcon,
  ShareIcon,
  StarFillIcon,
  StarIcon,
  SyncIcon,
  TrashIcon,
  XCircleFillIcon,
} from "@primer/octicons-react";
import { Button, Dialog, Flash, FormControl, Heading, Select, Spinner, Text, TextInput } from "@primer/react";
import React, { useContext, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import styled from "styled-components";
import { createRepo, deleteRepo, getPopularRepos, getRepos } from "../api";
import { useAuth } from "../AuthContext";
import Box from "../components/Box";
import { ComposeContext } from "../components/ComposeContext";
import { CircleIconButton, PageTab as Tab, PageTabBar as TabBar } from "../components/SharedStyles";
import type { RepositoryDTO } from "../types/api";
import { usePageTitle } from "../util/title";
import { getFollowedReposMap, setRepoStarred } from "./workspace/utils";

/* ─── styled helpers ─── */

const ResultCount = styled.span`
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text-muted);
  background: var(--color-bg-elevated, rgba(127, 140, 154, 0.12));
  padding: 2px 8px;
  border-radius: 9999px;
`;

const TabCountBadge = styled.span`
  font-size: 11px;
  font-weight: 700;
  padding: 1px 7px;
  border-radius: 9999px;
  margin-left: 6px;
  background: var(--color-bg-elevated, rgba(127, 140, 154, 0.14));
  color: var(--color-text-muted);
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

  @media (max-width: 680px) {
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
  font-size: 12.5px;
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

const TopicTagButton = styled.button<{ $color?: string; $active?: boolean }>`
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  font-weight: 600;
  padding: 2px 9px;
  border-radius: 9999px;
  border: 1px solid ${({ $active }) => ($active ? "var(--ms-brand, #0f766e)" : "transparent")};
  background: ${({ $active }) => ($active ? "rgba(15, 118, 110, 0.18)" : "rgba(15, 118, 110, 0.09)")};
  color: var(--ms-brand, #0f766e);
  cursor: pointer;
  transition: all 0.15s ease;

  &:hover {
    background: rgba(15, 118, 110, 0.16);
  }
`;

const ActionPillButton = styled.button<{ $danger?: boolean }>`
  background-color: transparent;
  color: ${({ $danger }) => ($danger ? "var(--color-danger-fg, #cf222e)" : "var(--color-text-primary)")};
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
    border-color: ${({ $danger }) => ($danger ? "var(--color-danger-fg, #cf222e)" : "var(--color-text-muted)")};
    background-color: ${({ $danger }) => ($danger ? "rgba(207, 34, 46, 0.08)" : "rgba(127, 140, 154, 0.08)")};
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

const ALL_DOMAIN_FILTERS = [
  "All Domains",
  "Modelica",
  "SysML v2",
  "FMI / SSP",
  "3D CAD / CSG",
  "CFD / Multiphysics",
  "Numerical Solvers",
  "Schematic & Vector",
] as const;

export function inferRepoDomainTags(repo: RepositoryDTO): { label: string; color: string }[] {
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

export function parseRepositoryInput(
  rawInput: string,
  fallbackProvider: "github" | "gitlab" | "local" = "github",
): { provider: string; repo_full_name: string } {
  const trimmed = rawInput.trim().replace(/\.git$/i, "");
  if (!trimmed) {
    throw new Error("Please enter a repository URL or owner/name");
  }

  // Shorthand owner/project (e.g. modelica/ModelicaStandardLibrary)
  if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(trimmed) && !trimmed.includes(".com") && !trimmed.includes(".org")) {
    return { provider: fallbackProvider, repo_full_name: trimmed };
  }

  const parsedUrl = new URL(trimmed.startsWith("http") ? trimmed : `https://${trimmed}`);
  const host = parsedUrl.hostname.toLowerCase();
  let provider: string;
  if (host === "github.com" || host.endsWith(".github.com")) {
    provider = "github";
  } else if (host === "gitlab.com" || host.endsWith(".gitlab.com")) {
    provider = "gitlab";
  } else if (host === "modelscript.org" || host === "localhost" || host.endsWith(".local")) {
    provider = "local";
  } else {
    throw new Error("Supported providers are GitHub, GitLab, or ModelScript Git (owner/repo)");
  }

  const parts = parsedUrl.pathname
    .split("/")
    .filter(Boolean)
    .filter((p) => p !== "git" && p !== "repos");
  if (parts.length < 2) {
    throw new Error("Invalid repository URL format (expected owner/project)");
  }
  const repo_full_name = `${parts[0]}/${parts[1]}`.replace(/\.git$/i, "");
  return { provider, repo_full_name };
}

/* ─── main page ─── */

const RepositoryListPage: React.FC = () => {
  usePageTitle("Repositories");
  const { token, user } = useAuth();
  const navigate = useNavigate();
  const { openCompose } = useContext(ComposeContext);
  const [searchParams, setSearchParams] = useSearchParams();

  const initialTabParam = searchParams.get("tab");
  const [activeTab, setActiveTab] = useState<"all" | "my" | "starred">(() => {
    if (initialTabParam === "my" && token) return "my";
    if (initialTabParam === "starred") return "starred";
    return "all";
  });

  const [allRepos, setAllRepos] = useState<RepositoryDTO[]>([]);
  const [myRepos, setMyRepos] = useState<RepositoryDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [addRepoError, setAddRepoError] = useState<string | null>(null);
  const [statusBanner, setStatusBanner] = useState<string | null>(null);

  const [providerFilter, setProviderFilter] = useState<"all" | "github" | "gitlab" | "local">("all");
  const [domainFilter, setDomainFilter] = useState<string>("All Domains");
  const [sortBy, setSortBy] = useState<"featured" | "name" | "provider">("featured");

  const [repoInput, setRepoInput] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [copiedCloneId, setCopiedCloneId] = useState<string | null>(null);

  // Connect / Create Modal state
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [modalProvider, setModalProvider] = useState<"github" | "gitlab" | "local">("github");
  const [modalRepoInput, setModalRepoInput] = useState("");
  const [modalBranch, setModalBranch] = useState("main");
  const [modalDescription, setModalDescription] = useState("");
  const [modalError, setModalError] = useState<string | null>(null);

  const [followedRepos, setFollowedRepos] = useState<Record<string, boolean>>(() => getFollowedReposMap());

  useEffect(() => {
    const syncEngagement = () => {
      setFollowedRepos(getFollowedReposMap());
    };
    window.addEventListener("modelscript:repo-engagement-changed", syncEngagement);
    window.addEventListener("storage", syncEngagement);
    return () => {
      window.removeEventListener("modelscript:repo-engagement-changed", syncEngagement);
      window.removeEventListener("storage", syncEngagement);
    };
  }, []);

  const query = searchParams.get("q") || "";
  const [searchInput, setSearchInput] = useState(query);

  useEffect(() => {
    setSearchInput(query);
  }, [query]);

  useEffect(() => {
    const handler = setTimeout(() => {
      if (searchInput.trim() !== query) {
        const next = new URLSearchParams(searchParams);
        if (searchInput.trim()) {
          next.set("q", searchInput.trim());
        } else {
          next.delete("q");
        }
        setSearchParams(next, { replace: true });
      }
    }, 250);
    return () => clearTimeout(handler);
  }, [searchInput, query, searchParams, setSearchParams]);

  useEffect(() => {
    let cancelled = false;
    const fetchRepos = async () => {
      try {
        setLoading(true);
        setError(null);

        const [popularRes, userRes] = await Promise.all([
          getPopularRepos(50).catch(() => ({ repos: [] as RepositoryDTO[] })),
          token
            ? getRepos().catch(() => ({ repos: [] as RepositoryDTO[] }))
            : Promise.resolve({ repos: [] as RepositoryDTO[] }),
        ]);

        if (cancelled) return;
        const popList = popularRes.repos || [];
        const myList = userRes.repos || [];

        // Merge user's linked repos into allRepos so newly created/linked repos appear in All Repositories too
        const mergedMap = new Map<string, RepositoryDTO>();
        for (const r of popList) {
          mergedMap.set(`${r.provider}:${r.namespace}/${r.project}`.toLowerCase(), r);
        }
        for (const r of myList) {
          const key = `${r.provider}:${r.namespace}/${r.project}`.toLowerCase();
          if (!mergedMap.has(key)) {
            mergedMap.set(key, r);
          }
        }

        setAllRepos(Array.from(mergedMap.values()));
        setMyRepos(myList);
      } catch (err) {
        if (!cancelled) {
          setError("Failed to load repositories");
          console.error(err);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    const timer = setTimeout(fetchRepos, query ? 120 : 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, token, refreshKey]);

  const activeSourceRepos = useMemo(() => {
    if (activeTab === "my") return myRepos;
    if (activeTab === "starred") {
      return allRepos.filter((r) => Boolean(followedRepos[`${r.namespace}/${r.project}`]));
    }
    return allRepos;
  }, [activeTab, allRepos, myRepos, followedRepos]);

  const starredCount = useMemo(() => {
    return allRepos.filter((r) => Boolean(followedRepos[`${r.namespace}/${r.project}`])).length;
  }, [allRepos, followedRepos]);

  const countsByProvider = useMemo(() => {
    let github = 0;
    let gitlab = 0;
    let local = 0;
    for (const r of activeSourceRepos) {
      if (r.provider === "github") github++;
      else if (r.provider === "gitlab") gitlab++;
      else if (r.provider === "local") local++;
    }
    return { all: activeSourceRepos.length, github, gitlab, local };
  }, [activeSourceRepos]);

  const filteredRepos = useMemo(() => {
    const list = activeSourceRepos.filter((r) => {
      if (providerFilter !== "all" && r.provider !== providerFilter) {
        return false;
      }
      if (domainFilter !== "All Domains") {
        const tags = inferRepoDomainTags(r);
        if (!tags.some((t) => t.label === domainFilter)) {
          return false;
        }
      }
      if (!query) return true;
      const lowerQuery = query.toLowerCase();
      const tags = inferRepoDomainTags(r);
      return (
        r.project.toLowerCase().includes(lowerQuery) ||
        r.namespace.toLowerCase().includes(lowerQuery) ||
        r.provider.toLowerCase().includes(lowerQuery) ||
        Boolean(r.description && r.description.toLowerCase().includes(lowerQuery)) ||
        tags.some((t) => t.label.toLowerCase().includes(lowerQuery))
      );
    });

    if (sortBy === "name") {
      return [...list].sort((a, b) => `${a.namespace}/${a.project}`.localeCompare(`${b.namespace}/${b.project}`));
    }
    if (sortBy === "provider") {
      return [...list].sort((a, b) => a.provider.localeCompare(b.provider));
    }
    return list;
  }, [activeSourceRepos, providerFilter, domainFilter, query, sortBy]);

  const detectedInputProvider = useMemo(() => {
    const lower = repoInput.trim().toLowerCase();
    if (!lower) return null;
    if (lower.includes("github.com")) return "github";
    if (lower.includes("gitlab.com")) return "gitlab";
    if (lower.includes("modelscript.org") || lower.startsWith("local:")) return "local";
    if (/^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i.test(lower)) return "github";
    return null;
  }, [repoInput]);

  const handleAddRepo = async (e: React.FormEvent) => {
    e.preventDefault();
    const raw = repoInput.trim();
    if (!raw || !token) return;

    let parsed: { provider: string; repo_full_name: string };
    try {
      parsed = parseRepositoryInput(raw, "github");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Invalid repository URL";
      setAddRepoError(msg);
      return;
    }

    setIsAdding(true);
    setAddRepoError(null);
    setStatusBanner(null);
    try {
      await createRepo({
        provider: parsed.provider,
        repo_full_name: parsed.repo_full_name,
        external_repo_id: parsed.repo_full_name,
      });

      setRepoInput("");
      setRefreshKey((k) => k + 1);
      setActiveTab("my");
      setStatusBanner(`Connected repository ${parsed.repo_full_name}.`);
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

  const handleModalCreateRepo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;

    const raw = modalRepoInput.trim();
    const fallbackOwner = user?.username || "engineering";
    const normalizedInput = modalProvider === "local" && raw && !raw.includes("/") ? `${fallbackOwner}/${raw}` : raw;

    let parsed: { provider: string; repo_full_name: string };
    try {
      parsed = parseRepositoryInput(normalizedInput, modalProvider);
    } catch (err: unknown) {
      setModalError(err instanceof Error ? err.message : "Invalid repository specification");
      return;
    }

    setIsAdding(true);
    setModalError(null);
    setStatusBanner(null);
    try {
      await createRepo({
        provider: parsed.provider,
        repo_full_name: parsed.repo_full_name,
        external_repo_id: parsed.repo_full_name,
        default_branch: modalBranch.trim() || "main",
        description: modalDescription.trim() || undefined,
      });

      setIsCreateModalOpen(false);
      setModalRepoInput("");
      setModalDescription("");
      setModalBranch("main");
      setRefreshKey((k) => k + 1);
      setActiveTab("my");
      setStatusBanner(`Repository ${parsed.repo_full_name} is now linked to your workspace.`);
    } catch (e: unknown) {
      if (e && typeof e === "object" && "response" in e) {
        const axErr = e as { response?: { data?: { error?: string | undefined } | undefined } | undefined };
        setModalError(axErr.response?.data?.error || "Failed to connect repository");
      } else if (e instanceof Error) {
        setModalError(e.message);
      } else {
        setModalError("Failed to connect repository");
      }
    } finally {
      setIsAdding(false);
    }
  };

  const handleUnlinkRepo = async (repo: RepositoryDTO) => {
    try {
      await deleteRepo(String(repo.id));
      setRefreshKey((k) => k + 1);
      setStatusBanner(`Unlinked ${repo.namespace}/${repo.project} from My Repositories.`);
    } catch (err) {
      console.error("Failed to unlink repository", err);
      setAddRepoError("Failed to unlink repository.");
    }
  };

  const handleCopyCloneUrl = (repo: RepositoryDTO, cloneUrl: string) => {
    navigator.clipboard?.writeText(cloneUrl).catch(() => {});
    const idStr = String(repo.id);
    setCopiedCloneId(idStr);
    setTimeout(() => {
      setCopiedCloneId((prev) => (prev === idStr ? null : prev));
    }, 1800);
  };

  return (
    <Box>
      <TabBar>
        <Tab $active={activeTab === "all"} onClick={() => setActiveTab("all")}>
          All Repositories
          {!loading && <TabCountBadge>{allRepos.length}</TabCountBadge>}
        </Tab>
        {token && (
          <Tab $active={activeTab === "my"} onClick={() => setActiveTab("my")}>
            My Repositories
            {!loading && <TabCountBadge>{myRepos.length}</TabCountBadge>}
          </Tab>
        )}
        <Tab $active={activeTab === "starred"} onClick={() => setActiveTab("starred")}>
          Starred
          {!loading && <TabCountBadge>{starredCount}</TabCountBadge>}
        </Tab>
      </TabBar>

      {token && (
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
            placeholder="Quick-connect a GitHub/GitLab URL or owner/repo (e.g. modelica/ModelicaStandardLibrary)..."
            value={repoInput}
            onChange={(e) => {
              setRepoInput(e.target.value);
              if (addRepoError) setAddRepoError(null);
            }}
            disabled={isAdding}
          />
          {detectedInputProvider && (
            <MetaBadge style={{ textTransform: "capitalize" }}>
              {detectedInputProvider === "local" ? "ModelScript Git" : detectedInputProvider}
            </MetaBadge>
          )}
          <CircleIconButton type="submit" disabled={isAdding || !repoInput.trim()} title="Quick connect repository">
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
        {statusBanner && (
          <Box mb={3}>
            <Flash variant="success">{statusBanner}</Flash>
          </Box>
        )}

        {/* Header + Filter & Search Toolbar */}
        <Box
          display="flex"
          alignItems="center"
          justifyContent="space-between"
          flexWrap="wrap"
          gap={3}
          style={{ marginBottom: "14px" }}
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

          <Box
            display="flex"
            alignItems="center"
            gap={2}
            flexWrap="wrap"
            style={{ flex: "1 1 360px", justifyContent: "flex-end" }}
          >
            <Box style={{ maxWidth: "320px", width: "100%", flex: "1 1 220px" }}>
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
                        const next = new URLSearchParams(searchParams);
                        next.delete("q");
                        setSearchParams(next, { replace: true });
                      }}
                    />
                  ) : undefined
                }
                sx={{ width: "100%" }}
              />
            </Box>

            <Select
              aria-label="Sort repositories"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as "featured" | "name" | "provider")}
              sx={{ minWidth: "130px" }}
            >
              <Select.Option value="featured">Sort: Featured</Select.Option>
              <Select.Option value="name">Sort: Name (A–Z)</Select.Option>
              <Select.Option value="provider">Sort: Provider</Select.Option>
            </Select>

            {token && (
              <Button
                variant="primary"
                leadingVisual={PlusIcon}
                onClick={() => {
                  setModalError(null);
                  setIsCreateModalOpen(true);
                }}
              >
                New / Connect
              </Button>
            )}
          </Box>
        </Box>

        {/* Provider & Domain Filter Bars */}
        <Box
          display="flex"
          alignItems="center"
          justifyContent="space-between"
          gap={2}
          flexWrap="wrap"
          style={{ marginBottom: "10px" }}
        >
          <Box display="flex" alignItems="center" gap={2} flexWrap="wrap">
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
            {(countsByProvider.local > 0 || providerFilter === "local") && (
              <FilterPill $active={providerFilter === "local"} onClick={() => setProviderFilter("local")} type="button">
                <RepoIcon size={14} /> ModelScript Git ({countsByProvider.local})
              </FilterPill>
            )}
          </Box>
        </Box>

        <Box display="flex" alignItems="center" gap="6px" flexWrap="wrap" style={{ marginBottom: "20px" }}>
          {ALL_DOMAIN_FILTERS.map((domain) => (
            <FilterPill
              key={domain}
              $active={domainFilter === domain}
              onClick={() => setDomainFilter(domain)}
              type="button"
              style={{ padding: "3px 10px", fontSize: "12px" }}
            >
              {domain}
            </FilterPill>
          ))}
        </Box>

        {/* Content */}
        {loading && activeSourceRepos.length === 0 ? (
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
              gap: 14,
              padding: 60,
              textAlign: "center",
              border: "1px dashed var(--color-border)",
              borderRadius: "12px",
            }}
          >
            <RepoIcon size={42} fill="var(--color-text-muted)" />
            <Heading as="h2" style={{ color: "var(--color-text-heading)", fontSize: 19, margin: 0 }}>
              {activeTab === "my"
                ? "You haven't linked any repositories yet"
                : activeTab === "starred"
                  ? "No starred repositories yet"
                  : "No repositories found"}
            </Heading>
            <Text as="p" style={{ color: "var(--color-text-muted)", fontSize: 14, margin: 0, maxWidth: 460 }}>
              {query || providerFilter !== "all" || domainFilter !== "All Domains"
                ? "No repositories match your active filters. Try clearing your search or domain filters."
                : activeTab === "my"
                  ? "Connect a GitHub or GitLab repository, create a ModelScript Git repository, or explore the flagship catalog."
                  : activeTab === "starred"
                    ? "Star repositories from the catalog or workspace header to bookmark them here."
                    : "No repositories have been connected yet."}
            </Text>
            <Box display="flex" gap={2} mt={2} flexWrap="wrap" justifyContent="center">
              {(query || providerFilter !== "all" || domainFilter !== "All Domains") && (
                <Button
                  onClick={() => {
                    setSearchInput("");
                    setProviderFilter("all");
                    setDomainFilter("All Domains");
                    setSearchParams({}, { replace: true });
                  }}
                >
                  Reset Filters
                </Button>
              )}
              {activeTab !== "all" && (
                <Button variant="primary" onClick={() => setActiveTab("all")}>
                  Explore All Flagship Repositories
                </Button>
              )}
              {token && activeTab === "my" && (
                <Button onClick={() => setIsCreateModalOpen(true)} leadingVisual={PlusIcon}>
                  Connect or Create Repository
                </Button>
              )}
            </Box>
          </Box>
        ) : (
          <CardList>
            {filteredRepos.map((r) => {
              const branch = (r as RepositoryDTO & { default_branch?: string }).default_branch || "main";
              const isLocal = r.provider === "local";
              const externalHost = isLocal ? "modelscript.org" : r.provider === "gitlab" ? "gitlab.com" : "github.com";
              const externalUrl = isLocal
                ? `${window.location.origin}/git/${r.namespace}/${r.project}.git`
                : `https://${externalHost}/${r.namespace}/${r.project}`;
              const cloneUrl = isLocal
                ? `${window.location.origin}/git/${r.namespace}/${r.project}.git`
                : `https://${externalHost}/${r.namespace}/${r.project}.git`;
              const domainTags = inferRepoDomainTags(r);
              const repoKey = `${r.namespace}/${r.project}`;
              const isFollowing = Boolean(followedRepos[repoKey]);

              return (
                <RepoCard key={`${r.provider}-${r.id}-${repoKey}`}>
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
                          ) : r.provider === "local" ? (
                            <RepoIcon size={12} />
                          ) : (
                            <MarkGithubIcon size={12} />
                          )}
                          {r.provider === "gitlab" ? "GitLab" : r.provider === "local" ? "ModelScript Git" : "GitHub"}
                        </MetaBadge>

                        <MetaBadge title={`Default branch: ${branch}`}>
                          <GitBranchIcon size={12} />
                          {branch}
                        </MetaBadge>
                      </Box>

                      <Box display="flex" alignItems="center" gap="10px" mt={1} flexWrap="wrap">
                        {!isLocal ? (
                          <a
                            href={externalUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{
                              fontSize: "12.5px",
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
                        ) : (
                          <span style={{ fontSize: "12.5px", color: "var(--color-text-muted)" }}>
                            /git/{r.namespace}/{r.project}.git
                          </span>
                        )}

                        <button
                          type="button"
                          onClick={() => handleCopyCloneUrl(r, cloneUrl)}
                          title={`Copy Git clone URL: ${cloneUrl}`}
                          style={{
                            border: "none",
                            background: "transparent",
                            color: copiedCloneId === r.id ? "var(--ms-brand, #0f766e)" : "var(--color-text-muted)",
                            fontSize: "12px",
                            fontWeight: 600,
                            cursor: "pointer",
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "4px",
                            padding: "1px 4px",
                          }}
                        >
                          {copiedCloneId === r.id ? <CheckIcon size={12} /> : <CopyIcon size={12} />}
                          {copiedCloneId === r.id ? "Copied URL" : "Clone URL"}
                        </button>
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
                          <TopicTagButton
                            key={tag.label}
                            type="button"
                            $active={domainFilter === tag.label}
                            onClick={() => setDomainFilter((prev) => (prev === tag.label ? "All Domains" : tag.label))}
                            title={`Filter by ${tag.label}`}
                          >
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
                          </TopicTagButton>
                        ))}
                      </Box>
                    </Box>
                  </Box>

                  <Box display="flex" alignItems="center" gap={2} flexWrap="wrap" style={{ flexShrink: 0 }}>
                    <ActionPillButton
                      type="button"
                      title="Browse repository files, issues, pull requests, and CI pipelines"
                      onClick={() => {
                        navigate(`/repos/${r.provider}/${r.namespace}/${r.project}`);
                      }}
                    >
                      <FileDirectoryIcon size={14} /> Browse
                    </ActionPillButton>

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
                      title={isFollowing ? "Remove from Starred repositories" : "Star & follow this repository"}
                      style={{
                        backgroundColor: isFollowing
                          ? "var(--color-btn-secondary-bg, transparent)"
                          : "var(--ms-brand, var(--color-accent-emphasis))",
                        color: isFollowing ? "var(--color-text-primary)" : "#ffffff",
                        border: isFollowing ? "1px solid var(--color-border)" : "1px solid transparent",
                        borderRadius: "9999px",
                        padding: "6px 14px",
                        fontWeight: 700,
                        fontSize: "13px",
                        cursor: "pointer",
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "6px",
                        transition: "all 0.2s ease",
                      }}
                      onClick={(e) => {
                        e.preventDefault();
                        const nextVal = !isFollowing;
                        setRepoStarred(repoKey, nextVal);
                        setFollowedRepos(getFollowedReposMap());
                      }}
                    >
                      {isFollowing ? (
                        <>
                          <StarFillIcon size={14} fill="#eab308" /> Starred
                        </>
                      ) : (
                        <>
                          <StarIcon size={14} /> Star
                        </>
                      )}
                    </button>

                    {activeTab === "my" && token && (
                      <ActionPillButton
                        type="button"
                        $danger
                        title="Unlink repository from My Repositories"
                        onClick={() => handleUnlinkRepo(r)}
                      >
                        <TrashIcon size={14} />
                      </ActionPillButton>
                    )}
                  </Box>
                </RepoCard>
              );
            })}
          </CardList>
        )}
      </Box>

      {/* Connect / Create Repository Modal */}
      {isCreateModalOpen && (
        <Dialog
          isOpen={isCreateModalOpen}
          onDismiss={() => setIsCreateModalOpen(false)}
          aria-labelledby="connect-repo-dialog-title"
          sx={{ width: "540px", maxWidth: "95vw" }}
        >
          <Dialog.Header id="connect-repo-dialog-title">Connect or Create Repository</Dialog.Header>
          <Box p={3}>
            <form onSubmit={handleModalCreateRepo}>
              {modalError && (
                <Box mb={3}>
                  <Flash variant="danger">{modalError}</Flash>
                </Box>
              )}

              <Box mb={3}>
                <FormControl>
                  <FormControl.Label>Repository Provider</FormControl.Label>
                  <Select
                    value={modalProvider}
                    onChange={(e) => setModalProvider(e.target.value as "github" | "gitlab" | "local")}
                    block
                  >
                    <Select.Option value="github">GitHub (github.com)</Select.Option>
                    <Select.Option value="gitlab">GitLab (gitlab.com)</Select.Option>
                    <Select.Option value="local">ModelScript Git (Hosted Local Repository)</Select.Option>
                  </Select>
                </FormControl>
              </Box>

              <Box mb={3}>
                <FormControl required>
                  <FormControl.Label>
                    {modalProvider === "local"
                      ? "Repository Name or Namespace/Project"
                      : "Repository URL or Owner/Project"}
                  </FormControl.Label>
                  <TextInput
                    block
                    placeholder={
                      modalProvider === "local"
                        ? `${user?.username || "engineering"}/ThermalActuatorModel`
                        : modalProvider === "gitlab"
                          ? "https://gitlab.com/libeigen/eigen or libeigen/eigen"
                          : "https://github.com/modelica/ModelicaStandardLibrary"
                    }
                    value={modalRepoInput}
                    onChange={(e) => setModalRepoInput(e.target.value)}
                    required
                  />
                  <FormControl.Caption>
                    {modalProvider === "local"
                      ? "Creates or links a native Git repository hosted on this ModelScript instance."
                      : "Enter a full HTTPS URL or owner/project shorthand."}
                  </FormControl.Caption>
                </FormControl>
              </Box>

              <Box display="grid" gridTemplateColumns="1fr 2fr" style={{ gap: "12px", marginBottom: "16px" }}>
                <FormControl>
                  <FormControl.Label>Default Branch</FormControl.Label>
                  <TextInput
                    block
                    value={modalBranch}
                    onChange={(e) => setModalBranch(e.target.value)}
                    placeholder="main"
                  />
                </FormControl>

                <FormControl>
                  <FormControl.Label>Description (Optional)</FormControl.Label>
                  <TextInput
                    block
                    value={modalDescription}
                    onChange={(e) => setModalDescription(e.target.value)}
                    placeholder="Multi-domain physical system model..."
                  />
                </FormControl>
              </Box>

              <Box
                p={2}
                mb={3}
                style={{
                  background: "var(--color-bg-elevated, rgba(127, 140, 154, 0.06))",
                  borderRadius: "8px",
                  border: "1px solid var(--color-border)",
                }}
              >
                <Text
                  style={{
                    fontSize: "12px",
                    fontWeight: 600,
                    color: "var(--color-text-muted)",
                    display: "block",
                    marginBottom: "6px",
                  }}
                >
                  Quick-fill Flagship Engineering Repositories:
                </Text>
                <Box display="flex" gap="6px" flexWrap="wrap">
                  {[
                    {
                      provider: "github" as const,
                      slug: "modelica/ModelicaStandardLibrary",
                      desc: "Modelica Standard Library",
                    },
                    {
                      provider: "github" as const,
                      slug: "Systems-Modeling/SysML-v2-Release",
                      desc: "OMG SysML v2 Release",
                    },
                    { provider: "gitlab" as const, slug: "libeigen/eigen", desc: "Eigen C++ Linear Algebra" },
                    { provider: "github" as const, slug: "modelica/fmi-standard", desc: "FMI Standard Specification" },
                  ].map((preset) => (
                    <FilterPill
                      key={preset.slug}
                      type="button"
                      onClick={() => {
                        setModalProvider(preset.provider);
                        setModalRepoInput(preset.slug);
                        setModalDescription(preset.desc);
                      }}
                      style={{ fontSize: "11px", padding: "2px 8px" }}
                    >
                      {preset.slug}
                    </FilterPill>
                  ))}
                </Box>
              </Box>

              <Box display="flex" justifyContent="flex-end" gap={2}>
                <Button type="button" onClick={() => setIsCreateModalOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" variant="primary" disabled={isAdding || !modalRepoInput.trim()}>
                  {isAdding ? "Connecting..." : modalProvider === "local" ? "Create Repository" : "Connect Repository"}
                </Button>
              </Box>
            </form>
          </Box>
        </Dialog>
      )}
    </Box>
  );
};

export default RepositoryListPage;
