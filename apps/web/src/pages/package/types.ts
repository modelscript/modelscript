// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  BookIcon,
  CodeIcon,
  CpuIcon,
  DatabaseIcon,
  DependabotIcon,
  FileIcon,
  GitCompareIcon,
  HistoryIcon,
  PackageIcon,
  WorkflowIcon,
} from "@primer/octicons-react";
import { Heading } from "@primer/react";
import React from "react";
import { Link } from "react-router-dom";
import styled, { css } from "styled-components";
import type { ArtifactViewerInfo } from "../../api";

/* ─── tab types ─── */

export type TabId = "readme" | "digital-thread" | "versions" | "compare" | "artifacts" | "dependencies";

export const TABS: { id: TabId; label: string; icon: React.ReactNode }[] = [
  { id: "readme", label: "Readme", icon: React.createElement(BookIcon, { size: 16 }) },
  { id: "digital-thread", label: "Digital Thread", icon: React.createElement(CpuIcon, { size: 16 }) },
  { id: "artifacts", label: "Artifacts", icon: React.createElement(FileIcon, { size: 16 }) },
  { id: "versions", label: "Versions", icon: React.createElement(HistoryIcon, { size: 16 }) },
  { id: "compare", label: "Compare", icon: React.createElement(GitCompareIcon, { size: 16 }) },
  { id: "dependencies", label: "Dependencies", icon: React.createElement(DependabotIcon, { size: 16 }) },
];

/* ─── polyglot domain classification ─── */

export type PolyglotDomain = "all" | "modelica" | "sysml2" | "cad" | "dataset" | "fmu" | "other";

export function classifyArtifactDomain(av: ArtifactViewerInfo): PolyglotDomain {
  const t = av.type.toLowerCase();
  const p = av.path.toLowerCase();
  const v = av.viewer?.viewer?.toLowerCase() || "";

  if (
    t === "cad" ||
    t === "step" ||
    p.endsWith(".step") ||
    p.endsWith(".stp") ||
    p.endsWith(".p21") ||
    p.endsWith(".scad") ||
    v === "cad-3d-viewer"
  ) {
    return "cad";
  }
  if (
    t === "sysml" ||
    t === "sysml2" ||
    t === "kerml" ||
    p.endsWith(".sysml") ||
    p.endsWith(".kerml") ||
    v === "sysml-architecture-viewer"
  ) {
    return "sysml2";
  }
  if (
    t === "dataset" ||
    t === "csv" ||
    p.endsWith(".csv") ||
    p.endsWith(".tsv") ||
    p.endsWith(".parquet") ||
    v === "dataset-table"
  ) {
    return "dataset";
  }
  if (t === "fmu" || p.endsWith(".fmu") || v === "fmu-simulator") {
    return "fmu";
  }
  if (t === "modelica" || t === "mo" || p.endsWith(".mo")) {
    return "modelica";
  }
  return "other";
}

export function getArtifactIcon(type: string, path?: string) {
  const t = type.toLowerCase();
  const p = path?.toLowerCase() || "";
  if (
    t === "cad" ||
    t === "step" ||
    p.endsWith(".step") ||
    p.endsWith(".stp") ||
    p.endsWith(".p21") ||
    p.endsWith(".scad")
  ) {
    return React.createElement(PackageIcon, {
      size: 14,
      style: { color: "var(--color-accent-cyan, #06b6d4)", flexShrink: 0 },
    });
  }
  if (t === "sysml" || t === "sysml2" || t === "kerml" || p.endsWith(".sysml") || p.endsWith(".kerml")) {
    return React.createElement(WorkflowIcon, { size: 14, style: { color: "#a855f7", flexShrink: 0 } });
  }
  if (t === "fmu" || p.endsWith(".fmu")) {
    return React.createElement(CpuIcon, { size: 14, style: { color: "#f43f5e", flexShrink: 0 } });
  }
  if (t === "dataset" || t === "csv" || p.endsWith(".csv") || p.endsWith(".tsv") || p.endsWith(".parquet")) {
    return React.createElement(DatabaseIcon, { size: 14, style: { color: "#3b82f6", flexShrink: 0 } });
  }
  if (t === "modelica" || t === "mo" || p.endsWith(".mo")) {
    return React.createElement(CodeIcon, { size: 14, style: { color: "#eab308", flexShrink: 0 } });
  }
  return React.createElement(FileIcon, { size: 14, style: { color: "var(--color-text-muted)", flexShrink: 0 } });
}

