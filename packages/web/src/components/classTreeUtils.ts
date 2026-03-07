import type { ClassSummary } from "../api";

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
