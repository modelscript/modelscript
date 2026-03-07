import { ChevronDownIcon, ChevronRightIcon } from "@primer/octicons-react";
import { Label } from "@primer/react";
import React, { useState } from "react";
import { Link } from "react-router-dom";
import styled from "styled-components";
import { getIconUrl } from "../api";
import type { TreeNode } from "./classTreeUtils";

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
        style={isActive ? { background: "var(--color-tree-active-bg)", color: "var(--color-link)" } : undefined}
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
          style={{ width: 16, height: 16, flexShrink: 0, filter: "var(--diagram-filter)" }}
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