/* ─── format helpers ─── */

export function formatDate(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
  } catch {
    return dateStr;
  }
}

export function timeAgo(dateStr: string): string {
  try {
    const now = Date.now();
    const then = new Date(dateStr).getTime();
    const diffMs = now - then;
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    if (diffDays < 1) return "today";
    if (diffDays === 1) return "yesterday";
    if (diffDays < 30) return `${diffDays} days ago`;
    if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`;
    return `${Math.floor(diffDays / 365)} years ago`;
  } catch {
    return "";
  }
}

/* ─── styled components ─── */

export const glassCard = css`
  background: var(--color-bg-card, rgba(15, 23, 42, 0.65));
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border: 1px solid var(--color-border-glass, rgba(255, 255, 255, 0.1));
  border-radius: 14px;
  transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);

  &:hover {
    border-color: rgba(139, 92, 246, 0.35);
    box-shadow:
      0 8px 24px -6px rgba(0, 0, 0, 0.5),
      0 0 16px rgba(139, 92, 246, 0.12);
  }
`;

export const GlassCard = styled.div`
  ${glassCard}
  padding: 20px;
  margin-bottom: 16px;
`;

export const DocCard = styled.div`
  ${glassCard}
  padding: 32px;

  h1,
  h2,
  h3,
  h4 {
    color: var(--color-text-heading);
    margin-top: 24px;
    margin-bottom: 12px;
  }
  p {
    line-height: 1.7;
    color: var(--color-text-primary);
    margin-bottom: 16px;
  }
  a {
    color: var(--color-link);
    text-decoration: none;
  }
  a:hover {
    text-decoration: underline;
  }
  code {
    background: var(--color-code-bg);
    padding: 2px 6px;
    border-radius: 4px;
    font-size: 0.9em;
  }
  pre {
    background: var(--color-pre-bg);
    padding: 16px;
    border-radius: 6px;
    overflow-x: auto;
  }
  pre code {
    background: transparent;
    padding: 0;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    margin-bottom: 16px;
  }
  th,
  td {
    border: 1px solid var(--color-table-border);
    padding: 8px 12px;
    text-align: left;
  }
  th {
    background: var(--color-table-header-bg);
    color: var(--color-text-heading);
  }
  img {
    max-width: 100%;
  }
`;

export const SectionTitle = styled(Heading)`
  font-size: 14px !important;
  color: var(--color-text-muted) !important;
  margin-bottom: 12px !important;
  font-weight: 600 !important;
`;

export const MetaGrid = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 24px;
  margin-bottom: 24px;
`;

export const MetaBlock = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 24px;
`;

export const MetaLabel = styled.span`
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text-muted);
`;

export const MetaValue = styled.span`
  font-size: 14px;
  color: var(--color-text-heading);
  font-weight: 600;
  word-break: break-word;
  display: flex;
  align-items: center;
  gap: 8px;
`;

export const Divider = styled.hr`
  border: none;
  border-top: 1px solid var(--color-border);
  margin: 24px 0;
`;

export const InstallBox = styled.div`
  background: #020408;
  border: 1px solid var(--color-border-glass);
  border-radius: 8px;
  padding: 12px 16px;
  margin-bottom: 24px;
  display: flex;
  align-items: center;
  gap: 8px;
  font-family: var(--font-mono);
  font-size: 13px;
  color: var(--color-accent-cyan);
  cursor: pointer;
  box-shadow: var(--glow-ai-sm);
  transition: all 0.2s;

  &:hover {
    border-color: rgba(6, 182, 212, 0.45);
    box-shadow: 0 0 16px rgba(6, 182, 212, 0.3);
  }

  code {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    &::before {
      content: "> ";
      color: var(--color-text-muted);
    }
  }

  .copy-icon {
    flex-shrink: 0;
    color: var(--color-text-muted);
    transition: color 0.2s;
  }

  &:hover .copy-icon {
    color: var(--color-text-primary);
  }
