// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  AlertFillIcon,
  AlertIcon,
  ArrowLeftIcon,
  BookIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CodeIcon,
  CopyIcon,
  CpuIcon,
  DatabaseIcon,
  DependabotIcon,
  FileCodeIcon,
  FileIcon,
  GearIcon,
  GitCompareIcon,
  GlobeIcon,
  HistoryIcon,
  LinkIcon,
  PackageIcon,
  SearchIcon,
  ShareIcon,
  SyncIcon,
  VerifiedIcon,
  WorkflowIcon,
  XIcon,
} from "@primer/octicons-react";
import { ActionList, ActionMenu, Button, Dialog, Flash, Heading, Label, Spinner, Text, TextInput } from "@primer/react";
import DOMPurify from "dompurify";
import { marked } from "marked";
import React, { useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import styled, { css, keyframes } from "styled-components";
import type {
  ArtifactViewerInfo,
  ClassDetail,
  ClassSummary,
  JobInfo,
  NpmPackument,
  NpmVersionManifest,
  PackageDependent,
  PackageStats,
} from "../api";
import {
  deprecatePackage,
  getArtifactViewers,
  getClassDetail,
  getClasses,
  getDiagramUrl,
  getIconUrl,
  getJobStatus,
  getPackageDependents,
  getPackageStats,
  getPackument,
  rewriteModelicaUris,
  transferPackageOwnership,
  undeprecatePackage,
  unyankPackage,
  yankPackage,
} from "../api";
import { useAuth } from "../AuthContext";
import CadStepViewer from "../components/artifacts/CadStepViewer";
import Box from "../components/Box";
import Breadcrumbs from "../components/Breadcrumbs";
import { ComposeContext } from "../components/ComposeContext";
import DatasetTableViewer from "../components/DatasetTableViewer";
import DigitalThreadExplorer from "../components/DigitalThreadExplorer";
import FmuSimulatorViewer from "../components/FmuSimulatorViewer";
import InvertedSvg from "../components/InvertedSvg";
import { PolyglotVersionDiffView } from "../components/PolyglotVersionDiffView";
import SysmlViewer from "../components/SysmlViewer";
import { TerminalLogViewer } from "../components/TerminalLogViewer";
import { usePageTitle } from "../util/title";

/* ─── animations ─── */

const fadeIn = keyframes`
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
`;

/* ─── styled components ─── */

const PageWrap = styled.div`
  background-color: var(--color-bg-primary);
  color: var(--color-text-primary);
  min-height: 100%;
  display: flex;
  flex-direction: row;
  transition:
    background-color 0.3s ease,
    color 0.3s ease;
  flex: 1;

  @media (max-width: 900px) {
    flex-direction: column;
  }
`;

const MobileTreeToggle = styled.button`
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

const TreeSidebar = styled.div<{ $mobileOpen?: boolean }>`
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

const TreeScrollArea = styled.div`
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
  &::-webkit-scrollbar-thumb:hover {
    background: var(--color-border-strong);
  }
`;

const MainContentWrap = styled.div`
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
`;

const ContentGrid = styled.div`
  max-width: none;
  margin: 0 auto;
  padding: 0 40px 60px;
  display: grid;
  grid-template-columns: 1fr 320px;
  gap: 40px;
  width: 100%;
  box-sizing: border-box;
  animation: ${fadeIn} 0.4s ease;

  @media (max-width: 900px) {
    grid-template-columns: 1fr;
    padding: 0 16px 40px;
    gap: 24px;
  }
`;

const HeaderBar = styled.div`
  max-width: none;
  width: 100%;
  margin: 0 auto;
  padding: 32px 40px 0;
  box-sizing: border-box;

  @media (max-width: 900px) {
    padding: 20px 16px 0;
  }
`;

const glassCard = css`
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

const GlassCard = styled.div`
  ${glassCard}
  padding: 20px;
  margin-bottom: 16px;
`;

const DocCard = styled.div`
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

const SectionTitle = styled(Heading)`
  font-size: 14px !important;
  color: var(--color-text-muted) !important;
  margin-bottom: 12px !important;
  font-weight: 600 !important;
`;

const MetaGrid = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 24px;
  margin-bottom: 24px;
`;

const MetaBlock = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 24px;
`;

const MetaLabel = styled.span`
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text-muted);
`;

const MetaValue = styled.span`
  font-size: 14px;
  color: var(--color-text-heading);
  font-weight: 600;
  word-break: break-word;
  display: flex;
  align-items: center;
  gap: 8px;
`;

const Divider = styled.hr`
  border: none;
  border-top: 1px solid var(--color-border);
  margin: 24px 0;
`;

/* ─── tab bar ─── */

const TabBar = styled.div`
  display: flex;
  gap: 0;
  border-bottom: 2px solid var(--color-border);
  margin-bottom: 24px;
  max-width: none;
  width: 100%;
  margin-left: auto;
  margin-right: auto;
  padding: 0 40px;
  box-sizing: border-box;
`;

const Tab = styled.button<{ $active: boolean }>`
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 12px 20px;
  font-size: 14px;
  font-weight: 600;
  border: none;
  background: transparent;
  color: ${(p) => (p.$active ? "var(--color-text-heading)" : "var(--color-text-muted)")};
  border-bottom: 3px solid ${(p) => (p.$active ? "var(--color-accent-cyan)" : "transparent")};
  box-shadow: ${(p) => (p.$active ? "0 2px 10px rgba(6, 182, 212, 0.4)" : "none")};
  margin-bottom: -2px;
  cursor: pointer;
  transition: all 0.2s ease;

  &:hover {
    color: var(--color-text-heading);
  }
`;

/* ─── install copy box ─── */

const InstallBox = styled.div`
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

/* ─── tree components ─── */

const TreeItem = styled(Link)<{ $depth: number }>`
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px 6px ${(p) => 10 + p.$depth * 16}px;
  font-size: 13px;
  font-family: var(--font-mono);
  color: var(--color-text-primary);
  text-decoration: none;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.15s;
  &:hover {
    background: var(--color-glass-bg-hover);
    color: var(--color-accent-cyan);
    box-shadow: 0 0 10px rgba(6, 182, 212, 0.15);
  }
`;

const TreeToggle = styled.button`
  background: none;
  border: none;
  cursor: pointer;
  color: var(--color-text-muted);
  padding: 0;
  display: flex;
  align-items: center;
  &:hover {
    color: var(--color-text-primary);
  }
`;

const DiagramWrap = styled.div`
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

/* ─── version row ─── */

const VersionRow = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 0;
  border-bottom: 1px solid var(--color-border);

  &:last-child {
    border-bottom: none;
  }
`;

/* ─── artifact card ─── */

const ArtifactCard = styled.div`
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

type PolyglotDomain = "all" | "modelica" | "sysml2" | "cad" | "dataset" | "fmu" | "other";

function classifyArtifactDomain(av: ArtifactViewerInfo): PolyglotDomain {
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

const ArtifactBadge = styled.span<{ $type: string }>`
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

const DomainNavWrap = styled.div`
  display: flex;
  gap: 5px;
  padding: 0 12px 10px;
  overflow-x: auto;
  scrollbar-width: none;
  &::-webkit-scrollbar {
    display: none;
  }
`;

const DomainPill = styled.button<{ $active: boolean; $color?: string }>`
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

const DomainSectionHeader = styled.div`
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

const ArtifactSidebarItem = styled.div<{ $active?: boolean }>`
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

function getArtifactIcon(type: string, path?: string) {
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
    return <PackageIcon size={14} style={{ color: "var(--color-accent-cyan, #06b6d4)", flexShrink: 0 }} />;
  }
  if (t === "sysml" || t === "sysml2" || t === "kerml" || p.endsWith(".sysml") || p.endsWith(".kerml")) {
    return <GearIcon size={14} style={{ color: "#a855f7", flexShrink: 0 }} />;
  }
  if (t === "fmu" || p.endsWith(".fmu")) {
    return <CpuIcon size={14} style={{ color: "#f43f5e", flexShrink: 0 }} />;
  }
  if (t === "dataset" || t === "csv" || p.endsWith(".csv") || p.endsWith(".tsv") || p.endsWith(".parquet")) {
    return <DatabaseIcon size={14} style={{ color: "#3b82f6", flexShrink: 0 }} />;
  }
  if (t === "modelica" || t === "mo" || p.endsWith(".mo")) {
    return <CodeIcon size={14} style={{ color: "#eab308", flexShrink: 0 }} />;
  }
  return <FileIcon size={14} style={{ color: "var(--color-text-muted)", flexShrink: 0 }} />;
}

/* ─── dependency row ─── */

const DepRow = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 0;
  border-bottom: 1px solid var(--color-border);
  &:last-child {
    border-bottom: none;
  }
`;

const SparklineContainer = styled.div`
  display: flex;
  align-items: flex-end;
  gap: 2px;
  height: 38px;
  padding-top: 8px;
  margin-top: 6px;
  border-bottom: 1px solid var(--color-border);
  padding-bottom: 4px;
`;

const SparklineBar = styled.div<{ $heightPct: number; $active?: boolean }>`
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

const DependentBadge = styled(Link)`
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

/* ─── tree helpers ─── */

interface TreeNode {
  name: string;
  fullName: string;
  classKind: string;
  children: TreeNode[];
}

function buildClassTree(classes: ClassSummary[], rootName: string): TreeNode[] {
  const root: TreeNode = { name: rootName, fullName: rootName, classKind: "package", children: [] };
  const sorted = [...classes].sort((a, b) => a.class_name.localeCompare(b.class_name));

  for (const cls of sorted) {
    const fullName = cls.class_name;
    const cleanName = fullName.startsWith(rootName + ".") ? fullName.slice(rootName.length + 1) : fullName;
    const parts = cleanName.split(".");
    let currentPath = "";
    let parentNode = root;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]!;
      currentPath = currentPath ? `${currentPath}.${part}` : part;
      let node = parentNode.children.find((c) => c.name === part);
      if (!node) {
        node = {
          name: part,
          fullName: i === parts.length - 1 ? fullName : currentPath,
          classKind: i === parts.length - 1 ? cls.class_kind : "package",
          children: [],
        };
        parentNode.children.push(node);
      } else if (i === parts.length - 1) {
        node.classKind = cls.class_kind;
        node.fullName = fullName;
      }
      parentNode = node;
    }
  }

  return root.children;
}

function filterClassTree(nodes: TreeNode[], query: string): TreeNode[] {
  if (!query.trim()) return nodes;
  const q = query.trim().toLowerCase();

  const filterNode = (node: TreeNode): TreeNode | null => {
    const nameMatches = node.name.toLowerCase().includes(q) || node.fullName.toLowerCase().includes(q);
    const filteredChildren = node.children
      .map((child) => filterNode(child))
      .filter((child): child is TreeNode => child !== null);

    if (nameMatches || filteredChildren.length > 0) {
      return {
        ...node,
        children: filteredChildren,
      };
    }
    return null;
  };

  return nodes.map((node) => filterNode(node)).filter((node): node is TreeNode => node !== null);
}

/* ─── tree node component ─── */

const ClassTreeNode: React.FC<{
  node: TreeNode;
  depth: number;
  libraryName: string;
  version: string;
  isFiltered?: boolean;
}> = ({ node, depth, libraryName, version, isFiltered }) => {
  const [expanded, setExpanded] = useState(depth < 1 || Boolean(isFiltered));

  useEffect(() => {
    if (isFiltered) {
      setExpanded(true);
    }
  }, [isFiltered]);

  const hasChildren = node.children.length > 0;
  const iconUrl = getIconUrl(libraryName, version, node.fullName);

  return (
    <>
      <TreeItem
        to={`/packages/${libraryName}/${version}/classes/${node.fullName}`}
        $depth={depth}
        onClick={(e) => {
          if (hasChildren) {
            e.preventDefault();
            setExpanded(!expanded);
          }
        }}
      >
        {hasChildren ? (
          <TreeToggle
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setExpanded(!expanded);
            }}
          >
            {expanded ? <ChevronDownIcon size={14} /> : <ChevronRightIcon size={14} />}
          </TreeToggle>
        ) : (
          <span style={{ width: 14, flexShrink: 0 }} />
        )}
        <InvertedSvg
          src={iconUrl}
          alt=""
          width={16}
          height={16}
          fallback={
            node.classKind.includes("sysml") ? (
              <CodeIcon size={16} fill="var(--color-primary)" />
            ) : node.classKind.includes("cad") ||
              node.classKind.includes("product") ||
              node.classKind.includes("shape") ? (
              <CpuIcon size={16} fill="var(--color-warning)" />
            ) : (
              <PackageIcon size={16} fill="var(--color-text-muted)" />
            )
          }
        />
        <span>{node.name}</span>
        <Label
          variant="secondary"
          style={{ fontSize: "10px", padding: "0 4px", lineHeight: "16px", marginLeft: "auto" }}
        >
          {node.classKind}
        </Label>
      </TreeItem>
      {expanded &&
        hasChildren &&
        node.children.map((child) => (
          <ClassTreeNode
            key={child.fullName}
            node={child}
            depth={depth + 1}
            libraryName={libraryName}
            version={version}
            isFiltered={isFiltered}
          />
        ))}
    </>
  );
};

/* ─── format helpers ─── */

function formatDate(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
  } catch {
    return dateStr;
  }
}

function timeAgo(dateStr: string): string {
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

/* ─── tab types ─── */

type TabId = "readme" | "digital-thread" | "versions" | "compare" | "artifacts" | "dependencies";

const TABS: { id: TabId; label: string; icon: React.ReactNode }[] = [
  { id: "readme", label: "Readme", icon: <BookIcon size={16} /> },
  { id: "digital-thread", label: "Digital Thread", icon: <CpuIcon size={16} /> },
  { id: "artifacts", label: "Artifacts", icon: <FileIcon size={16} /> },
  { id: "versions", label: "Versions", icon: <HistoryIcon size={16} /> },
  { id: "compare", label: "Compare", icon: <GitCompareIcon size={16} /> },
  { id: "dependencies", label: "Dependencies", icon: <DependabotIcon size={16} /> },
];

/* ─── skeleton ─── */

const PackageDetailSkeleton: React.FC = () => (
  <PageWrap>
    <TreeSidebar style={{ padding: "16px 12px" }}>
      <div className="skeleton" style={{ width: "120px", height: "14px", marginBottom: "16px" }} />
      <div className="skeleton" style={{ width: "100%", height: "24px", marginBottom: "8px" }} />
      <div className="skeleton" style={{ width: "85%", height: "24px", marginBottom: "8px" }} />
      <div className="skeleton" style={{ width: "90%", height: "24px", marginBottom: "8px" }} />
      <div className="skeleton" style={{ width: "70%", height: "24px", marginBottom: "8px" }} />
      <div className="skeleton" style={{ width: "80%", height: "24px", marginBottom: "8px" }} />
    </TreeSidebar>
    <MainContentWrap>
      <HeaderBar>
        <div style={{ display: "flex", gap: "16px", alignItems: "center", marginBottom: "16px" }}>
          <div className="skeleton" style={{ width: "52px", height: "52px", borderRadius: "10px" }} />
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <div className="skeleton" style={{ width: "240px", height: "28px" }} />
            <div className="skeleton" style={{ width: "160px", height: "14px" }} />
          </div>
        </div>
        <div
          style={{ display: "flex", gap: "12px", borderBottom: "1px solid var(--color-border)", paddingBottom: "12px" }}
        >
          <div className="skeleton" style={{ width: "80px", height: "20px" }} />
          <div className="skeleton" style={{ width: "80px", height: "20px" }} />
          <div className="skeleton" style={{ width: "80px", height: "20px" }} />
        </div>
      </HeaderBar>
      <ContentGrid style={{ marginTop: "24px" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <div className="skeleton" style={{ width: "100%", height: "160px", borderRadius: "12px" }} />
          <div className="skeleton" style={{ width: "100%", height: "280px", borderRadius: "12px" }} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <div className="skeleton" style={{ width: "100%", height: "180px", borderRadius: "12px" }} />
          <div className="skeleton" style={{ width: "100%", height: "140px", borderRadius: "12px" }} />
        </div>
      </ContentGrid>
    </MainContentWrap>
  </PageWrap>
);

/* ─── main page ─── */

const PackageDetailPage: React.FC = () => {
  const { name, version } = useParams<{ name: string; version: string }>();
  usePageTitle(name && version ? `${name}@${version}` : "Package Details");
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = (searchParams.get("tab") as TabId) || "readme";
  const { openCompose } = useContext(ComposeContext);
  const [mobileTreeOpen, setMobileTreeOpen] = useState(false);

  // Legacy API data
  const [rootClass, setRootClass] = useState<ClassDetail | null>(null);
  const [classes, setClasses] = useState<ClassSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [jobInfo, setJobInfo] = useState<JobInfo | null>(null);
  const jobStatus = jobInfo?.status ?? null;
  const [diagramLoaded, setDiagramLoaded] = useState(false);
  const [diagramError, setDiagramError] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [copied, setCopied] = useState(false);

  // npm packument data
  const [packument, setPackument] = useState<NpmPackument | null>(null);

  // Enriched artifact data from artifact viewer API
  const [artifactViewers, setArtifactViewers] = useState<ArtifactViewerInfo[]>([]);

  // Polyglot domain navigation state
  const [selectedDomain, setSelectedDomain] = useState<PolyglotDomain>("all");
  const [treeSearchFilter, setTreeSearchFilter] = useState("");
  const [artifactTabDomainFilter, setArtifactTabDomainFilter] = useState<PolyglotDomain>("all");

  // Analytics & reverse dependencies
  const [packageStats, setPackageStats] = useState<PackageStats | null>(null);
  const [dependents, setDependents] = useState<PackageDependent[]>([]);

  // Auth & governance states
  const { user } = useAuth();
  const [manageModal, setManageModal] = useState<"yank" | "deprecate" | "transfer" | null>(null);
  const [yankReasonInput, setYankReasonInput] = useState("");
  const [deprecateReasonInput, setDeprecateReasonInput] = useState("");
  const [transferTargetInput, setTransferTargetInput] = useState("");
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  const setTab = (tab: TabId) => {
    setSearchParams({ tab });
  };

  const fetchData = useCallback(async () => {
    if (!name || !version) return;
    try {
      const [rootCls, classList, npmData, viewers, stats, depData] = await Promise.all([
        getClassDetail(name, version, name).catch(() => null),
        getClasses(name, version),
        getPackument(name).catch(() => null),
        getArtifactViewers(name, version).catch(() => []),
        getPackageStats(name, 30).catch(() => null),
        getPackageDependents(name).catch(() => null),
      ]);
      setRootClass(rootCls);
      setClasses(classList);
      setPackument(npmData);
      setArtifactViewers(viewers);
      setPackageStats(stats);
      setDependents(depData?.dependents || []);
    } catch (err) {
      setError("Failed to load artifact details");
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [name, version]);

  useEffect(() => {
    setLoading(true);
    fetchData();
  }, [fetchData]);

  // Job polling
  useEffect(() => {
    if (!name || !version || jobStatus === "completed" || jobStatus === "failed") return;

    const checkStatus = async () => {
      try {
        const status = await getJobStatus(name, version);
        setJobInfo(status);
        if (status.status === "completed") {
          fetchData();
        }
      } catch (err: unknown) {
        const error = err as { response?: { status?: number } };
        if (error?.response?.status === 404) {
          setJobInfo({ status: "failed" }); // No job exists, don't poll forever
        } else {
          console.error("Failed to check job status", err);
        }
      }
    };

    checkStatus();
    const interval = setInterval(checkStatus, 3000);
    return () => clearInterval(interval);
  }, [name, version, jobStatus, fetchData]);

  // Derived data from packument
  const currentManifest: NpmVersionManifest | null =
    packument && version ? (packument.versions[version] ?? null) : null;
  const versionList = packument
    ? Object.keys(packument.versions).sort((a, b) => {
        const ta = packument.time?.[a] ?? "";
        const tb = packument.time?.[b] ?? "";
        return tb.localeCompare(ta);
      })
    : [];
  const artifacts = currentManifest?.modelscript?.artifacts ?? [];
  const dependencies = currentManifest?.dependencies ?? {};
  const publishedAt = packument?.time?.[version ?? ""] ?? packument?.time?.modified ?? "";

  // Install command
  const installCmd = `msx install ${name}`;

  const handleCopy = () => {
    navigator.clipboard.writeText(installCmd);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const tree = useMemo(() => (name ? buildClassTree(classes, name) : []), [classes, name]);
  const filteredTree = useMemo(() => filterClassTree(tree, treeSearchFilter), [tree, treeSearchFilter]);

  const sysmlArtifacts = useMemo(
    () => artifactViewers.filter((av) => classifyArtifactDomain(av) === "sysml2"),
    [artifactViewers],
  );
  const cadArtifacts = useMemo(
    () => artifactViewers.filter((av) => classifyArtifactDomain(av) === "cad"),
    [artifactViewers],
  );
  const datasetArtifacts = useMemo(
    () => artifactViewers.filter((av) => classifyArtifactDomain(av) === "dataset"),
    [artifactViewers],
  );
  const fmuArtifacts = useMemo(
    () => artifactViewers.filter((av) => classifyArtifactDomain(av) === "fmu"),
    [artifactViewers],
  );
  const otherArtifacts = useMemo(
    () =>
      artifactViewers.filter(
        (av) =>
          !sysmlArtifacts.includes(av) &&
          !cadArtifacts.includes(av) &&
          !datasetArtifacts.includes(av) &&
          !fmuArtifacts.includes(av),
      ),
    [artifactViewers, sysmlArtifacts, cadArtifacts, datasetArtifacts, fmuArtifacts],
  );

  const filterArtifactList = useCallback(
    (list: ArtifactViewerInfo[]) => {
      if (!treeSearchFilter.trim()) return list;
      const q = treeSearchFilter.trim().toLowerCase();
      return list.filter(
        (av) =>
          av.path.toLowerCase().includes(q) ||
          av.displayName.toLowerCase().includes(q) ||
          av.type.toLowerCase().includes(q),
      );
    },
    [treeSearchFilter],
  );

  const filteredSysml = useMemo(() => filterArtifactList(sysmlArtifacts), [filterArtifactList, sysmlArtifacts]);
  const filteredCad = useMemo(() => filterArtifactList(cadArtifacts), [filterArtifactList, cadArtifacts]);
  const filteredDatasets = useMemo(() => filterArtifactList(datasetArtifacts), [filterArtifactList, datasetArtifacts]);
  const filteredFmu = useMemo(() => filterArtifactList(fmuArtifacts), [filterArtifactList, fmuArtifacts]);
  const filteredOther = useMemo(() => filterArtifactList(otherArtifacts), [filterArtifactList, otherArtifacts]);

  const availableDomains = useMemo(() => {
    const list: {
      id: PolyglotDomain;
      label: string;
      icon: React.ComponentType<{ size?: number }>;
      count: number;
      color: string;
    }[] = [];
    const mCount = classes.length;
    const sCount = sysmlArtifacts.length;
    const cCount = cadArtifacts.length;
    const dCount = datasetArtifacts.length;
    const fCount = fmuArtifacts.length;
    const oCount = otherArtifacts.length;
    const totalCount = mCount + artifactViewers.length;

    const domainTypesPresent =
      (mCount > 0 ? 1 : 0) + (sCount > 0 ? 1 : 0) + (cCount > 0 ? 1 : 0) + (dCount > 0 ? 1 : 0) + (fCount > 0 ? 1 : 0);

    if (domainTypesPresent > 1 || totalCount > 0) {
      list.push({
        id: "all",
        label: "All",
        icon: GlobeIcon,
        count: totalCount,
        color: "var(--color-accent-cyan, #06b6d4)",
      });
    }
    if (mCount > 0) {
      list.push({ id: "modelica", label: "Modelica", icon: FileCodeIcon, count: mCount, color: "#eab308" });
    }
    if (sCount > 0) {
      list.push({ id: "sysml2", label: "SysML v2", icon: WorkflowIcon, count: sCount, color: "#a855f7" });
    }
    if (cCount > 0) {
      list.push({ id: "cad", label: "3D CAD", icon: PackageIcon, count: cCount, color: "#06b6d4" });
    }
    if (dCount > 0) {
      list.push({ id: "dataset", label: "Datasets", icon: DatabaseIcon, count: dCount, color: "#3b82f6" });
    }
    if (fCount > 0) {
      list.push({ id: "fmu", label: "FMUs", icon: CpuIcon, count: fCount, color: "#f43f5e" });
    }
    if (oCount > 0 && domainTypesPresent > 1) {
      list.push({ id: "other", label: "Files", icon: FileIcon, count: oCount, color: "#9ca3af" });
    }
    return list;
  }, [
    classes.length,
    sysmlArtifacts.length,
    cadArtifacts.length,
    datasetArtifacts.length,
    fmuArtifacts.length,
    otherArtifacts.length,
    artifactViewers.length,
  ]);

  const displayedArtifactViewers = useMemo(() => {
    if (artifactTabDomainFilter === "all") return artifactViewers;
    return artifactViewers.filter((av) => classifyArtifactDomain(av) === artifactTabDomainFilter);
  }, [artifactViewers, artifactTabDomainFilter]);

  const handleOpenArtifact = (av: ArtifactViewerInfo) => {
    setTab("artifacts");
    setTimeout(() => {
      const el = document.getElementById(`artifact-${av.id}`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
        el.style.transition = "box-shadow 0.3s ease, border-color 0.3s ease";
        el.style.boxShadow = "0 0 20px rgba(6, 182, 212, 0.4)";
        setTimeout(() => {
          el.style.boxShadow = "";
        }, 1500);
      }
    }, 100);
  };

  const isCurrentYanked = Boolean(currentManifest?.yanked || currentManifest?.is_yanked);
  const currentYankReason =
    typeof currentManifest?.yanked === "string"
      ? currentManifest.yanked
      : (currentManifest?.yank_reason as string | undefined);
  const isCurrentDeprecated = Boolean(currentManifest?.deprecated);
  const currentDeprecateReason = typeof currentManifest?.deprecated === "string" ? currentManifest.deprecated : null;

  const handleToggleYank = async () => {
    if (!name || !version) return;
    setActionLoading(true);
    setActionError(null);
    try {
      if (isCurrentYanked) {
        await unyankPackage(name, version);
        setActionSuccess(`Release v${version} has been restored (unyanked).`);
      } else {
        await yankPackage(name, version, yankReasonInput.trim() || "Yanked by maintainer");
        setActionSuccess(`Release v${version} has been yanked.`);
      }
      setManageModal(null);
      setYankReasonInput("");
      await fetchData();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } }; message?: string };
      setActionError(e.response?.data?.error || e.message || "Failed to update yank status");
    } finally {
      setActionLoading(false);
    }
  };

  const handleToggleDeprecate = async () => {
    if (!name || !version) return;
    setActionLoading(true);
    setActionError(null);
    try {
      if (isCurrentDeprecated) {
        await undeprecatePackage(name, version);
        setActionSuccess(`Deprecation removed from release v${version}.`);
      } else {
        await deprecatePackage(name, version, deprecateReasonInput.trim() || "Deprecated by maintainer");
        setActionSuccess(`Release v${version} has been marked as deprecated.`);
      }
      setManageModal(null);
      setDeprecateReasonInput("");
      await fetchData();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } }; message?: string };
      setActionError(e.response?.data?.error || e.message || "Failed to update deprecation status");
    } finally {
      setActionLoading(false);
    }
  };

  const handleTransfer = async () => {
    if (!name || !transferTargetInput.trim()) return;
    setActionLoading(true);
    setActionError(null);
    try {
      await transferPackageOwnership(name, transferTargetInput.trim());
      setActionSuccess(`Ownership transfer request sent to @${transferTargetInput.trim()}.`);
      setManageModal(null);
      setTransferTargetInput("");
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } }; message?: string };
      setActionError(e.response?.data?.error || e.message || "Failed to transfer ownership");
    } finally {
      setActionLoading(false);
    }
  };

  const description = packument?.description ?? rootClass?.description ?? null;

  if (loading) {
    return <PackageDetailSkeleton />;
  }

  if (error) {
    return (
      <PageWrap style={{ justifyContent: "center", alignItems: "center" }}>
        <Box
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 16,
            padding: 40,
            textAlign: "center",
          }}
        >
          <AlertIcon size={48} fill="var(--color-error)" />
          <Heading as="h2" style={{ color: "var(--color-text-heading)", fontSize: 22, margin: 0 }}>
            Failed to load artifact details
          </Heading>
          <Text as="p" style={{ color: "var(--color-text-muted)", fontSize: 15, margin: 0, maxWidth: 400 }}>
            The artifact may not exist, is still being processed, or the server is unavailable.
          </Text>
          <Link
            to="/packages"
            style={{
              color: "var(--color-link)",
              fontSize: 14,
              textDecoration: "none",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <ArrowLeftIcon size={14} /> Back to libraries
          </Link>
        </Box>
      </PageWrap>
    );
  }

  return (
    <PageWrap>
      {/* Mobile Toggle for Class / Artifact Tree */}
      {(tree.length > 0 || artifactViewers.length > 0) && (
        <MobileTreeToggle type="button" onClick={() => setMobileTreeOpen((prev) => !prev)}>
          <span>Browse Components &amp; Artifacts ({tree.length + artifactViewers.length})</span>
          {mobileTreeOpen ? <ChevronDownIcon size={16} /> : <ChevronRightIcon size={16} />}
        </MobileTreeToggle>
      )}

      {/* ── Left Sidebar (Classes or Polyglot Artifacts) ── */}
      {(tree.length > 0 || artifactViewers.length > 0) && (
        <TreeSidebar $mobileOpen={mobileTreeOpen}>
          <Box
            style={{
              height: "72px",
              minHeight: "72px",
              display: "flex",
              alignItems: "center",
              gap: "12px",
              padding: "0 16px",
              boxSizing: "border-box",
            }}
          >
            <InvertedSvg
              src={getIconUrl(name!, version!, name!)}
              alt=""
              width={32}
              height={32}
              style={{ flexShrink: 0 }}
            />
            <Box display="flex" flexDirection="column" style={{ minWidth: 0 }}>
              <Box display="flex" alignItems="center" gap={1}>
                <Text
                  style={{
                    fontWeight: 600,
                    fontSize: 14,
                    color: "var(--color-text-primary)",
                    lineHeight: 1.2,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {name}
                </Text>
                {availableDomains.length > 2 && (
                  <Label variant="accent" style={{ fontSize: 9, padding: "0 4px", lineHeight: "14px" }}>
                    Polyglot
                  </Label>
                )}
              </Box>
              <Text style={{ fontSize: 12, color: "var(--color-text-muted)", marginTop: "2px" }}>v{version}</Text>
            </Box>
          </Box>

          {/* Polyglot Domain Navigation Pills */}
          {availableDomains.length > 2 && (
            <DomainNavWrap>
              {availableDomains.map((d) => {
                const IconComp = d.icon;
                return (
                  <DomainPill
                    key={d.id}
                    $active={selectedDomain === d.id}
                    $color={d.color}
                    onClick={() => setSelectedDomain(d.id)}
                    title={`${d.label} (${d.count})`}
                  >
                    <IconComp size={12} />
                    <span>{d.label}</span>
                    <span className="domain-count">{d.count}</span>
                  </DomainPill>
                );
              })}
            </DomainNavWrap>
          )}

          {/* Search Input */}
          <Box style={{ padding: "0 12px 10px 12px" }}>
            <TextInput
              leadingVisual={SearchIcon}
              placeholder={
                selectedDomain === "modelica"
                  ? "Filter classes..."
                  : selectedDomain === "cad"
                    ? "Filter CAD parts..."
                    : selectedDomain === "sysml2"
                      ? "Filter SysML definitions..."
                      : selectedDomain === "dataset"
                        ? "Filter datasets..."
                        : "Filter polyglot symbols..."
              }
              value={treeSearchFilter}
              onChange={(e) => setTreeSearchFilter(e.target.value)}
              size="small"
              block
              trailingAction={
                treeSearchFilter ? (
                  <TextInput.Action onClick={() => setTreeSearchFilter("")} icon={XIcon} aria-label="Clear filter" />
                ) : undefined
              }
            />
          </Box>

          <TreeScrollArea>
            {/* Modelica Section */}
            {(selectedDomain === "all" || selectedDomain === "modelica") && filteredTree.length > 0 && (
              <>
                {selectedDomain === "all" && availableDomains.length > 2 && (
                  <DomainSectionHeader>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                      <FileCodeIcon size={13} /> Modelica Classes
                    </span>
                    <span>{filteredTree.length}</span>
                  </DomainSectionHeader>
                )}
                {filteredTree.map((node) => (
                  <ClassTreeNode
                    key={node.fullName}
                    node={node}
                    depth={0}
                    libraryName={name!}
                    version={version!}
                    isFiltered={Boolean(treeSearchFilter.trim())}
                  />
                ))}
              </>
            )}

            {/* SysML v2 Section */}
            {(selectedDomain === "all" || selectedDomain === "sysml2") && filteredSysml.length > 0 && (
              <>
                {selectedDomain === "all" && availableDomains.length > 2 && (
                  <DomainSectionHeader>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                      <WorkflowIcon size={13} /> SysML v2 Architecture
                    </span>
                    <span>{filteredSysml.length}</span>
                  </DomainSectionHeader>
                )}
                {filteredSysml.map((av) => (
                  <ArtifactSidebarItem key={av.id} onClick={() => handleOpenArtifact(av)}>
                    {getArtifactIcon(av.type, av.path)}
                    <span
                      style={{
                        flex: 1,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        fontFamily: "var(--font-mono)",
                        fontSize: 12,
                      }}
                      title={av.path}
                    >
                      {av.displayName || av.path}
                    </span>
                    <Label variant="secondary" style={{ fontSize: "10px", padding: "0 4px", lineHeight: "14px" }}>
                      SysML
                    </Label>
                  </ArtifactSidebarItem>
                ))}
              </>
            )}

            {/* 3D CAD Section */}
            {(selectedDomain === "all" || selectedDomain === "cad") && filteredCad.length > 0 && (
              <>
                {selectedDomain === "all" && availableDomains.length > 2 && (
                  <DomainSectionHeader>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                      <PackageIcon size={13} /> 3D CAD Models
                    </span>
                    <span>{filteredCad.length}</span>
                  </DomainSectionHeader>
                )}
                {filteredCad.map((av) => (
                  <ArtifactSidebarItem key={av.id} onClick={() => handleOpenArtifact(av)}>
                    {getArtifactIcon(av.type, av.path)}
                    <span
                      style={{
                        flex: 1,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        fontFamily: "var(--font-mono)",
                        fontSize: 12,
                      }}
                      title={av.path}
                    >
                      {av.displayName || av.path}
                    </span>
                    <Label
                      variant="secondary"
                      style={{
                        fontSize: "10px",
                        padding: "0 4px",
                        lineHeight: "14px",
                        color: "var(--color-accent-cyan, #06b6d4)",
                      }}
                    >
                      STEP
                    </Label>
                  </ArtifactSidebarItem>
                ))}
              </>
            )}

            {/* Datasets Section */}
            {(selectedDomain === "all" || selectedDomain === "dataset") && filteredDatasets.length > 0 && (
              <>
                {selectedDomain === "all" && availableDomains.length > 2 && (
                  <DomainSectionHeader>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                      <DatabaseIcon size={13} /> Datasets &amp; Tables
                    </span>
                    <span>{filteredDatasets.length}</span>
                  </DomainSectionHeader>
                )}
                {filteredDatasets.map((av) => (
                  <ArtifactSidebarItem key={av.id} onClick={() => handleOpenArtifact(av)}>
                    {getArtifactIcon(av.type, av.path)}
                    <span
                      style={{
                        flex: 1,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        fontFamily: "var(--font-mono)",
                        fontSize: 12,
                      }}
                      title={av.path}
                    >
                      {av.displayName || av.path}
                    </span>
                    <Label variant="secondary" style={{ fontSize: "10px", padding: "0 4px", lineHeight: "14px" }}>
                      CSV
                    </Label>
                  </ArtifactSidebarItem>
                ))}
              </>
            )}

            {/* FMUs Section */}
            {(selectedDomain === "all" || selectedDomain === "fmu") && filteredFmu.length > 0 && (
              <>
                {selectedDomain === "all" && availableDomains.length > 2 && (
                  <DomainSectionHeader>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                      <CpuIcon size={13} /> FMU Simulators
                    </span>
                    <span>{filteredFmu.length}</span>
                  </DomainSectionHeader>
                )}
                {filteredFmu.map((av) => (
                  <ArtifactSidebarItem key={av.id} onClick={() => handleOpenArtifact(av)}>
                    {getArtifactIcon(av.type, av.path)}
                    <span
                      style={{
                        flex: 1,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        fontFamily: "var(--font-mono)",
                        fontSize: 12,
                      }}
                      title={av.path}
                    >
                      {av.displayName || av.path}
                    </span>
                    <Label
                      variant="secondary"
                      style={{ fontSize: "10px", padding: "0 4px", lineHeight: "14px", color: "#f43f5e" }}
                    >
                      FMU
                    </Label>
                  </ArtifactSidebarItem>
                ))}
              </>
            )}

            {/* Other Files Section */}
            {(selectedDomain === "all" || selectedDomain === "other") && filteredOther.length > 0 && (
              <>
                {selectedDomain === "all" && availableDomains.length > 2 && (
                  <DomainSectionHeader>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                      <FileIcon size={13} /> Other Files
                    </span>
                    <span>{filteredOther.length}</span>
                  </DomainSectionHeader>
                )}
                {filteredOther.map((av) => (
                  <ArtifactSidebarItem key={av.id} onClick={() => handleOpenArtifact(av)}>
                    {getArtifactIcon(av.type, av.path)}
                    <span
                      style={{
                        flex: 1,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        fontFamily: "var(--font-mono)",
                        fontSize: 12,
                      }}
                      title={av.path}
                    >
                      {av.displayName || av.path}
                    </span>
                    <Label variant="secondary" style={{ fontSize: "10px", padding: "0 4px", lineHeight: "14px" }}>
                      {av.type}
                    </Label>
                  </ArtifactSidebarItem>
                ))}
              </>
            )}

            {/* Empty State */}
            {filteredTree.length === 0 &&
              filteredSysml.length === 0 &&
              filteredCad.length === 0 &&
              filteredDatasets.length === 0 &&
              filteredFmu.length === 0 &&
              filteredOther.length === 0 && (
                <Box
                  style={{ padding: "24px 12px", textAlign: "center", color: "var(--color-text-muted)", fontSize: 12 }}
                >
                  <Text as="p" style={{ margin: "0 0 8px 0" }}>
                    No matching items in {selectedDomain === "all" ? "package" : selectedDomain}
                  </Text>
                  {treeSearchFilter && (
                    <Button size="small" variant="invisible" onClick={() => setTreeSearchFilter("")}>
                      Clear filter
                    </Button>
                  )}
                </Box>
              )}
          </TreeScrollArea>
        </TreeSidebar>
      )}

      <MainContentWrap>
        {/* ── Header ── */}
        <HeaderBar>
          <Box mb={3}>
            <Breadcrumbs
              items={[
                { label: "Libraries", href: "/packages" },
                { label: name || "", href: `/packages/${name}` },
                { label: version || "" },
              ]}
            />
          </Box>
          <Box display="flex" alignItems="center" gap="16px" mb={3}>
            {/* Package icon */}
            <InvertedSvg
              src={getIconUrl(name!, version!, name!)}
              alt=""
              width={48}
              height={48}
              style={{ flexShrink: 0 }}
            />
            <Box>
              <Box display="flex" alignItems="center" gap="8px">
                <Heading
                  as="h1"
                  style={{ color: "var(--color-text-heading)", fontWeight: 700, fontSize: 28, margin: 0 }}
                >
                  {name}
                </Heading>
                <Label
                  variant="accent"
                  style={{
                    fontSize: 14,
                    padding: "2px 10px",
                    background: "var(--color-accent-blue-bg)",
                    color: "var(--color-accent-blue)",
                    border: "1px solid var(--color-accent-blue-border)",
                  }}
                >
                  {version}
                </Label>
                {jobStatus && jobStatus !== "completed" && jobStatus !== "failed" && (
                  <Label
                    variant="attention"
                    style={
                      jobStatus === "processing" ? { display: "flex", alignItems: "center", gap: "6px" } : undefined
                    }
                  >
                    {jobStatus === "processing" && <Spinner size="small" />}
                    {jobStatus === "processing" ? "Processing…" : "Pending"}
                  </Label>
                )}
                {packument?.license && (
                  <Label variant="secondary" style={{ fontSize: 11 }}>
                    {packument.license}
                  </Label>
                )}
                {openCompose && (
                  <Button
                    size="small"
                    variant="default"
                    leadingVisual={ShareIcon}
                    onClick={() => {
                      openCompose({
                        content: `Check out the **${name}** package (v${version})! 📦`,
                        packagePayload: {
                          name: name!,
                          version: version || "1.0.0",
                          description: description || undefined,
                          license: packument?.license || undefined,
                          dialect: "modelica",
                        },
                      });
                    }}
                    style={{ marginLeft: "auto" }}
                  >
                    Share to Feed
                  </Button>
                )}
                {user && (
                  <Box style={{ marginLeft: openCompose ? 8 : "auto" }}>
                    <ActionMenu>
                      <ActionMenu.Button size="small" leadingVisual={GearIcon}>
                        Manage Release
                      </ActionMenu.Button>
                      <ActionMenu.Overlay>
                        <ActionList>
                          <ActionList.Item
                            onSelect={() => {
                              setActionError(null);
                              setManageModal("yank");
                            }}
                          >
                            <ActionList.LeadingVisual>
                              <AlertFillIcon
                                size={14}
                                fill={
                                  isCurrentYanked
                                    ? "var(--color-success-fg, #2da44e)"
                                    : "var(--color-danger-fg, #cf222e)"
                                }
                              />
                            </ActionList.LeadingVisual>
                            {isCurrentYanked ? "Restore (Unyank) Release" : "Yank Release"}
                          </ActionList.Item>

                          <ActionList.Item
                            onSelect={() => {
                              setActionError(null);
                              setManageModal("deprecate");
                            }}
                          >
                            <ActionList.LeadingVisual>
                              <AlertIcon size={14} fill="#d97706" />
                            </ActionList.LeadingVisual>
                            {isCurrentDeprecated ? "Remove Deprecation" : "Deprecate Release"}
                          </ActionList.Item>

                          <ActionList.Divider />

                          <ActionList.Item
                            onSelect={() => {
                              setActionError(null);
                              setManageModal("transfer");
                            }}
                          >
                            <ActionList.LeadingVisual>
                              <SyncIcon size={14} />
                            </ActionList.LeadingVisual>
                            Transfer Ownership
                          </ActionList.Item>
                        </ActionList>
                      </ActionMenu.Overlay>
                    </ActionMenu>
                  </Box>
                )}
              </Box>
              {description && (
                <Text as="p" style={{ color: "var(--color-text-muted)", fontSize: 15, margin: "4px 0 0" }}>
                  {description}
                </Text>
              )}
              {publishedAt && (
                <Text as="p" style={{ color: "var(--color-text-tertiary)", fontSize: 12, margin: "2px 0 0" }}>
                  Published {timeAgo(publishedAt)}
                </Text>
              )}
            </Box>
          </Box>
        </HeaderBar>

        {/* Alerts & Notifications */}
        <Box px={5} pt={2}>
          {actionSuccess && (
            <Box mb={3}>
              <Flash variant="success" onDismiss={() => setActionSuccess(null)}>
                {actionSuccess}
              </Flash>
            </Box>
          )}

          {isCurrentYanked && (
            <Box
              mb={3}
              p={3}
              style={{
                borderRadius: 8,
                background: "rgba(207, 34, 46, 0.12)",
                border: "1px solid rgba(207, 34, 46, 0.4)",
                display: "flex",
                alignItems: "flex-start",
                gap: 12,
              }}
            >
              <AlertFillIcon size={20} fill="var(--color-danger-fg, #cf222e)" style={{ flexShrink: 0, marginTop: 2 }} />
              <Box>
                <Text style={{ fontWeight: 600, color: "var(--color-danger-fg, #cf222e)", display: "block" }}>
                  This version (v{version}) has been yanked
                </Text>
                <Text style={{ fontSize: 13, color: "var(--color-text-primary)", display: "block", marginTop: 2 }}>
                  {currentYankReason ||
                    "The maintainer has yanked this release. It should not be used in new projects."}
                </Text>
              </Box>
            </Box>
          )}

          {isCurrentDeprecated && (
            <Box
              mb={3}
              p={3}
              style={{
                borderRadius: 8,
                background: "rgba(217, 119, 6, 0.12)",
                border: "1px solid rgba(217, 119, 6, 0.4)",
                display: "flex",
                alignItems: "flex-start",
                gap: 12,
              }}
            >
              <AlertIcon size={20} fill="#d97706" style={{ flexShrink: 0, marginTop: 2 }} />
              <Box>
                <Text style={{ fontWeight: 600, color: "#d97706", display: "block" }}>
                  This version (v{version}) is deprecated
                </Text>
                <Text style={{ fontSize: 13, color: "var(--color-text-primary)", display: "block", marginTop: 2 }}>
                  {currentDeprecateReason ||
                    "The package author has deprecated this version. Please consider upgrading."}
                </Text>
              </Box>
            </Box>
          )}
        </Box>

        {manageModal === "yank" && (
          <Dialog
            title={isCurrentYanked ? `Restore Release v${version}` : `Yank Release v${version}`}
            onClose={() => setManageModal(null)}
          >
            <Box p={3} display="flex" flexDirection="column" gap={3}>
              <Text style={{ fontSize: 14, color: "var(--color-text-secondary)" }}>
                {isCurrentYanked
                  ? `Restoring this release will remove the yank warning and make v${version} visible in normal index listings.`
                  : `Yanking marks v${version} as discouraged and hides it from search. Existing projects depending on this version will still be able to resolve it.`}
              </Text>
              {!isCurrentYanked && (
                <Box>
                  <Text style={{ fontSize: 13, fontWeight: 600, display: "block", marginBottom: 6 }}>
                    Reason for yanking
                  </Text>
                  <TextInput
                    block
                    placeholder="e.g. Critical security bug or broken dependency"
                    value={yankReasonInput}
                    onChange={(e) => setYankReasonInput(e.target.value)}
                  />
                </Box>
              )}
              {actionError && <Flash variant="danger">{actionError}</Flash>}
              <Box display="flex" justifyContent="flex-end" gap={2} mt={2}>
                <Button onClick={() => setManageModal(null)}>Cancel</Button>
                <Button
                  variant={isCurrentYanked ? "primary" : "danger"}
                  onClick={handleToggleYank}
                  disabled={actionLoading}
                >
                  {actionLoading ? <Spinner size="small" /> : isCurrentYanked ? "Restore Release" : "Yank Release"}
                </Button>
              </Box>
            </Box>
          </Dialog>
        )}

        {manageModal === "deprecate" && (
          <Dialog
            title={isCurrentDeprecated ? `Remove Deprecation from v${version}` : `Deprecate Release v${version}`}
            onClose={() => setManageModal(null)}
          >
            <Box p={3} display="flex" flexDirection="column" gap={3}>
              <Text style={{ fontSize: 14, color: "var(--color-text-secondary)" }}>
                {isCurrentDeprecated
                  ? `Removing deprecation will clear the warning banner on v${version}.`
                  : `Deprecating v${version} displays a warning banner informing users to migrate to a newer version.`}
              </Text>
              {!isCurrentDeprecated && (
                <Box>
                  <Text style={{ fontSize: 13, fontWeight: 600, display: "block", marginBottom: 6 }}>
                    Deprecation message
                  </Text>
                  <TextInput
                    block
                    placeholder="e.g. Please upgrade to v2.0.0; this version is no longer maintained."
                    value={deprecateReasonInput}
                    onChange={(e) => setDeprecateReasonInput(e.target.value)}
                  />
                </Box>
              )}
              {actionError && <Flash variant="danger">{actionError}</Flash>}
              <Box display="flex" justifyContent="flex-end" gap={2} mt={2}>
                <Button onClick={() => setManageModal(null)}>Cancel</Button>
                <Button variant="primary" onClick={handleToggleDeprecate} disabled={actionLoading}>
                  {actionLoading ? (
                    <Spinner size="small" />
                  ) : isCurrentDeprecated ? (
                    "Remove Deprecation"
                  ) : (
                    "Deprecate Release"
                  )}
                </Button>
              </Box>
            </Box>
          </Dialog>
        )}

        {manageModal === "transfer" && (
          <Dialog title={`Transfer Package Ownership`} onClose={() => setManageModal(null)}>
            <Box p={3} display="flex" flexDirection="column" gap={3}>
              <Text style={{ fontSize: 14, color: "var(--color-text-secondary)" }}>
                Initiate an ownership transfer of <strong>{name}</strong> to another registered user. The transfer will
                remain pending until the recipient accepts it.
              </Text>
              <Box>
                <Text style={{ fontSize: 13, fontWeight: 600, display: "block", marginBottom: 6 }}>
                  Recipient username
                </Text>
                <TextInput
                  block
                  placeholder="e.g. alice"
                  value={transferTargetInput}
                  onChange={(e) => setTransferTargetInput(e.target.value)}
                />
              </Box>
              {actionError && <Flash variant="danger">{actionError}</Flash>}
              <Box display="flex" justifyContent="flex-end" gap={2} mt={2}>
                <Button onClick={() => setManageModal(null)}>Cancel</Button>
                <Button
                  variant="primary"
                  onClick={handleTransfer}
                  disabled={actionLoading || !transferTargetInput.trim()}
                >
                  {actionLoading ? <Spinner size="small" /> : "Send Transfer Request"}
                </Button>
              </Box>
            </Box>
          </Dialog>
        )}

        {/* ── Background Ingestion & Indexer Logs ── */}
        {name && version && (
          <TerminalLogViewer
            packageName={name}
            packageVersion={version}
            initialJobInfo={jobInfo}
            onJobCompleted={fetchData}
            defaultCollapsed={jobStatus === "completed"}
          />
        )}

        {/* ── Tabs ── */}
        <TabBar>
          {TABS.map((tab) => (
            <Tab key={tab.id} $active={activeTab === tab.id} onClick={() => setTab(tab.id)}>
              {tab.icon}
              {tab.label}
              {tab.id === "digital-thread" && availableDomains.length > 2 && (
                <Label variant="accent" style={{ fontSize: 10, padding: "0 4px", marginLeft: 4 }}>
                  Polyglot
                </Label>
              )}
              {tab.id === "artifacts" && (artifactViewers.length > 0 || artifacts.length > 0) && (
                <Label variant="secondary" style={{ fontSize: 10, padding: "0 4px", marginLeft: 4 }}>
                  {artifactViewers.length || artifacts.length}
                </Label>
              )}
              {tab.id === "dependencies" && Object.keys(dependencies).length > 0 && (
                <Label variant="secondary" style={{ fontSize: 10, padding: "0 4px", marginLeft: 4 }}>
                  {Object.keys(dependencies).length}
                </Label>
              )}
            </Tab>
          ))}
        </TabBar>

        {/* ── Body ── */}
        <ContentGrid>
          {/* ── Main column ── */}
          <div>
            {/* README tab */}
            {activeTab === "readme" && (
              <>
                {/* Cyber-Physical Digital Thread Banner */}
                {availableDomains.length > 2 && (
                  <GlassCard
                    style={{
                      padding: "14px 18px",
                      marginBottom: 20,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      background: "linear-gradient(135deg, rgba(6, 182, 212, 0.08), rgba(168, 85, 247, 0.08))",
                      border: "1px solid rgba(6, 182, 212, 0.3)",
                      borderRadius: 12,
                    }}
                  >
                    <Box display="flex" alignItems="center" gap={3}>
                      <SyncIcon size={20} fill="#06b6d4" />
                      <div>
                        <Text style={{ fontWeight: 600, fontSize: 14, color: "var(--color-text-heading)" }}>
                          Cross-Domain Digital Thread Active
                        </Text>
                        <Text as="p" style={{ fontSize: 12, color: "var(--color-text-muted)", margin: "2px 0 0" }}>
                          Multi-language twins bound across Modelica, SysML v2, and STEP CAD with verified unit parity.
                        </Text>
                      </div>
                    </Box>
                    <Button size="small" variant="primary" onClick={() => setTab("digital-thread")}>
                      Explore Twins
                    </Button>
                  </GlassCard>
                )}
                {/* Root class diagram */}
                {!diagramError && (
                  <div style={diagramLoaded ? undefined : { position: "absolute", opacity: 0, pointerEvents: "none" }}>
                    <DiagramWrap>
                      <InvertedSvg
                        src={`${getDiagramUrl(name!, version!, name!)}?t=${retryCount}`}
                        alt={`${name} diagram`}
                        onLoad={() => setDiagramLoaded(true)}
                        onError={() => {
                          if (jobStatus && jobStatus !== "completed" && jobStatus !== "failed") {
                            setTimeout(() => setRetryCount((p) => p + 1), 3000);
                          } else {
                            setDiagramError(true);
                          }
                        }}
                      />
                    </DiagramWrap>
                  </div>
                )}

                <DocCard>
                  {rootClass?.documentation ? (
                    <div
                      dangerouslySetInnerHTML={{
                        __html: DOMPurify.sanitize(rewriteModelicaUris(rootClass.documentation, version!, name)),
                      }}
                    />
                  ) : packument?.readme && !packument.readme.includes("ERROR: No README data found!") ? (
                    <div
                      dangerouslySetInnerHTML={{
                        __html: DOMPurify.sanitize(
                          rewriteModelicaUris(
                            marked.parse(packument.readme, { breaks: true, gfm: true }) as string,
                            version!,
                            name,
                          ),
                        ),
                      }}
                    />
                  ) : rootClass?.description ? (
                    <Text as="p" style={{ color: "var(--color-text-primary)", lineHeight: 1.7, margin: 0 }}>
                      {rootClass.description}
                    </Text>
                  ) : (
                    <Text as="p" style={{ color: "var(--color-text-muted)", fontStyle: "italic", margin: 0 }}>
                      No documentation available for this artifact.
                    </Text>
                  )}
                </DocCard>
              </>
            )}

            {/* Versions tab */}
            {activeTab === "versions" && (
              <>
                <SectionTitle as="h3">Version History</SectionTitle>
                <GlassCard>
                  {versionList.length > 0 ? (
                    versionList.map((v) => {
                      const vManifest = packument?.versions?.[v];
                      const isVManifestYanked = Boolean(vManifest?.yanked || vManifest?.is_yanked);
                      const vYankReason =
                        typeof vManifest?.yanked === "string"
                          ? vManifest.yanked
                          : (vManifest?.yank_reason as string | undefined);
                      const isVManifestDeprecated = Boolean(vManifest?.deprecated);
                      const vDepReason = typeof vManifest?.deprecated === "string" ? vManifest.deprecated : null;

                      return (
                        <VersionRow
                          key={v}
                          style={{
                            flexDirection: "column",
                            alignItems: "stretch",
                            gap: 6,
                            padding: "14px 0",
                          }}
                        >
                          <Box display="flex" justifyContent="space-between" alignItems="center">
                            <Box display="flex" alignItems="center" gap="8px" flexWrap="wrap">
                              <Link
                                to={`/packages/${name}/${v}`}
                                style={{
                                  color: "var(--color-link)",
                                  textDecoration: "none",
                                  fontWeight: v === version ? 600 : 400,
                                  fontSize: 14,
                                }}
                              >
                                {v}
                              </Link>
                              {packument?.["dist-tags"]?.["latest"] === v && (
                                <Label variant="accent" style={{ fontSize: 10, padding: "0 6px" }}>
                                  latest
                                </Label>
                              )}
                              {v === version && (
                                <Label variant="success" style={{ fontSize: 10, padding: "0 6px" }}>
                                  current
                                </Label>
                              )}
                              {isVManifestYanked && (
                                <Label
                                  variant="danger"
                                  style={{
                                    fontSize: 10,
                                    padding: "0 6px",
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: 4,
                                  }}
                                >
                                  <AlertFillIcon size={11} /> yanked
                                </Label>
                              )}
                              {isVManifestDeprecated && (
                                <Label
                                  variant="attention"
                                  style={{
                                    fontSize: 10,
                                    padding: "0 6px",
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: 4,
                                  }}
                                >
                                  <AlertIcon size={11} /> deprecated
                                </Label>
                              )}
                            </Box>
                            <Box display="flex" alignItems="center" gap="12px">
                              <Button
                                size="small"
                                variant="invisible"
                                leadingVisual={GitCompareIcon}
                                onClick={() => setTab("compare")}
                                style={{ fontSize: 12, padding: "2px 8px" }}
                              >
                                Compare
                              </Button>
                              <Text style={{ color: "var(--color-text-muted)", fontSize: 13 }}>
                                {packument?.time?.[v] ? formatDate(packument.time[v]) : ""}
                              </Text>
                            </Box>
                          </Box>

                          {isVManifestYanked && (
                            <Box
                              style={{
                                fontSize: 12,
                                color: "var(--color-danger-fg, #cf222e)",
                                background: "rgba(207, 34, 46, 0.08)",
                                padding: "4px 8px",
                                borderRadius: 4,
                                marginTop: 2,
                              }}
                            >
                              <strong>Yank reason:</strong> {vYankReason || "Yanked by author"}
                            </Box>
                          )}

                          {isVManifestDeprecated && vDepReason && (
                            <Box
                              style={{
                                fontSize: 12,
                                color: "#b45309",
                                background: "rgba(217, 119, 6, 0.08)",
                                padding: "4px 8px",
                                borderRadius: 4,
                                marginTop: 2,
                              }}
                            >
                              <strong>Deprecated:</strong> {vDepReason}
                            </Box>
                          )}
                        </VersionRow>
                      );
                    })
                  ) : (
                    <Text as="p" style={{ color: "var(--color-text-muted)", fontStyle: "italic", margin: 0 }}>
                      No version history available.
                    </Text>
                  )}
                </GlassCard>
              </>
            )}

            {/* Compare tab */}
            {activeTab === "compare" && name && version && (
              <>
                <SectionTitle as="h3">Polyglot Release Comparison</SectionTitle>
                <Text as="p" style={{ color: "var(--color-text-muted)", marginBottom: 24, fontSize: 14 }}>
                  Inspect multi-domain architectural, equation, CAD geometry, and parameter shifts between package
                  releases.
                </Text>
                <PolyglotVersionDiffView packageName={name} currentVersion={version} allVersions={versionList} />
              </>
            )}

            {/* Digital Thread tab */}
            {activeTab === "digital-thread" && (
              <>
                <SectionTitle as="h3">Digital Thread Twins &amp; Parity Matrix</SectionTitle>
                <Text as="p" style={{ color: "var(--color-text-muted)", marginBottom: 24, fontSize: 14 }}>
                  Inspect interconnected cyber-physical twins spanning continuous Modelica differential equations, SysML
                  v2 requirements &amp; block definitions, and STEP CAD 3D solids with real-time physical quantity
                  parity.
                </Text>
                <DigitalThreadExplorer
                  packageName={name!}
                  packageVersion={version!}
                  classes={classes}
                  rootClass={rootClass}
                  artifactViewers={artifactViewers}
                  onNavigateToArtifact={(p) => {
                    const av = artifactViewers.find((a) => a.path === p);
                    if (av) handleOpenArtifact(av);
                  }}
                  onNavigateToClass={(c) => {
                    navigate(`/packages/${name}/${version}/classes/${c}`);
                  }}
                />
              </>
            )}

            {/* Artifacts tab */}
            {activeTab === "artifacts" && (
              <>
                <SectionTitle as="h3">Bundled Artifacts</SectionTitle>
                <Text as="p" style={{ color: "var(--color-text-muted)", marginBottom: 24, fontSize: 14 }}>
                  Artifacts are compiled resources, datasets, or external files bundled with this artifact version. They
                  provide pre-compiled simulations (FMUs), CAD models, or supplementary data that can be executed or
                  viewed directly in the browser.
                </Text>

                {/* Domain filter buttons in artifacts tab */}
                {availableDomains.filter((d) => d.id !== "modelica").length > 2 && (
                  <Box display="flex" gap={2} mb={3} flexWrap="wrap">
                    {availableDomains
                      .filter((d) => d.id !== "modelica")
                      .map((d) => (
                        <Button
                          key={d.id}
                          size="small"
                          variant={artifactTabDomainFilter === d.id ? "primary" : "invisible"}
                          onClick={() => setArtifactTabDomainFilter(d.id)}
                          style={{ fontSize: 12 }}
                        >
                          {d.icon} {d.label} ({d.count})
                        </Button>
                      ))}
                  </Box>
                )}

                {/* Render enriched artifact viewers from the API */}
                {displayedArtifactViewers.length > 0 ? (
                  displayedArtifactViewers.map((av) => {
                    // Render interactive viewers based on handler-provided descriptors
                    if (av.viewer?.viewer === "fmu-simulator") {
                      return (
                        <div id={`artifact-${av.id}`} key={av.id}>
                          <FmuSimulatorViewer
                            config={
                              av.viewer.config as Record<string, unknown> & {
                                fmiVersion?: string;
                                modelName?: string;
                                hasWasm?: boolean;
                                inputs?: {
                                  name: string;
                                  valueReference: number;
                                  causality: string;
                                  variability: string;
                                  type: string;
                                  start?: string;
                                  unit?: string;
                                  description?: string;
                                }[];
                                outputs?: {
                                  name: string;
                                  valueReference: number;
                                  causality: string;
                                  variability: string;
                                  type: string;
                                  start?: string;
                                  unit?: string;
                                  description?: string;
                                }[];
                                parameters?: {
                                  name: string;
                                  valueReference: number;
                                  causality: string;
                                  variability: string;
                                  type: string;
                                  start?: string;
                                  unit?: string;
                                  description?: string;
                                }[];
                                platforms?: string[];
                              }
                            }
                            artifactPath={av.path}
                          />
                        </div>
                      );
                    }

                    if (av.viewer?.viewer === "dataset-table") {
                      return (
                        <div id={`artifact-${av.id}`} key={av.id}>
                          <DatasetTableViewer
                            config={
                              av.viewer.config as Record<string, unknown> & {
                                columns?: {
                                  name: string;
                                  type: "number" | "string" | "boolean";
                                  min?: number;
                                  max?: number;
                                  mean?: number;
                                  unique?: number;
                                }[];
                                rowCount?: number;
                                format?: string;
                                previewRows?: string[][];
                                hasHeader?: boolean;
                              }
                            }
                            artifactPath={av.path}
                          />
                        </div>
                      );
                    }

                    if (av.viewer?.viewer === "cad-3d-viewer") {
                      return (
                        <div id={`artifact-${av.id}`} key={av.id}>
                          <CadStepViewer viewConfig={{ url: av.path, ...(av.viewer.config || {}) }} />
                        </div>
                      );
                    }

                    if (av.viewer?.viewer === "sysml-architecture-viewer") {
                      return (
                        <div id={`artifact-${av.id}`} key={av.id}>
                          <SysmlViewer config={av.viewer.config} artifactPath={av.path} />
                        </div>
                      );
                    }

                    // Fallback: render a generic artifact card for unrecognized types
                    return (
                      <ArtifactCard id={`artifact-${av.id}`} key={av.id}>
                        <ArtifactBadge $type={av.type}>{av.type}</ArtifactBadge>
                        <Box flex={1}>
                          <Text style={{ fontSize: 14, fontWeight: 500, color: "var(--color-text-heading)" }}>
                            {av.path}
                          </Text>
                          <Text as="p" style={{ fontSize: 12, color: "var(--color-text-muted)", margin: "4px 0 0" }}>
                            {av.displayName}
                          </Text>
                        </Box>
                      </ArtifactCard>
                    );
                  })
                ) : artifacts.length > 0 ? (
                  // Fallback to basic artifact list from packument metadata
                  artifacts.map((artifact, i) => (
                    <ArtifactCard key={i}>
                      <ArtifactBadge $type={artifact.type}>{artifact.type}</ArtifactBadge>
                      <Box flex={1}>
                        <Text style={{ fontSize: 14, fontWeight: 500, color: "var(--color-text-heading)" }}>
                          {artifact.path}
                        </Text>
                        {artifact.description && (
                          <Text as="p" style={{ fontSize: 12, color: "var(--color-text-muted)", margin: "4px 0 0" }}>
                            {artifact.description}
                          </Text>
                        )}
                      </Box>
                      {artifact.fmiVersion && (
                        <Label variant="secondary" style={{ fontSize: 10 }}>
                          FMI {artifact.fmiVersion}
                        </Label>
                      )}
                      {artifact.platforms && (
                        <Box display="flex" gap="4px">
                          {artifact.platforms.map((p) => (
                            <Label key={p} variant="secondary" style={{ fontSize: 10 }}>
                              {p}
                            </Label>
                          ))}
                        </Box>
                      )}
                    </ArtifactCard>
                  ))
                ) : (
                  <GlassCard>
                    <Text as="p" style={{ color: "var(--color-text-muted)", fontStyle: "italic", margin: 0 }}>
                      No artifacts bundled with this version.
                    </Text>
                  </GlassCard>
                )}
              </>
            )}

            {/* Dependencies tab */}
            {activeTab === "dependencies" && (
              <>
                <SectionTitle as="h3">Dependencies</SectionTitle>
                <GlassCard>
                  {Object.keys(dependencies).length > 0 ? (
                    Object.entries(dependencies).map(([dep, range]) => (
                      <DepRow key={dep}>
                        <Link
                          to={`/packages/${dep}`}
                          style={{ color: "var(--color-link)", textDecoration: "none", fontSize: 14 }}
                        >
                          {dep}
                        </Link>
                        <Text style={{ color: "var(--color-text-muted)", fontSize: 13, fontFamily: "monospace" }}>
                          {range}
                        </Text>
                      </DepRow>
                    ))
                  ) : (
                    <Text as="p" style={{ color: "var(--color-text-muted)", fontStyle: "italic", margin: 0 }}>
                      No dependencies.
                    </Text>
                  )}
                </GlassCard>

                {currentManifest?.devDependencies && Object.keys(currentManifest.devDependencies).length > 0 && (
                  <>
                    <SectionTitle as="h3" style={{ marginTop: 24 }}>
                      Dev Dependencies
                    </SectionTitle>
                    <GlassCard>
                      {Object.entries(currentManifest.devDependencies).map(([dep, range]) => (
                        <DepRow key={dep}>
                          <Text style={{ color: "var(--color-text-primary)", fontSize: 14 }}>{dep}</Text>
                          <Text style={{ color: "var(--color-text-muted)", fontSize: 13, fontFamily: "monospace" }}>
                            {range}
                          </Text>
                        </DepRow>
                      ))}
                    </GlassCard>
                  </>
                )}
              </>
            )}
          </div>

          {/* ── Sidebar ── */}
          <aside style={{ display: "flex", flexDirection: "column" }}>
            <MetaLabel style={{ marginBottom: 12 }}>Install</MetaLabel>
            <InstallBox onClick={handleCopy} title="Click to copy">
              <code>{installCmd}</code>
              <span className="copy-icon">{copied ? <VerifiedIcon size={16} /> : <CopyIcon size={16} />}</span>
            </InstallBox>

            <Link
              to={`/ide#memfs:package-${name || "model"}`}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "8px",
                width: "100%",
                padding: "10px 16px",
                borderRadius: "8px",
                background: "var(--gradient-cta)",
                color: "white",
                fontSize: "14px",
                fontWeight: 600,
                textDecoration: "none",
                marginBottom: "20px",
                boxShadow: "var(--glow-ai-sm)",
                boxSizing: "border-box",
              }}
            >
              <CodeIcon size={16} />
              Open in ModelScript IDE
            </Link>

            {packument?.repository?.url && (
              <MetaBlock>
                <MetaLabel>Repository</MetaLabel>
                <MetaValue>
                  <BookIcon size={16} />
                  <a
                    href={packument.repository.url.replace(/^git\+/, "").replace(/\.git$/, "")}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: "var(--color-heading)", textDecoration: "none" }}
                  >
                    {packument.repository.url.replace(/^git\+https:\/\//, "").replace(/\.git$/, "")}
                  </a>
                </MetaValue>
              </MetaBlock>
            )}

            {packument?.homepage && (
              <MetaBlock>
                <MetaLabel>Homepage</MetaLabel>
                <MetaValue>
                  <LinkIcon size={16} />
                  <a
                    href={packument.homepage}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: "var(--color-heading)", textDecoration: "none" }}
                  >
                    {packument.homepage.replace(/^https?:\/\//, "")}
                  </a>
                </MetaValue>
              </MetaBlock>
            )}

            <Divider />

            <MetaGrid>
              <MetaBlock style={{ marginBottom: 0 }}>
                <MetaLabel>Version</MetaLabel>
                <MetaValue>{version}</MetaValue>
              </MetaBlock>
              {packument?.license && (
                <MetaBlock style={{ marginBottom: 0 }}>
                  <MetaLabel>License</MetaLabel>
                  <MetaValue>{packument.license}</MetaValue>
                </MetaBlock>
              )}
            </MetaGrid>

            <MetaBlock>
              <MetaLabel>Last publish</MetaLabel>
              <MetaValue>{publishedAt ? timeAgo(publishedAt) : "—"}</MetaValue>
            </MetaBlock>

            {currentManifest?.modelscript?.modelicaVersion && (
              <MetaBlock>
                <MetaLabel>Modelica Version</MetaLabel>
                <MetaValue>{currentManifest.modelscript.modelicaVersion}</MetaValue>
              </MetaBlock>
            )}

            {/* Polyglot Engineering Domains */}
            {availableDomains.filter((d) => d.id !== "all").length > 1 && (
              <MetaBlock>
                <MetaLabel style={{ marginBottom: 8 }}>
                  Polyglot Domains ({availableDomains.filter((d) => d.id !== "all").length})
                </MetaLabel>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                  {availableDomains
                    .filter((d) => d.id !== "all")
                    .map((d) => (
                      <span
                        key={d.id}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 4,
                          padding: "3px 8px",
                          borderRadius: "6px",
                          fontSize: 12,
                          fontWeight: 600,
                          background: "var(--color-glass-bg, rgba(255,255,255,0.04))",
                          border: `1px solid ${d.color}44`,
                          color: d.color,
                        }}
                      >
                        <span>{d.icon}</span>
                        <span>{d.label}</span>
                        <span style={{ opacity: 0.7, fontSize: 11 }}>({d.count})</span>
                      </span>
                    ))}
                </div>
              </MetaBlock>
            )}

            <Divider />

            {/* 30-Day Download Trends */}
            <MetaBlock>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <MetaLabel>Downloads</MetaLabel>
                <Text style={{ fontSize: 13, fontWeight: 600, color: "var(--color-heading)" }}>
                  {(packageStats?.daily?.reduce((acc, d) => acc + d.downloads, 0) ?? 0).toLocaleString()}
                </Text>
              </div>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  fontSize: 11,
                  color: "var(--color-text-muted)",
                  marginTop: 2,
                }}
              >
                <span>Total: {(packageStats?.totalDownloads ?? 0).toLocaleString()}</span>
                <span>Last 30 days</span>
              </div>
              {packageStats?.daily &&
                packageStats.daily.length > 0 &&
                (() => {
                  const maxVal = Math.max(...packageStats.daily.map((d) => d.downloads), 1);
                  return (
                    <SparklineContainer>
                      {packageStats.daily.map((d) => (
                        <SparklineBar
                          key={d.date}
                          $heightPct={(d.downloads / maxVal) * 100}
                          $active={d.downloads > 0}
                          title={`${d.date}: ${d.downloads} download${d.downloads === 1 ? "" : "s"}`}
                        />
                      ))}
                    </SparklineContainer>
                  );
                })()}
            </MetaBlock>

            <Divider />

            {/* Dependents ("Used by") */}
            <MetaBlock>
              <MetaLabel style={{ marginBottom: 8 }}>Used by ({dependents.length})</MetaLabel>
              {dependents.length > 0 ? (
                <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                  {dependents.slice(0, 8).map((dep) => (
                    <DependentBadge key={dep.name} to={`/packages/${dep.name}/${dep.version}`}>
                      <PackageIcon size={12} />
                      {dep.name}
                    </DependentBadge>
                  ))}
                  {dependents.length > 8 && (
                    <Text style={{ fontSize: 11, color: "var(--color-text-muted)", alignSelf: "center" }}>
                      +{dependents.length - 8} more
                    </Text>
                  )}
                </div>
              ) : (
                <Text style={{ fontSize: 12, color: "var(--color-text-muted)", fontStyle: "italic" }}>
                  0 packages depend on this library
                </Text>
              )}
            </MetaBlock>

            <Divider />
          </aside>
        </ContentGrid>
      </MainContentWrap>
    </PageWrap>
  );
};

export default PackageDetailPage;
