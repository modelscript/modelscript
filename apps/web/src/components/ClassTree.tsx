// SPDX-License-Identifier: AGPL-3.0-or-later

import { ChevronDownIcon, ChevronRightIcon, CodeIcon, CpuIcon, PackageIcon } from "@primer/octicons-react";
import { Label } from "@primer/react";
import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import styled from "styled-components";
import { getIconUrl } from "../api";
import type { TreeNode } from "./classTreeUtils";
import InvertedSvg from "./InvertedSvg";

/* ─── styled components ─── */

const TreeItem = styled(Link)<{ $depth: number }>`
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 8px 5px ${(p) => 8 + p.$depth * 16}px;
  font-size: 13px;
  color: var(--color-text-primary);
  text-decoration: none;
  border-radius: 4px;
  cursor: pointer;
  transition: background 0.15s;
  &:hover {
    background: var(--color-glass-bg-hover);
    color: var(--color-text-heading);
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

  const fallbackIcon = node.classKind.includes("sysml") ? (
    <CodeIcon size={16} fill="var(--color-primary)" />
  ) : node.classKind.includes("cad") || node.classKind.includes("product") || node.classKind.includes("shape") ? (
    <CpuIcon size={16} fill="var(--color-warning)" />
  ) : (
    <PackageIcon size={16} />
  );

  return (
    <>
      <TreeItem
        to={`/packages/${libraryName}/${version}/classes/${node.fullName}`}
        $depth={depth}
        style={isActive ? { background: "var(--color-tree-active-bg)", color: "var(--color-link)" } : undefined}
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
        <Label
          variant="secondary"
          style={{ fontSize: "10px", padding: "0 4px", lineHeight: "16px", marginLeft: "auto", flexShrink: 0 }}
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
            activeClassName={activeClassName}
            isFiltered={isFiltered}
          />
        ))}
    </>
  );
};
