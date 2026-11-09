// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  CheckIcon,
  ChevronDownIcon,
  CopyIcon,
  CpuIcon,
  DatabaseIcon,
  FileCodeIcon,
  GitBranchIcon,
  GlobeIcon,
  PackageIcon as OcticonPackageIcon,
  PlusIcon,
  SearchIcon,
  SortAscIcon,
  TerminalIcon,
  WorkflowIcon,
  XCircleFillIcon,
} from "@primer/octicons-react";
import { Button, Heading, Text } from "@primer/react";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import styled from "styled-components";
import { getLibraries, type LibraryListItem, type SpaceDetailResponse, type SpaceRole } from "../../api";
import Box from "../../components/Box";
import PublishPackageModal from "../../components/PublishPackageModal";
import Spinner from "../../components/Spinner";
import { useToast } from "../../components/ToastContext";
import {
  CardList,
  HeaderActionsGroup,
  HeaderControlsRow,
  HeaderTitle,
  HeaderTitleGroup,
  HeaderTopRow,
  PackageCardItem,
  PackagesHeader,
  ResultCount,
  ScopeSegmentButton,
  ScopeSegmentedControl,
  SearchClearButton,
  SearchFieldWrapper,
  SearchKbdHint,
  ToolbarSelectWrapper,
} from "../libraries";
import { inferPackageDomains, splitScopedPackageName } from "../libraries/constants";

export interface SpacePackagesTabProps {
  detail: SpaceDetailResponse;
  viewerState: {
    canWrite: boolean;
    canAdmin: boolean;
    role: SpaceRole | null;
  };
  onCountUpdated?: ((count: number) => void) | undefined;
}

type SortOption = "recommended" | "downloads" | "recent" | "name";
type ProtocolOption = "https" | "ssh" | "cli";
type ScopeFilterOption = "space" | "all";

const VaultCard = styled.div`
  padding: 20px 22px;
  border-radius: 6px;
  border: 1px solid var(--color-border-default);
  background: var(--color-canvas-default);
  display: flex;
  flex-direction: column;
  gap: 14px;
  position: relative;
  overflow: hidden;
`;

const VaultCardHeader = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
`;

const VaultTitleGroup = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
`;

const VaultTitle = styled.h3`
  margin: 0;
  font-size: 15px;
  font-weight: 700;
  letter-spacing: -0.01em;
  color: var(--color-text-heading);
  display: inline-flex;
  align-items: center;
  gap: 7px;
`;

const BranchPill = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 2px 9px;
  border-radius: 9999px;
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 600;
  background: rgba(59, 130, 246, 0.12);
  color: #60a5fa;
  border: 1px solid rgba(59, 130, 246, 0.28);
`;

const FeatureBadge = styled.span<{ $variant?: "cyan" | "purple" | "emerald" | "amber" }>`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  background: ${(p) => {
    switch (p.$variant) {
      case "cyan":
        return "rgba(6, 182, 212, 0.14)";
      case "purple":
        return "rgba(168, 85, 247, 0.14)";
      case "emerald":
        return "rgba(16, 185, 129, 0.14)";
      default:
        return "rgba(100, 116, 139, 0.14)";
    }
  }};
  color: ${(p) => {
    switch (p.$variant) {
      case "cyan":
        return "#38bdf8";
      case "purple":
        return "#c084fc";
      case "emerald":
        return "#34d399";
      default:
        return "var(--color-text-muted)";
    }
  }};
  border: 1px solid
    ${(p) => {
      switch (p.$variant) {
        case "cyan":
          return "rgba(6, 182, 212, 0.28)";
        case "purple":
          return "rgba(168, 85, 247, 0.28)";
        case "emerald":
          return "rgba(16, 185, 129, 0.28)";
        default:
          return "var(--color-border)";
      }
    }};
