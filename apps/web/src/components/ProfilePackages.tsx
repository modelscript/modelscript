// SPDX-License-Identifier: AGPL-3.0-or-later

import { DownloadIcon, PackageIcon } from "@primer/octicons-react";
import { Heading, Label, Text } from "@primer/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import styled from "styled-components";
import { getLibraries, type LibraryListItem } from "../api/packages";
import Box from "./Box";
import Spinner from "./Spinner";

type SortKey = "updated" | "downloads" | "name";

const Toolbar = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  margin-bottom: 16px;
`;

const SearchInput = styled.input`
  flex: 1 1 200px;
  min-width: 0;
  padding: 6px 10px;
  font-size: 14px;
  color: var(--color-fg-default);
  background: var(--color-canvas-default, transparent);
  border: 1px solid var(--color-border-default);
  border-radius: 6px;
  font-family: inherit;
`;

const SelectInput = styled.select`
  padding: 6px 8px;
  font-size: 13px;
  color: var(--color-fg-default);
  background: var(--color-canvas-default, transparent);
  border: 1px solid var(--color-border-default);
  border-radius: 6px;
  font-family: inherit;
`;

/** Three columns on desktop, two on tablet, one on mobile. */
const Grid = styled.div`
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;

  @media (max-width: 900px) {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  @media (max-width: 560px) {
    grid-template-columns: minmax(0, 1fr);
  }
`;

const Tile = styled.div`
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 12px;
  min-height: 150px;
  padding: 14px;
  border: 1px solid var(--color-border-default);
  border-radius: 8px;
  transition:
    border-color 0.15s ease,
    box-shadow 0.15s ease;

  &:hover {
    border-color: var(--color-accent-fg, var(--color-accent-emphasis));
    box-shadow: 0 1px 6px rgba(0, 0, 0, 0.12);
  }
`;

const TileTitle = styled(Link)`
  min-width: 0;
  overflow: hidden;
  font-weight: 600;
  color: var(--color-accent-fg, var(--color-accent-emphasis));
  text-decoration: none;
  text-overflow: ellipsis;
  white-space: nowrap;

  &:hover {
    text-decoration: underline;
  }
`;

const Description = styled.p`
  margin: 0;
  font-size: 13px;
  line-height: 1.45;
  color: var(--color-fg-muted);
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
`;

const Chips = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
`;

const Chip = styled.span`
  padding: 1px 8px;
  font-size: 11px;
  border-radius: 999px;
  color: var(--color-fg-muted);
  background: var(--color-neutral-muted, rgba(128, 128, 128, 0.15));
`;

const Footer = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 12px;
  color: var(--color-fg-muted);
`;

const StatusBar = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
  font-size: 12px;
  color: var(--color-fg-muted);
`;

const LinkButton = styled.button`
  padding: 0;
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;
  color: var(--color-accent-fg, var(--color-accent-emphasis));
  background: none;
  border: none;

  &:hover {
    text-decoration: underline;
  }
`;

function formatRelative(iso?: string): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
  const units: [number, string][] = [
    [60 * 60 * 24 * 365, "y"],
    [60 * 60 * 24 * 30, "mo"],
    [60 * 60 * 24 * 7, "w"],
    [60 * 60 * 24, "d"],
    [60 * 60, "h"],
    [60, "m"],
  ];
  for (const [size, label] of units) {
    if (seconds >= size) return `${Math.floor(seconds / size)}${label} ago`;
  }
  return "just now";
}

function formatCount(n?: number): string {
  const value = n ?? 0;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(value);
}

function isOwnedBy(pkg: LibraryListItem, username: string): boolean {
  const name = username.toLowerCase();
  const author = pkg.author?.replace(/^@/, "").toLowerCase();
  const scope = pkg.scope?.replace(/^@/, "").toLowerCase();
  return author === name || scope === name;
}

