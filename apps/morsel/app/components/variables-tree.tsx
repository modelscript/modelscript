// SPDX-License-Identifier: AGPL-3.0-or-later

import { Checkbox, TreeView } from "@primer/react";
import { useMemo } from "react";
import { SIMULATION_COLORS } from "./simulation-results";

interface VariablesTreeProps {
  variables: string[];
  selectedVariables: string[];
  onToggleVariable: (variable: string) => void;
}

interface TreeNode {
  name: string;
  fullName: string;
  children: Map<string, TreeNode>;
  isVariable: boolean;
}

export function VariablesTree({ variables, selectedVariables, onToggleVariable }: VariablesTreeProps) {
  const treeRoot = useMemo(() => {
    const root: TreeNode = { name: "", fullName: "", children: new Map(), isVariable: false };

    for (const variable of variables) {
      const isDer = variable.startsWith("der(") && variable.endsWith(")");
      const innerVar = isDer ? variable.slice(4, -1) : variable;
      const originalParts = innerVar.split(".");

      let current = root;
      let prefix = "";

      for (let i = 0; i < originalParts.length; i++) {
        const isLeaf = i === originalParts.length - 1;
        const basePart = originalParts[i];

        const part = isLeaf && isDer ? `der(${basePart})` : basePart;
        prefix = prefix ? `${prefix}.${basePart}` : basePart;
        const fullName = isLeaf ? variable : prefix;

        if (!current.children.has(part)) {
          current.children.set(part, {
            name: part,
            fullName: fullName,
            children: new Map(),
            isVariable: isLeaf,
          });
        }
        current = current.children.get(part)!;
      }
    }
    return root;
  }, [variables]);

  const renderNode = (node: TreeNode) => {
    const isSelected = selectedVariables.includes(node.fullName);
    const hasChildren = node.children.size > 0;
    const selectedIndex = selectedVariables.indexOf(node.fullName);
    const color = isSelected ? SIMULATION_COLORS[selectedIndex % SIMULATION_COLORS.length] : undefined;

    const items = Array.from(node.children.values()).sort((a, b) => {
      // Directories first, then alphabetical
      if (a.children.size > 0 && b.children.size === 0) return -1;
      if (a.children.size === 0 && b.children.size > 0) return 1;
      return a.name.localeCompare(b.name);
    });

    return (
      <TreeView.Item
        key={node.fullName}
        id={node.fullName}
        defaultExpanded={true}
        onSelect={node.isVariable ? () => onToggleVariable(node.fullName) : undefined}
      >
        <TreeView.LeadingVisual>
          {node.isVariable ? (
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <Checkbox
                checked={isSelected}
                onChange={() => onToggleVariable(node.fullName)}
                onClick={(e: React.MouseEvent) => e.stopPropagation()}
                aria-label={isSelected ? "Hide variable" : "Show variable"}
              />
              {isSelected && (
                <div
                  style={{
                    width: 12,
                    height: 12,
                    borderRadius: 2,
                    backgroundColor: color,
                    flexShrink: 0,
                  }}
                />
              )}
            </div>
          ) : null}
        </TreeView.LeadingVisual>
        {node.name}
        {hasChildren && <TreeView.SubTree>{items.map(renderNode)}</TreeView.SubTree>}
      </TreeView.Item>
    );
  };

  return (
    <TreeView aria-label="Simulation Variables">
      {Array.from(treeRoot.children.values())
        .sort((a, b) => {
          if (a.children.size > 0 && b.children.size === 0) return -1;
          if (a.children.size === 0 && b.children.size > 0) return 1;
          return a.name.localeCompare(b.name);
        })
        .map(renderNode)}
    </TreeView>
  );
}
