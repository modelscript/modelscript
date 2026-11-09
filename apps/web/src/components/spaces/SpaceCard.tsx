// SPDX-License-Identifier: AGPL-3.0-or-later

import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { SpaceRecord } from "../../api";
import { PRESET_BADGES } from "./presetBadges";

export const SpaceCard: React.FC<{ space: SpaceRecord }> = ({ space }) => {
  const navigate = useNavigate();
  const [isHovered, setIsHovered] = useState(false);

  const badge = PRESET_BADGES[space.domain_preset] ?? { label: "Systems & DAE", color: "#3b82f6" };
  const languages = Array.isArray(space.settings?.["languages"])
    ? (space.settings["languages"] as string[])
    : ["modelica", "sysml2", "step"];

  const spaceUrl = `/@${space.owner_namespace}/${space.slug}`;

  const handleCardClick = () => {
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
      onClick={handleCardClick}
      onKeyDown={handleKeyDown}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      style={{
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: "18px",
        borderRadius: "6px",
        border: isHovered
          ? "1px solid var(--color-accent-emphasis, var(--ms-brand, #0969da))"
          : "1px solid var(--color-border-default)",
        background: "var(--color-canvas-default)",
        gap: "14px",
        transition: "border-color 0.15s ease",
        cursor: "pointer",
        outline: "none",
        position: "relative",
      }}
    >
      <div>
        {/* Top Header: Avatar + Namespace + Full-Width Title (Category label moved to footer to let title breathe) */}
        <div style={{ display: "flex", alignItems: "flex-start", gap: "12px" }}>
          <div
            style={{
              width: "40px",
              height: "40px",
              borderRadius: "6px",
              background: `color-mix(in srgb, ${badge.color} 14%, transparent)`,
              border: `1px solid color-mix(in srgb, ${badge.color} 30%, transparent)`,
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
          <div style={{ minWidth: 0, flex: 1 }}>
            <div
              style={{
                fontSize: "12px",
                color: "var(--color-text-muted)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
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
              </Link>{" "}
              / <span style={{ fontFamily: "var(--font-mono, monospace)" }}>{space.slug}</span>
            </div>
            <div
              style={{
                fontSize: "16px",
                fontWeight: 700,
                lineHeight: 1.3,
                color: isHovered ? "var(--ms-brand, #3b82f6)" : "var(--color-text-heading, var(--color-text-primary))",
                marginTop: "3px",
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
                transition: "color 0.15s ease",
              }}
            >
              {space.name}
            </div>
          </div>
        </div>

        {/* Tagline */}
        {space.tagline && (
          <p
            style={{
              margin: "12px 0 0",
              fontSize: "13px",
              color: "var(--color-text-secondary)",
              lineHeight: 1.45,
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {space.tagline}
          </p>
        )}
      </div>

      <div>
        {/* Language Pills */}
        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginBottom: "12px" }}>
          {languages.slice(0, 5).map((lang) => (
            <span
              key={lang}
              style={{
                padding: "2px 7px",
                borderRadius: "5px",
                fontSize: "11px",
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

        {/* Card Footer: Telemetry on Left, Category Pill on Right (No redundant Chat/Open Space buttons) */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            paddingTop: "12px",
            borderTop: "1px solid var(--color-border)",
            fontSize: "12px",
            color: "var(--color-text-muted)",
          }}
        >
          <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
            <span>👥 {space.member_count}</span>
            <span>★ {space.follower_count}</span>
          </div>

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
              flexShrink: 0,
            }}
          >
            {badge.label}
          </span>
        </div>
      </div>
    </div>
  );
};

export default SpaceCard;
