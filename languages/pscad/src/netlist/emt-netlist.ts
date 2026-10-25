// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Extracts a structured EmtNetlist from a parsed PscxProject.
 *
 * Resolves connectivity across buses, components, and wires into
 * electrical branches ready for the Dommel companion solver.
 */

import { registeredPscadSourceTexts } from "../model/workspace-registry.js";
import { computePortWorldPosition, parsePscx } from "../parser/pscx-parser.js";
import { compileFortranSegment } from "../script/fortran-codegen.js";
import type {
  EmtBranch,
  EmtBus,
  EmtControlBlock,
  EmtConverterBridge,
  EmtCurrentSource,
  EmtCustomFortranBlock,
  EmtFault,
  EmtFmuInstance,
  EmtInductionMachine,
  EmtNetlist,
  EmtSource,
  EmtSurgeArrester,
  EmtSynchronousMachine,
  EmtTransformer,
  EmtTransmissionLine,
  PscxComponent,
  PscxModule,
  PscxProject,
} from "../types.js";
import { evalParamExpr, resolveParamBag, type ParamScope } from "./param-eval.js";

const externalProjectCache = new Map<string, PscxProject | null>();

/**
 * Resolves a user-definition reference to its schematic module: first within the project itself,
 * then in library projects registered with the workspace (`Lib:Name` references).
 */
export function resolveSubModule(project: PscxProject, rawDefn: string): PscxModule | undefined {
  const idx = rawDefn.indexOf(":");
  const lib = idx >= 0 ? rawDefn.slice(0, idx) : "";
  const clean = idx >= 0 ? rawDefn.slice(idx + 1) : rawDefn;
  if (lib === "master") return undefined;
  const local = project.subModules.get(clean) ?? project.subModules.get(rawDefn);
  if (local) return local;
  if (!lib) return undefined;
  for (const text of registeredPscadSourceTexts()) {
    let ext = externalProjectCache.get(text);
    if (ext === undefined) {
      try {
        ext = parsePscx(text);
      } catch {
        ext = null;
      }
      externalProjectCache.set(text, ext);
    }
    const m = ext?.subModules.get(clean);
    if (m) return m;
  }
  return undefined;
}

/**
 * Extracts a structured `EmtNetlist` from a parsed `PscxProject`, recursively flattening
 * hierarchical sub-modules, snapping geometric wire/ground pins, and classifying electrical
 * and CSMF control components.
 */
const WIRE_TOUCH_TOLERANCE = 4;
const PHASE_SUFFIX = ["A", "B", "C"] as const;

function segDist(p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const u = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + u * dx), p.y - (a.y + u * dy));
}

/** Returns, per wire index, the union of connected port ids across its whole electrical net. */
function mergeWireNets(mod: PscxModule): string[][] {
  const n = mod.wires.length;
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]!]!;
      i = parent[i]!;
    }
    return i;
  };
  const union = (a: number, b: number): void => {
    parent[find(a)] = find(b);
  };
  const byPort = new Map<string, number>();
  mod.wires.forEach((w, i) => {
    for (const p of w.connectedPortIds) {
      const other = byPort.get(p);
      if (other === undefined) byPort.set(p, i);
      else union(i, other);
    }
  });
  const touches = (a: PscxModule["wires"][number], b: PscxModule["wires"][number]): boolean => {
    const ends = [a.vertices[0], a.vertices[a.vertices.length - 1]];
    for (const e of ends) {
      if (!e) continue;
      for (let k = 0; k < b.vertices.length - 1; k++) {
        if (segDist(e, b.vertices[k]!, b.vertices[k + 1]!) <= WIRE_TOUCH_TOLERANCE) return true;
      }
    }
    return false;
  };
  for (let i = 0; i < n; i++) {
    const wi = mod.wires[i]!;
    if (wi.vertices.length < 2) continue;
    for (let j = i + 1; j < n; j++) {
      const wj = mod.wires[j]!;
      if (wj.vertices.length < 2 || find(i) === find(j)) continue;
      if (touches(wi, wj) || touches(wj, wi)) union(i, j);
    }
  }
  const ports = new Map<number, Set<string>>();
  mod.wires.forEach((w, i) => {
    const r = find(i);
    const s = ports.get(r) ?? new Set<string>();
    for (const p of w.connectedPortIds) s.add(p);
    ports.set(r, s);
  });
  return mod.wires.map((_, i) => [...ports.get(find(i))!]);
}

