// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/kicad — Geometric Schematic Netlist Extractor.
 *
 * Resolves KiCad `.kicad_sch` wires, junctions, local/global/hierarchical
 * labels, and power symbols into a canonical `@modelscript/cad` `NetlistGraph`.
 */

import type { Net, NetlistComponent, NetlistGraph, NetlistPin } from "@modelscript/cad/ecad";
import type { KiCadPinElectricalType, KiCadSchematic, KiCadSymbolInstance } from "./types.js";

export interface SchematicPinMeta {
  component: string;
  pinNumber: string;
  pinName: string;
  electricalType: KiCadPinElectricalType;
  sheetPos: [number, number];
  netName: string;
  isPowerSymbol: boolean;
}

export interface SchematicNetlistResult {
  netlist: NetlistGraph;
  /** Maps `"R1.1"` -> resolved net name (e.g. `"VCC"`, `"GND"`, `"Net-(R1-2)"`). */
  pinNetMap: Map<string, string>;
  /** Detailed per-pin metadata for ERC and DAE lowering. */
  pinDetails: SchematicPinMeta[];
  /** Power-flag nets explicitly driven by `power:PWR_FLAG`. */
  powerFlagNets: Set<string>;
}

function ptKey(p: [number, number]): string {
  return `${Math.round(p[0] * 100)},${Math.round(p[1] * 100)}`;
}

function pointOnSegment(p: [number, number], a: [number, number], b: [number, number], eps = 0.02): boolean {
  const minX = Math.min(a[0], b[0]) - eps;
  const maxX = Math.max(a[0], b[0]) + eps;
  const minY = Math.min(a[1], b[1]) - eps;
  const maxY = Math.max(a[1], b[1]) + eps;
  if (p[0] < minX || p[0] > maxX || p[1] < minY || p[1] > maxY) return false;
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lenSq = dx * dx + dy * dy;
  if (lenSq < eps * eps) return Math.hypot(p[0] - a[0], p[1] - a[1]) <= eps;
  const cross = Math.abs((p[0] - a[0]) * dy - (p[1] - a[1]) * dx);
  return cross / Math.sqrt(lenSq) <= eps;
}

function isPowerSymbol(sch: KiCadSchematic, sym: KiCadSymbolInstance): boolean {
  if (sch.libSymbols[sym.libId]?.isPower) return true;
  if (sym.libId.startsWith("power:")) return true;
  return sym.refDes.startsWith("#PWR") || sym.refDes.startsWith("#FLG");
}

function isPowerFlag(sym: KiCadSymbolInstance): boolean {
  return sym.libId === "power:PWR_FLAG" || sym.value.toUpperCase() === "PWR_FLAG" || sym.refDes.startsWith("#FLG");
}

/**
 * Extracts a canonical `NetlistGraph` from a parsed `KiCadSchematic` by
 * unioning geometrically connected wires, junctions, labels, and power symbols.
 */
