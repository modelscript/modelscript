import { ChevronDownIcon, ChevronRightIcon } from "@primer/octicons-react";
import { Label } from "@primer/react";
import React, { useState } from "react";
import { Link } from "react-router-dom";
import styled from "styled-components";
import type { ClassSummary } from "../api";
import { getIconUrl } from "../api";

/* ─── styled components ─── */

export const TreeItem = styled(Link)<{ $depth: number }>`
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 8px 5px ${(p) => 8 + p.$depth * 16}px;
  font-size: 13px;
  color: #c9d1d9;
  text-decoration: none;
  border-radius: 4px;
  cursor: pointer;
  transition: background 0.15s;
  &:hover {
    background: rgba(255, 255, 255, 0.06);
    color: #e6edf3;
  }
`;

export const TreeToggle = styled.button`
  background: none;
  border: none;
  cursor: pointer;
  color: #8b949e;
  padding: 0;
  display: flex;
  align-items: center;
  &:hover {
    color: #c9d1d9;
  }
`;

/* ─── tree node types ─── */

export interface TreeNode {
  name: string;
  fullName: string;
  classKind: string;
  children: TreeNode[];
}

export function buildClassTree(classes: ClassSummary[], rootName: string): TreeNode[] {
  const root: TreeNode = { name: rootName, fullName: rootName, classKind: "package", children: [] };
  const nodeMap = new Map<string, TreeNode>();
  nodeMap.set(rootName, root);

  // Sort classes so parents are processed before children
  const sorted = [...classes].sort((a, b) => a.class_name.localeCompare(b.class_name));

  for (const cls of sorted) {
    const fullName = cls.class_name;
    // Only include direct children of the root
    if (!fullName.startsWith(rootName + ".")) continue;

    const parts = fullName.split(".");
    // Build intermediate nodes
    for (let i = 1; i < parts.length; i++) {
      const partialName = parts.slice(0, i + 1).join(".");
      if (!nodeMap.has(partialName)) {
        const node: TreeNode = {
          name: parts[i],
          fullName: partialName,
          classKind: cls.class_name === partialName ? cls.class_kind : "package",
          children: [],
        };
        nodeMap.set(partialName, node);
        const parentName = parts.slice(0, i).join(".");
        const parent = nodeMap.get(parentName);
        if (parent) parent.children.push(node);
      } else if (cls.class_name === partialName) {
        // Update classKind if this is the actual class
        const existing = nodeMap.get(partialName)!;
        existing.classKind = cls.class_kind;
      }
    }
  }

  return root.children;
}

/* ─── tree node component ─── */

export const ClassTreeNode: React.FC<{
  node: TreeNode;
  depth: number;
  libraryName: string;
  version: string;
  activeClassName?: string;
}> = ({ node, depth, libraryName, version, activeClassName }) => {
  const [expanded, setExpanded] = useState(
    depth < 1 || (activeClassName ? activeClassName.startsWith(node.fullName + ".") : false),
  );
  const hasChildren = node.children.length > 0;
  const iconUrl = getIconUrl(libraryName, version, node.fullName);
  const isActive = activeClassName === node.fullName;

  return (
    <>
      <TreeItem
        to={`/${libraryName}/${version}/classes/${node.fullName}`}
        $depth={depth}
        style={isActive ? { background: "rgba(88,166,255,0.12)", color: "#58a6ff" } : undefined}
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
        <img
          src={iconUrl}
          alt=""
          style={{ width: 16, height: 16, flexShrink: 0, filter: "invert(1) hue-rotate(180deg)" }}
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = "none";
          }}
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
            activeClassName={activeClassName}
          />
        ))}
    </>
  );
};
