// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/kicad — Multi-Sheet Hierarchical Schematic Extractor.
 *
 * Parses `(sheet ...)` blocks with `(pin ...)` ports in parent `.kicad_sch`
 * files and merges parent + child sheets by binding parent sheet pins to
 * child `hierarchical_label` nets and unifying global/power nets across sheets.
 */

import type { Net, NetlistComponent, NetlistGraph, NetlistPin } from "@modelscript/cad/ecad";
import { parseKiCadSExpr } from "./parser/kicad-parser.js";
import { extractSchematicNetlist } from "./schematic-netlist.js";
import type { KiCadSchematic, SExprList } from "./types.js";

export interface KiCadSheetPin {
  name: string;
  direction: string;
  at: [number, number];
}

export interface KiCadSheetRef {
  sheetName: string;
  sheetFile: string;
  pins: KiCadSheetPin[];
}

function childLists(list: SExprList | undefined, head?: string): SExprList[] {
  if (!list) return [];
  const out: SExprList[] = [];
  for (const item of list.items) {
    if (item.kind === "list" && (head === undefined || item.head === head)) out.push(item);
  }
  return out;
}

function findList(list: SExprList | undefined, head: string): SExprList | undefined {
  return childLists(list, head)[0];
}

function atomAt(list: SExprList | undefined, idx: number): string | undefined {
  const it = list?.items[idx];
  return it && it.kind === "atom" ? it.value : undefined;
}

function numAt(list: SExprList | undefined, idx: number, fallback = 0): number {
  const raw = atomAt(list, idx);
  if (raw === undefined) return fallback;
  const v = Number.parseFloat(raw);
  return Number.isFinite(v) ? v : fallback;
}

/**
 * Extracts `(sheet ...)` sub-sheet references and their pins from raw `.kicad_sch` source.
 */
export function extractSheetRefs(source: string): KiCadSheetRef[] {
  const { roots } = parseKiCadSExpr(source);
  const root = roots.find((r) => r.head === "kicad_sch");
  if (!root) return [];

  const refs: KiCadSheetRef[] = [];
  for (const sh of childLists(root, "sheet")) {
    let sheetName = "";
    let sheetFile = "";
    for (const prop of childLists(sh, "property")) {
      const k = (atomAt(prop, 0) ?? "").toLowerCase();
      const v = atomAt(prop, 1) ?? "";
      if (k === "sheetname") sheetName = v;
      else if (k === "sheetfile") sheetFile = v;
    }
    const pins: KiCadSheetPin[] = childLists(sh, "pin").map((p) => {
      const atNode = findList(p, "at");
      return {
        name: atomAt(p, 0) ?? "",
        direction: atomAt(p, 1) ?? "bidirectional",
        at: [numAt(atNode, 0), numAt(atNode, 1)],
      };
    });
    if (sheetFile) refs.push({ sheetName: sheetName || sheetFile, sheetFile, pins });
  }
  return refs;
}

/**
 * Resolves a multi-sheet KiCad schematic hierarchy into a unified `NetlistGraph`.
 */
export function extractHierarchicalNetlist(
  rootSource: string,
  rootSch: KiCadSchematic,
  subSheets: Record<string, KiCadSchematic>,
): NetlistGraph {
  const rootNetRes = extractSchematicNetlist(rootSch);
  const sheetRefs = extractSheetRefs(rootSource);

  const components: NetlistComponent[] = [...rootNetRes.netlist.components];
  const mergedNets = new Map<string, NetlistPin[]>();

  for (const net of rootNetRes.netlist.nets) {
    mergedNets.set(net.id, [...net.pins]);
  }

  // Map root sheet geometric points (labels/wires) to root net names
  const rootLabelAt = new Map<string, string>();
  for (const lbl of rootSch.labels) {
    rootLabelAt.set(`${Math.round(lbl.at[0] * 100)},${Math.round(lbl.at[1] * 100)}`, lbl.name);
  }
  for (const w of rootSch.wires) {
    const k1 = `${Math.round(w.start[0] * 100)},${Math.round(w.start[1] * 100)}`;
    const k2 = `${Math.round(w.end[0] * 100)},${Math.round(w.end[1] * 100)}`;
    if (rootLabelAt.has(k1) && !rootLabelAt.has(k2)) rootLabelAt.set(k2, rootLabelAt.get(k1)!);
    if (rootLabelAt.has(k2) && !rootLabelAt.has(k1)) rootLabelAt.set(k1, rootLabelAt.get(k2)!);
  }

  for (const ref of sheetRefs) {
    const childSch = subSheets[ref.sheetFile];
    if (!childSch) continue;

    const childRes = extractSchematicNetlist(childSch);
    const prefix = ref.sheetName.replace(/[^A-Za-z0-9_]/g, "_");

    for (const c of childRes.netlist.components) {
      components.push({
        ...c,
        name: `${prefix}/${c.name}`,
      });
    }

    // Build mapping from child hierarchical_label name -> parent net name
    const hierMap = new Map<string, string>();
    for (const sp of ref.pins) {
      const k = `${Math.round(sp.at[0] * 100)},${Math.round(sp.at[1] * 100)}`;
      const parentNet = rootLabelAt.get(k) ?? sp.name;
      hierMap.set(sp.name, parentNet);
    }

    const globalNetNames = new Set(childSch.labels.filter((l) => l.kind === "global_label").map((l) => l.name));
    const powerNetNames = new Set(
      childSch.symbols.filter((s) => s.libId.startsWith("power:") || s.refDes.startsWith("#PWR")).map((s) => s.value),
    );

    for (const net of childRes.netlist.nets) {
      let targetNet: string;
      if (hierMap.has(net.id)) {
        targetNet = hierMap.get(net.id)!;
      } else if (globalNetNames.has(net.id) || powerNetNames.has(net.id)) {
        targetNet = net.id;
      } else {
        targetNet = `${prefix}/${net.id}`;
      }

      const list = mergedNets.get(targetNet) ?? [];
      for (const p of net.pins) {
        list.push({
          name: `${prefix}/${p.component}.${p.localName}`,
          component: `${prefix}/${p.component}`,
          localName: p.localName,
        });
      }
      mergedNets.set(targetNet, list);
    }
  }

  const nets: Net[] = [];
  let totalPins = 0;
  for (const [id, pins] of mergedNets) {
    nets.push({ id, pins });
    totalPins += pins.length;
  }

  return {
    nets,
    components,
    totalPins,
    totalConnections: nets.reduce((acc, n) => acc + Math.max(0, n.pins.length - 1), 0),
  };
}