export default function ProfilePackages({ username }: { username: string; isOwnProfile?: boolean }) {
  const [packages, setPackages] = useState<LibraryListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const [params, setParams] = useSearchParams();
  const update = (patch: Record<string, string | null>) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const [key, value] of Object.entries(patch)) {
          if (value) next.set(key, value);
          else next.delete(key);
        }
        return next;
      },
      { replace: true },
    );

  const query = params.get("q") ?? "";
  const setQuery = (val: string) => update({ q: val || null });

  const rawSort = params.get("sort");
  const sort: SortKey = rawSort === "downloads" || rawSort === "name" ? rawSort : "updated";
  const setSort = (val: SortKey) => update({ sort: val === "updated" ? null : val });

  const domain = params.get("domain") ?? "";
  const setDomain = (val: string) => update({ domain: val || null });

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    getLibraries(undefined, "recent", username)
      .then((authorPkgs) => {
        if (!cancelled) setPackages(authorPkgs.filter((pkg) => isOwnedBy(pkg, username)));
      })
      .catch((err) => {
        console.error(err);
        if (!cancelled) setError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [username]);

  const domains = useMemo(() => {
    const counts = new Map<string, number>();
    for (const pkg of packages) for (const d of pkg.domains ?? []) counts.set(d, (counts.get(d) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [packages]);

  const searchRef = useRef<HTMLInputElement>(null);

  // "/" focuses search box, matching Articles tab and standard doc sites
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing =
        target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if (e.key === "/" && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const hasActiveFilters = Boolean(query.trim() || domain || rawSort);
  const clearFilters = () => update({ q: null, domain: null, sort: null });

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = packages.filter((pkg) => {
      if (domain && !(pkg.domains ?? []).includes(domain)) return false;
      if (!q) return true;
      return [pkg.name, pkg.description, ...(pkg.domains ?? [])].filter(Boolean).join(" ").toLowerCase().includes(q);
    });
    return [...filtered].sort((a, b) => {
      if (sort === "name") return a.name.localeCompare(b.name);
      if (sort === "downloads")
        return (b.totalDownloads ?? 0) - (a.totalDownloads ?? 0) || a.name.localeCompare(b.name);
      const ta = a.publishedAt ? new Date(a.publishedAt).getTime() : 0;
      const tb = b.publishedAt ? new Date(b.publishedAt).getTime() : 0;
      return tb - ta || a.name.localeCompare(b.name);
    });
  }, [packages, query, sort, domain]);

  if (loading) {
    return (
      <Box p={4} display="flex" justifyContent="center">
        <Spinner />
      </Box>
    );
  }

  if (error) {
    return (
      <Box p={4} textAlign="center">
        <Text color="var(--color-fg-muted)">Packages could not be loaded right now.</Text>
      </Box>
    );
  }

  if (packages.length === 0) {
    return (
      <Box p={4} textAlign="center">
        <Heading as="h2" style={{ fontSize: "20px" }}>
          No packages yet
        </Heading>
        <Text color="var(--color-fg-muted)">When @{username} publishes packages, they will show up here.</Text>
      </Box>
    );
  }

  return (
    <Box p={3}>
      <Toolbar>
        <SearchInput
          ref={searchRef}
          type="search"
          aria-label="Search packages"
          placeholder={`Search ${packages.length} package${packages.length === 1 ? "" : "s"}… (press / to focus)`}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {domains.length > 0 && (
          <SelectInput aria-label="Filter by domain" value={domain} onChange={(e) => setDomain(e.target.value)}>
            <option value="">All domains</option>
            {domains.map(([d, count]) => (
              <option key={d} value={d}>
                {d} ({count})
              </option>
            ))}
          </SelectInput>
        )}
        <SelectInput aria-label="Sort packages" value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
          <option value="updated">Recently updated</option>
          <option value="downloads">Most downloads</option>
          <option value="name">Name</option>
        </SelectInput>
      </Toolbar>

      <StatusBar>
        <span>
          {hasActiveFilters ? `${visible.length} of ${packages.length}` : packages.length} package
          {(hasActiveFilters ? visible.length : packages.length) === 1 ? "" : "s"}
        </span>
        {hasActiveFilters && (
          <LinkButton type="button" onClick={clearFilters}>
            Clear filters
          </LinkButton>
        )}
      </StatusBar>

      {visible.length === 0 ? (
        <Box p={4} textAlign="center">
          <Text color="var(--color-fg-muted)">No packages match your filters.</Text>
        </Box>
      ) : (
        <Grid>
          {visible.map((pkg) => {
            const href = pkg.latestVersion ? `/packages/${pkg.name}/${pkg.latestVersion}` : `/packages/${pkg.name}`;
            const tags = pkg.domains ?? [];
            return (
              <Tile key={pkg.name}>
                <div style={{ minWidth: 0 }}>
                  <Box display="flex" alignItems="center" gap={2} mb={2} style={{ minWidth: 0 }}>
                    <PackageIcon size={16} fill="var(--color-fg-muted)" />
                    <TileTitle to={href} title={pkg.name}>
                      {pkg.name}
                    </TileTitle>
                    {pkg.latestVersion && (
                      <Label variant="secondary" size="small">
                        v{pkg.latestVersion}
                      </Label>
                    )}
                  </Box>
                  <Description>{pkg.description || "No description provided."}</Description>
                </div>
                <div>
                  {(pkg.isDeprecated || pkg.isYanked || tags.length > 0) && (
                    <Chips style={{ marginBottom: 10 }}>
                      {pkg.isYanked && (
                        <Label variant="danger" size="small">
                          Yanked
                        </Label>
                      )}
                      {pkg.isDeprecated && (
                        <Label variant="attention" size="small">
                          Deprecated
                        </Label>
                      )}
                      {tags.slice(0, 3).map((t) => (
                        <Chip key={t}>{t}</Chip>
                      ))}
                      {tags.length > 3 && <Chip>+{tags.length - 3}</Chip>}
                    </Chips>
                  )}
                  <Footer>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                      <DownloadIcon size={12} /> {formatCount(pkg.totalDownloads)}
                    </span>
                    <span>{pkg.publishedAt ? `Updated ${formatRelative(pkg.publishedAt)}` : ""}</span>
                  </Footer>
                </div>
              </Tile>
            );
          })}
        </Grid>
      )}
    </Box>
  );
}
