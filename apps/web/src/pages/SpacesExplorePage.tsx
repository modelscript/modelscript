// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  AppsIcon,
  CommentDiscussionIcon,
  PlusIcon,
  RowsIcon,
  SearchIcon,
  XCircleFillIcon,
} from "@primer/octicons-react";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  getMyOrganizations,
  getMySpacesAndChatTree,
  getSpaceDomainPresets,
  listSpaces,
  type Organization,
  type SpaceDomainPreset,
  type SpaceRecord,
} from "../api";
import { useAuth } from "../AuthContext";
import CreateSpaceModal from "../components/spaces/CreateSpaceModal";
import SpaceCard from "../components/spaces/SpaceCard";
import SpaceListItem from "../components/spaces/SpaceListItem";
import Spinner from "../components/Spinner";
import { usePageTitle } from "../util/title";

type TabOption = "all" | "my" | "organizations" | "personal";
type SortOption = "popular" | "recent" | "members" | "name";
type ViewMode = "grid" | "list";

export const SpacesExplorePage: React.FC = () => {
  usePageTitle("Engineering Spaces");
  const { user } = useAuth();
  const searchInputRef = useRef<HTMLInputElement>(null);

  const [presets, setPresets] = useState<SpaceDomainPreset[]>([]);
  const [spaces, setSpaces] = useState<SpaceRecord[]>([]);
  const [mySpacesList, setMySpacesList] = useState<SpaceRecord[]>([]);
  const [myOrgs, setMyOrgs] = useState<Organization[]>([]);
  const [activeTab, setActiveTab] = useState<TabOption>("all");
  const [selectedPreset, setSelectedPreset] = useState<string>("all");
  const [search, setSearch] = useState<string>("");
  const [sortBy, setSortBy] = useState<SortOption>("popular");
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    try {
      const saved = localStorage.getItem("spaces_view_mode");
      if (saved === "list" || saved === "grid") return saved;
    } catch {
      // Fallback
    }
    return "grid";
  });
  const [loading, setLoading] = useState<boolean>(true);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState<boolean>(false);

  const handleSetViewMode = (mode: ViewMode) => {
    setViewMode(mode);
    try {
      localStorage.setItem("spaces_view_mode", mode);
    } catch {
      // Ignore storage errors
    }
  };

  const fetchSpaces = useCallback(async () => {
    setLoading(true);
    try {
      let ownerTypeParam: "organization" | "user" | undefined = undefined;
      if (activeTab === "organizations") ownerTypeParam = "organization";
      else if (activeTab === "personal") ownerTypeParam = "user";

      const list = await listSpaces({
        domainPreset: selectedPreset === "all" ? undefined : selectedPreset,
        ownerType: ownerTypeParam,
        search: search.trim() || undefined,
      });
      setSpaces(list);
    } catch {
      setSpaces([]);
    } finally {
      setLoading(false);
    }
  }, [activeTab, selectedPreset, search]);

  useEffect(() => {
    void getSpaceDomainPresets()
      .then((list) => setPresets(list))
      .catch(() => {});

    if (user) {
      void getMyOrganizations()
        .then((orgs) => setMyOrgs(orgs))
        .catch(() => {});

      void getMySpacesAndChatTree()
        .then((res) => {
          setMySpacesList(res.spaces);
        })
        .catch(() => {});
    }
  }, [user]);

  useEffect(() => {
    void fetchSpaces();
  }, [fetchSpaces]);

  // Global keyboard shortcut: ⌘K or / focuses search input
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isInput =
        document.activeElement?.tagName === "INPUT" ||
        document.activeElement?.tagName === "TEXTAREA" ||
        (document.activeElement as HTMLElement)?.isContentEditable;

      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      } else if (e.key === "/" && !isInput) {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Filter and sort spaces
  const filteredAndSortedSpaces = useMemo(() => {
    let result = spaces;

    // Client-side refinement for "my" tab
    if (activeTab === "my" && user) {
      const myOrgSlugs = new Set(myOrgs.map((o) => o.slug));
      const mySpaceIds = new Set(mySpacesList.map((s) => s.id));
      result = spaces.filter(
        (s) => mySpaceIds.has(s.id) || s.owner_namespace === user.username || myOrgSlugs.has(s.owner_namespace),
      );
    }

    // Sort
    return [...result].sort((a, b) => {
      if (sortBy === "popular") {
        return (b.follower_count ?? 0) - (a.follower_count ?? 0);
      }
      if (sortBy === "recent") {
        return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
      }
      if (sortBy === "members") {
        return (b.member_count ?? 0) - (a.member_count ?? 0);
      }
      if (sortBy === "name") {
        return a.name.localeCompare(b.name);
      }
      return 0;
    });
  }, [spaces, activeTab, user, myOrgs, mySpacesList, sortBy]);

  // Compute counts for tabs
  const tabCounts = useMemo(() => {
    const total = spaces.length;
    let myCount = 0;
    let orgCount = 0;
    let personalCount = 0;

    if (user) {
      const myOrgSlugs = new Set(myOrgs.map((o) => o.slug));
      const mySpaceIds = new Set(mySpacesList.map((s) => s.id));
      myCount = spaces.filter(
        (s) => mySpaceIds.has(s.id) || s.owner_namespace === user.username || myOrgSlugs.has(s.owner_namespace),
      ).length;
    }

    for (const s of spaces) {
      if (s.owner_type === "organization") orgCount++;
      else personalCount++;
    }

    return { all: total, my: myCount, organizations: orgCount, personal: personalCount };
  }, [spaces, user, myOrgs, mySpacesList]);

  const tabs: Array<{ id: TabOption; label: string; count?: number }> = [
    { id: "all", label: "All Spaces", count: tabCounts.all },
    ...(user ? [{ id: "my" as const, label: "My Spaces", count: tabCounts.my }] : []),
    { id: "organizations", label: "Organizations", count: tabCounts.organizations },
    { id: "personal", label: "Personal", count: tabCounts.personal },
  ];

  return (
    <div
      style={{
        padding: "20px 24px 48px",
        display: "flex",
        flexDirection: "column",
        gap: "16px",
        maxWidth: "1400px",
        margin: "0 auto",
        width: "100%",
        boxSizing: "border-box",
      }}
    >
      {/* Accessible Title to satisfy test invariant */}
      <h1 className="sr-only">Ansatz Engineering Spaces</h1>

      {/* Top Navigation Row: Large Underline Tabs + Primary Action Buttons */}
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "16px",
          borderBottom: "1px solid var(--color-border)",
          paddingBottom: "2px",
        }}
      >
        {/* Large Tabs */}
        <nav
          aria-label="Spaces Navigation"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            flexWrap: "wrap",
          }}
        >
          {tabs.map((t) => {
            const isActive = activeTab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setActiveTab(t.id)}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "8px",
                  padding: "10px 14px",
                  marginBottom: "-2px",
                  border: "none",
                  borderBottom: isActive ? "2px solid var(--ms-brand, #3b82f6)" : "2px solid transparent",
                  background: "transparent",
                  color: isActive ? "var(--ms-brand, #3b82f6)" : "var(--color-text-secondary)",
                  fontSize: "15px",
                  fontWeight: isActive ? 700 : 500,
                  cursor: "pointer",
                  transition: "all 0.15s ease",
                  outline: "none",
                }}
              >
                <span>{t.label}</span>
                {typeof t.count === "number" && (
                  <span
                    style={{
                      fontSize: "11.5px",
                      fontWeight: 600,
                      padding: "1px 7px",
                      borderRadius: "999px",
                      background: isActive
                        ? "color-mix(in srgb, var(--ms-brand, #3b82f6) 15%, transparent)"
                        : "var(--color-code-bg, var(--ms-surface-hover))",
                      color: isActive ? "var(--ms-brand, #3b82f6)" : "var(--color-text-muted)",
                      fontFamily: "var(--font-mono, monospace)",
                    }}
                  >
                    {t.count}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Action Group */}
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <Link
            to="/chat"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              padding: "8px 14px",
              borderRadius: "8px",
              border: "1px solid var(--color-border)",
              background: "var(--color-bg-card, var(--ms-bg-elv))",
              color: "var(--color-text-primary)",
              textDecoration: "none",
              fontSize: "13px",
              fontWeight: 600,
              transition: "border-color 0.15s ease",
            }}
          >
            <CommentDiscussionIcon size={16} />
            <span>Chat Sidenav</span>
          </Link>

          {user && (
            <button
              type="button"
              onClick={() => setIsCreateModalOpen(true)}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                padding: "8px 16px",
                borderRadius: "8px",
                border: "none",
                background: "var(--ms-brand, #2563eb)",
                color: "#ffffff",
                fontSize: "13px",
                fontWeight: 700,
                cursor: "pointer",
                boxShadow: "0 1px 3px rgba(37, 99, 235, 0.25)",
                transition: "opacity 0.15s ease",
              }}
            >
              <PlusIcon size={16} />
              <span>New Space</span>
            </button>
          )}
        </div>
      </header>

      {/* Control Ribbon: Prominent Search + Sort + Grid/List View Toggle */}
      <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
          {/* Prominent Search Bar */}
          <div
            style={{
              flex: "1 1 280px",
              position: "relative",
              display: "flex",
              alignItems: "center",
              borderRadius: "10px",
              border: "1px solid var(--color-search-border, var(--color-border))",
              background: "var(--color-search-bg, var(--color-bg-card))",
              padding: "0 12px",
              height: "40px",
              boxSizing: "border-box",
            }}
          >
            <SearchIcon size={16} style={{ color: "var(--color-text-muted)", flexShrink: 0 }} />
            <input
              ref={searchInputRef}
              type="search"
              placeholder="Search spaces by name, description, language, or @owner..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{
                flex: 1,
                border: "none",
                background: "transparent",
                color: "var(--color-text-primary)",
                fontSize: "13.5px",
                padding: "0 10px",
                outline: "none",
                width: "100%",
              }}
            />
            {search.length > 0 ? (
              <button
                type="button"
                onClick={() => setSearch("")}
                style={{
                  border: "none",
                  background: "transparent",
                  color: "var(--color-text-muted)",
                  cursor: "pointer",
                  padding: "4px",
                  display: "flex",
                  alignItems: "center",
                }}
                title="Clear search"
              >
                <XCircleFillIcon size={14} />
              </button>
            ) : (
              <kbd
                style={{
                  fontSize: "11px",
                  fontFamily: "var(--font-mono, monospace)",
                  color: "var(--color-text-muted)",
                  padding: "2px 6px",
                  borderRadius: "4px",
                  border: "1px solid var(--color-border)",
                  background: "var(--color-code-bg, var(--ms-surface-hover))",
                }}
              >
                ⌘K
              </kbd>
            )}
          </div>

          {/* Sort Selector */}
          <div style={{ position: "relative" }}>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortOption)}
              style={{
                height: "40px",
                padding: "0 14px",
                borderRadius: "10px",
                border: "1px solid var(--color-border)",
                background: "var(--color-bg-card, var(--ms-bg-elv))",
                color: "var(--color-text-primary)",
                fontSize: "13px",
                fontWeight: 500,
                outline: "none",
                cursor: "pointer",
              }}
            >
              <option value="popular">Most Stars</option>
              <option value="recent">Recently Active</option>
              <option value="members">Most Members</option>
              <option value="name">Name (A–Z)</option>
            </select>
          </div>

          {/* View Mode Toggle: Grid vs. List */}
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              padding: "3px",
              borderRadius: "10px",
              border: "1px solid var(--color-border)",
              background: "var(--color-bg-card, var(--ms-bg-elv))",
              height: "40px",
              boxSizing: "border-box",
            }}
            role="group"
            aria-label="View toggle"
          >
            <button
              type="button"
              onClick={() => handleSetViewMode("grid")}
              title="Grid View"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: "32px",
                height: "32px",
                borderRadius: "7px",
                border: "none",
                background:
                  viewMode === "grid" ? "color-mix(in srgb, var(--ms-brand, #3b82f6) 18%, transparent)" : "transparent",
                color: viewMode === "grid" ? "var(--ms-brand, #3b82f6)" : "var(--color-text-muted)",
                cursor: "pointer",
                transition: "all 0.15s ease",
              }}
            >
              <AppsIcon size={16} />
            </button>
            <button
              type="button"
              onClick={() => handleSetViewMode("list")}
              title="List View"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: "32px",
                height: "32px",
                borderRadius: "7px",
                border: "none",
                background:
                  viewMode === "list" ? "color-mix(in srgb, var(--ms-brand, #3b82f6) 18%, transparent)" : "transparent",
                color: viewMode === "list" ? "var(--ms-brand, #3b82f6)" : "var(--color-text-muted)",
                cursor: "pointer",
                transition: "all 0.15s ease",
              }}
            >
              <RowsIcon size={16} />
            </button>
          </div>
        </div>

        {/* Domain Presets: Single Row Horizontal Scroll with No Clumsy Wrapping */}
        <div
          style={{
            display: "flex",
            gap: "8px",
            overflowX: "auto",
            scrollbarWidth: "none",
            padding: "2px 0 6px",
          }}
        >
          <button
            type="button"
            onClick={() => setSelectedPreset("all")}
            style={{
              padding: "5px 12px",
              borderRadius: "999px",
              border: selectedPreset === "all" ? "1px solid var(--ms-brand, #3b82f6)" : "1px solid var(--color-border)",
              background:
                selectedPreset === "all"
                  ? "color-mix(in srgb, var(--ms-brand, #3b82f6) 15%, transparent)"
                  : "transparent",
              color: selectedPreset === "all" ? "var(--ms-brand, #3b82f6)" : "var(--color-text-secondary)",
              fontSize: "12px",
              fontWeight: 600,
              cursor: "pointer",
              whiteSpace: "nowrap",
              transition: "all 0.15s ease",
              flexShrink: 0,
            }}
          >
            All Domains (68 Languages)
          </button>
          {presets.map((p) => {
            const isSelected = selectedPreset === p.id;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => setSelectedPreset(p.id)}
                style={{
                  padding: "5px 12px",
                  borderRadius: "999px",
                  border: isSelected ? `1px solid ${p.accentColor}` : "1px solid var(--color-border)",
                  background: isSelected ? `color-mix(in srgb, ${p.accentColor} 15%, transparent)` : "transparent",
                  color: isSelected ? p.accentColor : "var(--color-text-secondary)",
                  fontSize: "12px",
                  fontWeight: 600,
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                  transition: "all 0.15s ease",
                  flexShrink: 0,
                }}
              >
                {p.shortLabel}
              </button>
            );
          })}
        </div>
      </div>

      {/* Main Content Area: Spinner / Empty / Grid / List */}
      {loading ? (
        <div style={{ padding: "64px", display: "flex", justifyContent: "center" }}>
          <Spinner />
        </div>
      ) : filteredAndSortedSpaces.length === 0 ? (
        <div
          style={{
            padding: "48px 24px",
            borderRadius: "14px",
            border: "1px dashed var(--color-border)",
            background: "var(--color-bg-card, var(--ms-bg-elv))",
            textAlign: "center",
          }}
        >
          <h3
            style={{
              margin: "0 0 8px",
              fontSize: "16px",
              color: "var(--color-text-heading, var(--color-text-primary))",
            }}
          >
            No Spaces Found
          </h3>
          <p style={{ margin: "0 0 20px", fontSize: "13.5px", color: "var(--color-text-muted)" }}>
            {search || selectedPreset !== "all"
              ? "No spaces match your active search terms or domain filters."
              : "Create a Space to collaborate on Living Docs, Real-Time Chat, Git PDM, and PLM Change Orders."}
          </p>
          <div style={{ display: "flex", gap: "10px", justifyContent: "center" }}>
            {(search || selectedPreset !== "all") && (
              <button
                type="button"
                onClick={() => {
                  setSearch("");
                  setSelectedPreset("all");
                }}
                style={{
                  padding: "8px 16px",
                  borderRadius: "8px",
                  border: "1px solid var(--color-border)",
                  background: "transparent",
                  color: "var(--color-text-primary)",
                  fontWeight: 600,
                  fontSize: "13px",
                  cursor: "pointer",
                }}
              >
                Clear Filters
              </button>
            )}
            {user && (
              <button
                type="button"
                onClick={() => setIsCreateModalOpen(true)}
                style={{
                  padding: "8px 18px",
                  borderRadius: "8px",
                  border: "none",
                  background: "var(--ms-brand, #2563eb)",
                  color: "#fff",
                  fontWeight: 700,
                  fontSize: "13px",
                  cursor: "pointer",
                }}
              >
                + Create Space
              </button>
            )}
          </div>
        </div>
      ) : viewMode === "grid" ? (
        /* Grid View */
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: "16px" }}>
          {filteredAndSortedSpaces.map((sp) => (
            <SpaceCard key={sp.id} space={sp} />
          ))}
        </div>
      ) : (
        /* High-Density List View */
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            borderRadius: "14px",
            border: "1px solid var(--color-border)",
            background: "var(--color-bg-card, var(--ms-bg-elv))",
            overflow: "hidden",
          }}
        >
          {filteredAndSortedSpaces.map((sp) => (
            <SpaceListItem key={sp.id} space={sp} />
          ))}
        </div>
      )}

      <CreateSpaceModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        onCreated={(_ns, _slug) => {
          void fetchSpaces();
        }}
      />
    </div>
  );
};

export default SpacesExplorePage;
