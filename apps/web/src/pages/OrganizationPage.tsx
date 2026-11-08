// SPDX-License-Identifier: AGPL-3.0-or-later

import React, { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  addOrganizationMember,
  removeOrganizationMember,
  resolveNamespacePrincipal,
  updateOrganization,
  type Organization,
  type OrganizationMember,
  type OrgRole,
  type SpaceRecord,
} from "../api";
import CreateSpaceModal from "../components/spaces/CreateSpaceModal";
import SpaceCard from "../components/spaces/SpaceCard";
import Spinner from "../components/Spinner";
import { useToast } from "../components/ToastContext";
import { usePageTitle } from "../util/title";

interface OrganizationPageProps {
  orgSlugOverride?: string;
}

export const OrganizationPage: React.FC<OrganizationPageProps> = ({ orgSlugOverride }) => {
  const params = useParams<{ slug?: string; username?: string }>();
  const rawSlug = orgSlugOverride || params.slug || params.username || "";
  const orgSlug = rawSlug.replace(/^@/, "");

  const toast = useToast();

  const [org, setOrg] = useState<Organization | null>(null);
  const [spaces, setSpaces] = useState<SpaceRecord[]>([]);
  const [members, setMembers] = useState<OrganizationMember[]>([]);
  const [viewerRole, setViewerRole] = useState<OrgRole | null>(null);
  const [activeTab, setActiveTab] = useState<"spaces" | "members" | "settings">("spaces");
  const [loading, setLoading] = useState(true);
  const [isCreateSpaceOpen, setIsCreateSpaceOpen] = useState(false);

  const [inviteUsername, setInviteUsername] = useState("");
  const [inviteRole, setInviteRole] = useState<OrgRole>("contributor");
  const [editName, setEditName] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [editWebsite, setEditWebsite] = useState("");

  usePageTitle(org ? `${org.name} (@${org.slug}) — Organization Spaces` : `@${orgSlug}`);

  const fetchOrg = useCallback(async () => {
    if (!orgSlug) return;
    setLoading(true);
    try {
      const res = await resolveNamespacePrincipal(orgSlug);
      if (res.kind === "organization") {
        setOrg(res.organization);
        setSpaces(res.spaces);
        setMembers(res.members);
        setViewerRole(res.viewerRole);
        setEditName(res.organization.name);
        setEditDesc(res.organization.description || "");
        setEditWebsite(res.organization.website || "");
      }
    } catch {
      setOrg(null);
    } finally {
      setLoading(false);
    }
  }, [orgSlug]);

  useEffect(() => {
    void fetchOrg();
  }, [fetchOrg]);

  if (loading) {
    return (
      <div style={{ padding: "48px", display: "flex", justifyContent: "center" }}>
        <Spinner />
      </div>
    );
  }

  if (!org) {
    return (
      <div style={{ padding: "32px 24px", textAlign: "center" }}>
        <h2>Organization @{orgSlug} not found</h2>
        <Link to="/spaces" style={{ color: "var(--ms-brand, #3b82f6)" }}>
          Browse Engineering Spaces →
        </Link>
      </div>
    );
  }

  const canManage = viewerRole === "owner" || viewerRole === "maintainer" || viewerRole === "admin";

  return (
    <div style={{ display: "flex", flexDirection: "column", width: "100%" }}>
      {/* Organization Header */}
      <div
        style={{
          padding: "24px 24px 0 24px",
          background: "linear-gradient(180deg, rgba(59, 130, 246, 0.14) 0%, transparent 100%)",
          borderBottom: "1px solid var(--color-border)",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            flexWrap: "wrap",
            gap: "16px",
          }}
        >
          <div style={{ display: "flex", gap: "16px", alignItems: "center" }}>
            <div
              style={{
                width: "60px",
                height: "60px",
                borderRadius: "14px",
                background: "rgba(59, 130, 246, 0.2)",
                border: "2px solid #3b82f6",
                color: "#60a5fa",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "22px",
                fontWeight: 800,
              }}
            >
              {org.name.slice(0, 2).toUpperCase()}
            </div>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <span
                  style={{
                    padding: "2px 8px",
                    borderRadius: "6px",
                    fontSize: "11px",
                    fontWeight: 700,
                    background: "rgba(59, 130, 246, 0.16)",
                    color: "#60a5fa",
                  }}
                >
                  🏢 ORGANIZATION CONTAINER
                </span>
                <span style={{ fontSize: "13px", fontFamily: "monospace", color: "var(--color-text-muted)" }}>
                  @{org.slug}
                </span>
              </div>
              <h1 style={{ margin: "4px 0", fontSize: "24px", fontWeight: 800 }}>{org.name}</h1>
              {org.description && (
                <p style={{ margin: 0, fontSize: "13.5px", color: "var(--color-text-secondary)" }}>{org.description}</p>
              )}
            </div>
          </div>

          {canManage && (
            <button
              type="button"
              onClick={() => setIsCreateSpaceOpen(true)}
              style={{
                padding: "9px 16px",
                borderRadius: "8px",
                border: "none",
                background: "var(--ms-brand, #2563eb)",
                color: "#fff",
                fontSize: "13px",
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              + New Space in @{org.slug}
            </button>
          )}
        </div>

        {/* Organization Tabs */}
        <div style={{ display: "flex", gap: "8px", marginTop: "20px" }}>
          {(
            [
              { id: "spaces", label: `Spaces Portfolio (${spaces.length})` },
              { id: "members", label: `Members & Governance (${members.length})` },
              ...(canManage ? [{ id: "settings" as const, label: "Organization Settings" }] : []),
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setActiveTab(t.id)}
              style={{
                padding: "10px 14px",
                border: "none",
                borderBottom: activeTab === t.id ? "2px solid #3b82f6" : "2px solid transparent",
                background: "transparent",
                color: activeTab === t.id ? "var(--color-text-primary)" : "var(--color-text-muted)",
                fontWeight: activeTab === t.id ? 700 : 500,
                fontSize: "13.5px",
                cursor: "pointer",
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab Content */}
      <div style={{ padding: "24px" }}>
        {activeTab === "spaces" && (
          <div>
            {spaces.length === 0 ? (
              <div
                style={{
                  padding: "36px 24px",
                  borderRadius: "12px",
                  border: "1px dashed var(--color-border)",
                  textAlign: "center",
                }}
              >
                <h3 style={{ margin: "0 0 8px" }}>No Spaces in @{org.slug} yet</h3>
                <p style={{ margin: "0 0 16px", fontSize: "13.5px", color: "var(--color-text-muted)" }}>
                  Create a Space inside @{org.slug} to host Living Docs, Real-Time Engineering Channels, Git PDM, and
                  PLM Change Orders.
                </p>
                {canManage && (
                  <button
                    type="button"
                    onClick={() => setIsCreateSpaceOpen(true)}
                    style={{
                      padding: "9px 18px",
                      borderRadius: "8px",
                      border: "none",
                      background: "#2563eb",
                      color: "#fff",
                      fontWeight: 700,
                      cursor: "pointer",
                    }}
                  >
                    + Create First Organization Space
                  </button>
                )}
              </div>
            ) : (
              <div
                style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(310px, 1fr))", gap: "14px" }}
              >
                {spaces.map((sp) => (
                  <SpaceCard key={sp.id} space={sp} />
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === "members" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {members.map((m) => (
                <div
                  key={m.user_id}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "10px 14px",
                    borderRadius: "10px",
                    border: "1px solid var(--color-border)",
                    background: "rgba(15, 23, 42, 0.45)",
                  }}
                >
                  <Link
                    to={`/@${m.username}`}
                    style={{ fontWeight: 700, color: "var(--color-text-primary)", textDecoration: "none" }}
                  >
                    @{m.username}
                  </Link>
                  <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                    <span
                      style={{
                        padding: "2px 8px",
                        borderRadius: "999px",
                        fontSize: "11px",
                        fontWeight: 700,
                        background: "rgba(59, 130, 246, 0.16)",
                        color: "#60a5fa",
                      }}
                    >
                      {m.role}
                    </span>
                    {canManage && m.role !== "owner" && (
                      <button
                        type="button"
                        onClick={async () => {
                          await removeOrganizationMember(org.slug, m.user_id);
                          void fetchOrg();
                        }}
                        style={{
                          background: "transparent",
                          border: "none",
                          color: "#f87171",
                          fontSize: "12px",
                          cursor: "pointer",
                        }}
                      >
                        Remove
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {canManage && (
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (!inviteUsername.trim()) return;
                  try {
                    await addOrganizationMember(org.slug, inviteUsername.trim().replace(/^@/, ""), inviteRole);
                    setInviteUsername("");
                    toast.success("Added member to organization");
                    void fetchOrg();
                  } catch (err: any) {
                    toast.error(err?.response?.data?.error || "Failed to add member");
                  }
                }}
                style={{ display: "flex", gap: "8px", marginTop: "8px" }}
              >
                <input
                  type="text"
                  placeholder="username"
                  value={inviteUsername}
                  onChange={(e) => setInviteUsername(e.target.value)}
                  style={{
                    padding: "8px 12px",
                    borderRadius: "8px",
                    border: "1px solid var(--color-border)",
                    background: "var(--ms-bg)",
                    color: "inherit",
                  }}
                />
                <select
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value as OrgRole)}
                  style={{
                    padding: "8px 12px",
                    borderRadius: "8px",
                    border: "1px solid var(--color-border)",
                    background: "var(--ms-bg)",
                    color: "inherit",
                  }}
                >
                  <option value="contributor">Contributor</option>
                  <option value="maintainer">Maintainer</option>
                  <option value="owner">Owner</option>
                </select>
                <button
                  type="submit"
                  style={{
                    padding: "8px 14px",
                    borderRadius: "8px",
                    border: "none",
                    background: "#2563eb",
                    color: "#fff",
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  Add Member
                </button>
              </form>
            )}
          </div>
        )}

        {activeTab === "settings" && canManage && (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                await updateOrganization(org.slug, {
                  name: editName.trim(),
                  description: editDesc.trim() || null,
                  website: editWebsite.trim() || null,
                });
                toast.success("Updated organization profile");
                void fetchOrg();
              } catch (err: any) {
                toast.error(err?.response?.data?.error || "Failed to update organization");
              }
            }}
            style={{ display: "flex", flexDirection: "column", gap: "12px", maxWidth: "520px" }}
          >
            <div>
              <label style={{ display: "block", fontSize: "13px", fontWeight: 600, marginBottom: "6px" }}>
                Organization Name
              </label>
              <input
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                style={{
                  width: "100%",
                  padding: "8px 12px",
                  borderRadius: "8px",
                  border: "1px solid var(--color-border)",
                  background: "var(--ms-bg)",
                  color: "inherit",
                }}
              />
            </div>
            <div>
              <label style={{ display: "block", fontSize: "13px", fontWeight: 600, marginBottom: "6px" }}>
                Description
              </label>
              <textarea
                rows={3}
                value={editDesc}
                onChange={(e) => setEditDesc(e.target.value)}
                style={{
                  width: "100%",
                  padding: "8px 12px",
                  borderRadius: "8px",
                  border: "1px solid var(--color-border)",
                  background: "var(--ms-bg)",
                  color: "inherit",
                }}
              />
            </div>
            <div>
              <label style={{ display: "block", fontSize: "13px", fontWeight: 600, marginBottom: "6px" }}>
                Website
              </label>
              <input
                type="text"
                value={editWebsite}
                onChange={(e) => setEditWebsite(e.target.value)}
                style={{
                  width: "100%",
                  padding: "8px 12px",
                  borderRadius: "8px",
                  border: "1px solid var(--color-border)",
                  background: "var(--ms-bg)",
                  color: "inherit",
                }}
              />
            </div>
            <button
              type="submit"
              style={{
                alignSelf: "flex-start",
                padding: "9px 18px",
                borderRadius: "8px",
                border: "none",
                background: "#2563eb",
                color: "#fff",
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              Save Settings
            </button>
          </form>
        )}
      </div>

      <CreateSpaceModal
        isOpen={isCreateSpaceOpen}
        onClose={() => setIsCreateSpaceOpen(false)}
        defaultOwnerType="organization"
        defaultOrganizationSlug={org.slug}
        onCreated={() => {
          void fetchOrg();
        }}
      />
    </div>
  );
};

export default OrganizationPage;
