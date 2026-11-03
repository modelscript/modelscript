// SPDX-License-Identifier: AGPL-3.0-or-later

import React from "react";
import InvertedSvg from "../../../components/InvertedSvg";
import { encodePackagePath } from "../../../util/url";
import { inferPackageDomains } from "../constants";

export interface PackageIconProps {
  name: string;
  version: string;
  domains?: string[] | undefined;
  description?: string | null | undefined;
  size?: number | undefined;
}

interface DomainThemeSpec {
  bg: string;
  border: string;
  color: string;
  renderGlyph: (size: number) => React.ReactNode;
}

function getDomainTheme(primaryDomain: string): DomainThemeSpec {
  switch (primaryDomain) {
    case "power":
    case "pscad":
      return {
        bg: "linear-gradient(135deg, rgba(2, 132, 199, 0.16) 0%, rgba(6, 182, 212, 0.08) 100%)",
        border: "rgba(2, 132, 199, 0.35)",
        color: "#0284c7",
        renderGlyph: (s) => (
          <svg
            width={s}
            height={s}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
          </svg>
        ),
      };
    case "robotics":
    case "urdf":
      return {
        bg: "linear-gradient(135deg, rgba(5, 150, 105, 0.16) 0%, rgba(16, 185, 129, 0.08) 100%)",
        border: "rgba(5, 150, 105, 0.35)",
        color: "#059669",
        renderGlyph: (s) => (
          <svg
            width={s}
            height={s}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="6" cy="18" r="2.5" />
            <circle cx="12" cy="8" r="2.5" />
            <path d="M7.5 16L10.5 10" />
            <path d="M14.5 8H19" />
            <path d="M19 5.5V10.5" />
            <path d="M3 21h6" />
          </svg>
        ),
      };
    case "hydraulics":
    case "epanet":
      return {
        bg: "linear-gradient(135deg, rgba(14, 165, 233, 0.16) 0%, rgba(56, 189, 248, 0.08) 100%)",
        border: "rgba(14, 165, 233, 0.35)",
        color: "#0284c7",
        renderGlyph: (s) => (
          <svg
            width={s}
            height={s}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z" />
          </svg>
        ),
      };
    case "verification":
      return {
        bg: "linear-gradient(135deg, rgba(79, 70, 229, 0.16) 0%, rgba(129, 140, 248, 0.08) 100%)",
        border: "rgba(79, 70, 229, 0.35)",
        color: "#4f46e5",
        renderGlyph: (s) => (
          <svg
            width={s}
            height={s}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            <path d="m9 12 2 2 4-4" />
          </svg>
        ),
      };
    case "cad":
    case "step":
    case "scad":
      return {
        bg: "linear-gradient(135deg, rgba(8, 145, 178, 0.16) 0%, rgba(6, 182, 212, 0.08) 100%)",
        border: "rgba(8, 145, 178, 0.35)",
        color: "#0891b2",
        renderGlyph: (s) => (
          <svg
            width={s}
            height={s}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
            <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
            <line x1="12" y1="22.08" x2="12" y2="12" />
          </svg>
        ),
      };
    case "sysml2":
    case "sysml":
      return {
        bg: "linear-gradient(135deg, rgba(147, 51, 234, 0.16) 0%, rgba(168, 85, 247, 0.08) 100%)",
        border: "rgba(147, 51, 234, 0.35)",
        color: "#9333ea",
        renderGlyph: (s) => (
          <svg
            width={s}
            height={s}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="3" y="3" width="7" height="6" rx="1.5" />
            <rect x="14" y="3" width="7" height="6" rx="1.5" />
            <rect x="8.5" y="15" width="7" height="6" rx="1.5" />
            <path d="M6.5 9v3a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1V9" />
            <line x1="12" y1="13" x2="12" y2="15" />
          </svg>
        ),
      };
    case "fmu":
    case "ssp":
      return {
        bg: "linear-gradient(135deg, rgba(225, 29, 72, 0.16) 0%, rgba(244, 63, 94, 0.08) 100%)",
        border: "rgba(225, 29, 72, 0.35)",
        color: "#e11d48",
        renderGlyph: (s) => (
          <svg
            width={s}
            height={s}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="4" y="4" width="16" height="16" rx="2" />
            <rect x="9" y="9" width="6" height="6" />
            <path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 14h3M1 9h3M1 14h3" />
          </svg>
        ),
      };
    case "dataset":
    case "csv":
      return {
        bg: "linear-gradient(135deg, rgba(37, 99, 235, 0.16) 0%, rgba(59, 130, 246, 0.08) 100%)",
        border: "rgba(37, 99, 235, 0.35)",
        color: "#2563eb",
        renderGlyph: (s) => (
          <svg
            width={s}
            height={s}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <ellipse cx="12" cy="5" rx="9" ry="3" />
            <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
            <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
          </svg>
        ),
      };
    case "modelica":
    default:
      return {
        bg: "linear-gradient(135deg, rgba(217, 119, 6, 0.16) 0%, rgba(245, 158, 11, 0.08) 100%)",
        border: "rgba(217, 119, 6, 0.35)",
        color: "#d97706",
        renderGlyph: (s) => (
          <svg
            width={s}
            height={s}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M2 12h4l2.5-5 3 10 3-10 2.5 5h5" />
          </svg>
        ),
      };
  }
}

export const PackageIcon: React.FC<PackageIconProps> = ({ name, version, domains, description, size = 40 }) => {
  const rootClassName = name.includes("/") ? name.split("/")[1]! : name;
  const resolvedDomains = inferPackageDomains({ name, domains, description });
  const primaryDomain = resolvedDomains[0] || "modelica";
  const theme = getDomainTheme(primaryDomain);
  const glyphSize = Math.round(size * 0.5);

  const fallbackBox = (
    <div
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        borderRadius: "10px",
        background: theme.bg,
        border: `1px solid ${theme.border}`,
        color: theme.color,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
      }}
    >
      {theme.renderGlyph(glyphSize)}
    </div>
  );

  // Only attempt to load a Modelica root class icon.svg if the root class name is a valid Modelica identifier
  // and the package is not a known non-Modelica stdlib (such as SysML).
  const isModelicaIdentifier = /^[A-Za-z_][A-Za-z0-9_]*$/.test(rootClassName);
  const canHaveModelicaIcon =
    isModelicaIdentifier && name.toLowerCase() !== "sysml" && resolvedDomains.includes("modelica");

  if (!canHaveModelicaIcon) {
    return fallbackBox;
  }

  const iconUrl = `/api/v1/libraries/${encodePackagePath(name)}/${encodeURIComponent(version)}/classes/${encodeURIComponent(rootClassName)}/icon.svg`;

  return (
    <InvertedSvg
      src={iconUrl}
      alt={`${name} icon`}
      width={size}
      height={size}
      style={{ flexShrink: 0 }}
      fallback={fallbackBox}
    />
  );
};
