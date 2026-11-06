// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/cgmes — Projection from CIM / CGMES to OpenIPSL / Modelica Electrical Grid Model.
 */

import { processTopology } from "../topology/topology-processor.js";
import type { CgmesModel } from "../types.js";

export interface CgmesToModelicaOptions {
  packageName?: string;
  modelName?: string;
  useOpenIpsl?: boolean;
}

function sanitizeId(id: string): string {
  const sanitized = id.replace(/[^a-zA-Z0-9_]/g, "_");
  return /^[0-9]/.test(sanitized) ? `m_${sanitized}` : sanitized;
}

/**
 * Synthesizes an OpenIPSL / Modelica transmission grid model from a CGMES model.
 */
export function cgmesToModelica(model: CgmesModel, options: CgmesToModelicaOptions = {}): string {
  const pkgName = sanitizeId(options.packageName ?? "CgmesGridPackage");
  const mdlName = sanitizeId(options.modelName ?? "TransmissionSystem");
  const topo = processTopology(model);

  const lines: string[] = [];

  lines.push(`package ${pkgName}`);
  lines.push(`  model ${mdlName}`);
  lines.push(`    "CGMES Transformed Network Model"`);
  lines.push(``);

  // Terminals lookup
  const equipmentTerminals = new Map<string, string[]>();
  for (const term of topo.model.terminals.values()) {
    const list = equipmentTerminals.get(term.conductingEquipmentId) ?? [];
    list.push(term.mRID);
    equipmentTerminals.set(term.conductingEquipmentId, list);
  }

  // 1. Buses
  lines.push(`    // --- Topological Buses ---`);
  const nodeVarNames = new Map<string, string>();
  for (const [nodeId, node] of topo.model.nodes.entries()) {
    const varName = sanitizeId(node.name || `bus_${nodeId}`);
    nodeVarNames.set(nodeId, varName);
    const vNom = (node.baseVoltageKv > 0 ? node.baseVoltageKv : 400.0) * 1000.0;
    lines.push(`    OpenIPSL.Electrical.Buses.Bus ${varName}(V_nom = ${vNom.toFixed(1)});`);
  }
  lines.push(``);

  // 2. Generators
  lines.push(`    // --- Generators ---`);
  const genVars: Array<{ varName: string; busVar: string }> = [];
  for (const [genId, gen] of topo.model.generators.entries()) {
    const varName = sanitizeId(gen.name || `gen_${genId}`);
    const terms = equipmentTerminals.get(genId);
    const nodeId = terms && terms.length > 0 ? topo.terminalToNode.get(terms[0]!) : undefined;
    const busVar = nodeId ? nodeVarNames.get(nodeId) : undefined;

    lines.push(
      `    OpenIPSL.Electrical.Machines.PSSE.GENSAL ${varName}(` +
        `P_0 = ${(gen.pMw * 1e6).toFixed(1)}, ` +
        `Q_0 = ${(gen.qMvar * 1e6).toFixed(1)}, ` +
        `S_nom = ${((gen.ratedSMva ?? 100.0) * 1e6).toFixed(1)});`,
    );
    if (busVar) genVars.push({ varName, busVar });
  }
  lines.push(``);

  // 3. Loads
  lines.push(`    // --- Loads ---`);
  const loadVars: Array<{ varName: string; busVar: string }> = [];
  for (const [loadId, load] of topo.model.loads.entries()) {
    const varName = sanitizeId(load.name || `load_${loadId}`);
    const terms = equipmentTerminals.get(loadId);
    const nodeId = terms && terms.length > 0 ? topo.terminalToNode.get(terms[0]!) : undefined;
    const busVar = nodeId ? nodeVarNames.get(nodeId) : undefined;

    lines.push(
      `    OpenIPSL.Electrical.Loads.PSSE.Load ${varName}(` +
        `P_0 = ${(load.pMw * 1e6).toFixed(1)}, ` +
        `Q_0 = ${(load.qMvar * 1e6).toFixed(1)});`,
    );
    if (busVar) loadVars.push({ varName, busVar });
  }
  lines.push(``);

  // 4. Transmission Lines
  lines.push(`    // --- AC Transmission Lines ---`);
  const branchConnects: Array<{ varName: string; bus1: string; bus2: string }> = [];
  for (const [lineId, line] of topo.model.lines.entries()) {
    const varName = sanitizeId(line.name || `line_${lineId}`);
    const terms = equipmentTerminals.get(lineId);
    if (!terms || terms.length < 2) continue;

    const n1 = topo.terminalToNode.get(terms[0]!);
    const n2 = topo.terminalToNode.get(terms[1]!);
    const b1 = n1 ? nodeVarNames.get(n1) : undefined;
    const b2 = n2 ? nodeVarNames.get(n2) : undefined;

    lines.push(
      `    OpenIPSL.Electrical.Branches.Line ${varName}(` +
        `R = ${line.r.toFixed(5)}, ` +
        `X = ${line.x.toFixed(5)}, ` +
        `B = ${line.bch.toFixed(5)});`,
    );
    if (b1 && b2) branchConnects.push({ varName, bus1: b1, bus2: b2 });
  }
  lines.push(``);

  // 5. Transformers
  lines.push(`    // --- Power Transformers ---`);
  const xfConnects: Array<{ varName: string; bus1: string; bus2: string }> = [];
  for (const [xfId, xf] of topo.model.transformers.entries()) {
    const varName = sanitizeId(xf.name || `xf_${xfId}`);
    const ends: string[] = [];
    let rSum = 0;
    let xSum = 0.05;

    for (const end of topo.model.transformerEnds.values()) {
      if (end.powerTransformerId === xfId && end.terminalId) {
        const n = topo.terminalToNode.get(end.terminalId);
        if (n && nodeVarNames.has(n)) {
          ends.push(nodeVarNames.get(n)!);
          rSum += end.r;
          xSum = Math.max(xSum, end.x);
        }
      }
    }

    if (ends.length >= 2) {
      lines.push(
        `    OpenIPSL.Electrical.Branches.TwoWindingTransformer ${varName}(` +
          `R = ${rSum.toFixed(5)}, ` +
          `X = ${xSum.toFixed(5)});`,
      );
      xfConnects.push({ varName, bus1: ends[0]!, bus2: ends[1]! });
    }
  }
  lines.push(``);

  // Equations and Connects
  lines.push(`  equation`);

  for (const g of genVars) {
    lines.push(`    connect(${g.varName}.p, ${g.busVar}.p);`);
  }
  for (const l of loadVars) {
    lines.push(`    connect(${l.varName}.p, ${l.busVar}.p);`);
  }
  for (const br of branchConnects) {
    lines.push(`    connect(${br.varName}.p, ${br.bus1}.p);`);
    lines.push(`    connect(${br.varName}.q, ${br.bus2}.p);`);
  }
  for (const xf of xfConnects) {
    lines.push(`    connect(${xf.varName}.p, ${xf.bus1}.p);`);
    lines.push(`    connect(${xf.varName}.q, ${xf.bus2}.p);`);
  }

  lines.push(`  end ${mdlName};`);
  lines.push(`end ${pkgName};`);

  return lines.join("\n");
}
