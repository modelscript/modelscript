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
  EmtFmuInstance,
  EmtNetlist,
  EmtTransformer,
  EmtTransmissionLine,
  PscxProject,
} from "../types.js";

export function extractEmtNetlist(project: PscxProject): EmtNetlist {
  const mod = project.rootModule;
  const buses = new Map<string, EmtBus>();
  const branches: EmtBranch[] = [];
  const transformers: EmtTransformer[] = [];
  const transmissionLines: EmtTransmissionLine[] = [];
  const fmuInstances: EmtFmuInstance[] = [];

  // 1. Register explicit buses
  for (const b of mod.buses) {
    buses.set(b.id, {
      id: b.id,
      name: b.name,
      baseKv: b.voltageBaseKv ?? 230.0,
      phaseCount: b.phaseCount,
      connectedBranchIds: [],
    });
  }

  // Helper: map port ID to connected bus ID via wires
  const portToBusMap = new Map<string, string>();
  for (const wire of mod.wires) {
    const busId = wire.connectedPortIds.find((id) => buses.has(id));
    if (busId) {
      for (const pId of wire.connectedPortIds) {
        if (pId !== busId) {
          portToBusMap.set(pId, busId);
        }
      }
    }
  }

  // Fallback virtual bus counter for unconnected or point-to-point branches
  let virtualBusCounter = 1;
  function getOrCreateBus(portId?: string, defaultPrefix = "Node"): string {
    if (portId && portToBusMap.has(portId)) {
      return portToBusMap.get(portId)!;
    }
    const virtualBusId = `${defaultPrefix}_${virtualBusCounter++}`;
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

  // 2. Classify components into electrical elements
  for (const cmp of mod.components) {
    const defn = cmp.definitionName.toLowerCase();
    const p = cmp.parameters;

    if (defn.includes("xfmr") || defn.includes("transformer")) {
      // 3-Phase or 2-Winding Transformer
      const p1 = cmp.ports[0]?.id;
      const p2 = cmp.ports[1]?.id;
      const bus1 = getOrCreateBus(p1, `${cmp.instanceName}_P`);
      const bus2 = getOrCreateBus(p2, `${cmp.instanceName}_S`);

      const mva = parseFloat(String(p["MVA"] || p["mva"] || "100.0"));
      const v1 = parseFloat(String(p["V1"] || p["v1"] || p["Vpri"] || "16.5"));
      const v2 = parseFloat(String(p["V2"] || p["v2"] || p["Vsec"] || "230.0"));
      const x = parseFloat(String(p["X"] || p["x"] || p["leakage"] || "0.08"));

      const xfmr: EmtTransformer = {
        id: cmp.id,
        fromBus: bus1,
        toBus: bus2,
        mvaRating: mva,
        primaryKv: v1,
        secondaryKv: v2,
        leakageReactancePu: x,
        windingConnection: "Yg-Yg",
      };
      transformers.push(xfmr);

      buses.get(bus1)?.connectedBranchIds.push(cmp.id);
      buses.get(bus2)?.connectedBranchIds.push(cmp.id);
    } else if (defn.includes("tline") || defn.includes("cable") || defn.includes("line")) {
      // Transmission Line
      const p1 = cmp.ports[0]?.id;
      const p2 = cmp.ports[1]?.id;
      const bus1 = getOrCreateBus(p1, `${cmp.instanceName}_From`);
      const bus2 = getOrCreateBus(p2, `${cmp.instanceName}_To`);

      const len = parseFloat(String(p["length"] || p["Len"] || "50.0"));
      const r = parseFloat(String(p["R"] || p["r_per_km"] || "0.03"));
      const l = parseFloat(String(p["L"] || p["l_per_km"] || "0.001"));
      const c = parseFloat(String(p["C"] || p["c_per_km"] || "1.1e-8"));

      const line: EmtTransmissionLine = {
        id: cmp.id,
        fromBus: bus1,
        toBus: bus2,
        lengthKm: len,
        rPerKm: r,
        lPerKm: l,
        cPerKm: c,
        modelType: "bergeron",
      };
      transmissionLines.push(line);

      buses.get(bus1)?.connectedBranchIds.push(cmp.id);
      buses.get(bus2)?.connectedBranchIds.push(cmp.id);
    } else if (defn.includes("fmu") || defn.includes("inverter") || defn.includes("ibr")) {
      // Black-Box OEM FMU Component
      const p1 = cmp.ports[0]?.id;
      const bus1 = getOrCreateBus(p1, `${cmp.instanceName}_POI`);
      const fmuPath = String(p["fmu_path"] || p["source"] || "inverter.fmu");
      const mva = parseFloat(String(p["MVA"] || p["rated_mva"] || "100.0"));
      const kv = parseFloat(String(p["V"] || p["rated_kv"] || "0.69"));

      const fmu: EmtFmuInstance = {
        id: cmp.id,
        name: cmp.instanceName || `FMU_${cmp.id}`,
        busConnection: bus1,
        fmuPath,
        ratedMva: mva,
        ratedKv: kv,
        controlMode: "grid_following",
      };
      fmuInstances.push(fmu);
      buses.get(bus1)?.connectedBranchIds.push(cmp.id);
    } else if (
      defn.includes("resistor") ||
      defn.includes("inductor") ||
      defn.includes("capacitor") ||
      defn.includes("rlc")
    ) {
      // Passive RLC branch
      const p1 = cmp.ports[0]?.id;
      const p2 = cmp.ports[1]?.id;
      const bus1 = getOrCreateBus(p1, `${cmp.instanceName}_1`);
      const bus2 = cmp.ports.length > 1 ? getOrCreateBus(p2, `${cmp.instanceName}_2`) : "GND";

      const r = parseFloat(String(p["R"] || p["r"] || (defn.includes("resistor") ? p["Value"] : "0.001")));
      const l = parseFloat(String(p["L"] || p["l"] || (defn.includes("inductor") ? p["Value"] : "0")));
      const c = parseFloat(String(p["C"] || p["c"] || (defn.includes("capacitor") ? p["Value"] : "0")));

      const branch: EmtBranch = {
        id: cmp.id,
        kind: "rlc",
        fromBus: bus1,
        toBus: bus2,
        resistanceOhm: isNaN(r) ? 0.001 : r,
        inductanceH: isNaN(l) ? 0 : l,
        capacitanceF: isNaN(c) ? 0 : c,
      };
      branches.push(branch);
      buses.get(bus1)?.connectedBranchIds.push(cmp.id);
      if (buses.has(bus2)) buses.get(bus2)?.connectedBranchIds.push(cmp.id);
    } else if (defn.includes("breaker") || defn.includes("switch")) {
      // Circuit Breaker / Switch
      const p1 = cmp.ports[0]?.id;
      const p2 = cmp.ports[1]?.id;
      const bus1 = getOrCreateBus(p1, `${cmp.instanceName}_A`);
      const bus2 = getOrCreateBus(p2, `${cmp.instanceName}_B`);

      const branch: EmtBranch = {
        id: cmp.id,
        kind: "switch",
        fromBus: bus1,
        toBus: bus2,
        resistanceOhm: 0.001,
        inductanceH: 0,
        capacitanceF: 0,
        status: p["status"] === "open" ? "open" : "closed",
      };
      branches.push(branch);
      buses.get(bus1)?.connectedBranchIds.push(cmp.id);
      buses.get(bus2)?.connectedBranchIds.push(cmp.id);
    }
  }

  return {
    buses,
    branches,
    transformers,
    transmissionLines,
    fmuInstances,
    nominalFrequencyHz: project.settings.frequencyHz,
  };
}
