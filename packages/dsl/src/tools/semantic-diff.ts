import type { QueryDB, SymbolEntry, SymbolId } from "../dsl/types.js";

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
  /** Whether this change is breaking for downstream consumers / interfaces */
  isBreaking?: boolean;
  /** Specific category of semantic change */
  category?: "metadata" | "type" | "causality" | "variability" | "binding" | "structural" | "topology";
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
   * If true, only breaking changes are included in the diff result.
   */
  breakingOnly?: boolean;
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
      category: "structural",
      isBreaking: false,
      description: `Inserted ${newEntry.kind} '${newEntry.name || "unnamed"}'`,
    };
  }

  // Pure Delete
  if (oldNode && !newNode && oldEntry) {
    const isConnectorOrPort =
      oldEntry.kind.toLowerCase().includes("port") ||
      oldEntry.kind.toLowerCase().includes("pin") ||
      oldEntry.kind.toLowerCase().includes("flange") ||
      oldEntry.kind.toLowerCase().includes("connector");
    const isPublic = !oldEntry.metadata?.isProtected;
    const isBreaking = isConnectorOrPort || isPublic;

    return {
      action: "delete",
      oldSymbol: oldNode,
      oldEntry,
      category: "structural",
      isBreaking,
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
      category: "structural",
      isBreaking: true,
      description: `Replaced ${oldEntry.kind} with ${newEntry.kind}`,
    };
  }

  // Same identity, but metadata or args or children may have changed
  const edits: SemanticEdit[] = [];
  let isUpdated = false;
  let nodeIsBreaking = false;

  const oldMeta = oldEntry.metadata || {};
  const newMeta = newEntry.metadata || {};

  // 1. Causality check (input vs output)
  if (oldMeta.causality !== newMeta.causality) {
    isUpdated = true;
    nodeIsBreaking = true;
    edits.push({
      action: "update",
      oldSymbol: oldNode,
      newSymbol: newNode,
      oldEntry,
      newEntry,
      category: "causality",
      isBreaking: true,
      description: `Causality changed from '${oldMeta.causality || "unspecified"}' to '${newMeta.causality || "unspecified"}'`,
    });
  }

  // 2. Variability check (parameter, constant, discrete, continuous)
  if (oldMeta.variability !== newMeta.variability) {
    isUpdated = true;
    const isBreaking = oldMeta.variability === "parameter" || newMeta.variability === "constant";
    if (isBreaking) nodeIsBreaking = true;
    edits.push({
      action: "update",
      oldSymbol: oldNode,
      newSymbol: newNode,
      oldEntry,
      newEntry,
      category: "variability",
      isBreaking,
      description: `Variability changed from '${oldMeta.variability || "continuous"}' to '${newMeta.variability || "continuous"}'`,
    });
  }

  // 3. Type check
  const oldType = oldMeta.typeName || oldMeta.type || (oldEntry as any).typeName;
  const newType = newMeta.typeName || newMeta.type || (newEntry as any).typeName;
  if (oldType && newType && oldType !== newType) {
    isUpdated = true;
    nodeIsBreaking = true;
    edits.push({
      action: "update",
      oldSymbol: oldNode,
      newSymbol: newNode,
      oldEntry,
      newEntry,
      category: "type",
      isBreaking: true,
      description: `Type changed from '${oldType}' to '${newType}'`,
    });
  }

  // 4. Value / Binding check
  const oldBinding = oldMeta.binding || oldMeta.modifierValue || oldMeta.value;
  const newBinding = newMeta.binding || newMeta.modifierValue || newMeta.value;
  if (oldBinding !== undefined && newBinding !== undefined && oldBinding !== newBinding) {
    isUpdated = true;
    edits.push({
      action: "update",
      oldSymbol: oldNode,
      newSymbol: newNode,
      oldEntry,
      newEntry,
      category: "binding",
      isBreaking: false,
      description: `Value binding updated from '${oldBinding}' to '${newBinding}'`,
    });
  }

  const oldMetadataStr = JSON.stringify(oldEntry.metadata);
  const newMetadataStr = JSON.stringify(newEntry.metadata);
  if (oldMetadataStr !== newMetadataStr && edits.length === 0) {
    isUpdated = true;
    edits.push({
      action: "update",
      oldSymbol: oldNode,
      newSymbol: newNode,
      oldEntry,
      newEntry,
      category: "metadata",
      isBreaking: false,
      description: "Metadata updated",
    });
  }

  const oldArgs = oldNode.db.argsOf(oldNode.id)?.hash;
  const newArgs = newNode.db.argsOf(newNode.id)?.hash;
  if (oldArgs !== newArgs) {
    isUpdated = true;
    nodeIsBreaking = true;
    edits.push({
      action: "update",
      oldSymbol: oldNode,
      newSymbol: newNode,
      oldEntry,
      newEntry,
      category: "structural",
      isBreaking: true,
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
          if (childDiff.isBreaking) nodeIsBreaking = true;
        }
      } else {
        const isConnector =
          oc.kind.toLowerCase().includes("port") ||
          oc.kind.toLowerCase().includes("pin") ||
          oc.kind.toLowerCase().includes("flange");
        const isBreaking = isConnector || !oc.metadata?.isProtected;
        if (isBreaking) nodeIsBreaking = true;
        edits.push({
          action: "delete",
          oldSymbol: { id: oc.id, db: oldNode.db },
          oldEntry: oc,
          category: "structural",
          isBreaking,
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
          category: "structural",
          isBreaking: false,
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
          if (childDiff.isBreaking) nodeIsBreaking = true;
        }
      } else if (i < oldChildren.length) {
        const oc = oldChildren[i]!;
        const isBreaking = !oc.metadata?.isProtected;
        if (isBreaking) nodeIsBreaking = true;
        edits.push(computeSemanticDiff({ id: oc.id, db: oldNode.db }, null, options));
      } else {
        edits.push(computeSemanticDiff(null, { id: newChildren[i]!.id, db: newNode.db }, options));
      }
    }
  }

  const finalEdits = options.breakingOnly ? edits.filter((e) => e.isBreaking) : edits;

  if (finalEdits.length > 0 || isUpdated) {
    const descriptions = finalEdits.map((e) => e.description).filter(Boolean);
    return {
      action: "update",
      oldSymbol: oldNode,
      newSymbol: newNode,
      oldEntry,
      newEntry,
      category: "structural",
      isBreaking: nodeIsBreaking || finalEdits.some((e) => e.isBreaking),
      description: descriptions.length > 0 ? descriptions.join(", ") : undefined,
      children: finalEdits.length > 0 ? finalEdits : undefined,
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
