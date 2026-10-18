// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  AlertFillIcon,
  AlertIcon,
  CheckIcon,
  CodeIcon,
  CopyIcon,
  CpuIcon,
  DatabaseIcon,
  DesktopDownloadIcon,
  DownloadIcon,
  FileCodeIcon,
  GlobeIcon,
  HourglassIcon,
  LawIcon,
  PackageIcon as OcticonPackageIcon,
  PlusIcon,
  SearchIcon,
  SyncIcon,
  TerminalIcon,
  WorkflowIcon,
  XCircleFillIcon,
  XIcon,
} from "@primer/octicons-react";
import { ActionList, ActionMenu, Button, Flash, Heading, Label, Select, Text, TextInput } from "@primer/react";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import styled from "styled-components";
import type { LibraryListItem, PendingPackageTransfer } from "../api";
import { acceptPackageTransfer, cancelPackageTransfer, getLibraries, getPendingPackageTransfers } from "../api";
import { useAuth } from "../AuthContext";
import Box from "../components/Box";
import PublishPackageModal from "../components/PublishPackageModal";
import { usePageTitle } from "../util/title";
import { encodePackagePath } from "../util/url";

/* ─── styled helpers ─── */

const TabBar = styled.div`
  display: flex;
  border-bottom: 1px solid var(--color-border);
  position: sticky;
  top: var(--dev-header-height, 0px);
  z-index: 10;
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  background: rgba(6, 8, 15, 0.85);
`;

const Tab = styled.button<{ $active?: boolean | undefined }>`
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: none;
  border: none;
  color: ${(props) => (props.$active ? "var(--color-text-heading)" : "var(--color-text-muted)")};
  font-weight: ${(props) => (props.$active ? "700" : "500")};
  cursor: pointer;
  transition:
    background-color 0.2s,
    color 0.2s;
  position: relative;

  &:hover {
    background-color: rgba(255, 255, 255, 0.04);
  }

  &::after {
    content: "";
    position: absolute;
    bottom: 0;
    height: 3px;
    width: 56px;
    background: var(--gradient-cta);
    box-shadow: 0 0 10px rgba(139, 92, 246, 0.5);
    border-radius: 9999px;
    display: ${(props) => (props.$active ? "block" : "none")};
  }
`;

const ResultCount = styled.span`
  font-size: 13px;
  font-family: var(--font-mono);
  color: var(--color-text-muted);
  margin-left: 8px;
`;

const CardList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px 0;
`;

const FilterPillBar = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
`;

const FilterPill = styled.button<{ $active: boolean; $color?: string | undefined }>`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 12px;
  border-radius: 9999px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  border: 1px solid
    ${(p) =>
      p.$active ? p.$color || "var(--color-accent-cyan, #06b6d4)" : "var(--color-border, rgba(255, 255, 255, 0.12))"};
  background: ${(p) => (p.$active ? "rgba(255, 255, 255, 0.08)" : "rgba(255, 255, 255, 0.02)")};
  color: ${(p) => (p.$active ? "var(--color-text-heading)" : "var(--color-text-muted)")};
  transition: all 0.15s ease;

  &:hover {
    border-color: ${(p) => p.$color || "var(--color-accent-cyan, #06b6d4)"};
    color: var(--color-text-primary);
  }
`;

const DomainBadge = styled.span<{ $domain: string }>`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 600;
  background: ${(p) => {
    switch (p.$domain) {
      case "modelica":
        return "rgba(234, 179, 8, 0.12)";
      case "sysml2":
        return "rgba(168, 85, 247, 0.12)";
      case "cad":
        return "rgba(6, 182, 212, 0.12)";
      case "fmu":
        return "rgba(244, 63, 94, 0.12)";
      case "dataset":
        return "rgba(59, 130, 246, 0.12)";
      default:
        return "rgba(156, 163, 175, 0.12)";
    }
  }};
  color: ${(p) => {
    switch (p.$domain) {
      case "modelica":
        return "#eab308";
      case "sysml2":
        return "#c084fc";
      case "cad":
        return "#06b6d4";
      case "fmu":
        return "#f43f5e";
      case "dataset":
        return "#60a5fa";
      default:
        return "#9ca3af";
    }
  }};
`;