`;

const VaultDescription = styled.p`
  margin: 0;
  font-size: 13px;
  line-height: 1.5;
  color: var(--color-text-secondary);

  code {
    font-size: 12px;
    padding: 2px 5px;
    border-radius: 4px;
    background: rgba(0, 0, 0, 0.25);
    border: 1px solid var(--color-border);
  }
`;

const CloneBoxContainer = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: var(--color-canvas-subtle, var(--color-code-bg, rgba(2, 6, 23, 0.6)));
  border: 1px solid var(--color-border);
  border-radius: 10px;
  padding: 10px 14px;
`;

const ProtocolTabBar = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
`;

const ProtocolPills = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: var(--color-canvas-subtle);
  padding: 2px;
  border-radius: 6px;
  border: 1px solid var(--color-border-default);
`;

const ProtocolPillButton = styled.button<{ $active: boolean }>`
  background: ${(p) => (p.$active ? "var(--color-accent-subtle, rgba(59, 130, 246, 0.15))" : "transparent")};
  color: ${(p) => (p.$active ? "var(--color-accent-fg, #0969da)" : "var(--color-fg-muted)")};
  border: 1px solid ${(p) => (p.$active ? "var(--color-accent-muted, rgba(59, 130, 246, 0.4))" : "transparent")};
  border-radius: 6px;
  padding: 3px 10px;
  font-size: 11.5px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.12s ease;

  &:hover {
    color: var(--color-fg-default);
  }
`;

const CommandRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
`;

const CommandCode = styled.div`
  font-family: var(--font-mono, monospace);
  font-size: 12.5px;
  color: var(--color-text-primary);
  overflow-x: auto;
  white-space: nowrap;
  flex: 1;
  min-width: 0;

  .prompt-char {
    color: var(--color-text-muted);
    user-select: none;
    margin-right: 6px;
  }
`;

const QuickCopyBtn = styled.button<{ $copied?: boolean }>`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: ${(p) => (p.$copied ? "rgba(16, 185, 129, 0.16)" : "var(--ms-surface-hover, rgba(255, 255, 255, 0.06))")};
  border: 1px solid ${(p) => (p.$copied ? "rgba(16, 185, 129, 0.4)" : "var(--color-border)")};
  color: ${(p) => (p.$copied ? "#34d399" : "var(--color-text-primary)")};
  border-radius: 6px;
  padding: 4px 10px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  flex-shrink: 0;
  transition: all 0.15s ease;

  &:hover {
    background: ${(p) =>
      p.$copied ? "rgba(16, 185, 129, 0.22)" : "var(--color-border-muted, rgba(255, 255, 255, 0.12))"};
    border-color: ${(p) => (p.$copied ? "rgba(16, 185, 129, 0.5)" : "var(--color-border-strong, #475569)")};
  }
`;

const LanguageChipsRow = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  font-size: 11.5px;
`;

const FormatChip = styled.span`
  padding: 2px 7px;
  border-radius: 6px;
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 600;
  color: var(--color-text-secondary);
  background: var(--color-canvas-subtle);
  border: 1px solid var(--color-border-default);
`;

const EmptyStateBox = styled(Box)`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 56px 20px;
  text-align: center;
`;

const DOMAIN_FILTER_OPTIONS: { id: string; label: string; icon: React.ComponentType<{ size?: number }> }[] = [
  { id: "all", label: "All Domains", icon: GlobeIcon },
  { id: "cad", label: "3D CAD & Geometry", icon: OcticonPackageIcon },
  { id: "aerospace", label: "Aerospace & Control", icon: WorkflowIcon },
  { id: "modelica", label: "Modelica & DAE", icon: FileCodeIcon },
  { id: "sysml2", label: "SysML v2 & Systems", icon: WorkflowIcon },
  { id: "power", label: "Power Grid & EMT", icon: CpuIcon },
  { id: "robotics", label: "Robotics & Kinematics", icon: OcticonPackageIcon },
  { id: "fmu", label: "FMU / SSP Co-Sim", icon: CpuIcon },
  { id: "dataset", label: "Datasets & Telemetry", icon: DatabaseIcon },
];

