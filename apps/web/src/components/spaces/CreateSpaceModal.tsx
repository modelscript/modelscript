// SPDX-License-Identifier: AGPL-3.0-or-later

import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  createOrganization,
  createSpace,
  getMyOrganizations,
  getSpaceDomainPresets,
  type Organization,
  type SpaceDomainPreset,
  type SpaceOwnerType,
  type SpaceVisibility,
} from "../../api";
import { useAuth } from "../../AuthContext";
import { useToast } from "../ToastContext";

interface CreateSpaceModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultOwnerType?: SpaceOwnerType;
  defaultOrganizationSlug?: string;
  onCreated?: (namespace: string, slug: string) => void;
}

export const CreateSpaceModal: React.FC<CreateSpaceModalProps> = ({
  isOpen,
  onClose,
  defaultOwnerType = "user",
  defaultOrganizationSlug,
  onCreated,
}) => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();

  const [presets, setPresets] = useState<SpaceDomainPreset[]>([]);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [ownerType, setOwnerType] = useState<SpaceOwnerType>(defaultOwnerType);
  const [selectedOrgSlug, setSelectedOrgSlug] = useState<string>(defaultOrganizationSlug || "");
  const [showNewOrgForm, setShowNewOrgForm] = useState(false);
  const [newOrgSlug, setNewOrgSlug] = useState("");
  const [newOrgName, setNewOrgName] = useState("");

  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugManuallyEdited, setSlugManuallyEdited] = useState(false);
  const [tagline, setTagline] = useState("");
  const [selectedPreset, setSelectedPreset] = useState<string>("systems_general");
  const [visibility, setVisibility] = useState<SpaceVisibility>("public");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setOwnerType(defaultOwnerType);
    if (defaultOrganizationSlug) setSelectedOrgSlug(defaultOrganizationSlug);
    void getSpaceDomainPresets()
      .then((list) => {
        if (list.length > 0) setPresets(list);
      })
      .catch(() => {});
    void getMyOrganizations()
      .then((orgs) => {
        setOrganizations(orgs);
        if (!defaultOrganizationSlug && orgs.length > 0 && !selectedOrgSlug) {
          setSelectedOrgSlug(orgs[0]!.slug);
        }
      })
      .catch(() => {});
  }, [isOpen, defaultOwnerType, defaultOrganizationSlug]);

  if (!isOpen) return null;

  const activePreset = presets.find((p) => p.id === selectedPreset) || presets[0];

  const handleNameChange = (val: string) => {
    setName(val);
    if (!slugManuallyEdited) {
      setSlug(
        val
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "")
          .slice(0, 48),
      );
    }
  };

  const handleCreateNewOrg = async () => {
    if (!newOrgSlug.trim() || !newOrgName.trim()) {
      setError("Organization slug and name are required");
      return;
    }
    try {
      setSubmitting(true);
      setError(null);
      const createdOrg = await createOrganization({
        slug: newOrgSlug.trim().toLowerCase(),
        name: newOrgName.trim(),
      });
      setOrganizations((prev) => [...prev, createdOrg]);
      setSelectedOrgSlug(createdOrg.slug);
      setOwnerType("organization");
      setShowNewOrgForm(false);
      setNewOrgSlug("");
      setNewOrgName("");
      toast.success(`Created organization @${createdOrg.slug}`);
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || "Failed to create organization");
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !slug.trim()) {
      setError("Space name and slug are required");
      return;
    }
    if (ownerType === "organization" && !selectedOrgSlug) {
      setError("Please select or create an Organization container");
      return;
    }

    try {
      setSubmitting(true);
      setError(null);
      const res = await createSpace({
        name: name.trim(),
        slug: slug.trim().toLowerCase(),
        tagline: tagline.trim() || undefined,
        ownerType,
        organizationSlug: ownerType === "organization" ? selectedOrgSlug : undefined,
        domainPreset: selectedPreset,
        visibility,
      });

      const ns = res.space.owner_namespace;
      toast.success(`Created Space @${ns}/${res.space.slug}`);
      onClose();
      if (onCreated) {
        onCreated(ns, res.space.slug);
      } else {
        navigate(`/@${ns}/${res.space.slug}`);
      }
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || "Failed to create Space");
    } finally {
      setSubmitting(false);
    }
  };

  const containerPreview =
    ownerType === "organization" ? `@${selectedOrgSlug || "org"}` : `@${user?.username || "you"}`;

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1200,
        backgroundColor: "rgba(2, 6, 23, 0.72)",
        backdropFilter: "blur(6px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "16px",
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "720px",
          maxHeight: "90vh",
          overflowY: "auto",
          background: "var(--ms-bg-elv, #0f172a)",
          border: "1px solid var(--color-border, #1e293b)",
          borderRadius: "14px",
          padding: "24px",
          color: "var(--color-text-primary, #f8fafc)",
          boxShadow: "0 24px 48px rgba(0,0,0,0.5)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
          <div>
            <h2 style={{ margin: 0, fontSize: "20px", fontWeight: 700 }}>Create an Ansatz Engineering Space</h2>
            <p style={{ margin: "4px 0 0", fontSize: "13px", color: "var(--color-text-muted, #94a3b8)" }}>
              Unify Living Docs (CMS), Real-Time Channels (Slack), Git PDM/PLM, and Polyglot Packages in one container.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: "transparent",
              border: "none",
              color: "var(--color-text-muted)",
              fontSize: "20px",
              cursor: "pointer",
            }}
          >
            ✕
          </button>
        </div>

        {error && (
          <div
            style={{
              padding: "10px 14px",
              marginBottom: "16px",
              borderRadius: "8px",
              background: "rgba(239, 68, 68, 0.14)",
              border: "1px solid rgba(239, 68, 68, 0.4)",
              color: "#f87171",
              fontSize: "13px",
            }}
          >
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
          {/* 1. Container Ownership Selector (User vs Organization) */}
          <div>
            <label style={{ display: "block", fontSize: "13px", fontWeight: 600, marginBottom: "8px" }}>
              1. Parent Container (Owner Namespace)
            </label>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
              <button
                type="button"
                onClick={() => setOwnerType("user")}
                style={{
                  padding: "12px",
                  borderRadius: "10px",
                  border:
                    ownerType === "user"
                      ? "2px solid var(--ms-brand, #3b82f6)"
                      : "1px solid var(--color-border, #334155)",
                  background: ownerType === "user" ? "rgba(59, 130, 246, 0.12)" : "transparent",
                  color: "inherit",
                  textAlign: "left",
                  cursor: "pointer",
                }}
              >
                <div style={{ fontWeight: 700, fontSize: "14px" }}>👤 Personal Profile (@{user?.username})</div>
                <div style={{ fontSize: "12px", color: "var(--color-text-muted)", marginTop: "2px" }}>
                  R&D sandbox, personal portfolio, or academic lab notebook
                </div>
              </button>

              <button
                type="button"
                onClick={() => setOwnerType("organization")}
                style={{
                  padding: "12px",
                  borderRadius: "10px",
                  border:
                    ownerType === "organization"
                      ? "2px solid var(--ms-brand, #3b82f6)"
                      : "1px solid var(--color-border, #334155)",
                  background: ownerType === "organization" ? "rgba(59, 130, 246, 0.12)" : "transparent",
                  color: "inherit",
                  textAlign: "left",
                  cursor: "pointer",
                }}
              >
                <div style={{ fontWeight: 700, fontSize: "14px" }}>🏢 Organization Container</div>
                <div style={{ fontSize: "12px", color: "var(--color-text-muted)", marginTop: "2px" }}>
                  Enterprise program, vehicle platform, plant, or division
                </div>
              </button>
            </div>

            {ownerType === "organization" && (
              <div
                style={{
                  marginTop: "10px",
                  padding: "12px",
                  borderRadius: "10px",
                  background: "rgba(15, 23, 42, 0.6)",
                  border: "1px solid var(--color-border)",
                }}
              >
                <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                  <select
                    value={selectedOrgSlug}
                    onChange={(e) => setSelectedOrgSlug(e.target.value)}
                    style={{
                      flex: 1,
                      padding: "8px 12px",
                      borderRadius: "8px",
                      border: "1px solid var(--color-border)",
                      background: "var(--ms-bg, #090d16)",
                      color: "inherit",
                      fontSize: "13px",
                    }}
                  >
                    {organizations.length === 0 && <option value="">No organizations yet — create one →</option>}
                    {organizations.map((org) => (
                      <option key={org.id} value={org.slug}>
                        @{org.slug} — {org.name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => setShowNewOrgForm((prev) => !prev)}
                    style={{
                      padding: "8px 12px",
                      borderRadius: "8px",
                      border: "1px solid var(--color-border)",
                      background: "transparent",
                      color: "var(--ms-brand, #3b82f6)",
                      fontSize: "12px",
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    + New Org
                  </button>
                </div>

                {showNewOrgForm && (
                  <div style={{ marginTop: "10px", display: "flex", gap: "8px", flexWrap: "wrap" }}>
                    <input
                      type="text"
                      placeholder="org-slug (e.g. acme-aero)"
                      value={newOrgSlug}
                      onChange={(e) => setNewOrgSlug(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ""))}
                      style={{
                        flex: 1,
                        padding: "7px 10px",
                        borderRadius: "6px",
                        border: "1px solid var(--color-border)",
                        background: "var(--ms-bg)",
                        color: "inherit",
                        fontSize: "13px",
                      }}
                    />
                    <input
                      type="text"
                      placeholder="Organization Name"
                      value={newOrgName}
                      onChange={(e) => setNewOrgName(e.target.value)}
                      style={{
                        flex: 1,
                        padding: "7px 10px",
                        borderRadius: "6px",
                        border: "1px solid var(--color-border)",
                        background: "var(--ms-bg)",
                        color: "inherit",
                        fontSize: "13px",
                      }}
                    />
                    <button
                      type="button"
                      onClick={handleCreateNewOrg}
                      style={{
                        padding: "7px 14px",
                        borderRadius: "6px",
                        border: "none",
                        background: "#2563eb",
                        color: "#fff",
                        fontSize: "12px",
                        fontWeight: 700,
                        cursor: "pointer",
                      }}
                    >
                      Create Org
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 2. Space Name, URL Slug & Tagline */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
            <div>
              <label style={{ display: "block", fontSize: "13px", fontWeight: 600, marginBottom: "6px" }}>
                2. Space Name
              </label>
              <input
                type="text"
                required
                placeholder="e.g. F-150 Lightning BMS"
                value={name}
                onChange={(e) => handleNameChange(e.target.value)}
                style={{
                  width: "100%",
                  padding: "9px 12px",
                  borderRadius: "8px",
                  border: "1px solid var(--color-border)",
                  background: "var(--ms-bg, #090d16)",
                  color: "inherit",
                  fontSize: "14px",
                  boxSizing: "border-box",
                }}
              />
            </div>
            <div>
              <label style={{ display: "block", fontSize: "13px", fontWeight: 600, marginBottom: "6px" }}>
                Space URL:{" "}
                <span style={{ color: "var(--ms-brand)" }}>
                  {containerPreview}/{slug || "..."}
                </span>
              </label>
              <input
                type="text"
                required
                placeholder="e.g. f150-lightning-bms"
                value={slug}
                onChange={(e) => {
                  setSlugManuallyEdited(true);
                  setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ""));
                }}
                style={{
                  width: "100%",
                  padding: "9px 12px",
                  borderRadius: "8px",
                  border: "1px solid var(--color-border)",
                  background: "var(--ms-bg, #090d16)",
                  color: "inherit",
                  fontSize: "14px",
                  fontFamily: "monospace",
                  boxSizing: "border-box",
                }}
              />
            </div>
          </div>

          <div>
            <label style={{ display: "block", fontSize: "13px", fontWeight: 600, marginBottom: "6px" }}>
              Engineering Tagline / Scope Summary
            </label>
            <input
              type="text"
              placeholder="High-voltage thermal management, DAE simulation baselines, and ISO 26262 safety case"
              value={tagline}
              onChange={(e) => setTagline(e.target.value)}
              style={{
                width: "100%",
                padding: "9px 12px",
                borderRadius: "8px",
                border: "1px solid var(--color-border)",
                background: "var(--ms-bg, #090d16)",
                color: "inherit",
                fontSize: "13px",
                boxSizing: "border-box",
              }}
            />
          </div>

          {/* 3. Industry Domain Blueprint Selector */}
          <div>
            <label style={{ display: "block", fontSize: "13px", fontWeight: 600, marginBottom: "8px" }}>
              3. Industry Domain Blueprint (Configures Languages, Channels, Living Docs & PLM Gates)
            </label>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(205px, 1fr))", gap: "8px" }}>
              {presets.map((preset) => {
                const isSelected = preset.id === selectedPreset;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => setSelectedPreset(preset.id)}
                    style={{
                      padding: "10px 12px",
                      borderRadius: "10px",
                      border: isSelected ? `2px solid ${preset.accentColor}` : "1px solid var(--color-border, #334155)",
                      background: isSelected ? "rgba(59, 130, 246, 0.1)" : "transparent",
                      color: "inherit",
                      textAlign: "left",
                      cursor: "pointer",
                    }}
                  >
                    <div
                      style={{ fontWeight: 700, fontSize: "13px", color: isSelected ? preset.accentColor : "inherit" }}
                    >
                      {preset.shortLabel}
                    </div>
                    <div
                      style={{
                        fontSize: "11px",
                        color: "var(--color-text-muted)",
                        marginTop: "4px",
                        lineHeight: 1.35,
                      }}
                    >
                      {preset.languages.slice(0, 5).join(", ")}
                      {preset.languages.length > 5 ? ` +${preset.languages.length - 5}` : ""}
                    </div>
                  </button>
                );
              })}
            </div>

            {activePreset && (
              <div
                style={{
                  marginTop: "10px",
                  padding: "10px 12px",
                  borderRadius: "8px",
                  background: "rgba(30, 41, 59, 0.5)",
                  fontSize: "12px",
                  color: "var(--color-text-secondary)",
                }}
              >
                <div>
                  <strong>Replaces:</strong> {activePreset.replacesTools.join(" • ")}
                </div>
                <div style={{ marginTop: "4px" }}>
                  <strong>Standards & Compliance:</strong> {activePreset.complianceStandards.join(" • ")}
                </div>
              </div>
            )}
          </div>

          {/* 4. Visibility */}
          <div style={{ display: "flex", gap: "12px", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", gap: "8px" }}>
              {(["public", "internal", "private"] as SpaceVisibility[]).map((vis) => (
                <button
                  key={vis}
                  type="button"
                  onClick={() => setVisibility(vis)}
                  style={{
                    padding: "6px 12px",
                    borderRadius: "6px",
                    border:
                      visibility === vis
                        ? "1px solid var(--ms-brand, #3b82f6)"
                        : "1px solid var(--color-border, #334155)",
                    background: visibility === vis ? "rgba(59, 130, 246, 0.16)" : "transparent",
                    color: "inherit",
                    fontSize: "12px",
                    fontWeight: 600,
                    textTransform: "capitalize",
                    cursor: "pointer",
                  }}
                >
                  {vis}
                </button>
              ))}
            </div>

            <div style={{ display: "flex", gap: "10px" }}>
              <button
                type="button"
                onClick={onClose}
                style={{
                  padding: "9px 16px",
                  borderRadius: "8px",
                  border: "1px solid var(--color-border)",
                  background: "transparent",
                  color: "inherit",
                  fontSize: "13px",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                style={{
                  padding: "9px 18px",
                  borderRadius: "8px",
                  border: "none",
                  background: "var(--ms-brand, #2563eb)",
                  color: "#ffffff",
                  fontSize: "13px",
                  fontWeight: 700,
                  cursor: submitting ? "wait" : "pointer",
                }}
              >
                {submitting ? "Provisioning Git Vault & Channels..." : "Create Space →"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};

export default CreateSpaceModal;
