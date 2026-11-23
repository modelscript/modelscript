// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Hierarchical EDIF 2.0.0 netlist flattener.
 *
 * Recursively expands subcircuit instances from the top-level `design` cell
 * down to leaf primitive cells (`RES`, `CAP`, `IND`, `GND`, `VCC`, `AND2`, `OR2`,
 * `NAND2`, `NOR2`, `INV`, `XOR2`, `DFF`, etc.) while unifying connected nets
 * across hierarchy boundaries using a Union-Find (disjoint-set) structure.
 */

import { parseEdif, parseEdifNumericValue } from "../parser/edif-parser.js";
import type {
  EdifCell,
  EdifDocument,
  EdifLibrary,
  EdifPort,
  EdifProperty,
  EdifView,
  FlattenedEdifInstance,
  FlattenedEdifNet,
  FlattenedEdifNetlist,
  FlattenedEdifPin,
} from "../types.js";

class UnionFind {
  private parent = new Map<string, string>();
  private priority = new Map<string, number>();

  add(name: string, prio: number): void {
    if (!this.parent.has(name)) {
      this.parent.set(name, name);
      this.priority.set(name, prio);
    } else if (prio > (this.priority.get(name) ?? 0)) {
      this.priority.set(name, prio);
    }
  }

  find(x: string): string {
    let r = x;
    while (this.parent.has(r) && this.parent.get(r) !== r) {
      r = this.parent.get(r)!;
    }
    let cur = x;
    while (cur !== r && this.parent.has(cur)) {
      const next = this.parent.get(cur)!;
      this.parent.set(cur, r);
      cur = next;
    }
    return r;
  }

  union(a: string, b: string): string {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra === rb) return ra;
    const pa = this.priority.get(ra) ?? 0;
    const pb = this.priority.get(rb) ?? 0;
    if (pa >= pb) {
      this.parent.set(rb, ra);
      return ra;
    }
    this.parent.set(ra, rb);
    return rb;
  }

  allNodes(): string[] {
    return Array.from(this.parent.keys());
  }
}

function extractProps(props: EdifProperty[]): Record<string, number | string | boolean> {
  const out: Record<string, number | string | boolean> = {};
  for (const p of props) {
    const key = p.name.toUpperCase();
    if (p.value.kind === "boolean") {
      out[key] = p.value.value;
    } else {
      const num = parseEdifNumericValue(p.value);
      if (num !== undefined) {
        out[key] = num;
      } else {
        out[key] = String(p.value.value);
      }
    }
  }
  return out;
}

function netPriority(name: string, depth: number, isTopPort: boolean): number {
  const upper = name.toUpperCase();
  if (upper === "GND" || upper === "VSS" || upper === "0") return 10000;
  if (upper === "VCC" || upper === "VDD") return 9000;
  if (isTopPort) return 5000 - depth * 10;
  return 1000 - depth * 10;
}

/**
 * Flattens a hierarchical EDIF 2.0.0 document into a flat netlist of leaf instances and unified nets.
 */
