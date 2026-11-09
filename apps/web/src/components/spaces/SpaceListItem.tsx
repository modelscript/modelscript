// SPDX-License-Identifier: AGPL-3.0-or-later

import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { SpaceRecord } from "../../api";
import { PRESET_BADGES } from "./presetBadges";

export const SpaceListItem: React.FC<{ space: SpaceRecord }> = ({ space }) => {
  const navigate = useNavigate();
  const [isHovered, setIsHovered] = useState(false);

  const badge = PRESET_BADGES[space.domain_preset] ?? { label: "Systems & DAE", color: "#3b82f6" };
  const languages = Array.isArray(space.settings?.["languages"])
    ? (space.settings["languages"] as string[])
    : ["modelica", "sysml2", "step"];

  const spaceUrl = `/@${space.owner_namespace}/${space.slug}`;

  const handleRowClick = () => {
    navigate(spaceUrl);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      navigate(spaceUrl);
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={handleRowClick}
      onKeyDown={handleKeyDown}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "16px",
        padding: "14px 18px",
        borderBottom: "1px solid var(--color-border)",
        background: isHovered ? "var(--surface-row-hover, var(--ms-surface-hover))" : "transparent",
        transition: "background-color 0.15s ease",
        cursor: "pointer",
        outline: "none",
        flexWrap: "wrap",
      }}
    >
      {/* Left Column: Avatar + Title/Namespace + Tagline */}
      <div style={{ display: "flex", alignItems: "center", gap: "14px", minWidth: 0, flex: "1 1 340px" }}>
        <div
          style={{
            width: "38px",
            height: "38px",
            borderRadius: "6px",
            background: `color-mix(in srgb, ${badge.color} 14%, transparent)`,
            border: `1px solid color-mix(in srgb, ${badge.color} 30%, transparent)`,
            color: badge.color,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontWeight: 800,
            fontSize: "14px",
            flexShrink: 0,
          }}
        >
          {space.name.slice(0, 2).toUpperCase()}
        </div>

        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
            <span
              style={{
                fontSize: "15px",
                fontWeight: 700,
                color: isHovered ? "var(--ms-brand, #3b82f6)" : "var(--color-text-heading, var(--color-text-primary))",
                transition: "color 0.15s ease",
              }}
            >
              {space.name}
            </span>

            <span style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>
              <Link
                to={`/@${space.owner_namespace}`}
                onClick={(e) => e.stopPropagation()}
                style={{
                  color: "var(--color-text-secondary)",
                  textDecoration: "none",
                  fontWeight: 600,
                }}
                onMouseEnter={(e) => (e.currentTarget.style.textDecoration = "underline")}
                onMouseLeave={(e) => (e.currentTarget.style.textDecoration = "none")}
              >
                {space.owner_type === "organization" ? "🏢 " : "👤 "}@{space.owner_namespace}
              </Link>
              <span style={{ fontFamily: "var(--font-mono, monospace)" }}>/{space.slug}</span>
            </span>
          </div>

          {space.tagline && (
            <p
              style={{
                margin: "4px 0 0",
                fontSize: "12.5px",
                color: "var(--color-text-secondary)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {space.tagline}
            </p>
          )}
        </div>
      </div>

      {/* Right Column: Languages + Telemetry + Category Badge */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "14px",
          flexShrink: 0,
          fontSize: "12px",
          color: "var(--color-text-muted)",
        }}
      >
        {/* Top 3 languages */}
        <div style={{ display: "flex", gap: "4px" }}>
          {languages.slice(0, 3).map((lang) => (
            <span
              key={lang}
              style={{
                padding: "2px 6px",
                borderRadius: "4px",
                fontSize: "10.5px",
                fontFamily: "var(--font-mono, monospace)",
                background: "var(--color-code-bg, var(--ms-surface-hover))",
                border: "1px solid var(--color-border)",
                color: "var(--color-text-muted)",
              }}
            >
              .{lang}
            </span>
          ))}
        </div>

        {/* Telemetry stats */}
        <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
          <span>👥 {space.member_count}</span>
          <span>★ {space.follower_count}</span>
        </div>

        {/* Category badge */}
        <span
          style={{
            padding: "3px 9px",
            borderRadius: "999px",
            fontSize: "11px",
            fontWeight: 600,
            background: `color-mix(in srgb, ${badge.color} 12%, transparent)`,
            color: badge.color,
            border: `1px solid color-mix(in srgb, ${badge.color} 28%, transparent)`,
            whiteSpace: "nowrap",
          }}
        >
          {badge.label}
        </span>
      </div>
    </div>
  );
};

export default SpaceListItem;
