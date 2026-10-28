// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  ChevronDownIcon,
  ChevronRightIcon,
  CodeIcon,
  CpuIcon,
  DatabaseIcon,
  PackageIcon,
  WorkflowIcon,
} from "@primer/octicons-react";
import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import styled from "styled-components";
import { getIconUrl } from "../api";
import type { TreeNode } from "./classTreeUtils";
import InvertedSvg from "./InvertedSvg";

/* ─── styled components ─── */

const TreeItem = styled(Link)<{ $depth: number; $active?: boolean | undefined }>`
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 8px;
  font-size: 13px;
  font-family: var(--ms-font-sans, system-ui, -apple-system, sans-serif);
  color: ${(p) => (p.$active ? "var(--color-text-heading)" : "var(--color-text-primary)")};
  background: ${(p) => (p.$active ? "var(--color-glass-bg-active, rgba(255, 255, 255, 0.08))" : "transparent")};
  font-weight: ${(p) => (p.$active ? 600 : 500)};
  text-decoration: none;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.15s ease;
  min-height: 28px;
  box-sizing: border-box;
  &:hover {
    background: var(--color-glass-bg-hover, rgba(255, 255, 255, 0.05));
    color: var(--color-accent-cyan, #06b6d4);
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

export function getKindBadgeStyle(kind: string): { bg: string; color: string } | null {
  const k = kind.toLowerCase();
  if (k === "package" || k === "class") return null; // Packages are implicit in tree navigation
  switch (k) {
    case "model":
      return { bg: "rgba(6, 182, 212, 0.15)", color: "var(--color-accent-cyan, #06b6d4)" };
    case "block":
      return { bg: "rgba(59, 130, 246, 0.15)", color: "#3b82f6" };
    case "connector":
      return { bg: "rgba(234, 179, 8, 0.15)", color: "#eab308" };
    case "record":
    case "type":
      return { bg: "rgba(16, 185, 129, 0.15)", color: "#10b981" };
    case "function":
    case "algorithm":
      return { bg: "rgba(168, 85, 247, 0.15)", color: "#c084fc" };
    default:
      return { bg: "var(--color-border-glass, rgba(255, 255, 255, 0.08))", color: "var(--color-text-muted)" };
  }
}

/* ─── tree node component ─── */

export const ClassTreeNode: React.FC<{
  node: TreeNode;
  depth: number;
  libraryName: string;
  version: string;
  activeClassName?: string | undefined;
  isFiltered?: boolean | undefined;
}> = ({ node, depth, libraryName, version, activeClassName, isFiltered }) => {
  const [expanded, setExpanded] = useState(
    depth < 1 ||
      Boolean(isFiltered) ||
      (activeClassName ? activeClassName === node.fullName || activeClassName.startsWith(node.fullName + ".") : false),
  );

  useEffect(() => {
    if (isFiltered) {
      setExpanded(true);
    } else if (activeClassName && activeClassName.startsWith(node.fullName + ".")) {
      setExpanded(true);
    }
  }, [isFiltered, activeClassName, node.fullName]);

  const hasChildren = node.children.length > 0;
  const iconUrl = getIconUrl(libraryName, version, node.fullName);
  const isActive = activeClassName === node.fullName;
  const badgeStyle = getKindBadgeStyle(node.classKind);

  const fallbackIcon = node.classKind.includes("sysml") ? (
    <WorkflowIcon size={15} style={{ color: "#a855f7", flexShrink: 0 }} />
  ) : node.classKind.includes("cad") || node.classKind.includes("product") || node.classKind.includes("shape") ? (
    <PackageIcon size={15} style={{ color: "var(--color-accent-cyan, #06b6d4)", flexShrink: 0 }} />
  ) : node.classKind === "function" ? (
    <CodeIcon size={15} style={{ color: "#c084fc", flexShrink: 0 }} />
  ) : node.classKind === "connector" ? (
    <WorkflowIcon size={15} style={{ color: "#eab308", flexShrink: 0 }} />
  ) : node.classKind === "model" || node.classKind === "block" ? (
    <CpuIcon size={15} style={{ color: "var(--color-accent-cyan, #06b6d4)", flexShrink: 0 }} />
  ) : node.classKind === "record" ? (
    <DatabaseIcon size={15} style={{ color: "#3b82f6", flexShrink: 0 }} />
  ) : (
    <PackageIcon size={15} style={{ color: "var(--color-text-muted)", flexShrink: 0 }} />
  );

  return (
    <>
      <TreeItem
        to={`/packages/${libraryName}/${version}/classes/${node.fullName}`}
        $depth={depth}
        $active={isActive}
        onClick={() => {
          if (hasChildren && !expanded) {
            setExpanded(true);
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
        <InvertedSvg src={iconUrl} fallback={fallbackIcon} alt="" width={16} height={16} />
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{node.name}</span>
        {badgeStyle && (
          <span
            style={{
              fontSize: "10px",
              fontWeight: 600,
              padding: "1px 5px",
              borderRadius: "4px",
              marginLeft: "auto",
              flexShrink: 0,
              textTransform: "uppercase",
              letterSpacing: "0.4px",
              background: badgeStyle.bg,
              color: badgeStyle.color,
            }}
          >
            {node.classKind}
          </span>
        )}
      </TreeItem>
      {expanded && hasChildren && (
        <div
          style={{
            borderLeft: "1px solid var(--color-border-subtle, rgba(255, 255, 255, 0.07))",
            marginLeft: 14,
            paddingLeft: 4,
          }}
        >
          {node.children.map((child) => (
            <ClassTreeNode
              key={child.fullName}
              node={child}
              depth={depth + 1}
              libraryName={libraryName}
              version={version}
              activeClassName={activeClassName}
              isFiltered={isFiltered}
            />
          ))}
        </div>
      )}
    </>
  );
};