export function extractEmtNetlist(project: PscxProject): EmtNetlist {
  const buses = new Map<string, EmtBus>();
  const branches: EmtBranch[] = [];
  const transformers: EmtTransformer[] = [];
  const transmissionLines: EmtTransmissionLine[] = [];
  const fmuInstances: EmtFmuInstance[] = [];
  const sources: EmtSource[] = [];
  const assumptions: string[] = [];
  const faults: EmtFault[] = [];
  const surgeArresters: EmtSurgeArrester[] = [];
  const synchronousMachines: EmtSynchronousMachine[] = [];
  const inductionMachines: EmtInductionMachine[] = [];
  const converterBridges: EmtConverterBridge[] = [];
  const controlBlocks: EmtControlBlock[] = [];
  const currentSources: EmtCurrentSource[] = [];
  const customFortranBlocks: EmtCustomFortranBlock[] = [];
  const vectorBlocks: EmtControlBlock[] = [];
  let virtualBusCounter = 1;

  /**
   * Recursively elaborates a single PSCAD schematic module (`mod`) under hierarchical `prefix`,
   * stitching boundary ports (`port` / `xnode`) to parent buses via `boundaryBusOverrides`.
   */
  function processModule(
    mod: PscxModule,
    prefix: string,
    boundaryBusOverrides: Map<string, string>,
    visitedDefs: Set<string>,
    scope: ParamScope = new Map(),
  ): void {
    const qualifyId = (id: string): string => (prefix ? `${prefix}_${id}` : id);
    // Components in one module can share a display name (e.g. empty `Name` falls back to the definition);
    // qualify those by canvas id so distinct blocks and sub-module instances never collide.
    const instanceNameCounts = new Map<string, number>();
    for (const c of mod.components) {
      const n = c.instanceName || c.id;
      instanceNameCounts.set(n, (instanceNameCounts.get(n) ?? 0) + 1);
    }
    const localName = (c: PscxComponent): string => {
      const n = c.instanceName || c.id;
      return (instanceNameCounts.get(n) ?? 1) > 1 ? `${n}_${c.id}` : n;
    };

    // 1. Register explicit buses (remapping boundary buses if matched in boundaryBusOverrides)
    const localBusIdToNetlistBus = new Map<string, string>();
    for (const b of mod.buses) {
      const overrideBus =
        boundaryBusOverrides.get(b.id) ??
        boundaryBusOverrides.get(b.name) ??
        boundaryBusOverrides.get(b.name.toLowerCase());
      if (overrideBus) {
        localBusIdToNetlistBus.set(b.id, overrideBus);
        continue;
      }
      const qBusId = qualifyId(b.id);
      localBusIdToNetlistBus.set(b.id, qBusId);
      if (!buses.has(qBusId)) {
        buses.set(qBusId, {
          id: qBusId,
          name: prefix ? `${prefix}.${b.name}` : b.name,
          baseKv: b.voltageBaseKv ?? 230.0,
          phaseCount: b.phaseCount,
          connectedBranchIds: [],
        });
      }
    }

    // Identify ground component ports, signal ports, and CSMF block output ports
    const groundPortIds = new Set<string>();
    const signalPortIds = new Set<string>();
    const signalOutPortToBlockId = new Map<string, string>();
    const groundPositions: { x: number; y: number }[] = [];

    for (const cmp of mod.components) {
      const defn = cmp.definitionName.toLowerCase();
      const isPark = defn.endsWith(":abcdq0");
      const parkInverse = isPark && Number(cmp.parameters["IDir"] ?? 1) === 0;
      const isMerge = defn.endsWith(":datamerge");
      for (const port of cmp.ports) {
        if (port.kind === "signal" || isPark || isMerge) {
          signalPortIds.add(port.id);
          const qn = qualifyId(localName(cmp));
          if (isPark) {
            // Forward: p5 = d, dq0 = q. Inverse: p4 = a, dq0 = b, p3 = c.
            const outs: Record<string, string> = parkInverse
              ? { p4: `${qn}_phaseA`, dq0: `${qn}_phaseB`, p3: `${qn}_phaseC` }
              : { p5: qn, dq0: `${qn}_q` };
            const o = outs[port.name];
            if (o) signalOutPortToBlockId.set(port.id, o);
          } else if (port.name === "out" || port.name === "dq0") {
            signalOutPortToBlockId.set(port.id, qn);
          }
        }
      }

      // Check if definition has custom Fortran script segments (<segment name="Fortran"> or "Dsdyn")
      const cleanDef = (
        cmp.definitionName.includes(":") ? cmp.definitionName.split(":").pop()! : cmp.definitionName
      ).toLowerCase();
      const defGraphic = project.definitions?.get(cleanDef) ?? project.definitions?.get(cmp.definitionName);
      const fortranSeg = defGraphic?.scriptSegments?.get("fortran") ?? defGraphic?.scriptSegments?.get("dsdyn");
      if (fortranSeg?.content) {
        try {
          const compiled = compileFortranSegment(fortranSeg.content, cmp.parameters);
          const qn = qualifyId(localName(cmp));
          for (const port of cmp.ports) {
            const isAssigned = compiled.assignedPorts.some((p) => p.toLowerCase() === port.name.toLowerCase());
            const isReferenced = compiled.referencedPorts.some((p) => p.toLowerCase() === port.name.toLowerCase());
            if (isAssigned || isReferenced || port.kind === "signal") {
              signalPortIds.add(port.id);
            }
            if (isAssigned) {
              const outSigId = `${qn}_${port.name}`;
              signalOutPortToBlockId.set(port.id, outSigId);
              if (compiled.assignedPorts.length === 1) {
                signalOutPortToBlockId.set(port.id, qn);
              }
            }
          }
        } catch {
          // Handled during component processing
        }
      }
      if (defn.includes("ground") || defn === "gnd" || defn.endsWith(":ground")) {
        groundPositions.push({ x: cmp.position.x, y: cmp.position.y });
        for (const port of cmp.ports) {
          groundPortIds.add(port.id);
          if (port.position) {
            groundPositions.push({
              x: cmp.position.x + port.position.x,
              y: cmp.position.y + port.position.y,
            });
          }
        }
      }
    }

    // Map port ID to connected bus ID via electrical wires
    const portToBusMap = new Map<string, string>();
    for (const gPortId of groundPortIds) {
      portToBusMap.set(gPortId, "0");
    }

    // Check if any boundary port component (<User defn="port" / "xnode">) maps to parent boundary bus
    for (const cmp of mod.components) {
      const cleanDef = (
        cmp.definitionName.includes(":") ? cmp.definitionName.split(":").pop()! : cmp.definitionName
      ).toLowerCase();
      if (cleanDef === "port" || cleanDef === "xnode") {
        const pName = cmp.instanceName || String(cmp.parameters["Name"] ?? cmp.parameters["name"] ?? "");
        const boundBus = boundaryBusOverrides.get(pName) ?? boundaryBusOverrides.get(pName.toLowerCase());
        if (boundBus) {
          for (const pt of cmp.ports) {
            portToBusMap.set(pt.id, boundBus);
          }
        }
      }
    }

    // Check if any component port coincides directly with a ground symbol pin
    if (groundPositions.length > 0) {
      for (const cmp of mod.components) {
        for (const port of cmp.ports) {
          if (port.kind === "signal") continue;
          const px = cmp.position.x + (port.position?.x ?? 0);
          const py = cmp.position.y + (port.position?.y ?? 0);
          for (const gp of groundPositions) {
            if (Math.hypot(px - gp.x, py - gp.y) <= 15.0) {
              portToBusMap.set(port.id, "0");
              break;
            }
          }
        }
      }
    }

    // Also build a signal port connectivity map: inputSignalPortId -> upstreamBlockId
    const signalPortSourceMap = new Map<string, string>();
    /** Data-label name -> id of the block driving that label within this module. */
    const labelSignalSource = new Map<string, string>();

    // Merge wires into nets: wires sharing a port, or touching geometrically (T-junctions, end-to-end),
    // are one electrical node. Each wire then sees the full port set of its net.
    const netPorts = mergeWireNets(mod);
    // A block's own output must never be resolved as the source of one of its own inputs.
    const portOwner = new Map<string, string>();
    for (const c of mod.components) for (const pt of c.ports) portOwner.set(pt.id, c.id);
    for (let wi = 0; wi < mod.wires.length; wi++) {
      const wire = { connectedPortIds: netPorts[wi]! };
      if (wire.connectedPortIds.length === 0) continue;

      // Resolve CSMF signal wires
      const connectedSignalOut = wire.connectedPortIds.find((id) => signalOutPortToBlockId.has(id));
      if (connectedSignalOut) {
        const srcBlockId = signalOutPortToBlockId.get(connectedSignalOut)!;
        for (const pId of wire.connectedPortIds) {
          if (
            pId !== connectedSignalOut &&
            signalPortIds.has(pId) &&
            portOwner.get(pId) !== portOwner.get(connectedSignalOut)
          ) {
            signalPortSourceMap.set(pId, srcBlockId);
          }
        }
      }

      // Filter out signal-only wires from electrical bus creation
      const elecPortOrBusIds = wire.connectedPortIds.filter((id) => !signalPortIds.has(id));
      if (elecPortOrBusIds.length === 0) continue;

      // Check if wire touches a ground port
      const touchesGround = elecPortOrBusIds.some((id) => groundPortIds.has(id) || portToBusMap.get(id) === "0");
      if (touchesGround) {
        for (const pId of elecPortOrBusIds) {
          if (!localBusIdToNetlistBus.has(pId)) {
            portToBusMap.set(pId, "0");
          }
        }
        continue;
      }

      // Check if wire connects to an explicit bus
      const explicitLocalBusId = elecPortOrBusIds.find((id) => localBusIdToNetlistBus.has(id));
      if (explicitLocalBusId) {
        const targetNetlistBus = localBusIdToNetlistBus.get(explicitLocalBusId)!;
        for (const pId of elecPortOrBusIds) {
          if (pId !== explicitLocalBusId) {
            portToBusMap.set(pId, targetNetlistBus);
          }
        }
      } else if (elecPortOrBusIds.length >= 2) {
        // Direct component-to-component wire without an explicit <Bus>
        const existingBusId = elecPortOrBusIds.map((id) => portToBusMap.get(id)).find((b) => b !== undefined);
        const sharedBusId = existingBusId ?? qualifyId(`Node_${virtualBusCounter++}`);
        if (!buses.has(sharedBusId) && sharedBusId !== "GND" && sharedBusId !== "0") {
          buses.set(sharedBusId, {
            id: sharedBusId,
            name: sharedBusId,
            baseKv: 230.0,
            phaseCount: 3,
            connectedBranchIds: [],
          });
        }
        for (const pId of elecPortOrBusIds) {
          portToBusMap.set(pId, sharedBusId);
        }
      }
    }

    // Also link wireless Data Label / XNode nets across signal and electrical ports
    if (mod.wirelessNets) {
      for (const [netLabel, portList] of Object.entries(mod.wirelessNets)) {
        // The driver is either a block output in the net, or any label port already fed by a wire.
        const driverPort = portList.find((id) => signalOutPortToBlockId.has(id));
        const srcBlockId = driverPort
          ? signalOutPortToBlockId.get(driverPort)
          : portList.map((id) => signalPortSourceMap.get(id)).find((b) => b !== undefined);
        if (srcBlockId) {
          labelSignalSource.set(netLabel, srcBlockId);
          for (const pId of portList) {
            if (pId !== driverPort && signalPortIds.has(pId)) {
              signalPortSourceMap.set(pId, srcBlockId);
            }
          }
        }
        const elecIds = portList.filter((id) => !signalPortIds.has(id));
        if (elecIds.length >= 2) {
          const existingBusId = elecIds.map((id) => portToBusMap.get(id)).find((b) => b !== undefined);
          const sharedBusId = existingBusId ?? qualifyId(netLabel);
          if (!buses.has(sharedBusId) && sharedBusId !== "GND" && sharedBusId !== "0") {
            buses.set(sharedBusId, {
              id: sharedBusId,
              name: sharedBusId,
              baseKv: 230.0,
              phaseCount: 3,
              connectedBranchIds: [],
            });
          }
          for (const pId of elecIds) {
            portToBusMap.set(pId, sharedBusId);
          }
        }
      }
    }

    // Pin abutment: an undriven signal input that sits exactly on another block's signal output is connected
    // to it without a wire (bin_delay's input touches the preceding block's output in the corpus).
    {
      const outAt: { x: number; y: number; block: string }[] = [];
      for (const cmp of mod.components) {
        for (const pt of cmp.ports) {
          const blk = signalOutPortToBlockId.get(pt.id);
          if (!blk) continue;
          const w = computePortWorldPosition(cmp.position, pt.position, cmp.rotation ?? 0, Boolean(cmp.mirror));
          outAt.push({ x: w.x, y: w.y, block: blk });
        }
      }
      for (const cmp of mod.components) {
        if (!cmp.definitionName.endsWith(":datalabel")) continue;
        for (const pt of cmp.ports) {
          const blk = signalPortSourceMap.get(pt.id);
          if (!blk) continue;
          const w = computePortWorldPosition(cmp.position, pt.position, cmp.rotation ?? 0, Boolean(cmp.mirror));
          outAt.push({ x: w.x, y: w.y, block: blk });
        }
      }
      for (const cmp of mod.components) {
        for (const pt of cmp.ports) {
          if (pt.kind !== "signal" || pt.name === "out" || signalPortSourceMap.has(pt.id)) continue;
          const w = computePortWorldPosition(cmp.position, pt.position, cmp.rotation ?? 0, Boolean(cmp.mirror));
          const hit = outAt.find(
            (o) =>
              Math.hypot(o.x - w.x, o.y - w.y) <= 1 &&
              !cmp.ports.some((q) => signalOutPortToBlockId.get(q.id) === o.block),
          );
          if (hit) signalPortSourceMap.set(pt.id, hit.block);
        }
      }
    }

    // Bundle taps: `tap` sits on the vector net, `in` feeds the consumer. Index 1/2/3 selects phase A/B/C.
    {
      const assignments = new Map<string, string>();
      for (const cmp of mod.components) {
        if (!cmp.definitionName.toLowerCase().endsWith(":datatap")) continue;
        const tapPort = cmp.ports.find((pt) => pt.name === "tap");
        const inPort = cmp.ports.find((pt) => pt.name === "in");
        const src = tapPort ? signalPortSourceMap.get(tapPort.id) : undefined;
        const suffix = PHASE_SUFFIX[Number(cmp.parameters["Index"] ?? 0) - 1];
        if (!inPort || !src || !suffix) continue;
        for (let wi = 0; wi < mod.wires.length; wi++) {
          if (!netPorts[wi]!.includes(inPort.id)) continue;
          for (const pId of netPorts[wi]!) {
            if (pId !== inPort.id && !pId.endsWith("_tap") && signalPortIds.has(pId))
              assignments.set(pId, `${src}_phase${suffix}`);
          }
        }
      }
      for (const [pId, s] of assignments) signalPortSourceMap.set(pId, s);
    }

    function getOrCreateBus(portId?: string, defaultPrefix = "Node"): string {
      if (portId && portToBusMap.has(portId)) {
        return portToBusMap.get(portId)!;
      }
      const virtualBusId = qualifyId(`${defaultPrefix}_${virtualBusCounter++}`);
      buses.set(virtualBusId, {
        id: virtualBusId,
        name: virtualBusId,
        baseKv: 230.0,
        phaseCount: 3,
        connectedBranchIds: [],
      });
      if (portId) {
        portToBusMap.set(portId, virtualBusId);
      }
      return virtualBusId;
    }

    // 2. Classify components into sub-module instances, electrical elements, and CSMF control blocks
    for (const cmp of mod.components) {
      if (cmp.disabled) {
        continue;
      }
      const rawDefn = cmp.definitionName;
      const cleanDefn = rawDefn.includes(":") ? rawDefn.split(":").pop()! : rawDefn;
      const defn = rawDefn.toLowerCase();
      const lowerClean = cleanDefn.toLowerCase();
      const p = resolveParamBag(cmp.parameters, scope);
      const qCmpId = qualifyId(cmp.id);
      const qInstName = qualifyId(localName(cmp));

      // Check if component is a hierarchical sub-module instance in project.subModules
      const subMod = resolveSubModule(project, rawDefn);
      if (subMod && !visitedDefs.has(subMod.name)) {
        const subBoundaryMap = new Map<string, string>();
        for (let idx = 0; idx < cmp.ports.length; idx++) {
          const pt = cmp.ports[idx]!;
          if (pt.kind === "signal") continue;
          const connectedParentBus = getOrCreateBus(pt.id, `${cmp.instanceName}_${pt.name}`);
          subBoundaryMap.set(pt.name, connectedParentBus);
          subBoundaryMap.set(pt.name.toLowerCase(), connectedParentBus);
          // Also map by positional bus index if the sub-module bus has the same port name or order
          if (idx < subMod.buses.length) {
            const subBus = subMod.buses[idx]!;
            if (
              subBus.name.toLowerCase() === pt.name.toLowerCase() ||
              subBus.id.toLowerCase() === pt.name.toLowerCase()
            ) {
              subBoundaryMap.set(subBus.id, connectedParentBus);
            }
          }
        }
        const nextVisited = new Set(visitedDefs);
        nextVisited.add(subMod.name);
        // Child scope: definition defaults first, then instance overrides evaluated in the parent scope.
        const childScope: ParamScope = new Map();
        for (const [k, v] of Object.entries(subMod.parameterDefaults ?? {})) {
          const n = evalParamExpr(v, childScope);
          if (n !== undefined) childScope.set(k, n);
        }
        for (const [k, v] of Object.entries(cmp.parameters)) {
          const n = evalParamExpr(v, scope);
          if (n !== undefined) childScope.set(k, n);
        }
        processModule(subMod, qInstName, subBoundaryMap, nextVisited, childScope);
        continue;
      }

      if (defn.includes("xfmr") || defn.includes("transformer")) {
        const p1 = cmp.ports[0]?.id;
        const p2 = cmp.ports[1]?.id;
        const bus1 = getOrCreateBus(p1, `${cmp.instanceName}_P`);
        const bus2 = getOrCreateBus(p2, `${cmp.instanceName}_S`);

        const mva = parseFloat(String(p["MVA"] ?? p["mva"] ?? "100.0"));
        const v1 = parseFloat(String(p["V1"] ?? p["v1"] ?? p["Vpri"] ?? "16.5"));
        const v2 = parseFloat(String(p["V2"] ?? p["v2"] ?? p["Vsec"] ?? "230.0"));
        const x = parseFloat(String(p["X"] ?? p["x"] ?? p["leakage"] ?? "0.08"));

        const connRaw = String(p["Connection"] ?? p["connection"] ?? p["winding"] ?? p["vector_group"] ?? "").trim();
        let windingConnection: "Yg-Yg" | "Yg-D" | "D-Yg" | "D-D" = "Yg-Yg";
        if (connRaw === "Yg-D" || connRaw === "Y-D" || connRaw.toLowerCase().startsWith("ynd")) {
          windingConnection = "Yg-D";
        } else if (connRaw === "D-Yg" || connRaw === "D-Y" || connRaw.toLowerCase().startsWith("dyn")) {
          windingConnection = "D-Yg";
        } else if (connRaw === "D-D" || connRaw.toLowerCase().startsWith("dd")) {
          windingConnection = "D-D";
        } else if (p["YD1"] !== undefined || p["YD2"] !== undefined) {
          const yd1 = String(p["YD1"] ?? "0").toLowerCase();
          const yd2 = String(p["YD2"] ?? "0").toLowerCase();
          const isD1 = yd1 === "1" || yd1.startsWith("d");
          const isD2 = yd2 === "1" || yd2.startsWith("d");
          windingConnection = isD1 && isD2 ? "D-D" : isD1 ? "D-Yg" : isD2 ? "Yg-D" : "Yg-Yg";
        }

        // Saturation & Hysteresis Core Modeling
        const satRaw = String(p["Saturation"] ?? p["saturation"] ?? p["Sat"] ?? p["sat"] ?? p["Enab"] ?? "0").trim();
        const isSaturable =
          satRaw === "1" ||
          satRaw.toLowerCase() === "true" ||
          defn.includes("sat") ||
          p["Hysteresis"] !== undefined ||
          p["hysteresis"] !== undefined ||
          p["CoreModel"] !== undefined ||
          p["core_model"] !== undefined;

        let coreModel: "PIECEWISE_LINEAR" | "JILES_ATHERTON" | undefined = undefined;
        let lUnsatH: number | undefined = undefined;
        let lSatH: number | undefined = undefined;
        let kneeFluxWb: number | undefined = undefined;
        let remanentFluxWb: number | undefined = undefined;
        let jaParams: any = undefined;

        if (isSaturable) {
          const cmRaw = String(
            p["CoreModel"] ?? p["core_model"] ?? p["Hysteresis"] ?? p["hysteresis"] ?? p["Hys"] ?? "",
          )
            .trim()
            .toLowerCase();
          coreModel =
            cmRaw === "ja" || cmRaw.includes("jiles") || cmRaw === "1" || cmRaw === "true"
              ? "JILES_ATHERTON"
              : "PIECEWISE_LINEAR";

          const lUnsat = parseFloat(String(p["L_unsat"] ?? p["Lunsat"] ?? p["lUnsatH"] ?? "500.0"));
          const lSat = parseFloat(String(p["L_sat"] ?? p["Lsat"] ?? p["lSatH"] ?? "10.0"));
          const knee = parseFloat(String(p["knee_flux"] ?? p["kneeFlux"] ?? p["Vknee"] ?? "800.0"));
          const rem = parseFloat(String(p["remanence"] ?? p["Remanence"] ?? p["remanentFlux"] ?? p["Br"] ?? "0.0"));

          lUnsatH = isNaN(lUnsat) ? 500.0 : lUnsat;
          lSatH = isNaN(lSat) ? 10.0 : lSat;
          kneeFluxWb = isNaN(knee) ? 800.0 : knee;
          remanentFluxWb = isNaN(rem) ? 0.0 : rem;

          if (coreModel === "JILES_ATHERTON") {
            const ms = parseFloat(String(p["Ms"] ?? p["ms"] ?? "1.6e6"));
            const a = parseFloat(String(p["a"] ?? p["A"] ?? "1100.0"));
            const alpha = parseFloat(String(p["alpha"] ?? p["Alpha"] ?? "1.6e-3"));
            const k = parseFloat(String(p["k"] ?? p["K"] ?? "400.0"));
            const c = parseFloat(String(p["c"] ?? p["C"] ?? "0.2"));
            const area = parseFloat(String(p["coreAreaM2"] ?? p["core_area"] ?? p["Area"] ?? "0.5"));
            const length = parseFloat(String(p["magneticLengthM"] ?? p["mag_len"] ?? p["Length"] ?? "3.0"));
            const turns = parseFloat(String(p["primaryTurns"] ?? p["turns"] ?? p["N1"] ?? "500"));

            jaParams = {
              ms: isNaN(ms) ? 1.6e6 : ms,
              a: isNaN(a) ? 1100.0 : a,
              alpha: isNaN(alpha) ? 1.6e-3 : alpha,
              k: isNaN(k) ? 400.0 : k,
              c: isNaN(c) ? 0.2 : c,
              coreAreaM2: isNaN(area) ? 0.5 : area,
              magneticLengthM: isNaN(length) ? 3.0 : length,
              primaryTurns: isNaN(turns) ? 500 : Math.round(turns),
            };
          }
        }

        const xfmr: EmtTransformer = {
          id: qCmpId,
          fromBus: bus1,
          toBus: bus2,
          mvaRating: isNaN(mva) ? 100.0 : mva,
          primaryKv: isNaN(v1) ? 16.5 : v1,
          secondaryKv: isNaN(v2) ? 230.0 : v2,
          leakageReactancePu: isNaN(x) ? 0.08 : x,
          windingConnection,
          ...(isSaturable ? { saturation: true, coreModel, lUnsatH, lSatH, kneeFluxWb, remanentFluxWb, jaParams } : {}),
        };
        transformers.push(xfmr);

        buses.get(bus1)?.connectedBranchIds.push(qCmpId);
        buses.get(bus2)?.connectedBranchIds.push(qCmpId);
      } else if (defn.includes("tline") || defn.includes("cable") || defn.includes("line")) {
        const p1 = cmp.ports[0]?.id;
        const p2 = cmp.ports[1]?.id;
        const bus1 = getOrCreateBus(p1, `${cmp.instanceName}_From`);
        const bus2 = getOrCreateBus(p2, `${cmp.instanceName}_To`);

        const isCable = defn.includes("cable");
        const len = parseFloat(String(p["length"] ?? p["Length"] ?? p["Len"] ?? "50.0"));
        const coreRadiusM = parseFloat(String(p["core_radius"] ?? p["r_core"] ?? p["r1"] ?? "0.020"));
        const insRadiusM = parseFloat(String(p["insulation_radius"] ?? p["r_ins"] ?? p["r2"] ?? "0.045"));
        const epsR = parseFloat(String(p["eps_r"] ?? p["insulation_eps_r"] ?? "2.3"));
        const depthM = parseFloat(String(p["depth"] ?? p["burial_depth"] ?? "1.2"));
        const rhoSoil = parseFloat(String(p["rho_soil"] ?? p["soil_resistivity"] ?? "100.0"));

        const r1 = !isNaN(coreRadiusM) && coreRadiusM > 0 ? coreRadiusM : 0.02;
        const r2 = !isNaN(insRadiusM) && insRadiusM > r1 ? insRadiusM : Math.max(r1 * 2.0, 0.045);
        const er = !isNaN(epsR) && epsR >= 1.0 ? epsR : 2.3;

        const defaultCableR = (1.724e-8 / (Math.PI * r1 * r1)) * 1000.0 * 1.15;
        const defaultCableL = ((4 * Math.PI * 1e-7) / (2 * Math.PI)) * Math.log(r2 / r1) * 1000.0;
        const defaultCableC = ((2 * Math.PI * 8.854187817e-12 * er) / Math.log(r2 / r1)) * 1000.0;

        const r = parseFloat(String(p["R"] ?? p["r"] ?? p["r_per_km"] ?? (isCable ? defaultCableR : 0.03)));
        const l = parseFloat(String(p["L"] ?? p["l"] ?? p["l_per_km"] ?? (isCable ? defaultCableL : 0.001)));
        const c = parseFloat(String(p["C"] ?? p["c"] ?? p["c_per_km"] ?? (isCable ? defaultCableC : 1.1e-8)));
        const rawModel = String(p["model"] ?? p["modelType"] ?? p["model_type"] ?? "bergeron").toLowerCase();
        const modelType = rawModel === "fdpm" || rawModel === "fd" ? "fdpm" : rawModel === "pi" ? "pi" : "bergeron";

        const line: EmtTransmissionLine = {
          id: qCmpId,
          fromBus: bus1,
          toBus: bus2,
          lengthKm: isNaN(len) ? 50.0 : len,
          rPerKm: isNaN(r) ? (isCable ? defaultCableR : 0.03) : r,
          lPerKm: isNaN(l) ? (isCable ? defaultCableL : 0.001) : l,
          cPerKm: isNaN(c) ? (isCable ? defaultCableC : 1.1e-8) : c,
          modelType,
          isCable: isCable || undefined,
          coreRadiusM: isCable ? r1 : undefined,
          insulationRadiusM: isCable ? r2 : undefined,
          insulationEpsR: isCable ? er : undefined,
          burialDepthM: isCable && !isNaN(depthM) ? depthM : undefined,
          soilResistivityOhmM: isCable && !isNaN(rhoSoil) ? rhoSoil : undefined,
        };
        transmissionLines.push(line);

        buses.get(bus1)?.connectedBranchIds.push(qCmpId);
        buses.get(bus2)?.connectedBranchIds.push(qCmpId);
      } else if (lowerClean === "arrester" || lowerClean === "mov" || defn.includes("arrester")) {
        const p1 = cmp.ports[0]?.id;
        const p2 = cmp.ports[1]?.id;
        const bus1 = getOrCreateBus(p1, `${cmp.instanceName}_Bus`);
        const bus2 = cmp.ports.length > 1 ? getOrCreateBus(p2, `${cmp.instanceName}_Gnd`) : "0";
        const vRefKv = parseFloat(String(p["Vref"] ?? p["vref"] ?? p["V_ref"] ?? p["V"] ?? "180.0"));
        surgeArresters.push({
          id: qCmpId,
          fromBus: bus1,
          toBus: bus2,
          vRefKv: isNaN(vRefKv) ? 180.0 : vRefKv,
        });
        buses.get(bus1)?.connectedBranchIds.push(qCmpId);
      } else if (lowerClean === "sync_machine" || defn.includes("sync_machine") || defn.includes("sync_gen")) {
        const p1 = cmp.ports[0]?.id;
        const bus1 = getOrCreateBus(p1, `${cmp.instanceName}_Term`);
        const mva = parseFloat(String(p["MVA"] ?? p["mva"] ?? "250.0"));
        const kv = parseFloat(String(p["V"] ?? p["v"] ?? p["Vbase"] ?? "16.5"));
        const freq = parseFloat(String(p["freq"] ?? p["f"] ?? project.settings.frequencyHz));
        const xd = parseFloat(String(p["Xd"] ?? p["xd"] ?? "1.8"));
        const xq = parseFloat(String(p["Xq"] ?? p["xq"] ?? "1.7"));
        const xdPrime = parseFloat(String(p["Xd_p"] ?? p["xdPrime"] ?? "0.3"));
        const xqPrime = parseFloat(String(p["Xq_p"] ?? p["xqPrime"] ?? "0.55"));
        const xdSub = parseFloat(String(p["Xd_pp"] ?? p["Xd_sub"] ?? p["xdSub"] ?? "0.2"));
        const xqSub = parseFloat(String(p["Xq_pp"] ?? p["Xq_sub"] ?? p["xqSub"] ?? "0.25"));
        const h = parseFloat(String(p["H"] ?? p["h"] ?? "3.5"));
        const d = parseFloat(String(p["D"] ?? p["d"] ?? "2.0"));
        const pm = parseFloat(String(p["Pm"] ?? p["pm"] ?? "0.8"));
        const ef = parseFloat(String(p["Ef"] ?? p["ef"] ?? "1.2"));

        synchronousMachines.push({
          id: qCmpId,
          bus: bus1,
          ratedMva: isNaN(mva) ? 250.0 : mva,
          ratedKvLL: isNaN(kv) ? 16.5 : kv,
          frequencyHz: isNaN(freq) ? project.settings.frequencyHz : freq,
          xd: isNaN(xd) ? undefined : xd,
          xq: isNaN(xq) ? undefined : xq,
          xdPrime: isNaN(xdPrime) ? undefined : xdPrime,
          xqPrime: isNaN(xqPrime) ? undefined : xqPrime,
          xdSub: isNaN(xdSub) ? undefined : xdSub,
          xqSub: isNaN(xqSub) ? undefined : xqSub,
          hInertiaSec: isNaN(h) ? undefined : h,
          dampingPu: isNaN(d) ? undefined : d,
          mechanicalPowerPu: isNaN(pm) ? undefined : pm,
          fieldVoltagePu: isNaN(ef) ? undefined : ef,
        });
        buses.get(bus1)?.connectedBranchIds.push(qCmpId);
      } else if (
        lowerClean === "ind_machine" ||
        lowerClean === "induction_machine" ||
        lowerClean === "dfig" ||
        lowerClean === "wound_rotor" ||
        defn.includes("ind_machine") ||
        defn.includes("induction_machine") ||
        defn.includes("dfig") ||
        defn.includes("wound_rotor")
      ) {
        const p1 = cmp.ports[0]?.id;
        const bus1 = getOrCreateBus(p1, `${cmp.instanceName}_Term`);
        const mva = parseFloat(String(p["Pbase"] ?? p["MVA"] ?? p["mva"] ?? "10.0"));
        const kv = parseFloat(String(p["Vbase"] ?? p["V"] ?? p["v"] ?? "13.8"));
        const freq = parseFloat(String(p["freq"] ?? p["f"] ?? project.settings.frequencyHz));
        const typeRaw = String(
          p["machine_type"] ?? p["type"] ?? (defn.includes("dfig") ? "dfig" : "squirrel_cage"),
        ).toLowerCase();
        const machineType: "squirrel_cage" | "dfig" = typeRaw === "dfig" ? "dfig" : "squirrel_cage";
        const rs = parseFloat(String(p["R1"] ?? p["Rs"] ?? p["rs"] ?? "0.015"));
        const xs = parseFloat(String(p["Xa"] ?? p["Xs"] ?? p["xs"] ?? "0.10"));
        const xm = parseFloat(String(p["Xmd"] ?? p["Xm"] ?? p["xm"] ?? "3.50"));
        const rr = parseFloat(String(p["R2"] ?? p["Rr"] ?? p["rr"] ?? "0.015"));
        const xr = parseFloat(String(p["Xkd1"] ?? p["Xr"] ?? p["xr"] ?? "0.10"));
        const h = parseFloat(String(p["J"] ?? p["H"] ?? p["h"] ?? "1.5"));
        const d = parseFloat(String(p["D"] ?? p["d"] ?? "0.2"));
        const tm = parseFloat(String(p["Tm"] ?? p["tm"] ?? p["T_load"] ?? (machineType === "dfig" ? "-0.6" : "0.6")));
        const slip0 = parseFloat(
          String(p["s0"] ?? p["slip"] ?? p["initial_slip"] ?? (machineType === "dfig" ? "-0.05" : "0.02")),
        );
        const vdr = parseFloat(String(p["Vdr"] ?? p["vdr"] ?? "0"));
        const vqr = parseFloat(String(p["Vqr"] ?? p["vqr"] ?? "0"));
        const rCb = parseFloat(String(p["R_cb"] ?? p["crowbar_r"] ?? "0.15"));
        const iCb = parseFloat(String(p["I_crowbar"] ?? p["crowbar_threshold"] ?? "2.0"));

        inductionMachines.push({
          id: qCmpId,
          bus: bus1,
          ratedMva: isNaN(mva) ? 10.0 : mva,
          ratedKvLL: isNaN(kv) ? 13.8 : kv,
          frequencyHz: isNaN(freq) ? project.settings.frequencyHz : freq,
          machineType,
          rsPu: isNaN(rs) ? undefined : rs,
          xsPu: isNaN(xs) ? undefined : xs,
          xmPu: isNaN(xm) ? undefined : xm,
          rrPu: isNaN(rr) ? undefined : rr,
          xrPu: isNaN(xr) ? undefined : xr,
          hInertiaSec: isNaN(h) ? undefined : h,
          dampingPu: isNaN(d) ? undefined : d,
          mechanicalTorquePu: isNaN(tm) ? undefined : tm,
          initialSlip: isNaN(slip0) ? undefined : slip0,
          vRotorDPu: isNaN(vdr) ? undefined : vdr,
          vRotorQPu: isNaN(vqr) ? undefined : vqr,
          crowbarResistancePu: isNaN(rCb) ? undefined : rCb,
          crowbarTriggerCurrentPu: isNaN(iCb) ? undefined : iCb,
        });
        buses.get(bus1)?.connectedBranchIds.push(qCmpId);
      } else if (
        lowerClean === "tpflt" ||
        lowerClean === "fault" ||
        defn.endsWith(":tpflt") ||
        defn.endsWith(":fault")
      ) {
        const p1 = cmp.ports[0]?.id;
        const bus1 = getOrCreateBus(p1, `${cmp.instanceName}_Bus`);
        const typeStr = String(p["type"] ?? p["fault_type"] ?? p["FaultType"] ?? "3PH").toUpperCase();
        const faultType: EmtFault["faultType"] =
          typeStr === "SLG" || typeStr === "AG"
            ? "SLG"
            : typeStr === "LL" || typeStr === "BC"
              ? "LL"
              : typeStr === "DLG" || typeStr === "BCG"
                ? "DLG"
                : "3PH";
        const startSec = parseFloat(String(p["t_start"] ?? p["TF"] ?? p["start"] ?? "0.1"));
        const durationSec = parseFloat(String(p["duration"] ?? p["DF"] ?? "0.05"));
        const endSecRaw = parseFloat(
          String(
            p["t_end"] ??
              p["end"] ??
              String((isNaN(startSec) ? 0.1 : startSec) + (isNaN(durationSec) ? 0.05 : durationSec)),
          ),
        );
        const rFault = parseFloat(String(p["R"] ?? p["RON"] ?? p["r_fault"] ?? "0.001"));

        faults.push({
          id: qCmpId,
          bus: bus1,
          faultType,
          startSec: isNaN(startSec) ? 0.1 : startSec,
          endSec: isNaN(endSecRaw) ? 0.15 : endSecRaw,
          rFaultOhm: isNaN(rFault) ? 0.001 : rFault,
        });
        buses.get(bus1)?.connectedBranchIds.push(qCmpId);
      } else if (
        lowerClean === "vsc_pwm" ||
        lowerClean === "lcc_6pulse" ||
        lowerClean === "mmc_thevenin" ||
        lowerClean === "mmc" ||
        defn.includes("vsc_pwm") ||
        defn.includes("lcc_6pulse") ||
        defn.includes("mmc")
      ) {
        const p1 = cmp.ports[0]?.id;
        const bus1 = getOrCreateBus(p1, `${cmp.instanceName}_AC`);
        const kind: "vsc_pwm" | "lcc_6pulse" | "mmc_thevenin" = defn.includes("mmc")
          ? "mmc_thevenin"
          : defn.includes("lcc")
            ? "lcc_6pulse"
            : "vsc_pwm";
        const mva = parseFloat(String(p["MVA"] ?? p["mva"] ?? "100.0"));
        const kv = parseFloat(String(p["V"] ?? p["v"] ?? p["Vac"] ?? "230.0"));
        const vdc = parseFloat(String(p["Vdc"] ?? p["vdc"] ?? "400.0"));
        const fc = parseFloat(String(p["f_carrier"] ?? p["fc"] ?? "1980.0"));
        const alpha = parseFloat(String(p["alpha_deg"] ?? p["alpha"] ?? "15.0"));
        const nSm = parseInt(String(p["N_sm"] ?? p["num_submodules"] ?? p["numSubmodulesPerArm"] ?? "32"), 10);
        const cSm = parseFloat(String(p["C_sm"] ?? p["submoduleCapacitanceF"] ?? "0.01"));
        const lArm = parseFloat(String(p["L_arm"] ?? p["armInductanceH"] ?? "0.01"));

        converterBridges.push({
          id: qCmpId,
          acBus: bus1,
          kind,
          ratedMva: isNaN(mva) ? 100.0 : mva,
          ratedKvLL: isNaN(kv) ? 230.0 : kv,
          vDcNominalKv: isNaN(vdc) ? undefined : vdc,
          carrierFreqHz: isNaN(fc) ? undefined : fc,
          firingAngleDeg: isNaN(alpha) ? undefined : alpha,
          numSubmodulesPerArm: kind === "mmc_thevenin" && !isNaN(nSm) ? nSm : undefined,
          submoduleCapacitanceF: kind === "mmc_thevenin" && !isNaN(cSm) ? cSm : undefined,
          armInductanceH: kind === "mmc_thevenin" && !isNaN(lArm) ? lArm : undefined,
        });
        buses.get(bus1)?.connectedBranchIds.push(qCmpId);
      } else if (defn.includes("fmu") || defn.includes("inverter") || defn.includes("ibr")) {
        const p1 = cmp.ports[0]?.id;
        const bus1 = getOrCreateBus(p1, `${cmp.instanceName}_POI`);
        const fmuPath = String(p["fmu_path"] ?? p["source"] ?? "inverter.fmu");
        const mva = parseFloat(String(p["MVA"] ?? p["rated_mva"] ?? "100.0"));
        const kv = parseFloat(String(p["V"] ?? p["rated_kv"] ?? "0.69"));
        const modeStr = String(p["control_mode"] ?? p["controlMode"] ?? "grid_following").toLowerCase();

        const fmu: EmtFmuInstance = {
          id: qCmpId,
          name: qInstName || `FMU_${qCmpId}`,
          busConnection: bus1,
          fmuPath,
          ratedMva: isNaN(mva) ? 100.0 : mva,
          ratedKv: isNaN(kv) ? 0.69 : kv,
          controlMode: modeStr === "grid_forming" ? "grid_forming" : "grid_following",
        };
        fmuInstances.push(fmu);
      } else if (lowerClean === "src_ccin_1" || defn.includes("src_ccin_1")) {
        const p1 = cmp.ports[0]?.id;
        const bus1 = getOrCreateBus(p1, `${cmp.instanceName}_Bus`);
        const cntrl = parseInt(String(p["Cntrl"] ?? "0"), 10);
        const vmRaw = parseFloat(String(p["Vm"] ?? "0"));
        const freq = parseFloat(String(p["f"] ?? p["freq"] ?? "0"));
        const phaseDeg = parseFloat(String(p["Ph"] ?? p["phase"] ?? "0"));
        const isDc =
          freq === 0 ||
          String(p["Vm"] ?? "")
            .toLowerCase()
            .includes("dc");
        // When Cntrl=1, current is modulated by an external control signal (defaults to 0 if unwired to prevent runaway voltage)
        const iPeak = cntrl === 1 ? 0.0 : isNaN(vmRaw) ? 0.0 : vmRaw;

        currentSources.push({
          id: qCmpId,
          name: qInstName || `CurrentSource_${qCmpId}`,
          bus: bus1,
          iPeakA: iPeak * 1000.0,
          frequencyHz: isDc ? 0 : freq,
          phaseRad: (phaseDeg * Math.PI) / 180,
          parallelConductance: 0.1, // 10 ohm parallel conductance to ensure passive stability
        });
        buses.get(bus1)?.connectedBranchIds.push(qCmpId);
      } else if (lowerClean === "battery" || defn.includes("battery")) {
        const p1 = cmp.ports[0]?.id;
        const bus1 = getOrCreateBus(p1, `${cmp.instanceName}_Bus`);
        const enomRaw = parseFloat(String(p["Enom"] ?? p["Vnom"] ?? p["V"] ?? "0.4"));
        const enomStr = String(p["Enom"] ?? p["Vnom"] ?? "");
        const enomKv = enomStr.includes("[kV]") || enomRaw < 5.0 ? enomRaw : enomRaw / 1000.0;
        const qAh = parseFloat(String(p["Qrated"] ?? p["CapAh"] ?? "100.0"));
        const socInt = parseFloat(String(p["SOCint"] ?? p["SoC0"] ?? "50.0"));
        const soc = socInt > 1.0 ? socInt / 100.0 : socInt;
        const rLoss = parseFloat(String(p["loss"] ?? p["R0"] ?? "0.005"));
        const mva = (enomKv * qAh) / 1000.0;

        sources.push({
          id: qCmpId,
          name: qInstName || `Battery_${qCmpId}`,
          bus: bus1,
          vPeakKv: isNaN(enomKv) ? 0.4 : enomKv * (0.95 + 0.1 * soc),
          dc: true,
          frequencyHz: 0,
          phaseRad: 0,
          mvaRating: isNaN(mva) || mva <= 0 ? 1.0 : mva,
          rSourceOhm: Math.max(0.001, isNaN(rLoss) ? 0.005 : rLoss),
          rSourceSpecified: true,
        });
        buses.get(bus1)?.connectedBranchIds.push(qCmpId);
      } else if (defn.includes("source") || defn.includes("gen")) {
        const p1 = cmp.ports[0]?.id;
        const bus1 = getOrCreateBus(p1, `${cmp.instanceName}_Bus`);
        const vKv = parseFloat(String(p["V"] ?? p["v"] ?? p["Vbase"] ?? p["kv"] ?? "16.5"));
        const mva = parseFloat(String(p["MVA"] ?? p["mva"] ?? "100.0"));
        const freq = parseFloat(String(p["freq"] ?? p["f"] ?? project.settings.frequencyHz));
        const phaseDeg = parseFloat(String(p["phase"] ?? p["Ph"] ?? "0"));
        const rSrc = parseFloat(String(p["R"] ?? p["r"] ?? "0"));
        const lSrc = parseFloat(String(p["L"] ?? p["l"] ?? "0"));

        const hasV = p["V"] !== undefined || p["v"] !== undefined || p["Vbase"] !== undefined || p["kv"] !== undefined;
        // The evaluator yields SI (V) for "132.79 [kV]" but leaves a unitless "179.63" as written (assumed kV).
        const vmRaw = parseFloat(String(p["Vm"] ?? ""));
        const vmKv = vmRaw >= 1000 ? vmRaw / 1000 : vmRaw;
        const useVm = !hasV && !isNaN(vmKv) && vmKv > 0;
        const isDc = defn.endsWith(":source_1") && p["AC"] !== undefined && Number(p["AC"]) === 0;
        if (useVm) {
          assumptions.push(`Source '${qInstName}' (${rawDefn}): magnitude taken from Vm=${vmKv} (unit assumed kV).`);
        } else if (!hasV) {
          assumptions.push(`Source '${qInstName}' (${rawDefn}) has no recognised voltage parameter; assumed 16.5 kV.`);
        }
        if (isDc) {
          assumptions.push(
            `Source '${qInstName}' (${rawDefn}): AC=0 modelled as a constant DC voltage of Vm; Type, Cntrl and external control inputs are ignored (unverified).`,
          );
        }
        const src: EmtSource = {
          id: qCmpId,
          name: qInstName || `Source_${qCmpId}`,
          bus: bus1,
          vPeakKv: useVm ? vmKv : isNaN(vKv) ? 16.5 : vKv,
          dc: isDc || undefined,
          frequencyHz: isNaN(freq) || freq <= 0 ? project.settings.frequencyHz : freq,
          phaseRad: isNaN(phaseDeg) ? 0 : (phaseDeg * Math.PI) / 180,
          mvaRating: isNaN(mva) || mva <= 0 ? 100.0 : mva,
          rSourceOhm: !isNaN(rSrc) && rSrc > 0 ? rSrc : undefined,
          lSourceH: !isNaN(lSrc) && lSrc > 0 ? lSrc : undefined,
          rSourceSpecified: p["R"] !== undefined || p["r"] !== undefined,
        };
        sources.push(src);
        buses.get(bus1)?.connectedBranchIds.push(qCmpId);
      } else if (defn.endsWith(":fixed_load")) {
        // Constant-impedance load: balanced wye, parallel R and L per phase from the node to ground,
        // sized at nominal PO/QO, VBO (line-to-line) and FR.
        const num = (k: string): number => parseFloat(String(p[k] ?? ""));
        const po = num("PO") * 1e6;
        const qo = num("QO") * 1e6;
        const vb = num("VBO") * 1e3;
        const fr = num("FR");
        const f = isNaN(fr) || fr <= 0 ? project.settings.frequencyHz : fr;
        const bus1 = getOrCreateBus(cmp.ports[0]?.id, `${cmp.instanceName}_1`);
        const addLoadBranch = (suffix: string, r: number, l: number): void => {
          const id = `${qCmpId}_${suffix}`;
          branches.push({
            id,
            kind: "rlc",
            fromBus: bus1,
            toBus: "GND",
            resistanceOhm: r,
            inductanceH: l,
            capacitanceF: 0,
          });
          buses.get(bus1)?.connectedBranchIds.push(id);
        };
        if (!isNaN(po) && !isNaN(vb) && po > 0 && vb > 0) addLoadBranch("R", (vb * vb) / po, 0);
        if (!isNaN(qo) && !isNaN(vb) && qo > 0 && vb > 0) addLoadBranch("L", 0, (vb * vb) / qo / (2 * Math.PI * f));
        assumptions.push(
          isNaN(po) || isNaN(qo) || isNaN(vb)
            ? `'${qInstName}' (fixed_load): PO/QO/VBO did not evaluate to numbers; missing elements omitted.`
            : `'${qInstName}' (fixed_load): constant R||L at nominal PO/QO/VBO/FR; NP, NQ, KPF, KQF and Dtls are ignored (unverified).`,
        );
      } else if (
        defn.includes("resistor") ||
        defn.includes("inductor") ||
        defn.includes("capacitor") ||
        defn.includes("rlc") ||
        defn.endsWith(":current_scaler")
      ) {
        if (defn.endsWith(":current_scaler")) {
          assumptions.push(
            `'${qInstName}' (current_scaler): modelled as a 1 mOhm series connection between its terminals; the current gain G_CDCS is ignored (unverified).`,
          );
        }
        const p1 = cmp.ports[0]?.id;
        const p2 = cmp.ports[1]?.id;
        const bus1 = getOrCreateBus(p1, `${cmp.instanceName}_1`);
        const bus2 = cmp.ports.length > 1 ? getOrCreateBus(p2, `${cmp.instanceName}_2`) : "GND";

        const lRaw = parseFloat(String(p["L"] ?? p["l"] ?? (defn.includes("inductor") ? p["Value"] : "0")));
        const cRaw = parseFloat(String(p["C"] ?? p["c"] ?? (defn.includes("capacitor") ? p["Value"] : "0")));
        const l = isNaN(lRaw) ? 0 : lRaw;
        const c = isNaN(cRaw) ? 0 : cRaw;

        const defaultR = l === 0 && c === 0 ? "0.001" : "0";
        const rRaw = parseFloat(String(p["R"] ?? p["r"] ?? (defn.includes("resistor") ? p["Value"] : defaultR)));
        const r = isNaN(rRaw) ? (l === 0 && c === 0 ? 0.001 : 0) : rRaw;

        const branch: EmtBranch = {
          id: qCmpId,
          kind: "rlc",
          fromBus: bus1,
          toBus: bus2,
          resistanceOhm: r,
          inductanceH: l,
          capacitanceF: c,
        };
        branches.push(branch);
        buses.get(bus1)?.connectedBranchIds.push(qCmpId);
        if (buses.has(bus2)) buses.get(bus2)?.connectedBranchIds.push(qCmpId);
      } else if (defn.endsWith(":abcdq0")) {
        // Park transform, split into one single-output block per axis/phase. The angle is the
        // `Theta` parameter naming a signal (data label) rather than a wired input.
        const inverse = Number(cmp.parameters["IDir"] ?? 1) === 0;
        const srcOf = (name: string): string | undefined => {
          const pt = cmp.ports.find((x) => x.name === name);
          return pt ? signalPortSourceMap.get(pt.id) : undefined;
        };
        const thetaName = String(cmp.parameters["Theta"] ?? "").trim();
        const thetaBlock = thetaName ? labelSignalSource.get(thetaName) : undefined;
        if (!thetaBlock)
          assumptions.push(
            `'${qInstName}' (abcdq0): angle '${thetaName}' is not driven by a known signal; treated as 0.`,
          );
        if (inverse) {
          // dq0 -> abc: p5 = d, abc = q, p6 = zero-sequence.
          const ins = [srcOf("p5") ?? "", srcOf("abc") ?? "", srcOf("p6") ?? "", thetaBlock ?? ""];
          if (!srcOf("p5") || !srcOf("abc"))
            assumptions.push(`'${qInstName}' (abcdq0): d/q input is not driven by a recognised signal; treated as 0.`);
          (["A", "B", "C"] as const).forEach((ph) => {
            controlBlocks.push({
              id: `${qInstName}_phase${ph}`,
              kind: `inv_abcdq0_${ph.toLowerCase()}` as EmtControlBlock["kind"],
              inputs: ins,
              params: {},
            });
          });
        } else {
          // abc -> dq0: p3 = a, abc = b, p4 = c. A single vector driver feeds all three via the abc port.
          const vec = srcOf("abc");
          const a = srcOf("p3");
          const c = srcOf("p4");
          let ins: string[];
          if (a && c && vec) ins = [a, vec, c, thetaBlock ?? ""];
          else {
            ins = [...PHASE_SUFFIX.map((s) => (vec ? `${vec}_phase${s}` : "")), thetaBlock ?? ""];
            if (!vec)
              assumptions.push(
                `'${qInstName}' (abcdq0): abc input is not driven by a recognised signal; treated as 0.`,
              );
          }
          const kinds = ["abcdq0_d", "abcdq0_q", "abcdq0_0"] as const;
          kinds.forEach((kind, i) => {
            controlBlocks.push({
              id: i === 0 ? qInstName : `${qInstName}_${kind.slice(-1)}`,
              kind,
              inputs: ins,
              params: {},
            });
          });
        }
      } else if (defn.endsWith(":voltmeter") || defn.endsWith(":voltmetergnd")) {
        // Measures the node potential against EMT ground; exposes it as a control signal.
        const bus1 = getOrCreateBus(cmp.ports[0]?.id, `${cmp.instanceName}_V`);
        controlBlocks.push({ id: qInstName, kind: "sensor_v", inputs: [], params: {}, sensorTarget: bus1 });
        PHASE_SUFFIX.forEach((s, ph) =>
          controlBlocks.push({
            id: `${qInstName}_phase${s}`,
            kind: "sensor_v",
            inputs: [],
            params: { phase: ph },
            sensorTarget: bus1,
          }),
        );
      } else if (defn.endsWith(":ammeter") || defn.endsWith(":multimeter")) {
        // In-line meter: a near-zero impedance series branch plus a current sensor.
        if (defn.endsWith(":multimeter")) {
          assumptions.push(
            `'${qInstName}' (multimeter): modelled as an ideal in-line meter; P/Q/RMS outputs are not computed (unverified).`,
          );
        }
        const bus1 = getOrCreateBus(cmp.ports[0]?.id, `${cmp.instanceName}_A`);
        const bus2 = getOrCreateBus(cmp.ports[1]?.id, `${cmp.instanceName}_B`);
        branches.push({
          id: qCmpId,
          kind: "rlc",
          fromBus: bus1,
          toBus: bus2,
          resistanceOhm: 1e-4,
          inductanceH: 0,
          capacitanceF: 0,
        });
        buses.get(bus1)?.connectedBranchIds.push(qCmpId);
        buses.get(bus2)?.connectedBranchIds.push(qCmpId);
        controlBlocks.push({ id: qInstName, kind: "sensor_i", inputs: [], params: {}, sensorTarget: qCmpId });
        PHASE_SUFFIX.forEach((s, ph) =>
          controlBlocks.push({
            id: `${qInstName}_phase${s}`,
            kind: "sensor_i",
            inputs: [],
            params: { phase: ph },
            sensorTarget: qCmpId,
          }),
        );
      } else if (defn.includes("breaker") || defn.includes("switch")) {
        const p1 = cmp.ports[0]?.id;
        const p2 = cmp.ports[1]?.id;
        const bus1 = getOrCreateBus(p1, `${cmp.instanceName}_A`);
        const bus2 = getOrCreateBus(p2, `${cmp.instanceName}_B`);

        const statusRaw = String(p["status"] ?? p["Status"] ?? p["state"] ?? "closed").toLowerCase();
        const isOpen = statusRaw === "open" || statusRaw === "0";
        const tOpen = parseFloat(String(p["t_open"] ?? p["open_time"] ?? p["TO"] ?? "NaN"));
        const tClose = parseFloat(String(p["t_close"] ?? p["close_time"] ?? p["TC"] ?? "NaN"));
        const iChop = parseFloat(String(p["chopping_current"] ?? p["IC"] ?? "NaN"));
        const spPhase = parseInt(String(p["single_pole_phase"] ?? "NaN"), 10);

        const branch: EmtBranch = {
          id: qCmpId,
          kind: "switch",
          fromBus: bus1,
          toBus: bus2,
          resistanceOhm: isOpen ? 1e9 : 0.001,
          inductanceH: 0,
          capacitanceF: 0,
          status: isOpen ? "open" : "closed",
          openTimeSec: !isNaN(tOpen) ? tOpen : undefined,
          closeTimeSec: !isNaN(tClose) ? tClose : undefined,
          choppingCurrentAmp: !isNaN(iChop) ? iChop : undefined,
          singlePoleTripPhase: spPhase === 0 || spPhase === 1 || spPhase === 2 ? spPhase : undefined,
        };
        // PSCAD breaker1: NAME is the status signal it listens to; RON/ROFF are the contact resistances.
        const num = (k: string): number => parseFloat(String(p[k] ?? ""));
        const ron = num("RON");
        const roff = num("ROFF");
        if (!isNaN(ron) && ron > 0) branch.rClosedOhm = ron;
        if (!isNaN(roff) && roff > 0) branch.rOpenOhm = roff;
        if (defn.endsWith(":peswitch")) {
          // Corpus: L=D <-> Type=0 (42/42) and L=I|Q <-> Type=3 (22/22). Only the diode is modelled.
          const isDiode = String(p["L"] ?? "").trim() === "D" && Number(p["Type"]) === 0;
          if (isDiode) {
            branch.diode = true;
            // Anode = N2, cathode = N1: with the opposite orientation the half-bridge legs in the corpus
            // short their own source. Inferred from circuit topology, not from vendor documentation.
            branch.fromBus = bus2;
            branch.toBus = bus1;
            assumptions.push(
              `'${qInstName}' (peswitch): modelled as an ideal diode, anode N2 to cathode N1 (terminal polarity inverted for structural loop compatibility; unverified), RON/ROFF from the component; INTR, EFVD, EBO, Erw and the snubber are ignored.`,
            );
          } else {
            assumptions.push(
              `'${qInstName}' (peswitch): Type ${p["Type"]} (L='${p["L"]}') is gate-controlled and is not modelled; held closed.`,
            );
          }
        }
        if (defn.endsWith(":breaker1")) {
          const sigName = String(p["NAME"] ?? "").trim();
          const src = sigName ? labelSignalSource.get(sigName) : undefined;
          const notes: string[] = [];
          if (src) {
            controlBlocks.push({
              id: `${qCmpId}_status`,
              kind: "sum",
              inputs: [src],
              params: {},
              actuator: { type: "breaker_status", targetId: qCmpId },
            });
            notes.push(`status signal '${sigName}' (0 = closed, 1 = open; unverified)`);
          } else {
            notes.push(`status signal '${sigName}' is not driven; held closed`);
          }
          if (!(branch.rClosedOhm !== undefined)) notes.push("RON is 0 or missing; using 0.001 ohm");
          notes.push("TD, TDR, BOpen and CLVL are ignored (instantaneous operation at current zero)");
          assumptions.push(`'${qInstName}' (breaker1): ${notes.join("; ")}.`);
        }
        branches.push(branch);
        if (!isOpen) {
          buses.get(bus1)?.connectedBranchIds.push(qCmpId);
          buses.get(bus2)?.connectedBranchIds.push(qCmpId);
        }
      } else if (defn.endsWith(":datamerge")) {
        // Bundles scalar inputs (top to bottom) into a vector; exposed per phase as identity blocks.
        const ins = cmp.ports
          .filter((pt) => pt.name !== "out")
          .sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x)
          .map((pt) => signalPortSourceMap.get(pt.id) ?? "");
        PHASE_SUFFIX.forEach((s, i) => {
          const input = ins[i] ?? "";
          if (!input) assumptions.push(`'${qInstName}' (datamerge): input ${i + 1} is not driven; treated as 0.`);
          controlBlocks.push({ id: `${qInstName}_phase${s}`, kind: "sum", inputs: [input], params: {} });
        });
      } else if (
        defn.endsWith(":pi_ctlr") ||
        defn.endsWith(":pi") ||
        defn.endsWith(":gain") ||
        defn.endsWith(":sum") ||
        defn.endsWith(":realpole") ||
        defn.endsWith(":lag") ||
        defn.endsWith(":leadlag") ||
        defn.endsWith(":limit") ||
        defn.endsWith(":const") ||
        defn.endsWith(":compar") ||
        defn.endsWith(":mult") ||
        defn.endsWith(":div") ||
        defn.endsWith(":sumjct") ||
        defn.endsWith(":emtconst") ||
        defn.endsWith(":consti") ||
        defn.endsWith(":hardlimit") ||
        defn.endsWith(":unity") ||
        defn.endsWith(":square") ||
        defn.endsWith(":inv") ||
        defn.endsWith(":integral") ||
        defn.endsWith(":fp_int") ||
        defn.endsWith(":select") ||
        defn.endsWith(":upramp") ||
        defn.endsWith(":range") ||
        defn.endsWith(":compare") ||
        defn.endsWith(":maxmin") ||
        defn.endsWith(":x_power_y") ||
        defn.endsWith(":tbreakn") ||
        defn.endsWith(":angle_resolver") ||
        defn.endsWith(":rms3ph") ||
        defn.endsWith(":ratelimit") ||
        defn.endsWith(":xy_transfer_function") ||
        defn.endsWith(":bin_delay") ||
        defn.endsWith(":trans_filt") ||
        defn.endsWith(":time-sig") ||
        defn.endsWith(":trig") ||
        defn.endsWith(":current_scaler") ||
        defn.endsWith(":logic_mult")
      ) {
        const kind: EmtControlBlock["kind"] = defn.endsWith(":tbreakn")
          ? "tbreakn"
          : defn.endsWith(":x_power_y")
            ? "x_power_y"
            : defn.endsWith(":angle_resolver")
              ? "angle_resolver"
              : defn.endsWith(":maxmin")
                ? "maxmin"
                : defn.endsWith(":rms3ph")
                  ? "rms3ph"
                  : defn.endsWith(":compare")
                    ? "compare"
                    : defn.endsWith(":trans_filt")
                      ? "trans_filt"
                      : defn.endsWith(":bin_delay")
                        ? "bin_delay"
                        : defn.endsWith(":range")
                          ? "range"
                          : defn.endsWith(":xy_transfer_function")
                            ? "xy_table"
                            : defn.endsWith(":ratelimit")
                              ? "ratelimit"
                              : defn.endsWith(":logic_mult")
                                ? "logic"
                                : defn.endsWith(":trig")
                                  ? "trig"
                                  : defn.endsWith(":current_scaler")
                                    ? "gain"
                                    : defn.endsWith(":time-sig")
                                      ? "time_sig"
                                      : defn.endsWith(":upramp")
                                        ? "upramp"
                                        : defn.endsWith(":select")
                                          ? "select"
                                          : defn.endsWith(":square")
                                            ? "square"
                                            : defn.endsWith(":inv")
                                              ? "inv"
                                              : defn.endsWith(":integral")
                                                ? "integral"
                                                : defn.endsWith(":fp_int")
                                                  ? "fp_int"
                                                  : defn.endsWith(":hardlimit")
                                                    ? "limit"
                                                    : defn.endsWith(":unity")
                                                      ? "gain"
                                                      : defn.endsWith(":mult")
                                                        ? "mult"
                                                        : defn.endsWith(":div")
                                                          ? "div"
                                                          : defn.endsWith(":sumjct")
                                                            ? "sum"
                                                            : defn.endsWith(":emtconst") || defn.endsWith(":consti")
                                                              ? "const"
                                                              : defn.includes("pi")
                                                                ? "pi"
                                                                : defn.includes("gain")
                                                                  ? "gain"
                                                                  : defn.includes("sum")
                                                                    ? "sum"
                                                                    : defn.includes("leadlag")
                                                                      ? "leadlag"
                                                                      : defn.includes("pole") || defn.includes("lag")
                                                                        ? "lag"
                                                                        : defn.includes("limit")
                                                                          ? "limit"
                                                                          : defn.includes("compar")
                                                                            ? "compar"
                                                                            : "const";
        const params: Record<string, number> = {};
        for (const [k, v] of Object.entries(p)) {
          const num = typeof v === "number" ? v : parseFloat(String(v));
          if (!isNaN(num)) params[k] = num;
        }
        if (kind === "trans_filt") {
          const lowpass =
            params["Band"] === 1 &&
            params["Type"] === 1 &&
            (params["Order"] === 1 || params["Order"] === 2) &&
            (params["FBase"] ?? 0) > 0;
          assumptions.push(
            lowpass
              ? `'${qInstName}' (trans_filt): Order ${params["Order"]} Butterworth low-pass at FBase=${params["FBase"]} Hz, assuming Band=1 is low-pass and Type=1 is Butterworth (unverified); Cnfg, Flow, Fup, Q and PRip are ignored.`
              : `'${qInstName}' (trans_filt): Order=${params["Order"] ?? "?"} Band=${params["Band"] ?? "?"} Type=${params["Type"] ?? "?"} is not supported; the block is a unity pass-through (unverified).`,
          );
        }
        if (kind === "upramp" && (params["X2"] === undefined || params["Y2"] === undefined)) {
          assumptions.push(`'${qInstName}' (upramp): X2/Y2 did not evaluate to numbers; defaulted to 1.`);
        }
        if (kind === "tbreakn") {
          const bad = ["TO1", "TO2"].filter((k) => params[k] === undefined);
          assumptions.push(
            bad.length > 0
              ? `'${qInstName}' (tbreakn): ${bad.join("/")} did not evaluate to a number; defaulted to 0 s. Status 0 = closed, 1 = open (unverified).`
              : `'${qInstName}' (tbreakn): status 0 = closed, 1 = open; INIT=1 starts closed (unverified).`,
          );
        }
        if (kind === "x_power_y") {
          assumptions.push(
            `'${qInstName}' (x_power_y): in^y with y=${params["y"] ?? 1}; negative base ${Number(params["xneg"] ?? 0) === 0 ? "clamped to 0" : "passed to pow"} (unverified).`,
          );
        }
        if (kind === "angle_resolver") {
          const flags = ["IPUnit", "OPUnit", "OPRange"].map((k) => params[k] ?? 0);
          assumptions.push(
            flags.every((f) => f === 0)
              ? `'${qInstName}' (angle_resolver): radians in/out wrapped to [-pi, pi] (unverified).`
              : `'${qInstName}' (angle_resolver): IPUnit/OPUnit/OPRange ${flags.join("/")} not supported; wrapped to [-pi, pi] in radians.`,
          );
        }
        if (kind === "maxmin") {
          assumptions.push(
            `'${qInstName}' (maxmin): Type ${params["Type"] ?? 1} taken as ${params["Type"] === 2 ? "minimum" : "maximum"} over the single wired input; flags A-G ignored (unverified).`,
          );
        }
        if (kind === "rms3ph") {
          assumptions.push(
            `'${qInstName}' (rms3ph): modelled as sqrt(mean square of the 3 phases) through a first-order lag Ts; Type, Scale, NSAM and View ignored (unverified).`,
          );
        }
        if (kind === "compare") {
          assumptions.push(
            params["X"] === undefined
              ? `'${qInstName}' (compare): X did not evaluate to a number; threshold defaulted to 0.`
              : `'${qInstName}' (compare): modelled as OH when input > X, else OL (unverified).`,
          );
        }
        if (kind === "range") {
          const missing = ["XL", "XU", "OL", "OM", "OH"].filter((k) => params[k] === undefined);
          assumptions.push(
            missing.length > 0
              ? `'${qInstName}' (range): ${missing.join("/")} did not evaluate to numbers; defaulted to 0.`
              : `'${qInstName}' (range): modelled as OL below XL, OH above XU, else OM (unverified).`,
          );
        }
        if (kind === "bin_delay") {
          const missing = ["T", "Toff"].filter((k) => params[k] === undefined);
          assumptions.push(
            missing.length > 0
              ? `'${qInstName}' (bin_delay): ${missing.join("/")} did not evaluate to a number; that delay defaulted to 0 s.`
              : `'${qInstName}' (bin_delay): input > 0.5 is on; T delays the rising edge, Toff the falling edge, starting at INITST=${params["INITST"] ?? 0}; the INTR setting is ignored (unverified).`,
          );
        }
        if (kind === "xy_table") {
          const n = Math.trunc(params["N"] ?? 0);
          let ok = 0;
          for (let k = 1; k <= n; k++) if (params[`X${k}`] !== undefined && params[`Y${k}`] !== undefined) ok++;
          const modes = `Mode=${params["Mode"] ?? "?"} Method=${params["Method"] ?? "?"} InType=${params["InType"] ?? "?"} Per=${params["Per"] ?? "?"}`;
          assumptions.push(
            ok < n
              ? `'${qInstName}' (xy_transfer_function): only ${ok} of ${n} X/Y points evaluated to numbers; unevaluated points are skipped.`
              : `'${qInstName}' (xy_transfer_function): piecewise-linear table through ${n} points, end values held outside the range, not periodic; ${modes}, File and the Kx/Ky/Xoff/Yoff order are not interpreted (unverified).`,
          );
        }
        if (kind === "ratelimit") {
          const missing = ["IR", "DR"].filter((k) => params[k] === undefined);
          assumptions.push(
            missing.length > 0
              ? `'${qInstName}' (ratelimit): ${missing.join("/")} did not evaluate to numbers; that direction is unlimited.`
              : `'${qInstName}' (ratelimit): IR/DR taken as rise/fall rate limits per second (unverified).`,
          );
        }
        if (kind === "logic") {
          const t = Math.trunc(params["Type"] ?? 0);
          assumptions.push(
            t >= 0 && t <= 5
              ? `'${qInstName}' (logic_mult): Type ${t} mapped to ${["AND", "OR", "NAND", "NOR", "XOR", "XNOR"][t]} (unverified).`
              : `'${qInstName}' (logic_mult): Type ${t} is not recognised; treated as AND.`,
          );
        }
        if (kind === "trig") {
          const t = Math.trunc(params["Type"] ?? 1);
          if (t !== 1 && t !== 2)
            assumptions.push(`'${qInstName}' (trig): Type ${t} is not supported (only 1 = sin, 2 = cos); output is 0.`);
          else assumptions.push(`'${qInstName}' (trig): Type ${t} mapped to ${t === 1 ? "sin" : "cos"} (unverified).`);
        }
        if (defn.endsWith(":current_scaler")) {
          if (params["G_CDCS"] === undefined) {
            assumptions.push(
              `'${qInstName}' (current_scaler): G_CDCS did not evaluate to a number; gain defaulted to 1.`,
            );
          } else params["K"] = params["G_CDCS"];
          assumptions.push(`'${qInstName}' (current_scaler): modelled as Y = G_CDCS * X with no offset (unverified).`);
        }
        const explicitInputs = String(p["inputs"] ?? "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);

        // If explicit 'inputs' parameter is omitted, resolve upstream block IDs from graphical <Wire> connections
        const wiredInputs: string[] = [];
        if (explicitInputs.length === 0) {
          for (const pt of cmp.ports) {
            if (pt.kind === "signal" && pt.name !== "out") {
              const srcBlock = signalPortSourceMap.get(pt.id);
              if (srcBlock) wiredInputs.push(srcBlock);
            }
          }
        }

        let blockInputs = explicitInputs.length > 0 ? explicitInputs : wiredInputs;
        // A 3-phase vector driver feeds rms3ph through its per-phase signals.
        if (kind === "rms3ph") {
          const vec = blockInputs[0];
          blockInputs = vec ? PHASE_SUFFIX.map((s) => `${vec}_phase${s}`) : [];
          if (!vec)
            assumptions.push(`'${qInstName}' (rms3ph): input is not driven by a recognised signal; treated as 0.`);
        }
        controlBlocks.push({
          id: qInstName,
          kind,
          inputs: blockInputs,
          params,
        });
        if (Number(p["Dim"]) === 3 && ["const", "mult", "div", "sum", "gain", "limit"].includes(kind)) {
          vectorBlocks.push({ id: qInstName, kind, inputs: blockInputs, params });
        }
      } else {
        // Fallback: Check if definition has custom Fortran script segments (<segment name="Fortran"> or "Dsdyn")
        const defGraphic = project.definitions?.get(cleanDefn) ?? project.definitions?.get(rawDefn);
        const fortranSeg = defGraphic?.scriptSegments?.get("fortran") ?? defGraphic?.scriptSegments?.get("dsdyn");
        if (fortranSeg?.content) {
          try {
            const compiled = compileFortranSegment(fortranSeg.content, cmp.parameters);
            const blockInputs: { portName: string; sourceId?: string | undefined }[] = [];
            for (const refPort of compiled.referencedPorts) {
              const pt = cmp.ports.find((p) => p.name.toLowerCase() === refPort.toLowerCase());
              const srcId = pt ? (signalPortSourceMap.get(pt.id) ?? portToBusMap.get(pt.id)) : undefined;
              blockInputs.push({ portName: refPort, sourceId: srcId });
            }
            const blockOutputs: { portName: string; targetId?: string | undefined }[] = [];
            for (const asgPort of compiled.assignedPorts) {
              const targetId = compiled.assignedPorts.length === 1 ? qInstName : `${qInstName}_${asgPort}`;
              blockOutputs.push({ portName: asgPort, targetId });
            }

            customFortranBlocks.push({
              id: qInstName,
              name: localName(cmp),
              referencedPorts: compiled.referencedPorts,
              assignedPorts: compiled.assignedPorts,
              inputs: blockInputs,
              outputs: blockOutputs,
              numRealStates: compiled.numRealStates,
              numIntStates: compiled.numIntStates,
              step: compiled.step,
            });
          } catch {
            assumptions.push(`'${qInstName}' (${cleanDefn}): Custom Fortran script could not be lowered.`);
          }
        }
      }
    }
  }

  processModule(project.rootModule, "", new Map<string, string>(), new Set<string>(["Main"]));

  // Expand Dim=3 vector blocks into per-phase scalar blocks. Inputs follow their own phase signal when
  // one exists, otherwise they broadcast as a scalar.
  {
    const have = new Set(controlBlocks.map((b) => b.id));
    for (const v of vectorBlocks) {
      PHASE_SUFFIX.forEach((s) => {
        controlBlocks.push({
          id: `${v.id}_phase${s}`,
          kind: v.kind,
          inputs: v.inputs.map((i) => (have.has(`${i}_phase${s}`) ? `${i}_phase${s}` : i)),
          params: v.params,
        });
      });
    }
  }

  // Inputs that name a block which does not exist (e.g. per-phase taps of a non-sensor vector driver)
  // evaluate as 0 in the solver; surface them instead of failing silently.
  const knownBlocks = new Set(controlBlocks.map((b) => b.id));
  for (const cb of controlBlocks) {
    if (!cb.kind.startsWith("abcdq0_") || cb.kind !== "abcdq0_d") continue;
    const dangling = cb.inputs.filter((id) => id !== "" && !knownBlocks.has(id));
    if (dangling.length > 0) {
      assumptions.push(`'${cb.id}' (abcdq0): input signal '${dangling[0]}' has no per-phase source; treated as 0.`);
    }
  }

  const saturableTransformers = transformers.filter((x) => x.saturation);

  return {
    buses,
    branches,
    transformers,
    saturableTransformers: saturableTransformers.length > 0 ? saturableTransformers : undefined,
    transmissionLines,
    fmuInstances,
    sources,
    currentSources: currentSources.length > 0 ? currentSources : undefined,
    faults: faults.length > 0 ? faults : undefined,
    surgeArresters: surgeArresters.length > 0 ? surgeArresters : undefined,
    synchronousMachines: synchronousMachines.length > 0 ? synchronousMachines : undefined,
    inductionMachines: inductionMachines.length > 0 ? inductionMachines : undefined,
    converterBridges: converterBridges.length > 0 ? converterBridges : undefined,
    controlBlocks: controlBlocks.length > 0 ? controlBlocks : undefined,
    customFortranBlocks: customFortranBlocks.length > 0 ? customFortranBlocks : undefined,
    assumptions: assumptions.length > 0 ? assumptions : undefined,
    nominalFrequencyHz: project.settings.frequencyHz,
  };
}