export function flattenEdifNetlist(docOrSource: EdifDocument | string): FlattenedEdifNetlist {
  const doc = typeof docOrSource === "string" ? parseEdif(docOrSource) : docOrSource;

  const allLibs = [...doc.externals, ...doc.libraries];
  const libMap = new Map<string, EdifLibrary>();
  for (const lib of allLibs) {
    libMap.set(lib.name.toLowerCase(), lib);
  }

  function findCell(
    libName: string | undefined,
    cellName: string,
    fallbackLib?: EdifLibrary,
  ): { lib: EdifLibrary; cell: EdifCell } | undefined {
    if (libName) {
      const lib = libMap.get(libName.toLowerCase());
      const cell = lib?.cells.find((c) => c.name.toLowerCase() === cellName.toLowerCase());
      if (lib && cell) return { lib, cell };
    }
    if (fallbackLib) {
      const cell = fallbackLib.cells.find((c) => c.name.toLowerCase() === cellName.toLowerCase());
      if (cell) return { lib: fallbackLib, cell };
    }
    for (const lib of allLibs) {
      const cell = lib.cells.find((c) => c.name.toLowerCase() === cellName.toLowerCase());
      if (cell) return { lib, cell };
    }
    return undefined;
  }

  function findView(cell: EdifCell, viewName?: string): EdifView | undefined {
    if (viewName) {
      const v = cell.views.find((vv) => vv.name.toLowerCase() === viewName.toLowerCase());
      if (v) return v;
    }
    return cell.views[0];
  }

  // Locate top cell
  let topLib: EdifLibrary | undefined;
  let topCell: EdifCell | undefined;
  let topView: EdifView | undefined;
  const designName = doc.design?.name ?? doc.name;

  if (doc.design?.cellName) {
    const found = findCell(doc.design.libraryName, doc.design.cellName);
    if (found) {
      topLib = found.lib;
      topCell = found.cell;
      topView = findView(topCell, doc.design.viewName);
    }
  }

  if (!topCell) {
    // Fallback: pick last non-external cell with contents
    for (let i = doc.libraries.length - 1; i >= 0 && !topCell; i--) {
      const lib = doc.libraries[i]!;
      for (let j = lib.cells.length - 1; j >= 0 && !topCell; j--) {
        const cell = lib.cells[j]!;
        const v = cell.views.find((vv) => vv.instances.length > 0 || vv.nets.length > 0);
        if (v) {
          topLib = lib;
          topCell = cell;
          topView = v;
        }
      }
    }
  }

  if (!topLib || !topCell || !topView) {
    return {
      designName,
      topCellName: doc.design?.cellName ?? "",
      topLibraryName: doc.design?.libraryName ?? "",
      topPorts: [],
      instances: [],
      nets: [],
    };
  }

  const uf = new UnionFind();
  const topPortNetMeta = new Map<string, EdifPort>();
  const rawInstances: Array<{
    name: string;
    cellType: string;
    cellName: string;
    libraryName: string;
    viewName: string;
    portToRawNet: Record<string, string>;
    portDirections: Record<string, string | undefined>;
    properties: Record<string, number | string | boolean>;
  }> = [];

  // Create nodes for top-level ports
  const topPortBindings = new Map<string, string>();
  for (const p of topView.ports) {
    uf.add(p.name, netPriority(p.name, 0, true));
    topPortBindings.set(p.name.toLowerCase(), p.name);
    topPortNetMeta.set(p.name, p);
  }

  function expandView(
    lib: EdifLibrary,
    cell: EdifCell,
    view: EdifView,
    prefix: string,
    portBindings: Map<string, string>,
    depth: number,
    activeStack: Set<string>,
  ): void {
    const cellKey = `${lib.name.toLowerCase()}::${cell.name.toLowerCase()}`;
    if (activeStack.has(cellKey)) {
      return; // Guard against circular hierarchy
    }
    activeStack.add(cellKey);

    // Map local net names -> global raw net IDs
    const localNetToGlobal = new Map<string, string>();
    // Map (instName.toLowerCase() -> (portName.toLowerCase() -> global net ID))
    const instPortNet = new Map<string, Map<string, string>>();

    for (const net of view.nets) {
      const globalNetName = prefix ? `${prefix}/${net.name}` : net.name;
      uf.add(globalNetName, netPriority(net.name, depth, false));
      localNetToGlobal.set(net.name.toLowerCase(), globalNetName);

      for (const pref of net.joined) {
        if (!pref.instanceName) {
          // Connects to a port of the current view -> union with parent binding
          const bound = portBindings.get(pref.portName.toLowerCase());
          if (bound) {
            uf.union(bound, globalNetName);
          }
        } else {
          const iKey = pref.instanceName.toLowerCase();
          let pm = instPortNet.get(iKey);
          if (!pm) {
            pm = new Map<string, string>();
            instPortNet.set(iKey, pm);
          }
          const pKey = pref.portName.toLowerCase();
          const prev = pm.get(pKey);
          if (prev) {
            uf.union(prev, globalNetName);
          } else {
            pm.set(pKey, globalNetName);
          }
        }
      }
    }

    // Expand each instance
    for (const inst of view.instances) {
      const fullInstName = prefix ? `${prefix}/${inst.name}` : inst.name;
      const targetCellName = inst.viewRef.cellName ?? "";
      const found = targetCellName ? findCell(inst.viewRef.libraryName, targetCellName, lib) : undefined;
      const targetLib = found?.lib;
      const targetCell = found?.cell;
      const targetView = targetCell ? findView(targetCell, inst.viewRef.viewName) : undefined;

      const childPortMap = instPortNet.get(inst.name.toLowerCase()) ?? new Map<string, string>();

      const isHierarchical =
        Boolean(targetLib && targetCell && targetView) &&
        !targetLib!.isExternal &&
        (targetView!.instances.length > 0 || targetView!.nets.length > 0);

      if (isHierarchical && targetLib && targetCell && targetView) {
        // Ensure all child ports have a net node even if left floating in parent
        const childBindings = new Map<string, string>();
        for (const cp of targetView.ports) {
          const existing = childPortMap.get(cp.name.toLowerCase());
          if (existing) {
            childBindings.set(cp.name.toLowerCase(), existing);
          } else {
            const floating = `${fullInstName}/${cp.name}`;
            uf.add(floating, netPriority(floating, depth + 1, false));
            childBindings.set(cp.name.toLowerCase(), floating);
          }
        }
        expandView(targetLib, targetCell, targetView, fullInstName, childBindings, depth + 1, activeStack);
      } else {
        // Leaf primitive instance
        const props: Record<string, number | string | boolean> = {
          ...(targetCell ? extractProps(targetCell.properties) : {}),
          ...(targetView ? extractProps(targetView.properties) : {}),
          ...extractProps(inst.properties),
        };
        if (inst.designator && props["DESIGNATOR"] === undefined) {
          props["DESIGNATOR"] = inst.designator;
        }

        const portToRawNet: Record<string, string> = {};
        const portDirections: Record<string, string | undefined> = {};

        if (targetView && targetView.ports.length > 0) {
          for (const p of targetView.ports) {
            const netId = childPortMap.get(p.name.toLowerCase());
            if (netId) {
              portToRawNet[p.name] = netId;
            }
            portDirections[p.name] = p.direction;
          }
        }
        // Include any extra referenced ports not declared on view
        for (const [pKey, netId] of childPortMap) {
          const already = Object.keys(portToRawNet).some((k) => k.toLowerCase() === pKey);
          if (!already) {
            portToRawNet[pKey.toUpperCase()] = netId;
          }
        }

        rawInstances.push({
          name: fullInstName,
          cellType: targetCell?.cellType ?? "GENERIC",
          cellName: targetCell?.name ?? targetCellName,
          libraryName: targetLib?.name ?? inst.viewRef.libraryName ?? lib.name,
          viewName: targetView?.name ?? inst.viewRef.viewName,
          portToRawNet,
          portDirections,
          properties: props,
        });
      }
    }

    activeStack.delete(cellKey);
  }

  expandView(topLib, topCell, topView, "", topPortBindings, 0, new Set<string>());

  // Resolve canonical net names via Union-Find
  const netPins = new Map<string, FlattenedEdifPin[]>();
  const canonicalTopPort = new Map<string, EdifPort>();

  for (const [rawNet, port] of topPortNetMeta) {
    const canon = uf.find(rawNet);
    canonicalTopPort.set(canon, port);
    if (!netPins.has(canon)) netPins.set(canon, []);
    netPins.get(canon)!.push({ portName: port.name, direction: port.direction });
  }

  const instances: FlattenedEdifInstance[] = rawInstances.map((ri) => {
    const portToNet: Record<string, string> = {};
    for (const [pName, rawNet] of Object.entries(ri.portToRawNet)) {
      const canon = uf.find(rawNet);
      portToNet[pName] = canon;
      if (!netPins.has(canon)) netPins.set(canon, []);
      netPins.get(canon)!.push({
        instanceName: ri.name,
        portName: pName,
        direction: ri.portDirections[pName],
      });
    }
    return {
      name: ri.name,
      cellType: ri.cellType,
      cellName: ri.cellName,
      libraryName: ri.libraryName,
      viewName: ri.viewName,
      portToNet,
      properties: ri.properties,
    };
  });

  // Also ensure any isolated nets from UnionFind are included
  for (const n of uf.allNodes()) {
    const canon = uf.find(n);
    if (!netPins.has(canon)) {
      netPins.set(canon, []);
    }
  }

  const nets: FlattenedEdifNet[] = Array.from(netPins.entries()).map(([name, pins]) => {
    const tp = canonicalTopPort.get(name);
    return {
      name,
      pins,
      isTopPort: Boolean(tp),
      topPortName: tp?.name,
      topPortDirection: tp?.direction,
    };
  });

  return {
    designName,
    topCellName: topCell.name,
    topLibraryName: topLib.name,
    topPorts: topView.ports,
    instances,
    nets,
  };
}
