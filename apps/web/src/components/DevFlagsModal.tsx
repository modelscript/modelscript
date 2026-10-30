// SPDX-License-Identifier: AGPL-3.0-or-later

import { CheckIcon, SearchIcon, SyncIcon, XIcon } from "@primer/octicons-react";
import React, { useMemo, useRef, useState } from "react";
import { DEFAULT_FRONTEND_FLAGS, useFeatureFlags } from "../FeatureFlagContext";
import { useFocusTrap } from "../hooks/useFocusTrap";

interface DevFlagsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface FlagMetadata {
  title: string;
  category: "Core" | "HPC & Compute" | "Simulation" | "Community & Federation" | "Advanced";
  description: string;
}

const FLAG_METADATA: Record<string, FlagMetadata> = {
  cae_cloud_solver: {
    title: "Cloud HPC Jobs & Solvers",
    category: "HPC & Compute",
    description: "Enables the Cloud Jobs tab (/jobs), remote SLURM execution, and cluster solver queues.",
  },
  heavy_vscode_ide: {
    title: "Full VS Code Web IDE",
    category: "Core",
    description: "Enables the full Monaco/VSCode workspace IDE (/ide) in the main navigation.",
  },
  billing_stripe_live: {
    title: "Stripe Billing & Token Top-Up",
    category: "Core",
    description: "Enables credit wallet top-up modals, Stripe checkout sessions, and compute invoices.",
  },
  digital_twins: {
    title: "Digital Twins & Telemetry",
    category: "Simulation",
    description: "Enables real-time operational telemetry, MHE state estimation, and sensor streaming.",
  },
  cosim_mqtt: {
    title: "MQTT Live Co-Simulation",
    category: "Simulation",
    description: "Enables distributed real-time co-simulation over MQTT broker websockets.",
  },
  cad_step_viewer: {
    title: "Interactive 3D CAD STEP Viewer",
    category: "Simulation",
    description: "Enables Three.js WebGL CAD rendering for STEP models and 3D boundary markers.",
  },
  modelica_simulation: {
    title: "Modelica Simulation Runner",
    category: "Simulation",
    description: "In-browser WASM simulation using SUNDIALS CVODE, RK4, and DOPRI5 integrators.",
  },
  morsel_playground: {
    title: "Morsel Simulation Playground",
    category: "Simulation",
    description: "Interactive block-based physical modeling and equation playground.",
  },
  package_browser: {
    title: "Package Ecosystem Browser",
    category: "Core",
    description: "Modelica and SysML library package registry, versioning, and documentation views.",
  },
  community_social: {
    title: "Community Social & Feeds",
    category: "Community & Federation",
    description: "Social posts, engineering discussions, paper citations, and collaborative comments.",
  },
  activitypub_federation: {
    title: "ActivityPub Federation",
    category: "Community & Federation",
    description: "Federated social networking protocol for cross-instance model discovery.",
  },
  sysml2_omg_api: {
    title: "SysML v2 OMG API Endpoints",
    category: "Advanced",
    description: "OMG standard REST APIs for SysML v2 / KerML modeling environments.",
  },
  digital_thread_explorer: {
    title: "Digital Thread Knowledge Graph",
    category: "Advanced",
    description: "Cross-domain hypergraph tracing requirements, CAD, CFD, and Modelica artifacts.",
  },
  experimental_viewers: {
    title: "Experimental WebGPU Viewers",
    category: "Advanced",
    description: "Zero-copy WebGPU LBM lattice fluid animations and high-order FEA stress shaders.",
  },
  bot_accounts: {
    title: "Simulation Bot Accounts",
    category: "Community & Federation",
    description: "Automated simulation benchmark runners and verification bot accounts.",
  },
  sparql_rdf_endpoints: {
    title: "SPARQL / RDF Semantic Endpoints",
    category: "Advanced",
    description: "OWL2 and RDF semantic query engine for ontology-driven engineering.",
  },
  mcp_gateway_sse: {
    title: "Model Context Protocol (MCP) Gateway",
    category: "Advanced",
    description: "Server-Sent Events gateway for AI coding agent inspection and tool calls.",
  },
};