`;

export const VersionRow = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 0;
  border-bottom: 1px solid var(--color-border);

  &:last-child {
    border-bottom: none;
  }
`;

export const ArtifactCard = styled.div`
  ${glassCard}
  padding: 16px 20px;
  margin-bottom: 12px;
  display: flex;
  align-items: center;
  gap: 16px;
  transition: border-color 0.2s;

  &:hover {
    border-color: var(--color-border-strong);
  }
`;

export const ArtifactBadge = styled.span<{ $type: string }>`
  display: inline-flex;
  align-items: center;
  padding: 3px 10px;
  border-radius: 12px;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  background: ${(p) => {
    switch (p.$type) {
      case "fmu":
        return "rgba(244, 63, 94, 0.15)";
      case "cad":
      case "step":
        return "rgba(6, 182, 212, 0.15)";
      case "sysml":
      case "sysml2":
        return "rgba(168, 85, 247, 0.15)";
      case "dataset":
      case "csv":
        return "rgba(59, 130, 246, 0.15)";
      case "wasm":
        return "rgba(139, 92, 246, 0.15)";
      default:
        return "rgba(107, 114, 128, 0.15)";
    }
  }};
  color: ${(p) => {
    switch (p.$type) {
      case "fmu":
        return "#f43f5e";
      case "cad":
      case "step":
        return "var(--color-accent-cyan, #06b6d4)";
      case "sysml":
      case "sysml2":
        return "#c084fc";
      case "dataset":
      case "csv":
        return "#3b82f6";
      case "wasm":
        return "#8b5cf6";
      default:
        return "#6b7280";
    }
  }};
`;

export const DomainNavWrap = styled.div`
  display: flex;
  gap: 5px;
  padding: 0 12px 10px;
  overflow-x: auto;
  scrollbar-width: none;
  &::-webkit-scrollbar {
    display: none;
  }
`;

export const DomainPill = styled.button<{ $active: boolean; $color?: string | undefined }>`
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 8px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  border: 1px solid
    ${(p) =>
      p.$active
        ? p.$color || "var(--color-accent-cyan, #06b6d4)"
        : "var(--color-border-glass, rgba(255, 255, 255, 0.1))"};
  background: ${(p) => (p.$active ? "rgba(255, 255, 255, 0.08)" : "transparent")};
  color: ${(p) => (p.$active ? "var(--color-text-heading)" : "var(--color-text-muted)")};
  box-shadow: ${(p) => (p.$active ? `0 0 10px ${p.$color ? p.$color + "33" : "rgba(6, 182, 212, 0.2)"}` : "none")};
  transition: all 0.15s ease;

  &:hover {
    color: var(--color-text-primary);
    border-color: ${(p) => p.$color || "var(--color-accent-cyan, #06b6d4)"};
    background: rgba(255, 255, 255, 0.05);
  }

  .domain-count {
    padding: 0 4px;
    border-radius: 4px;
    font-size: 10px;
    font-weight: 700;
    line-height: 14px;
    background: ${(p) => (p.$active ? "rgba(255, 255, 255, 0.15)" : "var(--color-border, rgba(255, 255, 255, 0.08))")};
    color: ${(p) => (p.$active ? p.$color || "var(--color-accent-cyan, #06b6d4)" : "var(--color-text-muted)")};
  }
`;

export const DomainSectionHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 8px 4px;
  font-size: 11px;
  font-weight: 700;
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.6px;
  margin-top: 10px;
  border-top: 1px solid var(--color-border-subtle, rgba(255, 255, 255, 0.05));

  &:first-of-type {
    margin-top: 0;
    border-top: none;
  }
