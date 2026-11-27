// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Shared types and CST-offset override utilities for the Procedural CAD
 * (OpenSCAD) CSG Feature / Operation Tree.
 *
 * The feature tree itself is constructed directly from the native WASM GLR
 * OpenSCAD CST inside `@modelscript/scad` (`buildScadFeatureTreeFromCst`) and
 * served by the LSP (`modelscript/getCadFeatureTree`).
 */

export type CadFeatureKind = "boolean" | "transform" | "primitive" | "loop" | "module";

export type ScadModifierChar = "*" | "!" | "#" | "%";

export interface CadFeatureNode {
  readonly id: string;
  readonly kind: CadFeatureKind;
  readonly op: string;
  readonly label: string;
  readonly line: number;
  readonly startOffset: number;
  readonly opOffset: number;
  readonly modifier: ScadModifierChar | null;
  readonly children: CadFeatureNode[];
}

export interface ScadFeatureOverrides {
  readonly suppressedIds: ReadonlySet<string>;
  readonly isolatedId: string | null;
  readonly ghostIds: ReadonlySet<string>;
}

export const EMPTY_SCAD_FEATURE_OVERRIDES: ScadFeatureOverrides = {
  suppressedIds: new Set<string>(),
  isolatedId: null,
  ghostIds: new Set<string>(),
};

export function countCadFeatureNodes(nodes: readonly CadFeatureNode[]): number {
  let total = 0;
  for (const n of nodes) {
    total += 1 + countCadFeatureNodes(n.children);
  }
  return total;
}

export function hasActiveScadOverrides(overrides: ScadFeatureOverrides): boolean {
  return overrides.suppressedIds.size > 0 || overrides.isolatedId !== null || overrides.ghostIds.size > 0;
}

/**
 * Produces a non-destructive derived OpenSCAD source string by splicing `*` (suppress),
 * `!` (isolate), and `#` (debug/ghost) modifiers at the exact CST byte offsets reported
 * by `buildScadFeatureTreeFromCst`.
 */
export function applyScadOperationOverrides(
  source: string,
  nodes: readonly CadFeatureNode[],
  overrides: ScadFeatureOverrides,
): string {
  if (!hasActiveScadOverrides(overrides) || nodes.length === 0) {
    return source;
  }

  const edits: Array<{ start: number; end: number; text: string }> = [];
  const visit = (list: readonly CadFeatureNode[]) => {
    for (const node of list) {
      let desiredMod: ScadModifierChar | undefined;
      if (overrides.suppressedIds.has(node.id)) {
        desiredMod = "*";
      } else if (overrides.isolatedId === node.id) {
        desiredMod = "!";
      } else if (overrides.ghostIds.has(node.id)) {
        desiredMod = "#";
      }

      if (desiredMod !== undefined) {
        if (node.modifier) {
          edits.push({ start: node.startOffset, end: node.startOffset + 1, text: desiredMod });
        } else {
          edits.push({ start: node.opOffset, end: node.opOffset, text: desiredMod });
        }
      }
      if (node.children.length > 0) {
        visit(node.children);
      }
    }
  };
  visit(nodes);

  if (edits.length === 0) return source;
  edits.sort((a, b) => b.start - a.start);
  let out = source;
  for (const e of edits) {
    out = out.slice(0, e.start) + e.text + out.slice(e.end);
  }
  return out;
}

/**
 * Formats raw CSG/CAD part names cleanly for display—turning chained auto-generated
 * boolean names (`Subtract_Subtract_Subtract_...`) into crisp readable labels while
 * preserving user-authored identifiers (`flanged_hub_1`, `arm_link_3`, etc.).
 */
export function formatCadPartDisplayName(rawName: string): string {
  if (!rawName) return "CAD Body";
  if (/^(?:Subtract|Union|Intersect)_(?:Subtract|Union|Intersect)_/.test(rawName)) {
    const firstOp = rawName.split("_")[0];
    return firstOp === "Subtract"
      ? "CSG Solid (Difference)"
      : firstOp === "Union"
        ? "CSG Solid (Union)"
        : "CSG Solid (Intersection)";
  }
  return rawName;
}
