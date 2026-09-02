import type { QueryDB, SymbolEntry, SymbolId } from "./runtime.js";

export interface DiffConfig {
  /** Deterministic identity generator for unnamed or ordered nodes when mapping versions. */
  identity?: string | ((self: any) => string);
  /** Semantic fields to ignore in diff tracking (like documentation or formatting annotations). */
  ignore?: string[];
  /** Attributes where changes are flagged as non-breaking/minor. */
  minor?: string[];
  /** Attributes where changes trigger high-priority breaking diff alerts. */
  breaking?: string[];
}

export type DiffAction = "insert" | "delete" | "update" | "move" | "none";

export interface SymbolRef {
  id: SymbolId;
  db: QueryDB;
}

export interface SemanticEdit {
  action: DiffAction;
  /** The symbol reference from the 'old' tree (if applicable) */
  oldSymbol?: SymbolRef | null;
  /** The symbol reference from the 'new' tree (if applicable) */
  newSymbol?: SymbolRef | null;
  /** The underlying symbol entry from the old tree */
  oldEntry?: SymbolEntry | null;
  /** The underlying symbol entry from the new tree */
  newEntry?: SymbolEntry | null;
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
}

/**
 * Computes a structural / semantic diff between two symbol nodes in their respective QueryDBs.
 */
export function computeSemanticDiff(
  oldNode: SymbolRef | null,
  newNode: SymbolRef | null,
  options: SemanticDiffOptions = {},
): SemanticEdit {
  if (!oldNode && !newNode) {
    throw new Error("Both oldNode and newNode cannot be null");
  }

  const oldEntry = oldNode ? (oldNode.db.symbol(oldNode.id) ?? null) : null;
  const newEntry = newNode ? (newNode.db.symbol(newNode.id) ?? null) : null;

  // Pure Insert
  if (!oldNode && newNode && newEntry) {
    return {
      action: "insert",
      newSymbol: newNode,
      newEntry,
      description: `Inserted ${newEntry.kind} '${newEntry.name || "unnamed"}'`,
    };
  }

  // Pure Delete
  if (oldNode && !newNode && oldEntry) {
    return {
      action: "delete",
      oldSymbol: oldNode,
      oldEntry,
      description: `Deleted ${oldEntry.kind} '${oldEntry.name || "unnamed"}'`,
    };
  }

  if (!oldNode || !newNode || !oldEntry || !newEntry) {
    throw new Error("Unreachable: both nodes and entries must be defined here");
  }

  // Different kind or name? Replacement (Update with both nodes)
  if (oldEntry.kind !== newEntry.kind || oldEntry.name !== newEntry.name) {
    return {
      action: "update",
      oldSymbol: oldNode,
      newSymbol: newNode,
      oldEntry,
      newEntry,
      description: `Replaced ${oldEntry.kind} with ${newEntry.kind}`,
    };
  }

  // Same identity, but metadata or args or children may have changed
  const edits: SemanticEdit[] = [];
  let isUpdated = false;

  const oldMetadataStr = JSON.stringify(oldEntry.metadata);
  const newMetadataStr = JSON.stringify(newEntry.metadata);
  if (oldMetadataStr !== newMetadataStr) {
    isUpdated = true;
    edits.push({
      action: "update",
      oldSymbol: oldNode,
      newSymbol: newNode,
      oldEntry,
      newEntry,
      description: "Metadata updated",
    });
  }

  const oldArgs = oldNode.db.argsOf(oldNode.id)?.hash;
  const newArgs = newNode.db.argsOf(newNode.id)?.hash;
  if (oldArgs !== newArgs) {
    isUpdated = true;
    edits.push({
      action: "update",
      oldSymbol: oldNode,
      newSymbol: newNode,
      oldEntry,
      newEntry,
      description: "Specialization arguments updated",
    });
  }

  // Diff children directly from QueryDB
  const oldChildren = oldNode.db.childrenOf(oldNode.id);
  const newChildren = newNode.db.childrenOf(newNode.id);

  if (options.orderAgnostic) {
    const matchedNew = new Set<SymbolId>();

    for (const oc of oldChildren) {
      const match = newChildren.find((nc) => !matchedNew.has(nc.id) && oc.kind === nc.kind && oc.name === nc.name);

      if (match) {
        matchedNew.add(match.id);
        const childDiff = computeSemanticDiff({ id: oc.id, db: oldNode.db }, { id: match.id, db: newNode.db }, options);
        if (childDiff.action !== "none") {
          edits.push(childDiff);
        }
      } else {
        edits.push({
          action: "delete",
          oldSymbol: { id: oc.id, db: oldNode.db },
          oldEntry: oc,
          description: `Deleted child ${oc.kind} '${oc.name || "unnamed"}'`,
        });
      }
    }

    for (const nc of newChildren) {
      if (!matchedNew.has(nc.id)) {
        edits.push({
          action: "insert",
          newSymbol: { id: nc.id, db: newNode.db },
          newEntry: nc,
          description: `Inserted child ${nc.kind} '${nc.name || "unnamed"}'`,
        });
      }
    }
  } else {
    const maxLen = Math.max(oldChildren.length, newChildren.length);
    for (let i = 0; i < maxLen; i++) {
      if (i < oldChildren.length && i < newChildren.length) {
        const childDiff = computeSemanticDiff(
          { id: oldChildren[i]!.id, db: oldNode.db },
          { id: newChildren[i]!.id, db: newNode.db },
          options,
        );
        if (childDiff.action !== "none") {
          edits.push(childDiff);
        }
      } else if (i < oldChildren.length) {
        edits.push(computeSemanticDiff({ id: oldChildren[i]!.id, db: oldNode.db }, null, options));
      } else {
        edits.push(computeSemanticDiff(null, { id: newChildren[i]!.id, db: newNode.db }, options));
      }
    }
  }

  if (edits.length > 0 || isUpdated) {
    const descriptions = edits.map((e) => e.description).filter(Boolean);
    return {
      action: "update",
      oldSymbol: oldNode,
      newSymbol: newNode,
      oldEntry,
      newEntry,
      description: descriptions.length > 0 ? descriptions.join(", ") : undefined,
      children: edits.length > 0 ? edits : undefined,
    };
  }

  return {
    action: "none",
    oldSymbol: oldNode,
    newSymbol: newNode,
    oldEntry,
    newEntry,
  };
}
