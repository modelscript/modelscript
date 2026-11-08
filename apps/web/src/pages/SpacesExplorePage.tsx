// SPDX-License-Identifier: AGPL-3.0-or-later

import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  getMyOrganizations,
  getSpaceDomainPresets,
  listSpaces,
  type Organization,
  type SpaceDomainPreset,
  type SpaceOwnerType,
  type SpaceRecord,
} from "../api";
import { useAuth } from "../AuthContext";
import CreateSpaceModal from "../components/spaces/CreateSpaceModal";
import SpaceCard from "../components/spaces/SpaceCard";
import Spinner from "../components/Spinner";
import { usePageTitle } from "../util/title";

export const SpacesExplorePage: React.FC = () => {
  usePageTitle("Engineering Spaces & Organizations");
  const { user } = useAuth();

  const [presets, setPresets] = useState<SpaceDomainPreset[]>([]);
  const [spaces, setSpaces] = useState<SpaceRecord[]>([]);
  const [myOrgs, setMyOrgs] = useState<Organization[]>([]);
  const [selectedPreset, setSelectedPreset] = useState<string>("all");
  const [ownerFilter, setOwnerFilter] = useState<"all" | SpaceOwnerType>("all");
  const [search, setSearch] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(true);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState<boolean>(false);

  const fetchSpaces = useCallback(async () => {
    setLoading(true);
    try {
      const list = await listSpaces({
        domainPreset: selectedPreset === "all" ? undefined : selectedPreset,
        ownerType: ownerFilter === "all" ? undefined : ownerFilter,
        search: search.trim() || undefined,
      });
      setSpaces(list);
    } catch {
      setSpaces([]);
    } finally {
      setLoading(false);
    }
  }, [selectedPreset, ownerFilter, search]);

  useEffect(() => {
    void getSpaceDomainPresets()
      .then((list) => setPresets(list))
      .catch(() => {});
    if (user) {
      void getMyOrganizations()
        .then((orgs) => setMyOrgs(orgs))
        .catch(() => {});
    }
  }, [user]);

  useEffect(() => {
    void fetchSpaces();
  }, [fetchSpaces]);

  return (
    <div style={{ padding: "24px", display: "flex", flexDirection: "column", gap: "20px" }}>
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          flexWrap: "wrap",
          gap: "12px",
        }}
      >
        <div>
          <h1 style={{ margin: 0, fontSize: "24px", fontWeight: 800 }}>Ansatz Engineering Spaces</h1>
          <p style={{ margin: "6px 0 0", fontSize: "14px", color: "var(--color-text-secondary)" }}>
            Unified Organization & Personal containers replacing PDM, PLM, Confluence/SharePoint, Engineering Blogs, and
            Slack across 68 engineering languages.
          </p>
        </div>

        <div style={{ display: "flex", gap: "10px" }}>
          <Link
            to="/chat"
            style={{
              padding: "9px 14px",
              borderRadius: "8px",
              border: "1px solid var(--color-border)",
              background: "rgba(59, 130, 246, 0.12)",
              color: "var(--ms-brand, #3b82f6)",
              textDecoration: "none",
              fontSize: "13px",
              fontWeight: 700,
            }}
          >
            💬 Open Spaces Chat Sidenav
          </Link>
          {user && (
            <button
              type="button"
              onClick={() => setIsCreateModalOpen(true)}
              style={{
                padding: "9px 16px",
                borderRadius: "8px",
                border: "none",
                background: "var(--ms-brand, #2563eb)",
                color: "#ffffff",
                fontSize: "13px",
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              + New Space
            </button>
          )}
        </div>
      </div>

      {/* User's Organization Containers Bar */}
      {myOrgs.length > 0 && (
        <div
          style={{
            display: "flex",
            gap: "8px",
            alignItems: "center",
            flexWrap: "wrap",
            padding: "10px 14px",
            borderRadius: "10px",
            border: "1px solid var(--color-border)",
            background: "rgba(15, 23, 42, 0.45)",
          }}
        >
          <span style={{ fontSize: "12px", fontWeight: 700, color: "var(--color-text-muted)" }}>
            YOUR ORGANIZATIONS:
          </span>
          {myOrgs.map((org) => (
            <Link
              key={org.id}
              to={`/@${org.slug}`}
              style={{
                padding: "4px 10px",
                borderRadius: "999px",
                border: "1px solid var(--color-border)",
                background: "rgba(59, 130, 246, 0.12)",
                color: "var(--color-text-primary)",
                textDecoration: "none",
                fontSize: "12px",
                fontWeight: 600,
              }}
            >
              🏢 @{org.slug} ({org.name})
            </Link>
          ))}
        </div>
      )}

      {/* Search & Container Filter */}
      <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
        <input
          type="search"
          placeholder="Search Spaces by name, domain, or @namespace..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            flex: 1,
            minWidth: "240px",
            padding: "9px 14px",
            borderRadius: "8px",
            border: "1px solid var(--color-border)",
            background: "var(--ms-bg, #090d16)",
            color: "inherit",
            fontSize: "13.5px",
          }}
        />
        <div style={{ display: "flex", gap: "6px" }}>
          {(
            [
              { id: "all", label: "All Containers" },
              { id: "organization", label: "🏢 Organizations" },
              { id: "user", label: "👤 Personal Profiles" },
            ] as const
          ).map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setOwnerFilter(f.id)}
              style={{
                padding: "8px 12px",
                borderRadius: "8px",
                border: ownerFilter === f.id ? "1px solid var(--ms-brand, #3b82f6)" : "1px solid var(--color-border)",
                background: ownerFilter === f.id ? "rgba(59, 130, 246, 0.16)" : "transparent",
                color: "inherit",
                fontSize: "12.5px",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Industry Domain Preset Pills */}
      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={() => setSelectedPreset("all")}
          style={{
            padding: "6px 12px",
            borderRadius: "999px",
            border: selectedPreset === "all" ? "1px solid #3b82f6" : "1px solid var(--color-border)",
            background: selectedPreset === "all" ? "rgba(59, 130, 246, 0.18)" : "transparent",
            color: "inherit",
            fontSize: "12px",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          All Industries (68 Languages)
        </button>
        {presets.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => setSelectedPreset(p.id)}
            style={{
              padding: "6px 12px",
              borderRadius: "999px",
              border: selectedPreset === p.id ? `1px solid ${p.accentColor}` : "1px solid var(--color-border)",
              background: selectedPreset === p.id ? `${p.accentColor}22` : "transparent",
              color: selectedPreset === p.id ? p.accentColor : "var(--color-text-secondary)",
              fontSize: "12px",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            {p.shortLabel}
          </button>
        ))}
      </div>

      {/* Spaces Grid */}
      {loading ? (
        <div style={{ padding: "48px", display: "flex", justifyContent: "center" }}>
          <Spinner />
        </div>
      ) : spaces.length === 0 ? (
        <div
          style={{
            padding: "40px 24px",
            borderRadius: "12px",
            border: "1px dashed var(--color-border)",
            textAlign: "center",
          }}
        >
          <h3 style={{ margin: "0 0 8px" }}>No Spaces Found</h3>
          <p style={{ margin: "0 0 16px", fontSize: "13.5px", color: "var(--color-text-muted)" }}>
            Create a personal or organization Space to bundle Living Docs, Real-Time Chat, Git PDM, and PLM Change
            Orders.
          </p>
          {user && (
            <button
              type="button"
              onClick={() => setIsCreateModalOpen(true)}
              style={{
                padding: "9px 18px",
                borderRadius: "8px",
                border: "none",
                background: "var(--ms-brand, #2563eb)",
                color: "#fff",
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              + Create First Space
            </button>
          )}
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(310px, 1fr))", gap: "14px" }}>
          {spaces.map((sp) => (
            <SpaceCard key={sp.id} space={sp} />
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