export const DevFlagsModal: React.FC<DevFlagsModalProps> = ({ isOpen, onClose }) => {
  const { flags, overrides, isEnabled, setFlagOverride, resetAllOverrides } = useFeatureFlags();
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("All");

  const modalRef = useRef<HTMLDivElement>(null);
  useFocusTrap(modalRef, isOpen, { onEscape: onClose });

  const allKeys = useMemo(() => {
    const set = new Set<string>([
      ...Object.keys(DEFAULT_FRONTEND_FLAGS),
      ...Object.keys(flags),
      ...Object.keys(overrides),
    ]);
    return Array.from(set).sort();
  }, [flags, overrides]);

  const activeOverridesCount = Object.keys(overrides).length;

  const categories = useMemo(() => {
    const cats = new Set<string>(["All"]);
    allKeys.forEach((k) => {
      const meta = FLAG_METADATA[k];
      if (meta) cats.add(meta.category);
    });
    return Array.from(cats);
  }, [allKeys]);

  const filteredKeys = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allKeys.filter((k) => {
      const meta = FLAG_METADATA[k];
      const title = meta?.title.toLowerCase() || "";
      const desc = meta?.description.toLowerCase() || "";
      const matchesSearch = !q || k.toLowerCase().includes(q) || title.includes(q) || desc.includes(q);
      const matchesCategory = selectedCategory === "All" || (meta && meta.category === selectedCategory);
      return matchesSearch && matchesCategory;
    });
  }, [allKeys, search, selectedCategory]);

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: "var(--color-overlay-backdrop, rgba(15, 23, 42, 0.55))",
        backdropFilter: "blur(6px)",
        zIndex: 10000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "20px",
      }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="dev-flags-title"
    >
      <div
        ref={modalRef}
        style={{
          width: "100%",
          maxWidth: "760px",
          maxHeight: "88vh",
          backgroundColor: "var(--surface-overlay, var(--ms-bg-elv))",
          border: "1px solid var(--color-border-default)",
          borderRadius: "14px",
          boxShadow: "var(--ms-shadow-pop)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          color: "var(--color-text-primary)",
          fontFamily: "var(--font-sans, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            padding: "16px 20px",
            borderBottom: "1px solid var(--color-border)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            background: "linear-gradient(180deg, var(--color-accent-purple-bg) 0%, transparent 100%)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <span style={{ fontSize: "20px" }}>🚩</span>
            <div>
              <div style={{ fontSize: "16px", fontWeight: 700, display: "flex", alignItems: "center", gap: "8px" }}>
                <span id="dev-flags-title">Developer Feature Flags</span>
                {activeOverridesCount > 0 && (
                  <span
                    style={{
                      fontSize: "11px",
                      fontWeight: 600,
                      backgroundColor: "var(--status-warning-bg)",
                      color: "var(--color-warning)",
                      border: "1px solid var(--status-warning-border)",
                      padding: "2px 7px",
                      borderRadius: "9999px",
                      fontFamily: "var(--font-mono, monospace)",
                    }}
                  >
                    {activeOverridesCount} {activeOverridesCount === 1 ? "override" : "overrides"} active
                  </span>
                )}
              </div>
              <div style={{ fontSize: "12px", color: "var(--color-text-muted)", marginTop: "2px" }}>
                Instant real-time toggles persisted in localStorage with zero page reload
              </div>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            {activeOverridesCount > 0 && (
              <button
                type="button"
                onClick={resetAllOverrides}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "5px",
                  background: "var(--color-danger-subtle)",
                  border: "1px solid var(--color-danger-muted)",
                  color: "var(--color-danger-fg)",
                  borderRadius: "6px",
                  padding: "5px 10px",
                  fontSize: "12px",
                  fontWeight: 600,
                  cursor: "pointer",
                  transition: "all 0.15s ease",
                }}
                title="Clear all overrides and revert to server defaults"
              >
                <SyncIcon size={12} />
                <span>Reset to Defaults</span>
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              style={{
                background: "transparent",
                border: "none",
                color: "var(--color-text-muted)",
                cursor: "pointer",
                padding: "6px",
                display: "flex",
                alignItems: "center",
                borderRadius: "6px",
              }}
              aria-label="Close modal"
            >
              <XIcon size={18} />
            </button>
          </div>
        </div>

        {/* Filter & Search Bar */}
        <div
          style={{
            padding: "12px 20px",
            borderBottom: "1px solid var(--color-border)",
            display: "flex",
            flexDirection: "column",
            gap: "10px",
            backgroundColor: "var(--color-canvas-subtle)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              background: "var(--color-search-bg)",
              border: "1px solid var(--color-search-border)",
              borderRadius: "8px",
              padding: "6px 12px",
            }}
          >
            <SearchIcon size={14} style={{ color: "var(--color-text-muted)" }} />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search flags by name, key, or category..."
              style={{
                flex: 1,
                background: "transparent",
                border: "none",
                outline: "none",
                color: "inherit",
                fontSize: "13px",
              }}
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                style={{
                  background: "none",
                  border: "none",
                  color: "var(--color-text-muted)",
                  cursor: "pointer",
                  padding: "2px",
                }}
              >
                <XIcon size={12} />
              </button>
            )}
          </div>

          {/* Category Tabs */}
          <div style={{ display: "flex", gap: "6px", overflowX: "auto", paddingBottom: "2px" }}>
            {categories.map((cat) => {
              const isSelected = selectedCategory === cat;
              return (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setSelectedCategory(cat)}
                  style={{
                    background: isSelected ? "var(--color-accent-purple)" : "var(--ms-surface-hover)",
                    border: `1px solid ${isSelected ? "var(--color-accent-purple)" : "var(--color-border-default)"}`,
                    color: isSelected ? "#ffffff" : "var(--color-text-muted)",
                    borderRadius: "6px",
                    padding: "3px 10px",
                    fontSize: "11px",
                    fontWeight: 600,
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                    transition: "all 0.15s ease",
                  }}
                >
                  {cat}
                </button>
              );
            })}
          </div>
        </div>

        {/* Flag List */}
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "12px 20px",
            display: "flex",
            flexDirection: "column",
            gap: "10px",
          }}
        >
          {filteredKeys.length === 0 ? (
            <div style={{ textAlign: "center", padding: "40px 20px", color: "var(--color-text-muted)" }}>
              No feature flags found matching "{search}"
            </div>
          ) : (
            filteredKeys.map((key) => {
              const meta = FLAG_METADATA[key];
              const effective = isEnabled(key);
              const hasOverride = key in overrides;
              const serverDefault = flags[key] ?? DEFAULT_FRONTEND_FLAGS[key] ?? false;

              return (
                <div
                  key={key}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "12px 16px",
                    borderRadius: "10px",
                    backgroundColor: effective ? "var(--color-accent-purple-bg)" : "var(--color-canvas-subtle)",
                    border: `1px solid ${
                      hasOverride
                        ? "var(--status-warning-border)"
                        : effective
                          ? "var(--color-accent-purple-border)"
                          : "var(--color-border)"
                    }`,
                    transition: "all 0.15s ease",
                  }}
                >
                  <div style={{ flex: 1, marginRight: "16px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                      <span style={{ fontSize: "14px", fontWeight: 700, color: "var(--color-text-primary)" }}>
                        {meta?.title || key}
                      </span>
                      <code
                        style={{
                          fontSize: "11px",
                          fontFamily: "var(--font-mono, monospace)",
                          padding: "1px 6px",
                          borderRadius: "4px",
                          backgroundColor: "var(--color-code-bg)",
                          color: "var(--color-accent-cyan)",
                        }}
                      >
                        {key}
                      </code>
                      {hasOverride && (
                        <span
                          style={{
                            fontSize: "10px",
                            fontWeight: 700,
                            padding: "1px 6px",
                            borderRadius: "4px",
                            backgroundColor: "var(--status-warning-bg)",
                            color: "var(--color-warning)",
                            border: "1px solid var(--status-warning-border)",
                            letterSpacing: "0.5px",
                          }}
                        >
                          OVERRIDDEN
                        </span>
                      )}
                    </div>
                    <div
                      style={{
                        fontSize: "12px",
                        color: "var(--color-text-muted)",
                        marginTop: "3px",
                        lineHeight: 1.4,
                      }}
                    >
                      {meta?.description ||
                        `Evaluates feature flag '${key}'. Default: ${serverDefault ? "enabled" : "disabled"}.`}
                    </div>
                  </div>

                  {/* Toggle Controls */}
                  <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    <button
                      type="button"
                      onClick={() => setFlagOverride(key, false)}
                      style={{
                        background: !effective ? "var(--color-danger-subtle)" : "var(--ms-surface-hover)",
                        border: `1px solid ${!effective ? "var(--color-danger-muted)" : "var(--color-border-default)"}`,
                        color: !effective ? "var(--color-danger-fg)" : "var(--color-text-muted)",
                        borderRadius: "6px",
                        padding: "5px 10px",
                        fontSize: "11px",
                        fontWeight: 700,
                        cursor: "pointer",
                        transition: "all 0.15s ease",
                      }}
                      title="Force flag OFF"
                    >
                      OFF
                    </button>

                    <button
                      type="button"
                      onClick={() => setFlagOverride(key, true)}
                      style={{
                        background: effective ? "var(--status-verified-bg)" : "var(--ms-surface-hover)",
                        border: `1px solid ${effective ? "var(--status-verified-border)" : "var(--color-border-default)"}`,
                        color: effective ? "var(--color-success)" : "var(--color-text-muted)",
                        borderRadius: "6px",
                        padding: "5px 10px",
                        fontSize: "11px",
                        fontWeight: 700,
                        cursor: "pointer",
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "4px",
                        transition: "all 0.15s ease",
                      }}
                      title="Force flag ON"
                    >
                      {effective && <CheckIcon size={12} />}
                      ON
                    </button>

                    {hasOverride && (
                      <button
                        type="button"
                        onClick={() => setFlagOverride(key, null)}
                        style={{
                          background: "transparent",
                          border: "1px dashed var(--color-border-default)",
                          color: "var(--color-text-muted)",
                          borderRadius: "6px",
                          padding: "5px 8px",
                          fontSize: "11px",
                          cursor: "pointer",
                          transition: "all 0.15s ease",
                        }}
                        title={`Clear override (reverts to default: ${serverDefault ? "ON" : "OFF"})`}
                      >
                        Reset
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: "12px 20px",
            borderTop: "1px solid var(--color-border)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            fontSize: "12px",
            color: "var(--color-text-muted)",
            backgroundColor: "var(--color-canvas-subtle)",
          }}
        >
          <div>
            Tip: You can also override flags via URL query parameters:{" "}
            <code style={{ color: "var(--color-accent-cyan)" }}>?ff_cae_cloud_solver=1</code>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: "var(--color-accent-purple)",
              border: "none",
              color: "#ffffff",
              borderRadius: "6px",
              padding: "6px 14px",
              fontSize: "12px",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