const DOMAIN_OPTIONS: {
  id: string;
  label: string;
  color: string;
  icon: React.ComponentType<{ size?: number | undefined }>;
}[] = [
  { id: "all", label: "All Domains", color: "#06b6d4", icon: GlobeIcon },
  { id: "modelica", label: "Modelica", color: "#eab308", icon: FileCodeIcon },
  { id: "sysml2", label: "SysML v2", color: "#a855f7", icon: WorkflowIcon },
  { id: "cad", label: "3D CAD", color: "#06b6d4", icon: OcticonPackageIcon },
  { id: "fmu", label: "FMU", color: "#f43f5e", icon: CpuIcon },
  { id: "dataset", label: "Datasets", color: "#3b82f6", icon: DatabaseIcon },
];

function formatDomainLabel(domain: string): string {
  switch (domain) {
    case "modelica":
      return "Modelica";
    case "sysml2":
      return "SysML v2";
    case "cad":
      return "3D CAD";
    case "fmu":
      return "FMU";
    case "dataset":
      return "Dataset";
    default:
      return domain;
  }
}

function formatTimeAgo(dateStr?: string | null): string {
  if (!dateStr) return "";
  try {
    const diffMs = Date.now() - new Date(dateStr).getTime();
    const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    if (days < 1) return "updated today";
    if (days === 1) return "updated yesterday";
    if (days < 30) return `updated ${days}d ago`;
    if (days < 365) return `updated ${Math.floor(days / 30)}mo ago`;
    return `updated ${Math.floor(days / 365)}y ago`;
  } catch {
    return "";
  }
}

const PackageIcon = ({ name, version }: { name: string; version: string }) => {
  const [error, setError] = useState(false);
  const rootClassName = name.includes("/") ? name.split("/")[1]! : name;
  const iconUrl = `/api/v1/libraries/${encodePackagePath(name)}/${encodeURIComponent(version)}/classes/${encodeURIComponent(rootClassName)}/icon.svg`;

  if (error) {
    return (
      <Box
        sx={{
          width: 44,
          height: 44,
          borderRadius: "10px",
          background: "var(--gradient-icon-box)",
          border: "1px solid var(--gradient-icon-box-border)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: "18px",
          flexShrink: 0,
          boxShadow: "var(--glow-ai-sm)",
        }}
      >
        📦
      </Box>
    );
  }

  return (
    <img
      src={iconUrl}
      alt={`${name} icon`}
      style={{ width: 40, height: 40, borderRadius: "8px", flexShrink: 0, objectFit: "contain" }}
      onError={() => setError(true)}
    />
  );
};

import { filterAndSortLibraries, type SortOption } from "../util/package-helpers";

/* ─── main page ─── */

