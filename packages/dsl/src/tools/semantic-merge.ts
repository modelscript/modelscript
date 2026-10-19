// SPDX-License-Identifier: AGPL-3.0-or-later

import type { SymbolEntry } from "../dsl/types.js";
import { computeSemanticDiff, type SemanticEdit, type SymbolRef } from "./semantic-diff.js";

export type MergeStrategy = "strict" | "ours" | "theirs" | "physics-simplex";

export type ConflictKind =
  | "value-conflict"
  | "type-conflict"
  | "causality-conflict"
  | "variability-conflict"
  | "delete-modify"
  | "insert-collision"
  | "structural-conflict";

export interface SemanticMergeConflict {
  kind: ConflictKind;
  symbolName: string;
  symbolKind: string;
  category: "metadata" | "type" | "causality" | "variability" | "binding" | "structural" | "topology";
  description: string;
  baseValue?: unknown;
  oursValue?: unknown;
  theirsValue?: unknown;
  baseEntry?: SymbolEntry | null | undefined;
  oursEntry?: SymbolEntry | null | undefined;
  theirsEntry?: SymbolEntry | null | undefined;
  isBreaking: boolean;
}

export interface MergedSymbolOperation {
  action: "keep-ours" | "take-theirs" | "insert-theirs" | "delete-ours" | "reconcile-binding" | "conflict";
  symbolName: string;
  symbolKind: string;
  resolution: "unchanged" | "ours" | "theirs" | "both-identical" | "merged-orthogonal" | "reconciled" | "conflict";
  description: string;
  baseEntry?: SymbolEntry | null | undefined;
  oursEntry?: SymbolEntry | null | undefined;
  theirsEntry?: SymbolEntry | null | undefined;
  reconciledValue?: number | string | undefined;
  conflict?: SemanticMergeConflict | undefined;
  children?: MergedSymbolOperation[] | undefined;
}

export interface NumericReconcileInput {
  parameterName: string;
  baseValue?: number | undefined;
  oursValue: number;
  theirsValue: number;
  unit?: string | undefined;
  bounds?: { min?: number | undefined; max?: number | undefined } | undefined;
}

export interface NumericReconcileOutput {
  resolved: boolean;
  value?: number | undefined;
  recommendation?: string | undefined;
}

export interface SemanticMergeOptions {
  /** Merge conflict resolution strategy (default: "strict") */
  strategy?: MergeStrategy | undefined;
  /** Ignore child order in declarative sections (default: true) */
  orderAgnostic?: boolean | undefined;
  /** Physical bounds per parameter name for physics-simplex reconciliation */
  parameterBounds?:
    | Record<string, { min?: number | undefined; max?: number | undefined; unit?: string | undefined }>
    | undefined;
  /** Custom numeric reconciler callback (e.g. PhysicsSimplexReconciler from @modelscript/runtime) */
  reconcileNumeric?: ((input: NumericReconcileInput) => NumericReconcileOutput) | undefined;
}

export interface ThreeWayMergeResult {
  status: "clean" | "reconciled" | "conflicted";
  strategy: MergeStrategy;
  hasConflicts: boolean;
  conflicts: SemanticMergeConflict[];
  operations: MergedSymbolOperation[];
  rootOperation: MergedSymbolOperation;
  diffOurs: SemanticEdit;
  diffTheirs: SemanticEdit;
}

function getBindingValue(entry: SymbolEntry | null | undefined): unknown {
  if (!entry?.metadata) return undefined;
  return entry.metadata["binding"] ?? entry.metadata["modifierValue"] ?? entry.metadata["value"];
}

function getTypeName(entry: SymbolEntry | null | undefined): string | undefined {
  if (!entry) return undefined;
  const meta = entry.metadata || {};
  return (meta["typeName"] as string) || (meta["type"] as string) || (entry as any).typeName;
}

