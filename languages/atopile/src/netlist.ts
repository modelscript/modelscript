// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/atopile — Hierarchical Netlist & BOM Elaborator.
 *
 * Elaborates an `.ato` module hierarchy into ModelScript's canonical
 * `@modelscript/cad` `NetlistGraph` + `BomEntry` dictionary.
 */

import type { BomEntry, Net, NetlistComponent, NetlistGraph, NetlistPin } from "@modelscript/cad/ecad";
import type { AtoBlock, AtoFile, AtoPhysicalValue } from "./types.js";

export interface ElaboratedComponent {
  refDes: string;
  typeName: string;
  pins: string[];
  properties: Record<string, string | AtoPhysicalValue>;
}

export interface AtopileElaborationResult {
  entryModule: string;
  netlist: NetlistGraph;
  components: ElaboratedComponent[];
  bom: Record<string, BomEntry>;
  pinNetMap: Map<string, string>;
}

const BUILTIN_TWO_PIN_TYPES = new Set([
  "Resistor",
  "Capacitor",
  "Inductor",
  "Diode",
  "LED",
  "VoltageSource",
  "CurrentSource",
  "Power",
]);

function defaultPinsForType(typeName: string, blockMap: Map<string, AtoBlock>): string[] {
  const def = blockMap.get(typeName);
  if (def) {
    if (def.pins.length > 0) return def.pins;
    if (def.signals.length > 0) return def.signals;
  }
  if (typeName === "Power") return ["vcc", "gnd"];
  if (BUILTIN_TWO_PIN_TYPES.has(typeName)) return ["p1", "p2"];
  return ["p1", "p2"];
}

/**
 * Elaborates an atopile file starting from `entryModule` (defaults to the first
 * `module` block in the file) into a canonical `NetlistGraph` and BOM.
 */
/**
 * Elaborates a multi-file atopile project by merging imported `.ato` files and
 * recursively flattening nested `module` instances (e.g., `stage1.r1`).
 */
export function elaborateAtopileProject(
  rootFile: AtoFile,
  importedFiles: Record<string, AtoFile> = {},
  entryModule?: string,
): AtopileElaborationResult {
  const allBlocks: AtoBlock[] = [...rootFile.blocks];
  for (const f of Object.values(importedFiles)) {
    allBlocks.push(...f.blocks);
  }
  const blockMap = new Map<string, AtoBlock>();
  for (const b of allBlocks) blockMap.set(b.name, b);

  const rootBlock =
    (entryModule ? blockMap.get(entryModule) : undefined) ??
    rootFile.blocks.find((b) => b.kind === "module") ??
    rootFile.blocks[0];

  if (!rootBlock) return elaborateAtopile(rootFile, entryModule);

  // Flatten nested module instances into a synthetic root block
  const flat: AtoBlock = {
    ...rootBlock,
    instances: [],
    connections: [...rootBlock.connections],
    assignments: [...rootBlock.assignments],
    signals: [...rootBlock.signals],
  };

  for (const inst of rootBlock.instances) {
    const sub = blockMap.get(inst.typeName);
    if (sub && sub.kind === "module" && sub.instances.length > 0) {
      for (const childInst of sub.instances) {
        flat.instances.push({ ...childInst, name: `${inst.name}_${childInst.name}` });
      }
      for (const childAssign of sub.assignments) {
        flat.assignments.push({ ...childAssign, target: `${inst.name}_${childAssign.target}` });
      }
      for (const childConn of sub.connections) {
        flat.connections.push({
          ...childConn,
          endpoints: childConn.endpoints.map((ep) =>
            sub.signals.includes(ep) ? `${inst.name}.${ep}` : `${inst.name}_${ep}`,
          ),
        });
      }
    } else {
      flat.instances.push(inst);
    }
  }

  return elaborateAtopile(
    { imports: rootFile.imports, blocks: [flat, ...allBlocks.filter((b) => b.name !== flat.name)], diagnostics: [] },
    flat.name,
  );
}

/**
 * Elaborates an atopile file starting from `entryModule` (defaults to the first
 * `module` block in the file) into a canonical `NetlistGraph` and BOM.
 */