`;

export const ArtifactSidebarItem = styled.div<{ $active?: boolean | undefined }>`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  font-size: 13px;
  color: var(--color-text-primary);
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.15s;
  background: ${(p) => (p.$active ? "var(--color-glass-bg-hover)" : "transparent")};

  &:hover {
    background: var(--color-glass-bg-hover);
    color: var(--color-accent-cyan);
    box-shadow: 0 0 10px rgba(6, 182, 212, 0.15);
  }
`;

export const DepRow = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 0;
  border-bottom: 1px solid var(--color-border);
  &:last-child {
    border-bottom: none;
  }
`;

export const SparklineContainer = styled.div`
  display: flex;
  align-items: flex-end;
  gap: 2px;
  height: 38px;
  padding-top: 8px;
  margin-top: 6px;
  border-bottom: 1px solid var(--color-border);
  padding-bottom: 4px;
`;

export const SparklineBar = styled.div<{ $heightPct: number; $active?: boolean | undefined }>`
  flex: 1;
  min-width: 3px;
  max-width: 8px;
  height: ${(p) => Math.max(p.$heightPct, 8)}%;
  background: ${(p) =>
    p.$active
      ? "linear-gradient(180deg, var(--color-accent-cyan, #06b6d4) 0%, rgba(6, 182, 212, 0.4) 100%)"
      : "var(--color-border, rgba(255, 255, 255, 0.1))"};
  border-radius: 2px 2px 0 0;
  transition: all 0.2s ease;
  cursor: pointer;

  &:hover {
    background: var(--color-accent-cyan, #06b6d4);
    box-shadow: 0 0 6px rgba(6, 182, 212, 0.6);
  }
`;

export const DependentBadge = styled(Link)`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  border-radius: 6px;
  font-size: 12px;
  background: var(--color-glass-bg);
  border: 1px solid var(--color-glass-border);
  color: var(--color-text-primary);
  text-decoration: none;
  transition: all 0.15s ease;

  &:hover {
    border-color: var(--color-accent-cyan);
    color: var(--color-accent-cyan);
    background: var(--color-glass-bg-hover);
  }
`;

export const DiagramWrap = styled.div`
  ${glassCard}
  padding: 24px;
  margin-bottom: 24px;
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 120px;
  overflow: auto;
  > div > svg {
    width: 100%;
    height: auto;
    max-height: 400px;
    max-width: 100%;
  }
`;

export const HeaderBar = styled.div`
  max-width: none;
  width: 100%;
  margin: 0 auto;
  padding: 32px 40px 0;
  box-sizing: border-box;

  @media (max-width: 900px) {
    padding: 20px 16px 0;
  }
`;

export const MobileTreeToggle = styled.button`
  display: none;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 12px 20px;
  background: var(--surface-overlay);
  border: none;
  border-bottom: 1px solid var(--color-border);
  color: var(--color-text-primary);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s ease;

  &:hover {
    background: var(--surface-row-hover);
  }

  @media (max-width: 900px) {
    display: flex;
  }
`;

export const TreeSidebar = styled.div<{ $mobileOpen?: boolean | undefined }>`
  width: 260px;
  flex-shrink: 0;
  border-right: 1px solid var(--color-border);
  height: calc(100vh - var(--dev-header-height, 0px));
  position: sticky;
  top: var(--dev-header-height, 0px);
  display: flex;
  flex-direction: column;
  box-sizing: border-box;

  @media (max-width: 900px) {
    width: 100%;
    position: relative;
    top: 0;
    height: auto;
    max-height: ${(props) => (props.$mobileOpen ? "420px" : "0px")};
    overflow: hidden;
    border-right: none;
    border-bottom: ${(props) => (props.$mobileOpen ? "1px solid var(--color-border)" : "none")};
    transition: max-height 0.25s cubic-bezier(0.16, 1, 0.3, 1);
  }
`;

export const TreeScrollArea = styled.div`
  flex: 1;
  overflow-y: auto;
  padding: 12px 8px;

  &::-webkit-scrollbar {
    width: 6px;
  }
  &::-webkit-scrollbar-thumb {
    background: var(--color-border);
    border-radius: 3px;
  }
`;