const LibraryListPage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [libraries, setLibraries] = useState<LibraryListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const query = searchParams.get("q") || "";
  const [searchInput, setSearchInput] = useState(query);
  const [activeTab, setActiveTab] = useState<"all" | "my">("all");
  const [domainFilter, setDomainFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<SortOption>("downloads");
  const [publishModalOpen, setPublishModalOpen] = useState(false);
  const [copiedPkg, setCopiedPkg] = useState<string | null>(null);

  // Pending ownership transfers state
  const [pendingTransfers, setPendingTransfers] = useState<PendingPackageTransfer[]>([]);
  const [transferBusyId, setTransferBusyId] = useState<number | null>(null);
  const [transferFeedback, setTransferFeedback] = useState<{ type: "success" | "danger"; message: string } | null>(
    null,
  );

  usePageTitle("Packages");

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

  const fetchLibraries = useCallback(async () => {
    const libs = await getLibraries(query);
    setLibraries(libs);
    return libs;
  }, [query]);

  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout>;

    const load = async () => {
      try {
        const libs = await fetchLibraries();

        // If any library is processing, poll again after 2 seconds
        const isProcessing = libs.some(
          (lib) => lib.jobStatus?.status === "pending" || lib.jobStatus?.status === "processing",
        );
        if (isProcessing) {
          timeoutId = setTimeout(load, 2000);
        }
      } catch (err) {
        setError("Failed to load libraries");
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    setLoading(true);
    const initialDelay = setTimeout(load, 300);

    return () => {
      clearTimeout(initialDelay);
      clearTimeout(timeoutId);
    };
  }, [fetchLibraries]);

  const fetchPendingTransfers = useCallback(async () => {
    if (!user) {
      setPendingTransfers([]);
      return;
    }
    try {
      const transfers = await getPendingPackageTransfers();
      setPendingTransfers(transfers);
    } catch {
      // Ignore unauthenticated or transient errors
    }
  }, [user]);

  useEffect(() => {
    fetchPendingTransfers();
  }, [fetchPendingTransfers]);

  const handleAcceptTransfer = async (transfer: PendingPackageTransfer) => {
    setTransferBusyId(transfer.id);
    setTransferFeedback(null);
    try {
      await acceptPackageTransfer(transfer.package_name, transfer.id);
      setTransferFeedback({
        type: "success",
        message: `You are now the owner of ${transfer.package_name}.`,
      });
      await Promise.all([fetchPendingTransfers(), fetchLibraries()]);
    } catch (err: unknown) {
      const e = err as {
        response?: { data?: { error?: string | undefined } | undefined } | undefined;
        message?: string | undefined;
      };
      setTransferFeedback({
        type: "danger",
        message: e.response?.data?.error || e.message || "Failed to accept ownership transfer.",
      });
    } finally {
      setTransferBusyId(null);
    }
  };

  const handleCancelTransfer = async (transfer: PendingPackageTransfer) => {
    setTransferBusyId(transfer.id);
    setTransferFeedback(null);
    try {
      await cancelPackageTransfer(transfer.package_name, transfer.id);
      setTransferFeedback({
        type: "success",
        message: `Ownership transfer for ${transfer.package_name} has been cancelled.`,
      });
      await fetchPendingTransfers();
    } catch (err: unknown) {
      const e = err as {
        response?: { data?: { error?: string | undefined } | undefined } | undefined;
        message?: string | undefined;
      };
      setTransferFeedback({
        type: "danger",
        message: e.response?.data?.error || e.message || "Failed to cancel ownership transfer.",
      });
    } finally {
      setTransferBusyId(null);
    }
  };

  const displayedLibraries = useMemo(
    () =>
      filterAndSortLibraries(libraries, {
        activeTab,
        username: user?.username,
        domainFilter,
        sortBy,
      }),
    [libraries, activeTab, user?.username, domainFilter, sortBy],
  );

  const handleCopyInstall = (pkgName: string) => {
    navigator.clipboard.writeText(`msx install ${pkgName}`);
    setCopiedPkg(pkgName);
    setTimeout(() => setCopiedPkg(null), 2000);
  };

  return (
    <Box>
      <TabBar>
        <Tab $active={activeTab === "all"} onClick={() => setActiveTab("all")}>
          All Packages
        </Tab>
        <Tab $active={activeTab === "my"} onClick={() => setActiveTab("my")}>
          My Packages
          {pendingTransfers.length > 0 && (
            <Label variant="attention" style={{ marginLeft: 8, fontSize: 11 }}>
              {pendingTransfers.length}
            </Label>
          )}
        </Tab>
      </TabBar>

      <Box p={4}>
        {/* Pending Ownership Transfers Inbox Banner */}
        {transferFeedback && (
          <Box mb={3}>
            <Flash variant={transferFeedback.type} onDismiss={() => setTransferFeedback(null)}>
              {transferFeedback.message}
            </Flash>
          </Box>
        )}

        {user && pendingTransfers.length > 0 && (
          <Box
            mb={4}
            p={3}
            style={{
              borderRadius: 12,
              background: "rgba(139, 92, 246, 0.08)",
              border: "1px solid rgba(139, 92, 246, 0.35)",
              display: "flex",
              flexDirection: "column",
              gap: 10,
            }}
          >
            <Box display="flex" alignItems="center" justifyContent="space-between">
              <Text style={{ fontWeight: 700, fontSize: 14, color: "var(--color-text-heading)" }}>
                Pending Package Ownership Transfers ({pendingTransfers.length})
              </Text>
            </Box>
            {pendingTransfers.map((tr) => {
              const isIncoming = tr.to_user_id === user.id || tr.to_username === user.username;
              const isBusy = transferBusyId === tr.id;
              return (
                <Box
                  key={tr.id}
                  display="flex"
                  alignItems="center"
                  justifyContent="space-between"
                  flexWrap="wrap"
                  gap={2}
                  p={2}
                  style={{
                    borderRadius: 8,
                    background: "rgba(6, 8, 15, 0.55)",
                    border: "1px solid var(--color-border)",
                  }}
                >
                  <Box display="flex" alignItems="center" gap={2}>
                    <SyncIcon size={16} fill="#a855f7" />
                    {isIncoming ? (
                      <Text style={{ fontSize: 13, color: "var(--color-text-primary)" }}>
                        <strong>@{tr.from_username || "User"}</strong> invited you to accept ownership of{" "}
                        <Link
                          to={`/packages/${tr.package_name}`}
                          style={{ color: "var(--color-accent-cyan, #06b6d4)", fontWeight: 600 }}
                        >
                          {tr.package_name}
                        </Link>
                      </Text>
                    ) : (
                      <Text style={{ fontSize: 13, color: "var(--color-text-primary)" }}>
                        Outgoing transfer of{" "}
                        <Link
                          to={`/packages/${tr.package_name}`}
                          style={{ color: "var(--color-accent-cyan, #06b6d4)", fontWeight: 600 }}
                        >
                          {tr.package_name}
                        </Link>{" "}
                        to <strong>@{tr.to_username || "recipient"}</strong> (awaiting acceptance)
                      </Text>
                    )}
                  </Box>
                  <Box display="flex" alignItems="center" gap={2}>
                    {isIncoming && (
                      <Button
                        size="small"
                        variant="primary"
                        leadingVisual={CheckIcon}
                        disabled={isBusy}
                        onClick={() => handleAcceptTransfer(tr)}
                      >
                        Accept Ownership
                      </Button>
                    )}
                    <Button
                      size="small"
                      variant="danger"
                      leadingVisual={XIcon}
                      disabled={isBusy}
                      onClick={() => handleCancelTransfer(tr)}
                    >
                      {isIncoming ? "Decline" : "Cancel Request"}
                    </Button>
                  </Box>
                </Box>
              );
            })}
          </Box>
        )}

        {/* Search header, Filters & Publish CTA */}
        <Box display="flex" flexDirection="column" gap={3} mb={4}>
          <Box display="flex" alignItems="center" justifyContent="space-between" flexWrap="wrap" gap={2}>
            <Box display="flex" alignItems="baseline" gap="8px">
              <Heading as="h1" style={{ color: "var(--color-text-heading)", fontWeight: 800, fontSize: 24, margin: 0 }}>
                Packages
              </Heading>
              {!loading && (
                <ResultCount>
                  {displayedLibraries.length} package{displayedLibraries.length !== 1 ? "s" : ""}
                </ResultCount>
              )}
            </Box>

            <Button
              variant="primary"
              leadingVisual={PlusIcon}
              onClick={() => {
                if (!user) {
                  navigate("/login");
                } else {
                  setPublishModalOpen(true);
                }
              }}
            >
              Publish Package
            </Button>
          </Box>

          <Box display="flex" alignItems="center" justifyContent="space-between" flexWrap="wrap" gap={3}>
            <Box
              display="flex"
              alignItems="center"
              style={{
                maxWidth: "460px",
                width: "100%",
                flex: "1 1 280px",
              }}
            >
              <TextInput
                leadingVisual={SearchIcon}
                placeholder="Search packages by name, scope, or keyword..."
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

            <Box display="flex" alignItems="center" gap={2}>
              <Text style={{ fontSize: 12, color: "var(--color-text-muted)", fontWeight: 600 }}>Sort by:</Text>
              <Select
                size="small"
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as SortOption)}
                aria-label="Sort packages"
              >
                <Select.Option value="downloads">Most Downloaded</Select.Option>
                <Select.Option value="recent">Recently Updated</Select.Option>
                <Select.Option value="name">Alphabetical (A–Z)</Select.Option>
              </Select>
            </Box>
          </Box>

          {/* Polyglot Domain Filter Pills */}
          <FilterPillBar>
            {DOMAIN_OPTIONS.map((d) => {
              const IconComp = d.icon;
              return (
                <FilterPill
                  key={d.id}
                  $active={domainFilter === d.id}
                  $color={d.color}
                  onClick={() => setDomainFilter(d.id)}
                >
                  <IconComp size={13} />
                  <span>{d.label}</span>
                </FilterPill>
              );
            })}
          </FilterPillBar>
        </Box>

        {/* Content */}
        {loading && libraries.length === 0 ? (
          <Box display="flex" justifyContent="center" p={12}>
            <SyncIcon size={32} className="spinner-spin" fill="var(--color-text-muted)" />
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
              Failed to load libraries
            </Heading>
            <Text as="p" style={{ color: "var(--color-text-muted)", fontSize: 14, margin: 0 }}>
              The server may be unavailable. Please try again later.
            </Text>
          </Box>
        ) : activeTab === "my" && !user ? (
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
            <Heading as="h2" style={{ color: "var(--color-text-heading)", fontSize: 20, margin: 0 }}>
              Sign in to view your packages
            </Heading>
            <Text as="p" style={{ color: "var(--color-text-muted)", fontSize: 14, margin: 0 }}>
              Sign in to view and manage packages published under your username.
            </Text>
            <Button variant="primary" onClick={() => navigate("/login")}>
              Sign In
            </Button>
          </Box>
        ) : displayedLibraries.length === 0 ? (
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
              No packages found
            </Heading>
            <Text as="p" style={{ color: "var(--color-text-muted)", fontSize: 14, margin: 0 }}>
              {activeTab === "my"
                ? "You haven't published any matching packages yet."
                : query || domainFilter !== "all"
                  ? `No results matching your filter criteria.`
                  : "No libraries have been published yet."}
            </Text>
            {activeTab === "my" && user && (
              <Button variant="primary" leadingVisual={PlusIcon} onClick={() => setPublishModalOpen(true)}>
                Publish Your First Package
              </Button>
            )}
          </Box>
        ) : (
          <CardList>
            {displayedLibraries.map((lib) => {
              const displayHandle = lib.name.startsWith("@") ? lib.name : `@${lib.author || lib.name}`;
              const domains = lib.domains && lib.domains.length > 0 ? lib.domains : ["modelica"];
              const timeAgoText = formatTimeAgo(lib.publishedAt);

              return (
                <Box
                  key={lib.name}
                  display="flex"
                  alignItems="flex-start"
                  justifyContent="space-between"
                  p={3}
                  borderBottom="1px solid var(--color-border)"
                  style={{ gap: 16 }}
                >
                  <Link
                    to={lib.latestVersion ? `/packages/${lib.name}/${lib.latestVersion}` : `/packages/${lib.name}`}
                    style={{ textDecoration: "none", color: "inherit", display: "flex", gap: "12px", flex: 1 }}
                  >
                    <PackageIcon name={lib.name} version={lib.latestVersion || "1.0.0"} />
                    <Box flex={1}>
                      <Box display="flex" alignItems="center" gap="8px" flexWrap="wrap">
                        <Heading
                          as="h4"
                          style={{
                            fontSize: "15px",
                            fontWeight: "bold",
                            margin: 0,
                            color: "var(--color-text-heading)",
                          }}
                        >
                          {lib.name}
                        </Heading>
                        {lib.latestVersion && (
                          <Label variant="secondary" style={{ fontSize: 11 }}>
                            v{lib.latestVersion}
                          </Label>
                        )}
                        {lib.isYanked && (
                          <Label variant="danger" style={{ fontSize: 10 }}>
                            <AlertFillIcon size={10} /> yanked
                          </Label>
                        )}
                        {lib.isDeprecated && (
                          <Label
                            variant="attention"
                            style={{ fontSize: 10 }}
                            title={lib.deprecationReason || undefined}
                          >
                            <AlertIcon size={10} /> deprecated
                          </Label>
                        )}
                        {domains.map((dom) => (
                          <DomainBadge key={dom} $domain={dom}>
                            {formatDomainLabel(dom)}
                          </DomainBadge>
                        ))}
                      </Box>

                      <Text
                        as="p"
                        style={{
                          fontSize: "14px",
                          margin: "6px 0 8px 0",
                          color: "var(--color-text-primary)",
                          lineHeight: 1.4,
                        }}
                      >
                        {lib.description || "Engineering model & artifact package"}
                      </Text>

                      {/* Metadata Footer Row */}
                      <Box display="flex" alignItems="center" gap="14px" flexWrap="wrap">
                        <Text style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>{displayHandle}</Text>
                        {lib.license && (
                          <Text
                            style={{
                              fontSize: "12px",
                              color: "var(--color-text-muted)",
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 4,
                            }}
                          >
                            <LawIcon size={12} /> {lib.license}
                          </Text>
                        )}
                        {typeof lib.totalDownloads === "number" && (
                          <Text
                            style={{
                              fontSize: "12px",
                              color: "var(--color-text-muted)",
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 4,
                            }}
                          >
                            <DownloadIcon size={12} /> {lib.totalDownloads.toLocaleString()} downloads
                          </Text>
                        )}
                        {timeAgoText && (
                          <Text style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>{timeAgoText}</Text>
                        )}
                      </Box>

                      {lib.jobStatus &&
                        (lib.jobStatus.status === "pending" || lib.jobStatus.status === "processing") && (
                          <Box display="flex" alignItems="center" gap="8px" mt="8px">
                            {lib.jobStatus.status === "pending" ? (
                              <HourglassIcon size={16} fill="var(--color-text-muted)" />
                            ) : (
                              <SyncIcon size={16} className="spinner-spin" fill="var(--color-text-muted)" />
                            )}
                            <Text style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>
                              {lib.jobStatus.status === "pending"
                                ? "Queued for processing..."
                                : `Processing... ${
                                    lib.jobStatus.classesProcessed ? `(${lib.jobStatus.classesProcessed} classes)` : ""
                                  }`}
                            </Text>
                          </Box>
                        )}
                      {lib.jobStatus?.status === "failed" && (
                        <Box display="flex" alignItems="center" gap="6px" mt="8px">
                          <AlertIcon size={14} fill="var(--color-error)" />
                          <Text style={{ fontSize: "12px", color: "var(--color-error)" }}>
                            Processing failed: {lib.jobStatus.error || "Unknown error"}
                          </Text>
                        </Box>
                      )}
                    </Box>
                  </Link>

                  {/* Install / Open Action Menu */}
                  <Box display="flex" alignItems="center" gap={1} style={{ flexShrink: 0 }}>
                    <Button
                      size="small"
                      leadingVisual={copiedPkg === lib.name ? CheckIcon : CopyIcon}
                      onClick={(e) => {
                        e.preventDefault();
                        handleCopyInstall(lib.name);
                      }}
                      title={`Copy: msx install ${lib.name}`}
                    >
                      {copiedPkg === lib.name ? "Copied" : "msx install"}
                    </Button>
                    <ActionMenu>
                      <ActionMenu.Button size="small" aria-label={`Install options for ${lib.name}`}>
                        Open
                      </ActionMenu.Button>
                      <ActionMenu.Overlay align="end">
                        <ActionList>
                          <ActionList.Item onSelect={() => navigate(`/ide#memfs:package-${lib.name}`)}>
                            <ActionList.LeadingVisual>
                              <CodeIcon size={14} />
                            </ActionList.LeadingVisual>
                            Open in ModelScript Web IDE
                          </ActionList.Item>
                          <ActionList.Item onSelect={() => handleCopyInstall(lib.name)}>
                            <ActionList.LeadingVisual>
                              <TerminalIcon size={14} />
                            </ActionList.LeadingVisual>
                            Copy CLI Command (msx install)
                          </ActionList.Item>
                          <ActionList.Item
                            onSelect={() => {
                              window.location.href = `vscode://modelscript.modelscript/install?package=${encodeURIComponent(lib.name)}`;
                            }}
                          >
                            <ActionList.LeadingVisual>
                              <DesktopDownloadIcon size={14} />
                            </ActionList.LeadingVisual>
                            Install in VS Code Desktop
                          </ActionList.Item>
                        </ActionList>
                      </ActionMenu.Overlay>
                    </ActionMenu>
                  </Box>
                </Box>
              );
            })}
          </CardList>
        )}
      </Box>

      <PublishPackageModal
        isOpen={publishModalOpen}
        onClose={() => setPublishModalOpen(false)}
        onPublished={() => {
          fetchLibraries();
        }}
      />
    </Box>
  );
};

export default LibraryListPage;
