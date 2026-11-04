// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  AlertIcon,
  ChevronDownIcon,
  CpuIcon,
  DatabaseIcon,
  FileCodeIcon,
  GitBranchIcon,
  GlobeIcon,
  LockIcon,
  MarkGithubIcon,
  PackageIcon as OcticonPackageIcon,
  PlusIcon,
  RepoIcon,
  SearchIcon,
  SortAscIcon,
  StarFillIcon,
  StarIcon,
  TrashIcon,
  WorkflowIcon,
  XCircleFillIcon,
} from "@primer/octicons-react";
import { Button, Dialog, Flash, FormControl, Heading, Select, Text, TextInput } from "@primer/react";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import styled from "styled-components";
import { createRepo, deleteRepo, getPopularRepos, getRepoFallbackStars, getRepos } from "../api";
import { useAuth } from "../AuthContext";
import Box from "../components/Box";
import Spinner from "../components/Spinner";
import { useFeatureFlag } from "../FeatureFlagContext";
import { useInstanceBranding } from "../InstanceBrandingContext";
import type { RepositoryDTO } from "../types/api";
import { usePageTitle } from "../util/title";
import {
  CardList,
  FilterPill,
  HeaderActionsGroup,
  HeaderControlsRow,
  HeaderTitle,
  HeaderTitleGroup,
  HeaderTopRow,
  PackagesHeader,
  ResultCount,
  ScopeSegmentButton,
  ScopeSegmentedControl,
  SearchClearButton,
  SearchFieldWrapper,
  SearchKbdHint,
  ToolbarSelectWrapper,
} from "./libraries";
import { getFollowedReposMap } from "./workspace/utils";

/* ─── styled helpers ─── */

const RepoCard = styled.div`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 16px 20px;
  border-bottom: 1px solid var(--color-border);
  transition: background 0.15s ease;
  cursor: pointer;

  &:hover {
    background: var(--surface-row-hover);
  }
`;

const MetaBadge = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  font-weight: 500;
  padding: 2px 8px;
  border-radius: 9999px;
  border: 1px solid var(--color-border);
  color: var(--color-text-muted);
  background: transparent;
  white-space: nowrap;
  flex-shrink: 0;
`;

const TopicTagBadge = styled.span<{ $color?: string; $active?: boolean }>`
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  font-weight: 500;
  padding: 2px 9px;
  border-radius: 9999px;
  border: 1px solid ${({ $active }) => ($active ? "var(--ms-brand, #0f766e)" : "var(--color-border)")};
  background: ${({ $active }) =>
    $active ? "color-mix(in srgb, var(--ms-brand, #0f766e) 12%, transparent)" : "transparent"};
  color: ${({ $active }) => ($active ? "var(--ms-brand, #0f766e)" : "var(--color-text-muted)")};
`;

const ActionPillButton = styled.button<{ $danger?: boolean; $active?: boolean }>`
  background-color: ${({ $active }) =>
    $active ? "color-mix(in srgb, var(--ms-brand, #0f766e) 10%, transparent)" : "transparent"};
  color: ${({ $danger, $active }) =>
    $danger ? "var(--color-danger-fg, #cf222e)" : $active ? "var(--ms-brand, #0f766e)" : "var(--color-text-primary)"};
  border: 1px solid
    ${({ $danger, $active }) =>
      $danger
        ? "color-mix(in srgb, var(--color-danger-fg, #cf222e) 40%, var(--color-border))"
        : $active
          ? "color-mix(in srgb, var(--ms-brand, #0f766e) 45%, var(--color-border))"
          : "var(--color-border)"};
  border-radius: 9999px;
  padding: 6px 13px;
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
    background-color: ${({ $danger }) =>
      $danger ? "rgba(207, 34, 46, 0.08)" : "var(--surface-row-hover, rgba(127, 140, 154, 0.08))"};
  }
