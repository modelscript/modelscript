// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Extracts a structured EmtNetlist from a parsed PscxProject.
 *
 * Resolves connectivity across buses, components, and wires into
 * electrical branches ready for the Dommel companion solver.
 */

import type {
  EmtBranch,
  EmtBus,
  EmtControlBlock,
  EmtConverterBridge,
  EmtFault,
  EmtFmuInstance,
  EmtInductionMachine,
  EmtNetlist,
  EmtSource,
  EmtSurgeArrester,
  EmtSynchronousMachine,
  EmtTransformer,
  EmtTransmissionLine,
  PscxModule,
  PscxProject,
} from "../types.js";

/**
 * Extracts a structured `EmtNetlist` from a parsed `PscxProject`, recursively flattening
 * hierarchical sub-modules, snapping geometric wire/ground pins, and classifying electrical
 * and CSMF control components.
 */
export function extractEmtNetlist(project: PscxProject): EmtNetlist {
  const buses = new Map<string, EmtBus>();
  const branches: EmtBranch[] = [];
  const transformers: EmtTransformer[] = [];
  const transmissionLines: EmtTransmissionLine[] = [];
  const fmuInstances: EmtFmuInstance[] = [];
  const sources: EmtSource[] = [];
  const faults: EmtFault[] = [];
  const surgeArresters: EmtSurgeArrester[] = [];
  const synchronousMachines: EmtSynchronousMachine[] = [];
  const inductionMachines: EmtInductionMachine[] = [];
  const converterBridges: EmtConverterBridge[] = [];
  const controlBlocks: EmtControlBlock[] = [];
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
  ): void {
    const qualifyId = (id: string): string => (prefix ? `${prefix}_${id}` : id);

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
      for (const port of cmp.ports) {
        if (port.kind === "signal") {
          signalPortIds.add(port.id);
          if (port.name === "out") {
            signalOutPortToBlockId.set(port.id, qualifyId(cmp.instanceName || cmp.id));
          }
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

    for (const wire of mod.wires) {
      if (wire.connectedPortIds.length === 0) continue;

      // Resolve CSMF signal wires
      const connectedSignalOut = wire.connectedPortIds.find((id) => signalOutPortToBlockId.has(id));
      if (connectedSignalOut) {
        const srcBlockId = signalOutPortToBlockId.get(connectedSignalOut)!;
        for (const pId of wire.connectedPortIds) {
          if (pId !== connectedSignalOut && signalPortIds.has(pId)) {
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
        const connectedSignalOut = portList.find((id) => signalOutPortToBlockId.has(id));
        if (connectedSignalOut) {
          const srcBlockId = signalOutPortToBlockId.get(connectedSignalOut)!;
          for (const pId of portList) {
            if (pId !== connectedSignalOut && signalPortIds.has(pId)) {
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
      const rawDefn = cmp.definitionName;
      const cleanDefn = rawDefn.includes(":") ? rawDefn.split(":").pop()! : rawDefn;
      const defn = rawDefn.toLowerCase();
      const lowerClean = cleanDefn.toLowerCase();
      const p = cmp.parameters;
      const qCmpId = qualifyId(cmp.id);
      const qInstName = qualifyId(cmp.instanceName || cmp.id);

      // Check if component is a hierarchical sub-module instance in project.subModules
      const subMod = project.subModules.get(cleanDefn) ?? project.subModules.get(rawDefn);
      if (subMod && !visitedDefs.has(subMod.name)) {
        const subBoundaryMap = new Map<string, string>();
        for (let idx = 0; idx < cmp.ports.length; idx++) {
          const pt = cmp.ports[idx]!;
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
        processModule(subMod, qInstName, subBoundaryMap, nextVisited);
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

        const xfmr: EmtTransformer = {
          id: qCmpId,
          fromBus: bus1,
          toBus: bus2,
          mvaRating: isNaN(mva) ? 100.0 : mva,
          primaryKv: isNaN(v1) ? 16.5 : v1,
          secondaryKv: isNaN(v2) ? 230.0 : v2,
          leakageReactancePu: isNaN(x) ? 0.08 : x,
          windingConnection,
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
        defn.includes("ind_machine") ||
        defn.includes("induction_machine") ||
        defn.includes("dfig")
      ) {
        const p1 = cmp.ports[0]?.id;
        const bus1 = getOrCreateBus(p1, `${cmp.instanceName}_Term`);
        const mva = parseFloat(String(p["MVA"] ?? p["mva"] ?? "10.0"));
        const kv = parseFloat(String(p["V"] ?? p["v"] ?? p["Vbase"] ?? "13.8"));
        const freq = parseFloat(String(p["freq"] ?? p["f"] ?? project.settings.frequencyHz));
        const typeRaw = String(
          p["machine_type"] ?? p["type"] ?? (defn.includes("dfig") ? "dfig" : "squirrel_cage"),
        ).toLowerCase();
        const machineType: "squirrel_cage" | "dfig" = typeRaw === "dfig" ? "dfig" : "squirrel_cage";
        const rs = parseFloat(String(p["Rs"] ?? p["rs"] ?? "0.015"));
        const xs = parseFloat(String(p["Xs"] ?? p["xs"] ?? "0.10"));
        const xm = parseFloat(String(p["Xm"] ?? p["xm"] ?? "3.50"));
        const rr = parseFloat(String(p["Rr"] ?? p["rr"] ?? "0.015"));
        const xr = parseFloat(String(p["Xr"] ?? p["xr"] ?? "0.10"));
        const h = parseFloat(String(p["H"] ?? p["h"] ?? "1.5"));
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

        const src: EmtSource = {
          id: qCmpId,
          name: qInstName || `Source_${qCmpId}`,
          bus: bus1,
          vPeakKv: isNaN(vKv) ? 16.5 : vKv,
          frequencyHz: isNaN(freq) || freq <= 0 ? project.settings.frequencyHz : freq,
          phaseRad: isNaN(phaseDeg) ? 0 : (phaseDeg * Math.PI) / 180,
          mvaRating: isNaN(mva) || mva <= 0 ? 100.0 : mva,
          rSourceOhm: !isNaN(rSrc) && rSrc > 0 ? rSrc : undefined,
          lSourceH: !isNaN(lSrc) && lSrc > 0 ? lSrc : undefined,
        };
        sources.push(src);
        buses.get(bus1)?.connectedBranchIds.push(qCmpId);
      } else if (
        defn.includes("resistor") ||
        defn.includes("inductor") ||
        defn.includes("capacitor") ||
        defn.includes("rlc")
      ) {
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
        branches.push(branch);
        if (!isOpen) {
          buses.get(bus1)?.connectedBranchIds.push(qCmpId);
          buses.get(bus2)?.connectedBranchIds.push(qCmpId);
        }
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
        defn.endsWith(":compar")
      ) {
        const kind: EmtControlBlock["kind"] = defn.includes("pi")
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
        const explicitInputs = String(p["inputs"] ?? "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);

        // If explicit 'inputs' parameter is omitted, resolve upstream block IDs from graphical <Wire> connections
        const wiredInputs: string[] = [];
        if (explicitInputs.length === 0) {
          for (const pt of cmp.ports) {
            if (pt.kind === "signal" && pt.name.startsWith("in")) {
              const srcBlock = signalPortSourceMap.get(pt.id);
              if (srcBlock) wiredInputs.push(srcBlock);
            }
          }
        }

        controlBlocks.push({
          id: qInstName,
          kind,
          inputs: explicitInputs.length > 0 ? explicitInputs : wiredInputs,
          params,
        });
      }
    }
  }

  processModule(project.rootModule, "", new Map<string, string>(), new Set<string>(["Main"]));

  return {
    buses,
    branches,
    transformers,
    transmissionLines,
    fmuInstances,
    sources,
    faults: faults.length > 0 ? faults : undefined,
    surgeArresters: surgeArresters.length > 0 ? surgeArresters : undefined,
    synchronousMachines: synchronousMachines.length > 0 ? synchronousMachines : undefined,
    inductionMachines: inductionMachines.length > 0 ? inductionMachines : undefined,
    converterBridges: converterBridges.length > 0 ? converterBridges : undefined,
    controlBlocks: controlBlocks.length > 0 ? controlBlocks : undefined,
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

  // 3. Map two-winding transformers, distributed-parameter lines/cables, and FMU interfaces
  const transformers = netlist.transformers.map((x) => ({
    id: x.id,
    primaryBus: x.fromBus,
    secondaryBus: x.toBus,
    mvaRating: x.mvaRating,
    primaryKv: x.primaryKv,
    secondaryKv: x.secondaryKv,
    leakageReactancePu: x.leakageReactancePu,
    windingConnection: x.windingConnection,
  }));

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
  }));

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
  }));

  return {
    buses,
    rlc,
    breakers: breakers.length > 0 ? breakers : undefined,
    transformers: transformers.length > 0 ? transformers : undefined,
    transmissionLines: transmissionLines.length > 0 ? transmissionLines : undefined,
    fmuInstances: fmuInstances.length > 0 ? fmuInstances : undefined,
    sources: sources.length > 0 ? sources : undefined,
    faults: faults && faults.length > 0 ? faults : undefined,
    surgeArresters: surgeArresters && surgeArresters.length > 0 ? surgeArresters : undefined,
    synchronousMachines: synchronousMachines && synchronousMachines.length > 0 ? synchronousMachines : undefined,
    inductionMachines: inductionMachines && inductionMachines.length > 0 ? inductionMachines : undefined,
    converterBridges: converterBridges && converterBridges.length > 0 ? converterBridges : undefined,
    csmfBlocks: csmfBlocks && csmfBlocks.length > 0 ? csmfBlocks : undefined,
  };
}