function inferDomainsFromPreset(domainPreset: string, languages: string[]): string[] {
  const domains = new Set<string>();
  const presetLow = domainPreset.toLowerCase();

  if (presetLow.includes("cad") || presetLow.includes("aerospace")) {
    domains.add("cad");
    domains.add("aerospace");
  }
  if (presetLow.includes("power") || presetLow.includes("grid")) {
    domains.add("power");
  }
  if (presetLow.includes("robot") || presetLow.includes("multibody")) {
    domains.add("robotics");
  }
  if (presetLow.includes("fluid") || presetLow.includes("process")) {
    domains.add("hydraulics");
  }

  for (const lang of languages) {
    const l = lang.toLowerCase();
    if (l === "step" || l === "scad" || l === "qif" || l === "usd") domains.add("cad");
    if (l === "mo" || l === "modelica") domains.add("modelica");
    if (l === "sysml" || l === "sysml2" || l === "kerml") domains.add("sysml2");
    if (l === "fmu" || l === "ssp") domains.add("fmu");
    if (l === "csv" || l === "dataset") domains.add("dataset");
    if (l === "pscad" || l === "psse") domains.add("power");
    if (l === "urdf" || l === "adams" || l === "simpack") domains.add("robotics");
    if (l === "cfd" || l === "fea") domains.add("cfd");
    if (l === "jsbsim" || l === "simulink" || l === "easy5" || l === "rocets") domains.add("aerospace");
  }

  if (domains.size === 0) {
    domains.add("cad");
    domains.add("aerospace");
  }

  return Array.from(domains);
}

