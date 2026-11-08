// SPDX-License-Identifier: AGPL-3.0-or-later

import React from "react";
import { Link } from "react-router-dom";
import type { SpaceRecord } from "../../api";

const PRESET_BADGES: Record<string, { label: string; color: string }> = {
  systems_general: { label: "Systems & DAE", color: "#3b82f6" },
  oil_gas_process: { label: "Oil, Gas & Process", color: "#f59e0b" },
  power_rf_grid: { label: "Power Grids & RF", color: "#10b981" },
  automotive_robotics: { label: "Automotive & Robotics", color: "#ef4444" },
  aerospace_cad: { label: "3D CAD & Aerospace", color: "#8b5cf6" },
  pharma_chem_bio: { label: "Pharma & Bio", color: "#ec4899" },
  med_radiology: { label: "Medical & Biomech", color: "#06b6d4" },
};

export const SpaceCard: React.FC<{ space: SpaceRecord }> = ({ space }) => {
  const badge = PRESET_BADGES[space.domain_preset] ?? { label: "Systems & DAE", color: "#3b82f6" };
  const languages = Array.isArray(space.settings?.["languages"])
    ? (space.settings["languages"] as string[])
    : ["modelica", "sysml2", "step"];

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: "16px",
        borderRadius: "12px",
        border: "1px solid var(--color-border, #1e293b)",
        background: "var(--ms-bg-elv, rgba(15, 23, 42, 0.55))",
        gap: "12px",
        transition: "border-color 0.15s ease, transform 0.15s ease",
      }}
    >
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "8px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", minWidth: 0 }}>
            <div
              style={{
                width: "38px",
                height: "38px",
                borderRadius: "10px",
                background: `${badge.color}22`,
                border: `1px solid ${badge.color}55`,
                color: badge.color,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontWeight: 800,
                fontSize: "15px",
                flexShrink: 0,
              }}
            >
              {space.name.slice(0, 2).toUpperCase()}
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>
                <Link
                  to={`/@${space.owner_namespace}`}
                  style={{ color: "var(--color-text-secondary)", textDecoration: "none", fontWeight: 600 }}
                >
                  {space.owner_type === "organization" ? "🏢 " : "👤 "}@{space.owner_namespace}
                </Link>{" "}
                / <span style={{ fontFamily: "monospace" }}>{space.slug}</span>
              </div>
              <Link
                to={`/@${space.owner_namespace}/${space.slug}`}
                style={{
                  display: "block",
                  fontSize: "16px",
                  fontWeight: 700,
                  color: "var(--color-text-primary)",
                  textDecoration: "none",
                  marginTop: "2px",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {space.name}
              </Link>
            </div>
          </div>

          <span
            style={{
              padding: "3px 8px",
              borderRadius: "999px",
              fontSize: "11px",
              fontWeight: 700,
              background: `${badge.color}20`,
              color: badge.color,
              border: `1px solid ${badge.color}44`,
              whiteSpace: "nowrap",
            }}
          >
            {badge.label}
          </span>
        </div>

        {space.tagline && (
          <p
            style={{
              margin: "10px 0 0",
              fontSize: "13px",
              color: "var(--color-text-secondary)",
              lineHeight: 1.45,
            }}
          >
            {space.tagline}
          </p>
        )}
      </div>

      <div>
        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginBottom: "12px" }}>
          {languages.slice(0, 5).map((lang) => (
            <span
              key={lang}
              style={{
                padding: "2px 7px",
                borderRadius: "5px",
                fontSize: "11px",
                fontFamily: "monospace",
                background: "rgba(148, 163, 184, 0.1)",
                color: "var(--color-text-muted)",
              }}
            >
              .{lang}
            </span>
          ))}
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            paddingTop: "10px",
            borderTop: "1px solid var(--color-border, #1e293b)",
            fontSize: "12px",
            color: "var(--color-text-muted)",
          }}
        >
          <div style={{ display: "flex", gap: "12px" }}>
            <span>👥 {space.member_count} members</span>
            <span>★ {space.follower_count} followers</span>
          </div>

          <div style={{ display: "flex", gap: "8px" }}>
            <Link
              to={`/@${space.owner_namespace}/${space.slug}?tab=chat`}
              style={{
                padding: "4px 10px",
                borderRadius: "6px",
                border: "1px solid var(--color-border)",
                color: "var(--color-text-primary)",
                textDecoration: "none",
                fontWeight: 600,
                fontSize: "12px",
              }}
            >
              💬 Chat
            </Link>
            <Link
              to={`/@${space.owner_namespace}/${space.slug}`}
              style={{
                padding: "4px 10px",
                borderRadius: "6px",
                background: "rgba(59, 130, 246, 0.15)",
                color: "var(--ms-brand, #3b82f6)",
                textDecoration: "none",
                fontWeight: 700,
                fontSize: "12px",
              }}
            >
              Open Space →
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SpaceCard;
