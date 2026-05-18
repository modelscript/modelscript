import { NodeFactory, SemanticNode } from "./semantic-node.js";

export type DiffAction = "insert" | "delete" | "update" | "move" | "none";

export interface SemanticEdit {
  action: DiffAction;
  /** The node from the 'old' tree (if applicable) */
  oldNode?: SemanticNode | null;
  /** The node from the 'new' tree (if applicable) */
  newNode?: SemanticNode | null;
  /** Description of the change */
  description?: string;
  /** Nested edits for children */
  children?: SemanticEdit[];
}

export interface SemanticDiffOptions {
  /**
   * If true, changes in the order of children for certain nodes are ignored.
   * Useful for declarative sections like Modelica equations.
   */
  orderAgnostic?: boolean;
  /**
   * Factory function to wrap generic SymbolEntries back into SemanticNodes.
   */
  nodeFactory: NodeFactory;
}

/**
 * Computes a structural / semantic diff between two SemanticNode trees.
 */
export function computeSemanticDiff(
  oldNode: SemanticNode | null,
  newNode: SemanticNode | null,
  options: SemanticDiffOptions,
): SemanticEdit {
  if (!oldNode && !newNode) {
    throw new Error("Both oldNode and newNode cannot be null");
  }

  // Pure Insert
  if (!oldNode && newNode) {
    return {
      action: "insert",
      newNode,
      description: `Inserted ${newNode.kind} '${newNode.entry.name || "unnamed"}'`,
    };
  }

  // Pure Delete
  if (oldNode && !newNode) {
    return {
      action: "delete",
      oldNode,
      description: `Deleted ${oldNode.kind} '${oldNode.entry.name || "unnamed"}'`,
    };
  }

  if (!oldNode || !newNode) {
    throw new Error("Unreachable: both nodes must be defined here");
  }

  // Different kind or name? Might be purely an Update or we treat it as Delete + Insert.
  // We'll treat same kind + same name as "Update"
  if (oldNode.kind !== newNode.kind || oldNode.entry.name !== newNode.entry.name) {
    // If the identity completely changed, it's a replacement (Delete then Insert)
    // We can represent this as an update with both nodes.
    return {
      action: "update",
      oldNode,
      newNode,
      description: `Replaced ${oldNode.kind} with ${newNode.kind}`,
    };
  }

  // Same identity, but hash differs. This means children or metadata/args changed.
  const edits: SemanticEdit[] = [];
  let isUpdated = false;

  const oldMetadataStr = JSON.stringify(oldNode.entry.metadata);
  const newMetadataStr = JSON.stringify(newNode.entry.metadata);
  if (oldMetadataStr !== newMetadataStr) {
    isUpdated = true;
    edits.push({
      action: "update",
      oldNode,
      newNode,
      description: "Metadata updated",
    });
  }

  const oldArgs = oldNode.specializationArgs?.hash;
  const newArgs = newNode.specializationArgs?.hash;
  if (oldArgs !== newArgs) {
    isUpdated = true;
    edits.push({
      action: "update",
      oldNode,
      newNode,
      description: "Specialization arguments updated",
    });
  }

  // Diff children
  const factory = options.nodeFactory;
  const oldChildren = oldNode.childEntries.map((e) => factory(e, oldNode.db));
  const newChildren = newNode.childEntries.map((e) => factory(e, newNode.db));

  if (options.orderAgnostic) {
    // Order agnostic matching
    const matchedNew = new Set<string>();

    for (const oc of oldChildren) {
      // Find a matching kind + name in new
      const matchIdx = newChildren.findIndex(
        (nc) => !matchedNew.has(nc.id.toString()) && oc.kind === nc.kind && oc.entry.name === nc.entry.name,
      );

      if (matchIdx >= 0) {
        const nc = newChildren[matchIdx];
        matchedNew.add(nc.id.toString());
        const childDiff = computeSemanticDiff(oc, nc, options);
        if (childDiff.action !== "none") {
          edits.push(childDiff);
        }
      } else {
        // Child was deleted
        edits.push({
          action: "delete",
          oldNode: oc,
          description: `Deleted child ${oc.kind} '${oc.entry.name || "unnamed"}'`,
        });
      }
    }

    // Any remaining new children are insertions
    for (const nc of newChildren) {
      if (!matchedNew.has(nc.id.toString())) {
        edits.push({
          action: "insert",
          newNode: nc,
          description: `Inserted child ${nc.kind} '${nc.entry.name || "unnamed"}'`,
        });
      }
    }
  } else {
    // Simple ordered matching (assumes same indices for simplicty to start)
    // A more advanced Diff would use Myers or Levenshtein on children array
    const maxLen = Math.max(oldChildren.length, newChildren.length);
    for (let i = 0; i < maxLen; i++) {
      if (i < oldChildren.length && i < newChildren.length) {
        const childDiff = computeSemanticDiff(oldChildren[i], newChildren[i], options);
        if (childDiff.action !== "none") {
          edits.push(childDiff);
        }
      } else if (i < oldChildren.length) {
        edits.push(computeSemanticDiff(oldChildren[i], null, options));
      } else {
        edits.push(computeSemanticDiff(null, newChildren[i], options));
      }
    }
  }

  // If there are child edits or direct updates, the node itself is considered "updated" structurally
  if (edits.length > 0 || isUpdated) {
    const descriptions = edits.map((e) => e.description).filter(Boolean);
    return {
      action: "update",
      oldNode,
      newNode,
      description: descriptions.length > 0 ? descriptions.join(", ") : undefined,
      children: edits.length > 0 ? edits : undefined,
    };
  }

  return {
    action: "none",
    oldNode,
    newNode,
  };
}