export function elaborateAtopile(file: AtoFile, entryModule?: string): AtopileElaborationResult {
  const blockMap = new Map<string, AtoBlock>();
  for (const b of file.blocks) blockMap.set(b.name, b);

  const rootBlock =
    (entryModule ? blockMap.get(entryModule) : undefined) ??
    file.blocks.find((b) => b.kind === "module") ??
    file.blocks[0];

  if (!rootBlock) {
    return {
      entryModule: entryModule ?? "",
      netlist: { nets: [], components: [], totalPins: 0, totalConnections: 0 },
      components: [],
      bom: {},
      pinNetMap: new Map(),
    };
  }

  // Union-Find for net connectivity
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

  const components: ElaboratedComponent[] = [];
  const compByName = new Map<string, ElaboratedComponent>();
  const namedSignals = new Set<string>(rootBlock.signals);

  // 1. Instantiate components in the entry module
  for (const inst of rootBlock.instances) {
    const pins = defaultPinsForType(inst.typeName, blockMap);
    const comp: ElaboratedComponent = {
      refDes: inst.name,
      typeName: inst.typeName,
      pins,
      properties: {},
    };
    components.push(comp);
    compByName.set(inst.name, comp);
    for (const p of pins) {
      ensure(`${inst.name}.${p}`);
    }
  }

  // 2. Apply property assignments
  for (const assign of rootBlock.assignments) {
    const dotIdx = assign.target.indexOf(".");
    if (dotIdx > 0) {
      const instName = assign.target.slice(0, dotIdx);
      const propName = assign.target.slice(dotIdx + 1);
      const comp = compByName.get(instName);
      if (comp) {
        comp.properties[propName] = assign.physicalValue ?? assign.stringValue ?? assign.rawValue;
      }
    }
  }

  // 3. Apply `~` (direct) and `~>` (bridge) connections
  for (const conn of rootBlock.connections) {
    if (conn.kind === "direct") {
      for (let i = 0; i < conn.endpoints.length - 1; i++) {
        union(conn.endpoints[i]!, conn.endpoints[i + 1]!);
      }
    } else if (conn.kind === "bridge") {
      // `a ~> r1 ~> b` connects `a ~ r1.p1` and `r1.p2 ~ b`
      for (let i = 0; i + 2 < conn.endpoints.length; i += 2) {
        const left = conn.endpoints[i]!;
        const mid = conn.endpoints[i + 1]!;
        const right = conn.endpoints[i + 2]!;
        const midComp = compByName.get(mid);
        const p1 = midComp?.pins[0] ?? "p1";
        const p2 = midComp?.pins[1] ?? "p2";
        union(left, `${mid}.${p1}`);
        union(`${mid}.${p2}`, right);
      }
    }
  }

  // 4. Resolve net names (prefer explicit signal names like `vcc`, `gnd`, `v_out`)
  const rootPreferredName = new Map<string, string>();
  for (const sig of namedSignals) {
    rootPreferredName.set(find(sig), sig);
  }
  // Also recognize bare endpoint names that aren't `comp.pin` as net labels
  for (const conn of rootBlock.connections) {
    for (const ep of conn.endpoints) {
      if (!ep.includes(".") && !compByName.has(ep)) {
        const r = find(ep);
        if (!rootPreferredName.has(r)) rootPreferredName.set(r, ep);
      }
    }
  }

  // 5. Group component pins into nets
  const rootPins = new Map<string, NetlistPin[]>();
  for (const comp of components) {
    for (const p of comp.pins) {
      const full = `${comp.refDes}.${p}`;
      const r = find(full);
      let list = rootPins.get(r);
      if (!list) {
        list = [];
        rootPins.set(r, list);
      }
      list.push({ name: full, component: comp.refDes, localName: p });
    }
  }

  const nets: Net[] = [];
  const pinNetMap = new Map<string, string>();
  let totalPins = 0;
  for (const [root, pins] of rootPins) {
    const id = rootPreferredName.get(root) ?? `Net-(${pins[0]!.component}-${pins[0]!.localName})`;
    nets.push({ id, pins });
    totalPins += pins.length;
    for (const p of pins) {
      pinNetMap.set(p.name, id);
    }
  }

  const netlistComponents: NetlistComponent[] = components.map((c) => {
    const fp = typeof c.properties["footprint"] === "string" ? c.properties["footprint"] : null;
    return {
      name: c.refDes,
      pins: c.pins,
      placement: { footprint: fp, layer: "TopCopper", x: 0, y: 0, angle: 0 },
    };
  });

  const bom: Record<string, BomEntry> = {};
  for (const c of components) {
    const entry: BomEntry = { refDes: c.refDes };
    const valProp =
      c.properties["value"] ??
      c.properties["resistance"] ??
      c.properties["capacitance"] ??
      c.properties["inductance"] ??
      c.properties["voltage"];
    if (valProp !== undefined) {
      entry.value = typeof valProp === "string" ? valProp : valProp.raw;
    }
    const mpn = c.properties["mpn"];
    if (typeof mpn === "string") entry.mpn = mpn;
    const fp = c.properties["footprint"];
    if (typeof fp === "string") entry.footprint = fp;
    bom[c.refDes] = entry;
  }

  return {
    entryModule: rootBlock.name,
    netlist: {
      nets,
      components: netlistComponents,
      totalPins,
      totalConnections: nets.reduce((acc, n) => acc + Math.max(0, n.pins.length - 1), 0),
    },
    components,
    bom,
    pinNetMap,
  };
}