export function extractSchematicNetlist(sch: KiCadSchematic): SchematicNetlistResult {
  const parent = new Map<string, string>();
  const ensure = (k: string): string => {
    if (!parent.has(k)) parent.set(k, k);
    return k;
  };
  const find = (k: string): string => {
    ensure(k);
    let r = k;
    while (parent.get(r) !== r) r = parent.get(r)!;
    let c = k;
    while (c !== r) {
      const n = parent.get(c)!;
      parent.set(c, r);
      c = n;
    }
    return r;
  };
  const union = (a: string, b: string): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };

  // 1. Register and union all wire endpoints
  for (const w of sch.wires) {
    union(ptKey(w.start), ptKey(w.end));
  }

  // 2. Collect all interactive points (junctions, labels, symbol pins) and attach
  //    any point that lands on the interior of a wire segment (e.g. T-junctions).
  const candidatePoints: [number, number][] = [];
  for (const j of sch.junctions) candidatePoints.push(j.at);
  for (const lbl of sch.labels) candidatePoints.push(lbl.at);
  for (const sym of sch.symbols) {
    for (const pin of sym.pins) candidatePoints.push(pin.sheetPos);
  }
  for (const pt of candidatePoints) {
    const k = ensure(ptKey(pt));
    for (const w of sch.wires) {
      if (pointOnSegment(pt, w.start, w.end)) {
        union(k, ptKey(w.start));
      }
    }
  }

  // 3. Union labels sharing the same name & record preferred net names
  const labelFirstKey = new Map<string, string>();
  const rootPreferredName = new Map<string, string>();
  for (const lbl of sch.labels) {
    if (!lbl.name) continue;
    const k = ptKey(lbl.at);
    const prev = labelFirstKey.get(lbl.name);
    if (prev) {
      union(prev, k);
    } else {
      labelFirstKey.set(lbl.name, k);
    }
  }

  // 4. Union power symbols sharing the same power net value (e.g., GND, VCC)
  const powerFirstKey = new Map<string, string>();
  const powerFlagKeys: string[] = [];
  for (const sym of sch.symbols) {
    if (!isPowerSymbol(sch, sym)) continue;
    const pinPos = sym.pins[0]?.sheetPos ?? sym.at;
    const k = ensure(ptKey(pinPos));
    if (isPowerFlag(sym)) {
      powerFlagKeys.push(k);
      continue;
    }
    const netName = sym.value || sym.libId.replace(/^power:/, "");
    if (!netName) continue;
    const prev = powerFirstKey.get(netName);
    if (prev) {
      union(prev, k);
    } else {
      powerFirstKey.set(netName, k);
    }
  }

  // Assign preferred names to union-find roots (power nets take priority, then labels)
  for (const [name, k] of labelFirstKey) {
    rootPreferredName.set(find(k), name);
  }
  for (const [name, k] of powerFirstKey) {
    rootPreferredName.set(find(k), name);
  }

  // 5. Group pins by root
  const rootPins = new Map<string, NetlistPin[]>();
  const components: NetlistComponent[] = [];
  const rawPinEntries: {
    root: string;
    component: string;
    pinNumber: string;
    pinName: string;
    electricalType: KiCadPinElectricalType;
    sheetPos: [number, number];
    isPower: boolean;
  }[] = [];

  for (const sym of sch.symbols) {
    const powerSym = isPowerSymbol(sch, sym);
    const compName = sym.refDes || sym.libId;
    if (!powerSym) {
      components.push({
        name: compName,
        pins: sym.pins.map((p) => p.number),
        placement: {
          footprint: sym.footprint ?? null,
          layer: "TopCopper",
          x: sym.at[0],
          y: sym.at[1],
          angle: sym.rotation,
        },
      });
    }

    for (const pin of sym.pins) {
      const root = find(ptKey(pin.sheetPos));
      rawPinEntries.push({
        root,
        component: compName,
        pinNumber: pin.number,
        pinName: pin.name,
        electricalType: pin.electricalType,
        sheetPos: pin.sheetPos,
        isPower: powerSym,
      });

      if (!powerSym) {
        let list = rootPins.get(root);
        if (!list) {
          list = [];
          rootPins.set(root, list);
        }
        list.push({
          name: `${compName}.${pin.number}`,
          component: compName,
          localName: pin.number,
        });
      }
    }
  }

  // 6. Finalize net names (auto-name unnamed nets as `Net-(<firstComp>-<pin>)`)
  const rootFinalName = new Map<string, string>();
  let anonIdx = 1;
  for (const [root, pins] of rootPins) {
    const preferred = rootPreferredName.get(root);
    if (preferred) {
      rootFinalName.set(root, preferred);
    } else if (pins.length > 0) {
      const first = pins[0]!;
      rootFinalName.set(root, `Net-(${first.component}-${first.localName})`);
    } else {
      rootFinalName.set(root, `Net_${anonIdx++}`);
    }
  }

  const nets: Net[] = [];
  let totalPins = 0;
  for (const [root, pins] of rootPins) {
    const id = rootFinalName.get(root) ?? `Net_${anonIdx++}`;
    nets.push({ id, pins });
    totalPins += pins.length;
  }

  const pinNetMap = new Map<string, string>();
  const pinDetails: SchematicPinMeta[] = [];
  for (const entry of rawPinEntries) {
    const netName = rootFinalName.get(entry.root) ?? rootPreferredName.get(entry.root) ?? "";
    if (!entry.isPower) {
      pinNetMap.set(`${entry.component}.${entry.pinNumber}`, netName);
    }
    pinDetails.push({
      component: entry.component,
      pinNumber: entry.pinNumber,
      pinName: entry.pinName,
      electricalType: entry.electricalType,
      sheetPos: entry.sheetPos,
      netName,
      isPowerSymbol: entry.isPower,
    });
  }

  const powerFlagNets = new Set<string>();
  for (const k of powerFlagKeys) {
    const r = find(k);
    const name = rootFinalName.get(r) ?? rootPreferredName.get(r);
    if (name) powerFlagNets.add(name);
  }

  return {
    netlist: {
      nets,
      components,
      totalPins,
      totalConnections: nets.reduce((acc, n) => acc + Math.max(0, n.pins.length - 1), 0),
    },
    pinNetMap,
    pinDetails,
    powerFlagNets,
  };
}