function parseNumericValue(val: unknown): number | null {
  if (typeof val === "number" && Number.isFinite(val)) return val;
  if (typeof val === "string") {
    const trimmed = val.trim();
    if (/^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/.test(trimmed)) {
      const parsed = Number(trimmed);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

function defaultPhysicsSimplexReconcile(input: NumericReconcileInput): NumericReconcileOutput {
  const { oursValue, theirsValue, bounds } = input;
  const minBound = bounds?.min ?? -Infinity;
  const maxBound = bounds?.max ?? Infinity;

  if (minBound > maxBound) {
    return {
      resolved: false,
      recommendation: `Infeasible physical bounds [${minBound}, ${maxBound}] on '${input.parameterName}'.`,
    };
  }

  // Minimize L1 weighted deviation |x - ours| + |x - theirs| subject to minBound <= x <= maxBound
  const midpoint = (oursValue + theirsValue) * 0.5;
  let candidate = midpoint;
  if (candidate < minBound) candidate = minBound;
  if (candidate > maxBound) candidate = maxBound;

  const oursFeasible = oursValue >= minBound && oursValue <= maxBound;
  const theirsFeasible = theirsValue >= minBound && theirsValue <= maxBound;

  if (!oursFeasible && !theirsFeasible) {
    return {
      resolved: false,
      recommendation: `Neither ours (${oursValue}) nor theirs (${theirsValue}) satisfies physical envelope [${minBound}, ${maxBound}].`,
    };
  }

  // Prefer the single feasible proposal if one proposal violates physical bounds
  if (oursFeasible && !theirsFeasible) {
    candidate = oursValue;
  } else if (!oursFeasible && theirsFeasible) {
    candidate = theirsValue;
  }

  return {
    resolved: true,
    value: Number(candidate.toFixed(6)),
    recommendation: `Reconciled '${input.parameterName}' to ${Number(candidate.toFixed(6))} within [${minBound}, ${maxBound}].`,
  };
}

/**
 * Computes an AST/Symbol-aware 3-way structural merge across `base`, `ours`, and `theirs` QueryDB trees.
 */
export function computeThreeWayMerge(
  baseNode: SymbolRef | null,
  oursNode: SymbolRef | null,
  theirsNode: SymbolRef | null,
  options: SemanticMergeOptions = {},
): ThreeWayMergeResult {
  const strategy: MergeStrategy = options.strategy ?? "strict";
  const orderAgnostic = options.orderAgnostic ?? true;

  if (!baseNode && !oursNode && !theirsNode) {
    throw new Error("Cannot merge when baseNode, oursNode, and theirsNode are all null");
  }

  const diffOurs: SemanticEdit =
    baseNode || oursNode ? computeSemanticDiff(baseNode, oursNode, { orderAgnostic }) : { action: "none" };
  const diffTheirs: SemanticEdit =
    baseNode || theirsNode ? computeSemanticDiff(baseNode, theirsNode, { orderAgnostic }) : { action: "none" };

  const conflicts: SemanticMergeConflict[] = [];
  const flatOperations: MergedSymbolOperation[] = [];

  function mergeSymbolTriple(
    baseRef: SymbolRef | null,
    oursRef: SymbolRef | null,
    theirsRef: SymbolRef | null,
  ): MergedSymbolOperation {
    const baseEntry = baseRef ? (baseRef.db.symbol(baseRef.id) ?? null) : null;
    const oursEntry = oursRef ? (oursRef.db.symbol(oursRef.id) ?? null) : null;
    const theirsEntry = theirsRef ? (theirsRef.db.symbol(theirsRef.id) ?? null) : null;

    const symbolName = oursEntry?.name || theirsEntry?.name || baseEntry?.name || "unnamed";
    const symbolKind = oursEntry?.kind || theirsEntry?.kind || baseEntry?.kind || "Element";

    // Case 1: Node did not exist in base (concurrent insertion or one-sided insertion)
    if (!baseEntry) {
      if (oursEntry && !theirsEntry) {
        const op: MergedSymbolOperation = {
          action: "keep-ours",
          symbolName,
          symbolKind,
          resolution: "ours",
          description: `Keep inserted ${symbolKind} '${symbolName}' from ours`,
          oursEntry,
        };
        flatOperations.push(op);
        return op;
      }
      if (!oursEntry && theirsEntry) {
        const op: MergedSymbolOperation = {
          action: "insert-theirs",
          symbolName,
          symbolKind,
          resolution: "theirs",
          description: `Insert ${symbolKind} '${symbolName}' from theirs`,
          theirsEntry,
        };
        flatOperations.push(op);
        return op;
      }
      if (oursEntry && theirsEntry) {
        // Both branches inserted a symbol with the same (kind, name)
        const directDiff = computeSemanticDiff(oursRef, theirsRef, { orderAgnostic });
        if (directDiff.action === "none") {
          const op: MergedSymbolOperation = {
            action: "keep-ours",
            symbolName,
            symbolKind,
            resolution: "both-identical",
            description: `Both branches inserted identical ${symbolKind} '${symbolName}'`,
            oursEntry,
            theirsEntry,
          };
          flatOperations.push(op);
          return op;
        }

        // Check if only numeric binding differs and physics-simplex is enabled
        const oursVal = parseNumericValue(getBindingValue(oursEntry));
        const theirsVal = parseNumericValue(getBindingValue(theirsEntry));
        const oursType = getTypeName(oursEntry);
        const theirsType = getTypeName(theirsEntry);

        if (strategy === "physics-simplex" && oursVal !== null && theirsVal !== null && oursType === theirsType) {
          const reconcileFn = options.reconcileNumeric ?? defaultPhysicsSimplexReconcile;
          const bounds = options.parameterBounds?.[symbolName];
          const res = reconcileFn({
            parameterName: symbolName,
            oursValue: oursVal,
            theirsValue: theirsVal,
            unit: bounds?.unit,
            bounds,
          });
          if (res.resolved && res.value !== undefined) {
            const op: MergedSymbolOperation = {
              action: "reconcile-binding",
              symbolName,
              symbolKind,
              resolution: "reconciled",
              reconciledValue: res.value,
              description: res.recommendation || `Reconciled concurrent insertion of '${symbolName}' to ${res.value}`,
              oursEntry,
              theirsEntry,
            };
            flatOperations.push(op);
            return op;
          }
        }

        if (strategy === "ours") {
          const op: MergedSymbolOperation = {
            action: "keep-ours",
            symbolName,
            symbolKind,
            resolution: "ours",
            description: `Resolved insert collision on '${symbolName}' in favor of ours`,
            oursEntry,
            theirsEntry,
          };
          flatOperations.push(op);
          return op;
        }
        if (strategy === "theirs") {
          const op: MergedSymbolOperation = {
            action: "take-theirs",
            symbolName,
            symbolKind,
            resolution: "theirs",
            description: `Resolved insert collision on '${symbolName}' in favor of theirs`,
            oursEntry,
            theirsEntry,
          };
          flatOperations.push(op);
          return op;
        }

        const conflict: SemanticMergeConflict = {
          kind: "insert-collision",
          symbolName,
          symbolKind,
          category: "structural",
          description: `Both branches inserted ${symbolKind} '${symbolName}' with conflicting definitions`,
          oursValue: getBindingValue(oursEntry) ?? oursType,
          theirsValue: getBindingValue(theirsEntry) ?? theirsType,
          oursEntry,
          theirsEntry,
          isBreaking: true,
        };
        conflicts.push(conflict);
        const op: MergedSymbolOperation = {
          action: "conflict",
          symbolName,
          symbolKind,
          resolution: "conflict",
          description: conflict.description,
          oursEntry,
          theirsEntry,
          conflict,
        };
        flatOperations.push(op);
        return op;
      }
    }

    // Case 2: Node existed in base, check deletions
    if (baseEntry && (!oursEntry || !theirsEntry)) {
      if (!oursEntry && !theirsEntry) {
        const op: MergedSymbolOperation = {
          action: "keep-ours",
          symbolName,
          symbolKind,
          resolution: "both-identical",
          description: `Both branches deleted ${symbolKind} '${symbolName}'`,
          baseEntry,
        };
        flatOperations.push(op);
        return op;
      }

      if (!oursEntry && theirsEntry) {
        // Deleted in ours; check if theirs modified it relative to base
        const theirsChanged = computeSemanticDiff(baseRef, theirsRef, { orderAgnostic }).action !== "none";
        if (!theirsChanged || strategy === "ours") {
          const op: MergedSymbolOperation = {
            action: "keep-ours",
            symbolName,
            symbolKind,
            resolution: "ours",
            description: `Keep deletion of ${symbolKind} '${symbolName}' from ours`,
            baseEntry,
            theirsEntry,
          };
          flatOperations.push(op);
          return op;
        }
        if (strategy === "theirs") {
          const op: MergedSymbolOperation = {
            action: "insert-theirs",
            symbolName,
            symbolKind,
            resolution: "theirs",
            description: `Restore modified ${symbolKind} '${symbolName}' from theirs`,
            baseEntry,
            theirsEntry,
          };
          flatOperations.push(op);
          return op;
        }

        const conflict: SemanticMergeConflict = {
          kind: "delete-modify",
          symbolName,
          symbolKind,
          category: "structural",
          description: `'${symbolName}' was deleted in ours but modified in theirs`,
          baseEntry,
          theirsEntry,
          isBreaking: true,
        };
        conflicts.push(conflict);
        const op: MergedSymbolOperation = {
          action: "conflict",
          symbolName,
          symbolKind,
          resolution: "conflict",
          description: conflict.description,
          baseEntry,
          theirsEntry,
          conflict,
        };
        flatOperations.push(op);
        return op;
      }

      if (oursEntry && !theirsEntry) {
        // Deleted in theirs; check if ours modified it relative to base
        const oursChanged = computeSemanticDiff(baseRef, oursRef, { orderAgnostic }).action !== "none";
        if (!oursChanged || strategy === "theirs") {
          const op: MergedSymbolOperation = {
            action: "delete-ours",
            symbolName,
            symbolKind,
            resolution: "theirs",
            description: `Apply deletion of ${symbolKind} '${symbolName}' from theirs`,
            baseEntry,
            oursEntry,
          };
          flatOperations.push(op);
          return op;
        }
        if (strategy === "ours") {
          const op: MergedSymbolOperation = {
            action: "keep-ours",
            symbolName,
            symbolKind,
            resolution: "ours",
            description: `Keep modified ${symbolKind} '${symbolName}' from ours despite deletion in theirs`,
            baseEntry,
            oursEntry,
          };
          flatOperations.push(op);
          return op;
        }

        const conflict: SemanticMergeConflict = {
          kind: "delete-modify",
          symbolName,
          symbolKind,
          category: "structural",
          description: `'${symbolName}' was modified in ours but deleted in theirs`,
          baseEntry,
          oursEntry,
          isBreaking: true,
        };
        conflicts.push(conflict);
        const op: MergedSymbolOperation = {
          action: "conflict",
          symbolName,
          symbolKind,
          resolution: "conflict",
          description: conflict.description,
          baseEntry,
          oursEntry,
          conflict,
        };
        flatOperations.push(op);
        return op;
      }
    }

    // Case 3: Present in all three (base, ours, theirs)
    const bEntry = baseEntry!;
    const oEntry = oursEntry!;
    const tEntry = theirsEntry!;

    const baseMeta = bEntry.metadata || {};
    const oursMeta = oEntry.metadata || {};
    const theirsMeta = tEntry.metadata || {};

    let selfAction: MergedSymbolOperation["action"] = "keep-ours";
    let selfResolution: MergedSymbolOperation["resolution"] = "unchanged";
    let selfDescription = `${symbolKind} '${symbolName}' unchanged`;
    let reconciledValue: number | string | undefined;
    let nodeConflict: SemanticMergeConflict | undefined;

    // Check attribute-level changes on the node itself (causality, variability, type, binding)
    const attrs: {
      name: string;
      category: "causality" | "variability" | "type" | "binding";
      conflictKind: ConflictKind;
      get: (e: SymbolEntry, m: Record<string, unknown>) => unknown;
      isBreaking: boolean;
    }[] = [
      {
        name: "causality",
        category: "causality",
        conflictKind: "causality-conflict",
        get: (_e, m) => m["causality"],
        isBreaking: true,
      },
      {
        name: "variability",
        category: "variability",
        conflictKind: "variability-conflict",
        get: (_e, m) => m["variability"],
        isBreaking: true,
      },
      {
        name: "type",
        category: "type",
        conflictKind: "type-conflict",
        get: (e) => getTypeName(e),
        isBreaking: true,
      },
      {
        name: "binding",
        category: "binding",
        conflictKind: "value-conflict",
        get: (e) => getBindingValue(e),
        isBreaking: false,
      },
    ];

    let oursUpdatedSelf = false;
    let theirsUpdatedSelf = false;

    for (const attr of attrs) {
      const bVal = attr.get(bEntry, baseMeta);
      const oVal = attr.get(oEntry, oursMeta);
      const tVal = attr.get(tEntry, theirsMeta);

      const oChanged = oVal !== bVal;
      const tChanged = tVal !== bVal;

      if (oChanged && !tChanged) {
        oursUpdatedSelf = true;
        if (selfResolution === "unchanged") {
          selfAction = "keep-ours";
          selfResolution = "ours";
          selfDescription = `Updated ${attr.name} of '${symbolName}' in ours`;
        } else if (selfResolution === "theirs") {
          selfResolution = "merged-orthogonal";
          selfDescription = `Merged orthogonal attribute updates on '${symbolName}'`;
        }
      } else if (!oChanged && tChanged) {
        theirsUpdatedSelf = true;
        if (selfResolution === "unchanged") {
          selfAction = "take-theirs";
          selfResolution = "theirs";
          selfDescription = `Updated ${attr.name} of '${symbolName}' from theirs`;
        } else if (selfResolution === "ours") {
          selfResolution = "merged-orthogonal";
          selfDescription = `Merged orthogonal attribute updates on '${symbolName}'`;
        }
      } else if (oChanged && tChanged) {
        if (oVal === tVal) {
          selfAction = "keep-ours";
          selfResolution = "both-identical";
          selfDescription = `Both branches updated ${attr.name} of '${symbolName}' to '${String(oVal)}'`;
        } else {
          // Concurrent conflicting modification to the same attribute
          if (attr.category === "binding" && strategy === "physics-simplex") {
            const bNum = parseNumericValue(bVal) ?? undefined;
            const oNum = parseNumericValue(oVal);
            const tNum = parseNumericValue(tVal);
            if (oNum !== null && tNum !== null) {
              const reconcileFn = options.reconcileNumeric ?? defaultPhysicsSimplexReconcile;
              const bounds = options.parameterBounds?.[symbolName];
              const res = reconcileFn({
                parameterName: symbolName,
                baseValue: bNum,
                oursValue: oNum,
                theirsValue: tNum,
                unit: bounds?.unit,
                bounds,
              });
              if (res.resolved && res.value !== undefined) {
                selfAction = "reconcile-binding";
                selfResolution = "reconciled";
                reconciledValue = res.value;
                selfDescription =
                  res.recommendation || `Reconciled '${symbolName}' binding (${oNum} vs ${tNum}) to ${res.value}`;
                continue;
              }
            }
          }

          if (strategy === "ours") {
            selfAction = "keep-ours";
            selfResolution = "ours";
            selfDescription = `Resolved ${attr.name} conflict on '${symbolName}' in favor of ours ('${String(oVal)}')`;
          } else if (strategy === "theirs") {
            selfAction = "take-theirs";
            selfResolution = "theirs";
            selfDescription = `Resolved ${attr.name} conflict on '${symbolName}' in favor of theirs ('${String(tVal)}')`;
          } else {
            nodeConflict = {
              kind: attr.conflictKind,
              symbolName,
              symbolKind,
              category: attr.category,
              description: `Conflicting ${attr.name} changes on '${symbolName}': ours='${String(oVal)}' vs theirs='${String(tVal)}' (base='${String(bVal)}')`,
              baseValue: bVal,
              oursValue: oVal,
              theirsValue: tVal,
              baseEntry: bEntry,
              oursEntry: oEntry,
              theirsEntry: tEntry,
              isBreaking: attr.isBreaking,
            };
            conflicts.push(nodeConflict);
            selfAction = "conflict";
            selfResolution = "conflict";
            selfDescription = nodeConflict.description;
          }
        }
      }
    }

    // Recursively merge children of (baseRef, oursRef, theirsRef)
    const baseChildren = baseRef ? baseRef.db.childrenOf(baseRef.id) : [];
    const oursChildren = oursRef ? oursRef.db.childrenOf(oursRef.id) : [];
    const theirsChildren = theirsRef ? theirsRef.db.childrenOf(theirsRef.id) : [];

    const childOps: MergedSymbolOperation[] = [];
    const keyOf = (e: SymbolEntry, idx: number) =>
      orderAgnostic && e.name ? `${e.kind}::${e.name}` : `${e.kind}::${e.name || idx}`;

    const baseMap = new Map<string, SymbolEntry>();
    const oursMap = new Map<string, SymbolEntry>();
    const theirsMap = new Map<string, SymbolEntry>();
    const allKeys: string[] = [];
    const seenKeys = new Set<string>();

    const registerKey = (k: string) => {
      if (!seenKeys.has(k)) {
        seenKeys.add(k);
        allKeys.push(k);
      }
    };

    baseChildren.forEach((c, i) => {
      const k = keyOf(c, i);
      baseMap.set(k, c);
      registerKey(k);
    });
    oursChildren.forEach((c, i) => {
      const k = keyOf(c, i);
      oursMap.set(k, c);
      registerKey(k);
    });
    theirsChildren.forEach((c, i) => {
      const k = keyOf(c, i);
      theirsMap.set(k, c);
      registerKey(k);
    });

    for (const key of allKeys) {
      const bc = baseMap.get(key);
      const oc = oursMap.get(key);
      const tc = theirsMap.get(key);

      const childOp = mergeSymbolTriple(
        bc && baseRef ? { id: bc.id, db: baseRef.db } : null,
        oc && oursRef ? { id: oc.id, db: oursRef.db } : null,
        tc && theirsRef ? { id: tc.id, db: theirsRef.db } : null,
      );
      childOps.push(childOp);
    }

    const op: MergedSymbolOperation = {
      action: selfAction,
      symbolName,
      symbolKind,
      resolution: selfResolution,
      description: selfDescription,
      baseEntry: bEntry,
      oursEntry: oEntry,
      theirsEntry: tEntry,
      reconciledValue,
      conflict: nodeConflict,
      children: childOps.length > 0 ? childOps : undefined,
    };

    if (oursUpdatedSelf || theirsUpdatedSelf || nodeConflict || reconciledValue !== undefined) {
      flatOperations.push(op);
    }
    return op;
  }

  const rootOperation = mergeSymbolTriple(baseNode, oursNode, theirsNode);
  const hasConflicts = conflicts.length > 0;
  const hasReconciled = flatOperations.some((op) => op.resolution === "reconciled");

  return {
    status: hasConflicts ? "conflicted" : hasReconciled ? "reconciled" : "clean",
    strategy,
    hasConflicts,
    conflicts,
    operations: flatOperations,
    rootOperation,
    diffOurs,
    diffTheirs,
  };
}

export interface SourceMergeResult {
  mergedText: string;
  hasConflicts: boolean;
  conflicts: SemanticMergeConflict[];
  appliedEditsCount: number;
}

interface OffsetTextReplacement {
  startOffset: number;
  endOffset: number;
  replacementText: string;
}

function replaceNumericBindingInSnippet(snippet: string, newValue: number | string): string {
  // Replace `= <number>` in Modelica / SysML v2 declaration while preserving surrounding text
  return snippet.replace(/(=\s*)[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/, `$1${newValue}`);
}

function findInsertionOffsetBeforeEnd(
  parentSnippet: string,
  parentStartOffset: number,
): { offset: number; indent: string } {
  // Match closing `end <Ident>;` (Modelica) or closing `}` (SysML v2) at the tail of the parent declaration
  const modelicaEndMatch = /\n([ \t]*)end\s+[A-Za-z0-9_']+\s*;\s*$/.exec(parentSnippet);
  if (modelicaEndMatch && modelicaEndMatch.index !== undefined) {
    const parentIndent = modelicaEndMatch[1] ?? "";
    return {
      offset: parentStartOffset + modelicaEndMatch.index,
      indent: parentIndent + "  ",
    };
  }

  const braceEndMatch = /\n([ \t]*)\}\s*;?\s*$/.exec(parentSnippet);
  if (braceEndMatch && braceEndMatch.index !== undefined) {
    const parentIndent = braceEndMatch[1] ?? "";
    return {
      offset: parentStartOffset + braceEndMatch.index,
      indent: parentIndent + "  ",
    };
  }

  return {
    offset: parentStartOffset + parentSnippet.length,
    indent: "  ",
  };
}

/**
 * Applies a `ThreeWayMergeResult` to source code using surgical character-range splicing
 * across `oursText` and `theirsText`.
 */
export function mergeModelSourceText(
  _baseText: string,
  oursText: string,
  theirsText: string,
  mergeResult: ThreeWayMergeResult,
): SourceMergeResult {
  const replacements: OffsetTextReplacement[] = [];
  let appliedEditsCount = 0;

  function collectEdits(op: MergedSymbolOperation, parentOursEntry: SymbolEntry | null): void {
    if (op.action === "insert-theirs" && op.theirsEntry && parentOursEntry) {
      const theirSlice = theirsText.slice(op.theirsEntry.startOffset, op.theirsEntry.endOffset).trim();
      const parentSlice = oursText.slice(parentOursEntry.startOffset, parentOursEntry.endOffset);
      const { offset, indent } = findInsertionOffsetBeforeEnd(parentSlice, parentOursEntry.startOffset);
      replacements.push({
        startOffset: offset,
        endOffset: offset,
        replacementText: `\n${indent}${theirSlice}`,
      });
      appliedEditsCount++;
      return;
    }

    if (op.action === "delete-ours" && op.oursEntry) {
      let start = op.oursEntry.startOffset;
      let end = op.oursEntry.endOffset;
      // Consume leading newline and indentation if on its own line
      while (start > 0 && (oursText[start - 1] === " " || oursText[start - 1] === "\t")) {
        start--;
      }
      if (start > 0 && oursText[start - 1] === "\n") {
        start--;
      }
      replacements.push({
        startOffset: start,
        endOffset: end,
        replacementText: "",
      });
      appliedEditsCount++;
      return;
    }

    if (op.action === "take-theirs" && op.oursEntry && op.theirsEntry && (!op.children || op.children.length === 0)) {
      const theirSlice = theirsText.slice(op.theirsEntry.startOffset, op.theirsEntry.endOffset);
      replacements.push({
        startOffset: op.oursEntry.startOffset,
        endOffset: op.oursEntry.endOffset,
        replacementText: theirSlice,
      });
      appliedEditsCount++;
      return;
    }

    if (op.action === "reconcile-binding" && op.oursEntry && op.reconciledValue !== undefined) {
      const oursSlice = oursText.slice(op.oursEntry.startOffset, op.oursEntry.endOffset);
      const updatedSlice = replaceNumericBindingInSnippet(oursSlice, op.reconciledValue);
      replacements.push({
        startOffset: op.oursEntry.startOffset,
        endOffset: op.oursEntry.endOffset,
        replacementText: updatedSlice,
      });
      appliedEditsCount++;
      return;
    }

    if (op.action === "conflict" && op.conflict) {
      if (op.oursEntry && op.theirsEntry) {
        const oursSlice = oursText.slice(op.oursEntry.startOffset, op.oursEntry.endOffset);
        const theirSlice = theirsText.slice(op.theirsEntry.startOffset, op.theirsEntry.endOffset);
        const markerBlock = [
          `<<<<<<< OURS (${op.conflict.description})`,
          oursSlice,
          `=======`,
          theirSlice,
          `>>>>>>> THEIRS`,
        ].join("\n");
        replacements.push({
          startOffset: op.oursEntry.startOffset,
          endOffset: op.oursEntry.endOffset,
          replacementText: markerBlock,
        });
        appliedEditsCount++;
        return;
      } else if (!op.oursEntry && op.theirsEntry && parentOursEntry) {
        // Deleted in ours, modified in theirs
        const theirSlice = theirsText.slice(op.theirsEntry.startOffset, op.theirsEntry.endOffset).trim();
        const parentSlice = oursText.slice(parentOursEntry.startOffset, parentOursEntry.endOffset);
        const { offset, indent } = findInsertionOffsetBeforeEnd(parentSlice, parentOursEntry.startOffset);
        const markerBlock = [
          `\n${indent}<<<<<<< OURS (${op.conflict.description})`,
          `${indent}// [Deleted in ours]`,
          `${indent}=======`,
          `${indent}${theirSlice}`,
          `${indent}>>>>>>> THEIRS`,
        ].join("\n");
        replacements.push({
          startOffset: offset,
          endOffset: offset,
          replacementText: markerBlock,
        });
        appliedEditsCount++;
        return;
      } else if (op.oursEntry && !op.theirsEntry) {
        // Modified in ours, deleted in theirs
        const oursSlice = oursText.slice(op.oursEntry.startOffset, op.oursEntry.endOffset);
        const markerBlock = [
          `<<<<<<< OURS (${op.conflict.description})`,
          oursSlice,
          `=======`,
          `// [Deleted in theirs]`,
          `>>>>>>> THEIRS`,
        ].join("\n");
        replacements.push({
          startOffset: op.oursEntry.startOffset,
          endOffset: op.oursEntry.endOffset,
          replacementText: markerBlock,
        });
        appliedEditsCount++;
        return;
      }
    }

    if (op.children && op.children.length > 0) {
      const currentParent = op.oursEntry ?? parentOursEntry;
      for (const child of op.children) {
        collectEdits(child, currentParent);
      }
    }
  }

  collectEdits(mergeResult.rootOperation, mergeResult.rootOperation.oursEntry ?? null);

  // Sort replacements descending by startOffset so earlier offsets remain valid
  replacements.sort((a, b) => b.startOffset - a.startOffset);

  let mergedText = oursText;
  for (const rep of replacements) {
    mergedText = mergedText.slice(0, rep.startOffset) + rep.replacementText + mergedText.slice(rep.endOffset);
  }

  return {
    mergedText,
    hasConflicts: mergeResult.hasConflicts,
    conflicts: mergeResult.conflicts,
    appliedEditsCount,
  };
}