/**
 * Converts an extracted PSCAD `EmtNetlist` directly into an `EmtCircuitDefinition`
 * ready for `@modelscript/simulate`'s `EmtSolver`.
 */
export function netlistToEmtCircuit(netlist: EmtNetlist) {
  // 1. Exclude reference ground nodes ("0" and "GND") from the active nodal admittance bus list
  const buses = Array.from(netlist.buses.keys()).filter((b) => b !== "0" && b !== "GND");

  // 2. Map passive RLC branches and circuit breakers/switches
  const rlc = netlist.branches
    .filter((b) => b.kind === "rlc")
    .map((b) => ({
      id: b.id,
      from: b.fromBus,
      to: b.toBus,
      r: b.resistanceOhm,
      l: b.inductanceH,
      c: b.capacitanceF,
    }));

  const breakers = netlist.branches
    .filter((b) => b.kind === "switch")
    .map((b) => ({
      id: b.id,
      from: b.fromBus,
      to: b.toBus,
      closedInitially: b.status !== "open",
      openTimeSec: b.openTimeSec,
      closeTimeSec: b.closeTimeSec,
      choppingCurrentAmp: b.choppingCurrentAmp,
      rClosedOhm: b.rClosedOhm,
      rOpenOhm: b.rOpenOhm,
      diode: b.diode,
      // Convert numeric 0/1/2 phase index into symbolic phase identifier ("A" | "B" | "C")
      singlePoleTripPhase:
        b.singlePoleTripPhase === 0
          ? ("A" as const)
          : b.singlePoleTripPhase === 1
            ? ("B" as const)
            : b.singlePoleTripPhase === 2
              ? ("C" as const)
              : undefined,
    }));

  // 3. Map two-winding transformers, saturable transformers, distributed-parameter lines/cables, and FMU interfaces
  const linearTransformers: {
    id: string;
    primaryBus: string;
    secondaryBus: string;
    mvaRating: number;
    primaryKv: number;
    secondaryKv: number;
    leakageReactancePu: number;
    windingConnection: "Yg-Yg" | "Yg-D" | "D-Yg" | "D-D";
  }[] = [];

  const saturableTransformers: any[] = [];

  for (const x of netlist.transformers) {
    if (x.saturation) {
      saturableTransformers.push({
        id: x.id,
        primaryBus: x.fromBus,
        secondaryBus: x.toBus,
        ratedMva: x.mvaRating,
        primaryKv: x.primaryKv,
        secondaryKv: x.secondaryKv,
        leakageReactancePu: x.leakageReactancePu,
        coreModel: x.coreModel ?? "PIECEWISE_LINEAR",
        lUnsatH: x.lUnsatH,
        lSatH: x.lSatH,
        kneeFluxWb: x.kneeFluxWb,
        remanentFluxWb: x.remanentFluxWb,
        jaParams: x.jaParams,
      });
    } else {
      linearTransformers.push({
        id: x.id,
        primaryBus: x.fromBus,
        secondaryBus: x.toBus,
        mvaRating: x.mvaRating,
        primaryKv: x.primaryKv,
        secondaryKv: x.secondaryKv,
        leakageReactancePu: x.leakageReactancePu,
        windingConnection: x.windingConnection,
      });
    }
  }

  const transmissionLines = netlist.transmissionLines.map((l) => ({
    id: l.id,
    from: l.fromBus,
    to: l.toBus,
    lengthKm: l.lengthKm,
    rPerKm: l.rPerKm,
    lPerKm: l.lPerKm,
    cPerKm: l.cPerKm,
    modelType: l.modelType,
    isCable: l.isCable,
    coreRadiusM: l.coreRadiusM,
    insulationRadiusM: l.insulationRadiusM,
    insulationEpsR: l.insulationEpsR,
    burialDepthM: l.burialDepthM,
    soilResistivityOhmM: l.soilResistivityOhmM,
  }));

  const fmuInstances = netlist.fmuInstances.map((f) => ({
    id: f.id,
    bus: f.busConnection,
    ratedMva: f.ratedMva,
    ratedKv: f.ratedKv,
  }));

  // 4. Map Thevenin/ideal AC voltage sources, timed faults, and nonlinear MOV surge arresters
  const sources = netlist.sources.map((s) => ({
    id: s.id,
    bus: s.bus,
    vPeakKv: s.vPeakKv,
    freqHz: s.frequencyHz,
    phaseRad: s.phaseRad,
    rSource: s.rSourceOhm,
    dc: s.dc,
  }));

  const currentSources = netlist.currentSources?.map((s) => {
    if (s.parallelConductance && s.parallelConductance > 0) {
      rlc.push({
        id: `${s.id}_shunt`,
        from: s.bus,
        to: "0",
        r: 1.0 / s.parallelConductance,
        l: 0,
        c: 0,
      });
    }
    return {
      id: s.id,
      bus: s.bus,
      iPeakA: s.iPeakA ?? 0,
      freqHz: s.frequencyHz ?? 0,
      phaseRad: s.phaseRad ?? 0,
    };
  });

  const faults = netlist.faults?.map((f) => ({
    id: f.id,
    bus: f.bus,
    faultType: f.faultType,
    startSec: f.startSec,
    endSec: f.endSec,
    durationSec: Math.max(0, f.endSec - f.startSec),
    rFaultOhm: f.rFaultOhm,
    faultResistanceOhm: f.rFaultOhm,
  }));

  const surgeArresters = netlist.surgeArresters?.map((arr) => ({
    id: arr.id,
    bus: arr.fromBus,
    fromBus: arr.fromBus,
    toBus: arr.toBus,
    ratedKv: arr.vRefKv,
    protectionLevelKv: arr.vRefKv,
    vRefKv: arr.vRefKv,
  }));

  // 5. Map rotating machines (Park dq0 synchronous & induction machines) and power-electronic converters
  const synchronousMachines = netlist.synchronousMachines?.map((sm) => ({
    id: sm.id,
    bus: sm.bus,
    ratedMva: sm.ratedMva,
    ratedKv: sm.ratedKvLL,
    ratedKvLL: sm.ratedKvLL,
    freqHz: sm.frequencyHz,
    frequencyHz: sm.frequencyHz,
    xd: sm.xd,
    xq: sm.xq,
    xdPrime: sm.xdPrime,
    xqPrime: sm.xqPrime,
    xdSub: sm.xdSub,
    xqSub: sm.xqSub,
    xdDoublePrime: sm.xdSub,
    xqDoublePrime: sm.xqSub,
    inertiaConstantH: sm.hInertiaSec,
    hInertiaSec: sm.hInertiaSec,
    dampingD: sm.dampingPu,
    dampingPu: sm.dampingPu,
    mechanicalPowerPu: sm.mechanicalPowerPu,
    fieldVoltagePu: sm.fieldVoltagePu,
  }));

  const inductionMachines = netlist.inductionMachines?.map((im) => ({
    id: im.id,
    bus: im.bus,
    ratedMva: im.ratedMva,
    ratedKv: im.ratedKvLL,
    ratedKvLL: im.ratedKvLL,
    nominalFreqHz: im.frequencyHz,
    machineType: im.machineType,
    rsPu: im.rsPu,
    xsPu: im.xsPu,
    xmPu: im.xmPu,
    rrPu: im.rrPu,
    xrPu: im.xrPu,
    inertiaConstantH: im.hInertiaSec,
    dampingD: im.dampingPu,
    mechanicalTorquePu: im.mechanicalTorquePu,
    initialSlip: im.initialSlip,
    vRotorDPu: im.vRotorDPu,
    vRotorQPu: im.vRotorQPu,
    crowbarResistancePu: im.crowbarResistancePu,
    crowbarTriggerCurrentPu: im.crowbarTriggerCurrentPu,
  }));

  const converterBridges = netlist.converterBridges?.map((cb) => ({
    id: cb.id,
    bus: cb.acBus,
    acBus: cb.acBus,
    topology: cb.kind,
    kind: cb.kind,
    ratedKv: cb.ratedKvLL,
    ratedKvLL: cb.ratedKvLL,
    ratedMva: cb.ratedMva,
    dcLinkKv: cb.vDcNominalKv,
    vDcNominalKv: cb.vDcNominalKv,
    carrierFreqHz: cb.carrierFreqHz,
    firingAngleDeg: cb.firingAngleDeg,
    numSubmodulesPerArm: cb.numSubmodulesPerArm,
    submoduleCapacitanceF: cb.submoduleCapacitanceF,
    armInductanceH: cb.armInductanceH,
  }));

  // 6. Map Continuous System Modeling Functions (CSMF) signal-flow control blocks
  const csmfBlocks = netlist.controlBlocks?.map((cb) => ({
    id: cb.id,
    kind: cb.kind,
    inputs: cb.inputs,
    params: cb.params,
    ...(cb.sensorTarget !== undefined ? { sensorTarget: cb.sensorTarget } : {}),
    ...(cb.actuator !== undefined ? { actuator: cb.actuator } : {}),
  }));

  // 7. Map custom procedural Fortran blocks
  const customFortranBlocks = netlist.customFortranBlocks?.map((fb) => ({
    id: fb.id,
    name: fb.name,
    referencedPorts: fb.referencedPorts,
    assignedPorts: fb.assignedPorts,
    numRealStates: fb.numRealStates,
    numIntStates: fb.numIntStates,
    inputs: fb.inputs,
    outputs: fb.outputs,
    step: fb.step,
  }));

  return {
    buses,
    rlc,
    breakers: breakers.length > 0 ? breakers : undefined,
    transformers: linearTransformers.length > 0 ? linearTransformers : undefined,
    saturableTransformers: saturableTransformers.length > 0 ? saturableTransformers : undefined,
    transmissionLines: transmissionLines.length > 0 ? transmissionLines : undefined,
    fmuInstances: fmuInstances.length > 0 ? fmuInstances : undefined,
    sources: sources.length > 0 ? sources : undefined,
    currentSources: currentSources && currentSources.length > 0 ? currentSources : undefined,
    faults: faults && faults.length > 0 ? faults : undefined,
    surgeArresters: surgeArresters && surgeArresters.length > 0 ? surgeArresters : undefined,
    synchronousMachines: synchronousMachines && synchronousMachines.length > 0 ? synchronousMachines : undefined,
    inductionMachines: inductionMachines && inductionMachines.length > 0 ? inductionMachines : undefined,
    converterBridges: converterBridges && converterBridges.length > 0 ? converterBridges : undefined,
    csmfBlocks: csmfBlocks && csmfBlocks.length > 0 ? csmfBlocks : undefined,
    customFortranBlocks: customFortranBlocks && customFortranBlocks.length > 0 ? customFortranBlocks : undefined,
  };
}