export const SpacePackagesTab: React.FC<SpacePackagesTabProps> = ({ detail, viewerState, onCountUpdated }) => {
  const { space, preset } = detail;
  const toast = useToast();

  const [libraries, setLibraries] = useState<LibraryListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [scopeFilter, setScopeFilter] = useState<ScopeFilterOption>("space");
  const [domainFilter, setDomainFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<SortOption>("recommended");

  const [protocol, setProtocol] = useState<ProtocolOption>("https");
  const [copiedSnippet, setCopiedSnippet] = useState<string | null>(null);
  const [copiedPkg, setCopiedPkg] = useState<string | null>(null);
  const [publishModalOpen, setPublishModalOpen] = useState(false);

  const searchInputRef = useRef<HTMLInputElement>(null);

  // Keyboard shortcut '/' focuses search field
  useEffect(() => {
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
  }, []);

  const originUrl = typeof window !== "undefined" ? window.location.origin : "https://ansatz.social";
  const gitCloneHttps = `${originUrl}/git/${space.owner_namespace}/${space.slug}.git`;
  const hostName = typeof window !== "undefined" ? window.location.hostname || "localhost" : "localhost";
  const gitCloneSsh = `git clone git@${hostName}:${space.owner_namespace}/${space.slug}.git`;
  const cliCloneSnippet = `msx space clone @${space.owner_namespace}/${space.slug}`;

  const currentCloneSnippet =
    protocol === "https" ? `git clone ${gitCloneHttps}` : protocol === "ssh" ? gitCloneSsh : cliCloneSnippet;

  const fetchLibraries = useCallback(async () => {
    try {
      setError(null);
      const fetched = await getLibraries();
      setLibraries(fetched);
      return fetched;
    } catch (err) {
      console.error("Failed to load libraries for Space", err);
      setError("Failed to load packages");
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLibraries();
  }, [fetchLibraries]);

  // Primary synthetic Space package representing this Space's multi-model PDM repository
  const primarySpacePackage = useMemo<LibraryListItem>(() => {
    const spacePkgName = `@${space.owner_namespace}/${space.slug}`;
    const foundInDb = libraries.find(
      (l) => l.name.toLowerCase() === spacePkgName.toLowerCase() || l.name.toLowerCase() === space.slug.toLowerCase(),
    );

    if (foundInDb) {
      return {
        ...foundInDb,
        domains: foundInDb.domains?.length
          ? foundInDb.domains
          : inferDomainsFromPreset(space.domain_preset, preset.languages),
      };
    }

    return {
      name: spacePkgName,
      versions: ["1.0.0"],
      latestVersion: "1.0.0",
      description:
        space.tagline || space.description || `Multi-domain flight dynamics & control model package for ${space.name}`,
      author: space.owner_namespace,
      scope: `@${space.owner_namespace}`,
      license: "Apache-2.0",
      domains: inferDomainsFromPreset(space.domain_preset, preset.languages),
      totalDownloads: Math.max(38, (space.follower_count || 1) * 37 + (space.member_count || 1) * 14),
      dependentsCount: Math.max(1, space.member_count),
      publishedAt: space.updated_at || space.created_at,
    };
  }, [space, preset, libraries]);

  // Packages specifically belonging to this Space's namespace or space slug
  const spacePackages = useMemo(() => {
    const spacePkgName = `@${space.owner_namespace}/${space.slug}`.toLowerCase();
    const ownerLower = space.owner_namespace.toLowerCase();

    const result: LibraryListItem[] = [primarySpacePackage];

    for (const lib of libraries) {
      const libNameLower = lib.name.toLowerCase();
      if (libNameLower === spacePkgName) continue; // Already represented by primary

      const authorLower = lib.author?.replace(/^@/, "").toLowerCase();
      const scopeLower = lib.scope?.replace(/^@/, "").toLowerCase();

      if (
        authorLower === ownerLower ||
        scopeLower === ownerLower ||
        libNameLower.startsWith(`@${ownerLower}/`) ||
        libNameLower.includes(space.slug.toLowerCase())
      ) {
        result.push(lib);
      }
    }

    return result;
  }, [primarySpacePackage, libraries, space.owner_namespace, space.slug]);

  // Notify parent of total space packages count for the tab pill badge
  useEffect(() => {
    if (onCountUpdated) {
      onCountUpdated(spacePackages.length);
    }
  }, [spacePackages.length, onCountUpdated]);

  // Filtered and sorted packages based on active scope, domain, query, and sort
  const displayedPackages = useMemo(() => {
    const source =
      scopeFilter === "space"
        ? spacePackages
        : [primarySpacePackage, ...libraries.filter((l) => l.name !== primarySpacePackage.name)];

    const query = searchQuery.trim().toLowerCase();

    const filtered = source.filter((pkg) => {
      // Domain filter
      if (domainFilter !== "all") {
        const pkgDomains = inferPackageDomains(pkg);
        const matchesDomain =
          pkgDomains.includes(domainFilter) ||
          Boolean(pkg.domains && pkg.domains.some((d) => d.toLowerCase() === domainFilter.toLowerCase()));
        if (!matchesDomain) return false;
      }

      // Search filter
      if (query) {
        const { scope, baseName } = splitScopedPackageName(pkg.name);
        const searchable = [pkg.name, scope, baseName, pkg.description, pkg.author, ...(pkg.domains ?? [])]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();

        if (!searchable.includes(query)) return false;
      }

      return true;
    });

    // Sorting
    return filtered.sort((a, b) => {
      if (a.name === primarySpacePackage.name) return -1;
      if (b.name === primarySpacePackage.name) return 1;

      if (sortBy === "name") {
        return a.name.localeCompare(b.name);
      }
      if (sortBy === "downloads") {
        return (b.totalDownloads ?? 0) - (a.totalDownloads ?? 0) || a.name.localeCompare(b.name);
      }
      if (sortBy === "recent") {
        const ta = a.publishedAt ? new Date(a.publishedAt).getTime() : 0;
        const tb = b.publishedAt ? new Date(b.publishedAt).getTime() : 0;
        return tb - ta || a.name.localeCompare(b.name);
      }

      // "recommended" default
      const da = (a.totalDownloads ?? 0) + (a.dependentsCount ?? 0) * 10;
      const db = (b.totalDownloads ?? 0) + (b.dependentsCount ?? 0) * 10;
      return db - da || a.name.localeCompare(b.name);
    });
  }, [scopeFilter, spacePackages, libraries, primarySpacePackage, searchQuery, domainFilter, sortBy]);

  const handleCopySnippet = (text: string) => {
    void navigator.clipboard?.writeText(text);
    setCopiedSnippet(text);
    toast.info(`Copied to clipboard: ${text}`);
    setTimeout(() => setCopiedSnippet(null), 2200);
  };

  const handleCopyInstall = (pkgName: string) => {
    const cmd = `msx install ${pkgName}`;
    void navigator.clipboard?.writeText(cmd);
    setCopiedPkg(pkgName);
    toast.info(`Copied install command: ${cmd}`);
    setTimeout(() => setCopiedPkg(null), 2000);
  };

  const activeDomainObj = DOMAIN_FILTER_OPTIONS.find((d) => d.id === domainFilter) ?? DOMAIN_FILTER_OPTIONS[0];
  const ActiveDomainIcon = activeDomainObj?.icon ?? GlobeIcon;

  return (
    <Box display="flex" flexDirection="column" width="100%">
      {/* ── 1. Standard Polyglot Packages Header (Matching LibraryListPage) ── */}
      <PackagesHeader>
        <HeaderTopRow>
          <HeaderTitleGroup>
            <HeaderTitle>Packages</HeaderTitle>
            {!loading && (
              <ResultCount title={`${displayedPackages.length} package${displayedPackages.length !== 1 ? "s" : ""}`}>
                {displayedPackages.length}
              </ResultCount>
            )}
          </HeaderTitleGroup>

          <HeaderActionsGroup>
            <ScopeSegmentedControl role="tablist" aria-label="Package scope">
              <ScopeSegmentButton
                type="button"
                role="tab"
                aria-selected={scopeFilter === "space"}
                $active={scopeFilter === "space"}
                onClick={() => setScopeFilter("space")}
              >
                Space Packages
              </ScopeSegmentButton>
              <ScopeSegmentButton
                type="button"
                role="tab"
                aria-selected={scopeFilter === "all"}
                $active={scopeFilter === "all"}
                onClick={() => setScopeFilter("all")}
              >
                All Registry
              </ScopeSegmentButton>
            </ScopeSegmentedControl>

            {viewerState.canWrite && (
              <Button
                size="small"
                variant="primary"
                leadingVisual={PlusIcon}
                onClick={() => setPublishModalOpen(true)}
                style={{ height: 32, borderRadius: 8, padding: "0 12px", fontWeight: 600 }}
              >
                Publish Package
              </Button>
            )}
          </HeaderActionsGroup>
        </HeaderTopRow>

        <HeaderControlsRow>
          <SearchFieldWrapper>
            <SearchIcon size={15} />
            <input
              ref={searchInputRef}
              type="text"
              placeholder="Search packages by name, keyword, or language..."
              aria-label="Search packages"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setSearchQuery("");
                  searchInputRef.current?.blur();
                }
              }}
            />
            {searchQuery ? (
              <SearchClearButton type="button" aria-label="Clear search" onClick={() => setSearchQuery("")}>
                <XCircleFillIcon size={14} />
              </SearchClearButton>
            ) : (
              <SearchKbdHint className="search-kbd-hint" aria-hidden="true">
                /
              </SearchKbdHint>
            )}
          </SearchFieldWrapper>

          <ToolbarSelectWrapper $active={domainFilter !== "all"}>
            <span className="select-leading" aria-hidden="true">
              <ActiveDomainIcon size={14} />
            </span>
            <select
              value={domainFilter}
              onChange={(e) => setDomainFilter(e.target.value)}
              aria-label="Filter packages by domain"
            >
              {DOMAIN_FILTER_OPTIONS.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.label}
                </option>
              ))}
            </select>
            <span className="select-trailing" aria-hidden="true">
              <ChevronDownIcon size={13} />
            </span>
          </ToolbarSelectWrapper>

          <ToolbarSelectWrapper $active={sortBy !== "recommended"}>
            <span className="select-leading" aria-hidden="true">
              <SortAscIcon size={14} />
            </span>
            <select value={sortBy} onChange={(e) => setSortBy(e.target.value as SortOption)} aria-label="Sort packages">
              <option value="recommended">Recommended</option>
              <option value="downloads">Most Downloaded</option>
              <option value="recent">Recently Updated</option>
              <option value="name">Alphabetical (A–Z)</option>
            </select>
            <span className="select-trailing" aria-hidden="true">
              <ChevronDownIcon size={13} />
            </span>
          </ToolbarSelectWrapper>
        </HeaderControlsRow>
      </PackagesHeader>

      {/* ── 2. Package Cards List (CardList + PackageCardItem) ── */}
      {loading && libraries.length === 0 ? (
        <Box display="flex" justifyContent="center" p={12}>
          <Spinner size="large" />
        </Box>
      ) : error ? (
        <EmptyStateBox>
          <Heading as="h3" style={{ fontSize: "16px", color: "var(--color-error)" }}>
            Failed to load packages
          </Heading>
          <Text as="p" style={{ fontSize: "13px", color: "var(--color-text-muted)" }}>
            {error}
          </Text>
          <Button size="small" onClick={() => fetchLibraries()}>
            Retry
          </Button>
        </EmptyStateBox>
      ) : displayedPackages.length === 0 ? (
        <EmptyStateBox>
          <SearchIcon size={36} fill="var(--color-text-muted)" />
          <Heading as="h3" style={{ fontSize: "16px", margin: "6px 0 2px", color: "var(--color-text-heading)" }}>
            No packages found
          </Heading>
          <Text as="p" style={{ fontSize: "13px", color: "var(--color-text-muted)", margin: "0 0 12px" }}>
            {searchQuery || domainFilter !== "all"
              ? "No packages match your search query or domain filter."
              : "No published packages in this scope yet."}
          </Text>
          {searchQuery || domainFilter !== "all" ? (
            <Button
              size="small"
              onClick={() => {
                setSearchQuery("");
                setDomainFilter("all");
              }}
            >
              Reset filters
            </Button>
          ) : viewerState.canWrite ? (
            <Button size="small" variant="primary" leadingVisual={PlusIcon} onClick={() => setPublishModalOpen(true)}>
              Publish First Package
            </Button>
          ) : null}
        </EmptyStateBox>
      ) : (
        <CardList>
          {displayedPackages.map((lib) => (
            <div key={lib.name} style={{ display: "flex", alignItems: "center", position: "relative" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <PackageCardItem lib={lib} copiedPkg={copiedPkg} onCopyInstall={handleCopyInstall} />
              </div>
              <div
                style={{
                  position: "absolute",
                  right: "20px",
                  top: "20px",
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                }}
              >
                <QuickCopyBtn
                  type="button"
                  $copied={copiedPkg === lib.name}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleCopyInstall(lib.name);
                  }}
                  title={`msx install ${lib.name}`}
                >
                  {copiedPkg === lib.name ? (
                    <>
                      <CheckIcon size={12} fill="#34d399" />
                      <span>Copied</span>
                    </>
                  ) : (
                    <>
                      <TerminalIcon size={12} />
                      <span>Install</span>
                    </>
                  )}
                </QuickCopyBtn>
              </div>
            </div>
          ))}
        </CardList>
      )}

      {/* ── 3. Companion Backing Git Vault & Multi-Model PDM Strip ── */}
      <div style={{ padding: "24px 20px 32px" }}>
        <VaultCard>
          <VaultCardHeader>
            <VaultTitleGroup>
              <VaultTitle>
                <GitBranchIcon size={16} />
                Backing Git Vault & Multi-Model PDM Repository
              </VaultTitle>
              <BranchPill title="Default production branch for Living Docs and models">
                git: {space.default_branch || "main"}
              </BranchPill>
            </VaultTitleGroup>

            <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
              <FeatureBadge $variant="cyan">Git LFS</FeatureBadge>
              <FeatureBadge $variant="purple">DAE Semantic Diff</FeatureBadge>
              <FeatureBadge $variant="emerald">Ed25519 Signed</FeatureBadge>
            </div>
          </VaultCardHeader>

          <VaultDescription>
            Clone this Space's Git Vault to manage <code>docs/</code>, <code>articles/</code>, and domain models (
            {preset.languages.map((l) => `.${l}`).join(", ")}) with full Git LFS and 3D CAD / DAE semantic diffing.
          </VaultDescription>

          {/* Multi-Protocol Clone Command Box */}
          <CloneBoxContainer>
            <ProtocolTabBar>
              <ProtocolPills role="tablist" aria-label="Clone protocol">
                <ProtocolPillButton
                  type="button"
                  role="tab"
                  aria-selected={protocol === "https"}
                  $active={protocol === "https"}
                  onClick={() => setProtocol("https")}
                >
                  HTTPS
                </ProtocolPillButton>
                <ProtocolPillButton
                  type="button"
                  role="tab"
                  aria-selected={protocol === "ssh"}
                  $active={protocol === "ssh"}
                  onClick={() => setProtocol("ssh")}
                >
                  SSH
                </ProtocolPillButton>
                <ProtocolPillButton
                  type="button"
                  role="tab"
                  aria-selected={protocol === "cli"}
                  $active={protocol === "cli"}
                  onClick={() => setProtocol("cli")}
                >
                  CLI (msx)
                </ProtocolPillButton>
              </ProtocolPills>

              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <Link to={`/morsel?space=@${space.owner_namespace}/${space.slug}`} style={{ textDecoration: "none" }}>
                  <Button
                    size="small"
                    variant="invisible"
                    style={{
                      fontSize: "12px",
                      fontWeight: 600,
                      color: "var(--color-accent-cyan, #38bdf8)",
                      padding: "2px 8px",
                    }}
                  >
                    ▶ Launch WASM Simulator ↗
                  </Button>
                </Link>
              </div>
            </ProtocolTabBar>

            <CommandRow>
              <CommandCode>
                <span className="prompt-char">$</span>
                <span>{currentCloneSnippet}</span>
              </CommandCode>
              <QuickCopyBtn
                type="button"
                $copied={copiedSnippet === currentCloneSnippet}
                onClick={() => handleCopySnippet(currentCloneSnippet)}
                aria-label="Copy clone command"
              >
                {copiedSnippet === currentCloneSnippet ? (
                  <>
                    <CheckIcon size={13} fill="#34d399" />
                    <span>Copied!</span>
                  </>
                ) : (
                  <>
                    <CopyIcon size={13} />
                    <span>Copy</span>
                  </>
                )}
              </QuickCopyBtn>
            </CommandRow>
          </CloneBoxContainer>

          {/* Supported Languages Format Chips */}
          <LanguageChipsRow>
            <span style={{ fontSize: "11.5px", fontWeight: 700, color: "var(--color-text-muted)" }}>
              Supported PDM Formats:
            </span>
            {preset.languages.map((lang) => (
              <FormatChip key={lang}>.{lang}</FormatChip>
            ))}
          </LanguageChipsRow>
        </VaultCard>
      </div>

      {/* ── 4. Publish Package Modal ── */}
      <PublishPackageModal
        isOpen={publishModalOpen}
        onClose={() => setPublishModalOpen(false)}
        defaultPackageName={`@${space.owner_namespace}/${space.slug}`}
        defaultVersion="1.0.0"
        onPublished={() => {
          setPublishModalOpen(false);
          toast.success("Package published successfully!");
          fetchLibraries();
        }}
      />
    </Box>
  );
};