`;

const REPO_DOMAIN_OPTIONS: {
  id: string;
  label: string;
  color: string;
  icon: React.ComponentType<{ size?: number | undefined }>;
}[] = [
  { id: "All Domains", label: "All Domains", color: "var(--domain-core)", icon: GlobeIcon },
  { id: "Modelica", label: "Modelica", color: "var(--domain-core)", icon: FileCodeIcon },
  { id: "SysML v2", label: "SysML v2", color: "var(--domain-core)", icon: WorkflowIcon },
  { id: "3D CAD / CSG", label: "3D CAD", color: "var(--domain-cad)", icon: OcticonPackageIcon },
  { id: "FMI / SSP", label: "FMU / SSP", color: "var(--domain-aero)", icon: CpuIcon },
  { id: "CFD / Multiphysics", label: "CFD & Solvers", color: "var(--domain-fluid)", icon: DatabaseIcon },
];

export function inferRepoDomainTags(repo: RepositoryDTO): { label: string; color: string }[] {
  const hay = `${repo.namespace}/${repo.project} ${repo.description || ""}`.toLowerCase();
  const tags: { label: string; color: string }[] = [];
  if (hay.includes("modelica")) tags.push({ label: "Modelica", color: "var(--domain-core)" });
  if (hay.includes("sysml") || hay.includes("kerml")) tags.push({ label: "SysML v2", color: "var(--domain-core)" });
  if (hay.includes("fmi") || hay.includes("fmu") || hay.includes("ssp"))
    tags.push({ label: "FMI / SSP", color: "var(--domain-aero)" });
  if (hay.includes("openscad") || hay.includes("cad") || hay.includes("csg"))
    tags.push({ label: "3D CAD / CSG", color: "var(--domain-cad)" });
  if (hay.includes("su2") || hay.includes("cfd") || hay.includes("aerodynamic"))
    tags.push({ label: "CFD / Multiphysics", color: "var(--domain-fluid)" });
  if (hay.includes("eigen") || hay.includes("linear algebra") || hay.includes("solver"))
    tags.push({ label: "Numerical Solvers", color: "var(--domain-mechanics)" });
  if (hay.includes("graphviz") || hay.includes("svg") || hay.includes("inkscape") || hay.includes("schematic")) {
    tags.push({ label: "Schematic & Vector", color: "var(--domain-core)" });
  }
  if (tags.length === 0) {
    tags.push({ label: "Engineering", color: "var(--domain-core)" });
  }
  return tags.slice(0, 3);
}

export const GitlabSvgIcon: React.FC<{ size?: number }> = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M22.65 14.39L12 22.13 1.35 14.39a.84.84 0 0 1-.3-.94l1.22-3.78 2.44-7.51A.42.42 0 0 1 4.82 2a.43.43 0 0 1 .58 0 .42.42 0 0 1 .11.18l2.44 7.49h8.1l2.44-7.51A.42.42 0 0 1 18.6 2a.43.43 0 0 1 .58 0 .42.42 0 0 1 .11.18l2.44 7.51L23 13.45a.84.84 0 0 1-.35.94z" />
  </svg>
);

function renderRepoDomainGlyph(domainLabel: string, s: number): React.ReactNode {
  switch (domainLabel) {
    case "Modelica":
      return (
        <svg
          width={s}
          height={s}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M2 12h4l2.5-5 3 10 3-10 2.5 5h5" />
        </svg>
      );
    case "SysML v2":
      return (
        <svg
          width={s}
          height={s}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="3" y="3" width="7" height="6" rx="1.5" />
          <rect x="14" y="3" width="7" height="6" rx="1.5" />
          <rect x="8.5" y="15" width="7" height="6" rx="1.5" />
          <path d="M6.5 9v3a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1V9" />
          <line x1="12" y1="13" x2="12" y2="15" />
        </svg>
      );
    case "FMI / SSP":
      return (
        <svg
          width={s}
          height={s}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="4" y="4" width="16" height="16" rx="2" />
          <rect x="9" y="9" width="6" height="6" />
          <path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 14h3M1 9h3M1 14h3" />
        </svg>
      );
    case "3D CAD / CSG":
      return (
        <svg
          width={s}
          height={s}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
          <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
          <line x1="12" y1="22.08" x2="12" y2="12" />
        </svg>
      );
    case "CFD / Multiphysics":
      return (
        <svg
          width={s}
          height={s}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M3 8c3-3 6 3 9 0s6-3 9 0" />
          <path d="M3 13c3-3 6 3 9 0s6-3 9 0" />
          <path d="M3 18c3-3 6 3 9 0s6-3 9 0" />
        </svg>
      );
    case "Numerical Solvers":
      return (
        <svg
          width={s}
          height={s}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M6 4H4v16h2" />
          <path d="M18 4h2v16h-2" />
          <circle cx="9" cy="9" r="1.2" fill="currentColor" />
          <circle cx="15" cy="9" r="1.2" fill="currentColor" />
          <circle cx="9" cy="15" r="1.2" fill="currentColor" />
          <circle cx="15" cy="15" r="1.2" fill="currentColor" />
        </svg>
      );
    case "Schematic & Vector":
      return (
        <svg
          width={s}
          height={s}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="6" cy="6" r="3" />
          <circle cx="18" cy="6" r="3" />
          <circle cx="12" cy="18" r="3" />
          <line x1="8.7" y1="7.5" x2="10.8" y2="15.3" />
          <line x1="15.3" y1="7.5" x2="13.2" y2="15.3" />
          <line x1="9" y1="6" x2="15" y2="6" />
        </svg>
      );
    default:
      return <RepoIcon size={s} />;
  }
}

export interface RepoAvatarBadgeProps {
  url?: string | null | undefined;
  name: string;
  namespace?: string | undefined;
  provider?: string | undefined;
  description?: string | null | undefined;
  size?: number | undefined;
}

export const RepoAvatarBadge: React.FC<RepoAvatarBadgeProps> = ({
  url,
  name,
  namespace = "",
  description = null,
  size = 40,
}) => {
  const [imgFailed, setImgFailed] = useState(false);
  // Ignore human persona portraits (/avatars/...) and generic instance logo (/ms-logo.png) on repositories
  const isPersonaOrGenericLogo = Boolean(
    url && (url.startsWith("/avatars/") || url === "/ms-logo.png" || url === "/ms-logo-light.png"),
  );
  const showImage = Boolean(url && !isPersonaOrGenericLogo && !imgFailed);
  const tags = inferRepoDomainTags({
    id: 0,
    provider: "github",
    namespace,
    project: name,
    description,
  });
  const primaryTag = tags[0] || { label: "Engineering", color: "#0f766e" };
  const glyphSize = Math.round(size * 0.5);

  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: "10px",
        background: showImage
          ? "var(--color-bg-elevated, #f8fafc)"
          : `color-mix(in srgb, ${primaryTag.color} 14%, transparent)`,
        border: showImage
          ? "1px solid var(--color-border)"
          : `1px solid color-mix(in srgb, ${primaryTag.color} 35%, transparent)`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: primaryTag.color,
        flexShrink: 0,
        overflow: "hidden",
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
        renderRepoDomainGlyph(primaryTag.label, glyphSize)
      )}
    </div>
  );
};

function parseRepositoryInput(
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
  } else if (
    host === "ansatz.social" ||
    host.endsWith(".ansatz.social") ||
    host === "modelscript.org" ||
    host.endsWith(".modelscript.org") ||
    host === "localhost" ||
    host.endsWith(".local")
  ) {
    provider = "local";
  } else {
    throw new Error("Supported providers are GitHub, GitLab, or Ansatz Git (owner/repo)");
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
  const hasRepos = useFeatureFlag(["git_repositories", "repositories"]);
  const { token, user } = useAuth();
  const branding = useInstanceBranding();
  const brandName = branding.instanceName || "Ansatz";
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const searchInputRef = useRef<HTMLInputElement>(null);

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

  const [isAdding, setIsAdding] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  // Connect / Create Modal state
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [modalProvider, setModalProvider] = useState<"github" | "gitlab" | "local">("github");
  const [modalRepoInput, setModalRepoInput] = useState("");
  const [modalBranch, setModalBranch] = useState("main");
  const [modalDescription, setModalDescription] = useState("");
  const [modalError, setModalError] = useState<string | null>(null);

  const [followedRepos, setFollowedRepos] = useState<Record<string, boolean>>(() => getFollowedReposMap());

  useEffect(() => {
    if (!hasRepos) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "/" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const active = document.activeElement;
        const tag = active?.tagName.toLowerCase();
        if (
          tag === "input" ||
          tag === "textarea" ||
          tag === "select" ||
          (active as HTMLElement | null)?.isContentEditable
        ) {
          return;
        }
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [hasRepos]);

  useEffect(() => {
    if (!hasRepos) return;
    const syncEngagement = () => {
      setFollowedRepos(getFollowedReposMap());
    };
    window.addEventListener("modelscript:repo-engagement-changed", syncEngagement);
    window.addEventListener("storage", syncEngagement);
    return () => {
      window.removeEventListener("modelscript:repo-engagement-changed", syncEngagement);
      window.removeEventListener("storage", syncEngagement);
    };
  }, [hasRepos]);

  const query = searchParams.get("q") || "";
  const [searchInput, setSearchInput] = useState(query);

  useEffect(() => {
    if (!hasRepos) return;
    setSearchInput(query);
  }, [hasRepos, query]);

  useEffect(() => {
    if (!hasRepos) return;
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
  }, [hasRepos, searchInput, query, searchParams, setSearchParams]);

  useEffect(() => {
    if (!hasRepos) return;
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
  }, [hasRepos, query, token, refreshKey]);

  const activeSourceRepos = useMemo(() => {
    if (activeTab === "my") return myRepos;
    if (activeTab === "starred") {
      return allRepos.filter((r) => Boolean(followedRepos[`${r.namespace}/${r.project}`]));
    }
    return allRepos;
  }, [activeTab, allRepos, myRepos, followedRepos]);

  const hasLocalRepos = useMemo(() => {
    return activeSourceRepos.some((r) => r.provider === "local") || providerFilter === "local";
  }, [activeSourceRepos, providerFilter]);

  const filteredRepos = useMemo(() => {
    const list = activeSourceRepos.filter((r) => {
      if (providerFilter !== "all" && r.provider !== providerFilter) {
        return false;
      }
      if (domainFilter !== "All Domains") {
        const tags = inferRepoDomainTags(r);
        if (
          !tags.some(
            (t) =>
              t.label === domainFilter || (domainFilter === "CFD / Multiphysics" && t.label === "Numerical Solvers"),
          )
        ) {
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

  const clearSearch = () => {
    setSearchInput("");
    const next = new URLSearchParams(searchParams);
    next.delete("q");
    setSearchParams(next, { replace: true });
  };

  const activeDomainObj = REPO_DOMAIN_OPTIONS.find((d) => d.id === domainFilter) ?? REPO_DOMAIN_OPTIONS[0];
  const ActiveDomainIcon = activeDomainObj?.icon ?? GlobeIcon;

  if (!hasRepos) {
    return <Navigate to="/packages" replace />;
  }

  return (
    <Box>
      <PackagesHeader>
        <HeaderTopRow>
          <HeaderTitleGroup>
            <HeaderTitle>Repositories</HeaderTitle>
            {!loading && (
              <ResultCount
                title={`${filteredRepos.length} ${filteredRepos.length === 1 ? "repository" : "repositories"}`}
              >
                {filteredRepos.length}
              </ResultCount>
            )}
          </HeaderTitleGroup>

          <HeaderActionsGroup>
            <ScopeSegmentedControl role="tablist" aria-label="Repository scope">
              <ScopeSegmentButton
                type="button"
                role="tab"
                aria-selected={activeTab === "all"}
                $active={activeTab === "all"}
                onClick={() => setActiveTab("all")}
              >
                All
              </ScopeSegmentButton>
              {token && (
                <ScopeSegmentButton
                  type="button"
                  role="tab"
                  aria-selected={activeTab === "my"}
                  $active={activeTab === "my"}
                  onClick={() => setActiveTab("my")}
                >
                  My Repos
                </ScopeSegmentButton>
              )}
              <ScopeSegmentButton
                type="button"
                role="tab"
                aria-selected={activeTab === "starred"}
                $active={activeTab === "starred"}
                onClick={() => setActiveTab("starred")}
              >
                Starred
              </ScopeSegmentButton>
            </ScopeSegmentedControl>

            <Button
              size="small"
              variant="primary"
              leadingVisual={PlusIcon}
              onClick={() => {
                if (!token) {
                  navigate("/login");
                } else {
                  setModalError(null);
                  setIsCreateModalOpen(true);
                }
              }}
              style={{ height: 32, borderRadius: 8, padding: "0 12px", fontWeight: 600 }}
            >
              Connect Repository
            </Button>
          </HeaderActionsGroup>
        </HeaderTopRow>

        <HeaderControlsRow>
          <SearchFieldWrapper>
            <SearchIcon size={15} />
            <input
              ref={searchInputRef}
              type="text"
              placeholder="Search repositories by name, owner, or domain..."
              aria-label="Search repositories"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  if (searchInput) {
                    clearSearch();
                  } else {
                    searchInputRef.current?.blur();
                  }
                }
              }}
            />
            {searchInput ? (
              <SearchClearButton type="button" aria-label="Clear search" onClick={clearSearch}>
                <XCircleFillIcon size={14} />
              </SearchClearButton>
            ) : (
              <SearchKbdHint className="search-kbd-hint" aria-hidden="true">
                /
              </SearchKbdHint>
            )}
          </SearchFieldWrapper>

          <ToolbarSelectWrapper $active={providerFilter !== "all"}>
            <span className="select-leading" aria-hidden="true">
              {providerFilter === "github" ? (
                <MarkGithubIcon size={14} />
              ) : providerFilter === "gitlab" ? (
                <GitlabSvgIcon size={14} />
              ) : (
                <RepoIcon size={14} />
              )}
            </span>
            <select
              value={providerFilter}
              onChange={(e) => setProviderFilter(e.target.value as "all" | "github" | "gitlab" | "local")}
              aria-label="Filter repositories by provider"
            >
              <option value="all">All Providers</option>
              <option value="github">GitHub</option>
              <option value="gitlab">GitLab</option>
              {hasLocalRepos && <option value="local">{brandName} Git</option>}
            </select>
            <span className="select-trailing" aria-hidden="true">
              <ChevronDownIcon size={13} />
            </span>
          </ToolbarSelectWrapper>

          <ToolbarSelectWrapper $active={domainFilter !== "All Domains"}>
            <span className="select-leading" aria-hidden="true">
              <ActiveDomainIcon size={14} />
            </span>
            <select
              value={domainFilter}
              onChange={(e) => setDomainFilter(e.target.value)}
              aria-label="Filter repositories by domain"
            >
              {REPO_DOMAIN_OPTIONS.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.label}
                </option>
              ))}
            </select>
            <span className="select-trailing" aria-hidden="true">
              <ChevronDownIcon size={13} />
            </span>
          </ToolbarSelectWrapper>

          <ToolbarSelectWrapper $active={sortBy !== "featured"}>
            <span className="select-leading" aria-hidden="true">
              <SortAscIcon size={14} />
            </span>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as "featured" | "name" | "provider")}
              aria-label="Sort repositories"
            >
              <option value="featured">Recommended</option>
              <option value="name">Alphabetical (A–Z)</option>
              <option value="provider">Provider</option>
            </select>
            <span className="select-trailing" aria-hidden="true">
              <ChevronDownIcon size={13} />
            </span>
          </ToolbarSelectWrapper>
        </HeaderControlsRow>
      </PackagesHeader>

      {(addRepoError || statusBanner) && (
        <Box px="20px" pt={3}>
          {addRepoError && (
            <Box mb={2}>
              <Flash variant="danger">{addRepoError}</Flash>
            </Box>
          )}
          {statusBanner && (
            <Box mb={2}>
              <Flash variant="success">{statusBanner}</Flash>
            </Box>
          )}
        </Box>
      )}

      <Box>
        {/* Pinned Personal Activity Git Vault (My Repositories) */}
        {token && user?.username && activeTab === "my" && (
          <Box
            mx="20px"
            mt={3}
            mb={2}
            style={{
              border: "1px solid var(--ms-brand, #0f766e)",
              borderRadius: "12px",
              background: "rgba(15, 118, 110, 0.05)",
              overflow: "hidden",
            }}
          >
            <RepoCard
              style={{ borderBottom: "none" }}
              onClick={() => navigate(`/repos/local/${user.username}/activity`)}
            >
              <Link
                to={`/repos/local/${user.username}/activity`}
                onClick={(e) => e.stopPropagation()}
                style={{
                  textDecoration: "none",
                  color: "inherit",
                  display: "flex",
                  gap: "14px",
                  flex: 1,
                  minWidth: 0,
                }}
              >
                <RepoAvatarBadge url={user.avatar_url} name="activity" />
                <Box flex={1} style={{ minWidth: 0 }}>
                  <Box
                    display="flex"
                    alignItems="center"
                    justifyContent="space-between"
                    gap="12px"
                    style={{ flexWrap: "nowrap", minWidth: 0 }}
                  >
                    <Heading
                      as="h4"
                      style={{
                        fontSize: "16px",
                        fontWeight: 700,
                        margin: 0,
                        color: "var(--color-text-heading)",
                        lineHeight: 1.3,
                        minWidth: 0,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      <span style={{ color: "var(--color-text-muted)", fontWeight: 500 }}>{user.username} / </span>
                      activity
                    </Heading>

                    <Box display="flex" alignItems="center" gap="8px" style={{ flexShrink: 0, whiteSpace: "nowrap" }}>
                      <MetaBadge
                        style={{
                          borderColor: "var(--ms-brand, #0f766e)",
                          color: "var(--ms-brand, #0f766e)",
                          background: "rgba(15, 118, 110, 0.12)",
                        }}
                        title="Strictly private to your account and read-only"
                      >
                        <LockIcon size={12} />
                        Personal Activity Vault
                      </MetaBadge>
                    </Box>
                  </Box>

                  <Text
                    as="p"
                    style={{
                      fontSize: "14px",
                      margin: "6px 0 0 0",
                      color: "var(--color-text-primary)",
                      lineHeight: 1.45,
                    }}
                  >
                    Your personal account activity, authored posts, published libraries, and simulation studies packaged
                    as an owner-authenticated, fast-forwarding Git repository (GDPR Art. 20).
                  </Text>
                </Box>
              </Link>
            </RepoCard>
          </Box>
        )}

        {/* Content */}
        {loading && activeSourceRepos.length === 0 ? (
          <Box display="flex" justifyContent="center" p={12}>
            <Spinner size="large" />
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
                  ? `Connect a GitHub or GitLab repository, create an ${brandName} Git repository, or explore the flagship catalog.`
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
              const domainTags = inferRepoDomainTags(r);
              const repoKey = `${r.namespace}/${r.project}`;
              const repoUrl = `/repos/${r.provider}/${r.namespace}/${r.project}`;
              const isFollowing = Boolean(followedRepos[repoKey]);
              const baseStars = r.star_count ?? r.stars_count ?? r.stargazers_count ?? getRepoFallbackStars(repoKey);
              const starCount = baseStars + (isFollowing ? 1 : 0);

              return (
                <RepoCard key={`${r.provider}-${r.id}-${repoKey}`} onClick={() => navigate(repoUrl)}>
                  <Link
                    to={repoUrl}
                    onClick={(e) => e.stopPropagation()}
                    style={{
                      textDecoration: "none",
                      color: "inherit",
                      display: "flex",
                      gap: "14px",
                      flex: 1,
                      minWidth: 0,
                    }}
                  >
                    <RepoAvatarBadge
                      url={r.avatar_url}
                      name={r.project}
                      namespace={r.namespace}
                      provider={r.provider}
                      description={r.description}
                      size={42}
                    />
                    <Box flex={1} style={{ minWidth: 0 }}>
                      <Box
                        display="flex"
                        alignItems="center"
                        justifyContent="space-between"
                        gap="12px"
                        style={{ flexWrap: "nowrap", minWidth: 0 }}
                      >
                        <Heading
                          as="h4"
                          style={{
                            fontSize: "15.5px",
                            fontWeight: 700,
                            margin: 0,
                            color: "var(--color-text-heading)",
                            lineHeight: 1.3,
                            minWidth: 0,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          <span style={{ color: "var(--color-text-muted)", fontWeight: 500 }}>{r.namespace} / </span>
                          {r.project}
                        </Heading>

                        <Box
                          display="flex"
                          alignItems="center"
                          gap="8px"
                          style={{ flexShrink: 0, whiteSpace: "nowrap" }}
                        >
                          {!isLocal ? (
                            <MetaBadge title={`Hosted on ${r.provider === "gitlab" ? "GitLab" : "GitHub"}`}>
                              {r.provider === "gitlab" ? (
                                <span style={{ color: "#e24329", display: "inline-flex" }}>
                                  <GitlabSvgIcon size={12} />
                                </span>
                              ) : (
                                <MarkGithubIcon size={12} />
                              )}
                              {r.provider === "gitlab" ? "GitLab" : "GitHub"}
                            </MetaBadge>
                          ) : (
                            <MetaBadge title={`Hosted on ${brandName} Git`}>
                              <RepoIcon size={12} />
                              {brandName} Git
                            </MetaBadge>
                          )}

                          <MetaBadge title={`Default branch: ${branch}`} style={{ fontFamily: "var(--font-mono)" }}>
                            <GitBranchIcon size={11} />
                            {branch}
                          </MetaBadge>

                          {activeTab === "my" && token && (
                            <ActionPillButton
                              type="button"
                              $danger
                              title="Unlink repository from My Repositories"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                handleUnlinkRepo(r);
                              }}
                            >
                              <TrashIcon size={14} />
                            </ActionPillButton>
                          )}
                        </Box>
                      </Box>

                      <Text
                        as="p"
                        style={{
                          fontSize: "14px",
                          margin: "6px 0 10px 0",
                          color: "var(--color-text-secondary, var(--color-text-primary))",
                          lineHeight: 1.45,
                        }}
                      >
                        {r.description || "No description provided."}
                      </Text>

                      <Box display="flex" alignItems="center" gap="10px" flexWrap="wrap">
                        <span
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "4px",
                            fontSize: "12px",
                            fontWeight: 600,
                            color: "var(--color-text-muted)",
                          }}
                          title={`${starCount.toLocaleString()} ${starCount === 1 ? "star" : "stars"}`}
                        >
                          {isFollowing ? <StarFillIcon size={12} fill="#eab308" /> : <StarIcon size={12} />}
                          {starCount.toLocaleString()}
                        </span>

                        {domainTags.map((tag) => (
                          <TopicTagBadge key={tag.label} $active={domainFilter === tag.label}>
                            <span
                              style={{
                                width: 6,
                                height: 6,
                                borderRadius: "50%",
                                backgroundColor: tag.color,
                                display: "inline-block",
                              }}
                            />
                            {tag.label}
                          </TopicTagBadge>
                        ))}
                      </Box>
                    </Box>
                  </Link>
                </RepoCard>
              );
            })}
          </CardList>
        )}
      </Box>

      {/* Connect / Create Repository Modal */}
      {isCreateModalOpen && (
        <Dialog
          title="Connect or Create Repository"
          onClose={() => setIsCreateModalOpen(false)}
          sx={{ width: "540px", maxWidth: "95vw" }}
        >
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
                    <Select.Option value="local">{brandName} Git (Hosted Local Repository)</Select.Option>
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
                      ? `Creates or links a native Git repository hosted on this ${brandName} instance.`
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
                      $active={modalRepoInput === preset.slug}
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
