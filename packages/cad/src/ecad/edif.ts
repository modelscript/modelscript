// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * EDIF 2 0 0 Schematic Netlist Importer.
 *
 * Parses enterprise EDIF 2 0 0 S-expression netlists (Cadence OrCAD/Allegro,
 * Siemens Mentor/DxDesigner, Altium) into ModelScript's canonical `NetlistGraph`.
 */

import type { Net, NetlistComponent, NetlistGraph, NetlistPin } from "./netlist.js";

export interface EdifParseResult {
  designName: string;
  netlist: NetlistGraph;
  diagnostics: string[];
}

interface EdifNode {
  head?: string;
  items: (EdifNode | string)[];
}

function parseEdifSExpr(src: string): EdifNode | null {
  const stack: EdifNode[] = [];
  let root: EdifNode | null = null;
  let i = 0;
  const n = src.length;

  while (i < n) {
    const c = src.charCodeAt(i);
    if (c === 32 || c === 9 || c === 10 || c === 13) {
      i++;
      continue;
    }
    if (c === 40) {
      const node: EdifNode = { items: [] };
      if (stack.length > 0) stack[stack.length - 1]!.items.push(node);
      else root = node;
      stack.push(node);
      i++;
      continue;
    }
    if (c === 41) {
      stack.pop();
      i++;
      continue;
    }
    let tok = "";
    if (c === 34) {
      i++;
      while (i < n && src.charCodeAt(i) !== 34) {
        tok += src[i]!;
        i++;
      }
      if (i < n) i++;
    } else {
      const start = i;
      while (i < n) {
        const ch = src.charCodeAt(i);
        if (ch === 32 || ch === 9 || ch === 10 || ch === 13 || ch === 40 || ch === 41) break;
        i++;
      }
      tok = src.slice(start, i);
    }
    const top = stack[stack.length - 1];
    if (top) {
      if (top.head === undefined) top.head = tok.toLowerCase();
      else top.items.push(tok);
    }
  }
  return root;
}

function edifFindAll(node: EdifNode | null | undefined, head: string, out: EdifNode[] = []): EdifNode[] {
  if (!node) return out;
  for (const item of node.items) {
    if (typeof item !== "string") {
      if (item.head === head) out.push(item);
      edifFindAll(item, head, out);
    }
  }
  return out;
}

function edifNameOf(node: EdifNode | undefined): string {
  const first = node?.items[0];
  if (typeof first === "string") return first;
  if (first && first.head === "rename") {
    const renamed = first.items[1] ?? first.items[0];
    return typeof renamed === "string" ? renamed : "";
  }
  return "";
}

/**
 * Parses an EDIF 2 0 0 netlist string into ModelScript's canonical `NetlistGraph`.
 */
export function parseEdif200(text: string): EdifParseResult {
  const diagnostics: string[] = [];
  const root = parseEdifSExpr(text);
  if (!root || root.head !== "edif") {
    return {
      designName: "",
      netlist: { nets: [], components: [], totalPins: 0, totalConnections: 0 },
      diagnostics: ["Missing top-level '(edif ...)' S-expression."],
    };
  }

  const designName = edifNameOf(root) || "EDIF_DESIGN";
  const compMap = new Map<string, { footprint: string | null; pins: Set<string> }>();

  for (const inst of edifFindAll(root, "instance")) {
    const refDes = edifNameOf(inst);
    if (!refDes) continue;
    const cellRef = edifFindAll(inst, "cellref")[0];
    const footprint = cellRef ? edifNameOf(cellRef) || null : null;
    if (!compMap.has(refDes)) {
      compMap.set(refDes, { footprint, pins: new Set() });
    }
  }

  const nets: Net[] = [];
  let totalPins = 0;

  for (const netNode of edifFindAll(root, "net")) {
    const netName = edifNameOf(netNode);
    if (!netName) continue;
    const pins: NetlistPin[] = [];
    for (const pr of edifFindAll(netNode, "portref")) {
      const pinName = edifNameOf(pr);
      const instRef = edifFindAll(pr, "instanceref")[0];
      const compName = instRef ? edifNameOf(instRef) : "";
      if (!compName || !pinName) continue;
      pins.push({ name: `${compName}.${pinName}`, component: compName, localName: pinName });
      totalPins++;
      if (!compMap.has(compName)) {
        compMap.set(compName, { footprint: null, pins: new Set() });
      }
      compMap.get(compName)!.pins.add(pinName);
    }
    nets.push({ id: netName, pins });
  }

  const components: NetlistComponent[] = [];
  for (const [name, info] of compMap) {
    components.push({
      name,
      pins: [...info.pins],
      placement: { footprint: info.footprint, layer: "TopCopper", x: 0, y: 0, angle: 0 },
    });
  }

  return {
    designName,
    netlist: {
      nets,
      components,
      totalPins,
      totalConnections: nets.reduce((acc, n) => acc + Math.max(0, n.pins.length - 1), 0),
    },
    diagnostics,
  };
}
