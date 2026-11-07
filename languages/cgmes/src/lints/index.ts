// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/cgmes — Static Semantic Linter Rules.
 *
 * Implements ENTSO-E CGMES validation rules C1001–C1010.
 */

import { processTopology } from "../topology/topology-processor.js";
import type { CgmesModel } from "../types.js";

export interface CgmesDiagnostic {
  code: string;
  rule: string;
  severity: "error" | "warning" | "info";
  message: string;
  mRID?: string | undefined;
}

export const CgmesErrorCode = {
  MISSING_MRID: {
    code: "C1001",
    rule: "missing-mrid",
    severity: "error" as const,
    message: "TopologicalNode has empty or missing mRID.",
  },
  ORPHAN_TERMINAL: {
    code: "C1002",
    rule: "orphan-terminal",
    severity: "error" as const,
    message: (terminal: string, conductingEquipment: string) =>
      `Terminal '${terminal}' references non-existent ConductingEquipment '${conductingEquipment}'.`,
  },
  DANGLING_NODE: {
    code: "C1003",
    rule: "dangling-node",
    severity: "warning" as const,
    message: (node: string) => `TopologicalNode '${node}' has no connected equipment terminals.`,
  },
  INVALID_VOLTAGE_LEVEL: {
    code: "C1004",
    rule: "invalid-voltage-level",
    severity: "error" as const,
    message: (voltageLevel: string, baseVoltageKv: string) =>
      `VoltageLevel '${voltageLevel}' has non-positive base voltage (${baseVoltageKv} kV).`,
  },
  TRANSFORMER_END_MISMATCH: {
    code: "C1005",
    rule: "transformer-end-mismatch",
    severity: "error" as const,
    message: (transformer: string, ends: string) =>
      `PowerTransformer '${transformer}' must have 2 or 3 ends, but found ${ends}.`,
  },
  GENERATOR_LIMIT_INVERSION: {
    code: "C1006",
    rule: "generator-limit-inversion",
    severity: "error" as const,
    message: (generator: string, minP: string, maxP: string) =>
      `SynchronousMachine '${generator}' minP (${minP} MW) exceeds maxP (${maxP} MW).`,
  },
  ZERO_IMPEDANCE_LINE: {
    code: "C1007",
    rule: "zero-impedance-line",
    severity: "warning" as const,
    message: (line: string, r: string, x: string) =>
      `ACLineSegment '${line}' has zero or negative impedance (r=${r}, x=${x}).`,
  },
  NEGATIVE_LOAD: {
    code: "C1008",
    rule: "negative-load",
    severity: "info" as const,
    message: (load: string, pMw: string) =>
      `EnergyConsumer '${load}' has negative active power (${pMw} MW), behaving as net generation.`,
  },
  ISOLATED_SUBSTATION: {
    code: "C1009",
    rule: "isolated-substation",
    severity: "warning" as const,
    message: (substation: string) => `Substation '${substation}' is isolated from the transmission network.`,
  },
  UNBALANCED_PROFILE_DATA: {
    code: "C1010",
    rule: "unbalanced-profile-data",
    severity: "error" as const,
    message: (svId: string, topologicalNodeId: string) =>
      `State variable SvVoltage '${svId}' references non-existent TopologicalNode '${topologicalNodeId}'.`,
  },
} as const;

export function lintCgmesModel(model: CgmesModel): CgmesDiagnostic[] {
  const diagnostics: CgmesDiagnostic[] = [];
  const topo = processTopology(model);

  // C1001: missing-mrid
  // (All elements in Maps already have mRID, but check for empty or whitespace)
  for (const [id] of model.nodes.entries()) {
    if (!id || id.trim() === "") {
      diagnostics.push({
        code: "C1001",
        rule: "missing-mrid",
        severity: "error",
        message: "TopologicalNode has empty or missing mRID.",
      });
    }
  }

  // C1002: orphan-terminal
  const allEquipmentIds = new Set<string>([
    ...model.lines.keys(),
    ...model.transformers.keys(),
    ...model.generators.keys(),
    ...model.loads.keys(),
    ...model.shunts.keys(),
  ]);

  for (const term of model.terminals.values()) {
    if (!term.conductingEquipmentId || !allEquipmentIds.has(term.conductingEquipmentId)) {
      diagnostics.push({
        code: "C1002",
        rule: "orphan-terminal",
        severity: "error",
        message: `Terminal '${term.name || term.mRID}' references non-existent ConductingEquipment '${term.conductingEquipmentId}'.`,
        mRID: term.mRID,
      });
    }
  }

  // C1003: dangling-node
  const nodesWithTerminals = new Set<string>();
  for (const term of model.terminals.values()) {
    const n = topo.terminalToNode.get(term.mRID);
    if (n) nodesWithTerminals.add(n);
  }

  for (const [nodeId, node] of model.nodes.entries()) {
    if (!nodesWithTerminals.has(nodeId)) {
      diagnostics.push({
        code: "C1003",
        rule: "dangling-node",
        severity: "warning",
        message: `TopologicalNode '${node.name || nodeId}' has no connected equipment terminals.`,
        mRID: nodeId,
      });
    }
  }

  // C1004: invalid-voltage-level
  for (const vl of model.voltageLevels.values()) {
    if (vl.baseVoltageKv <= 0) {
      diagnostics.push({
        code: "C1004",
        rule: "invalid-voltage-level",
        severity: "error",
        message: `VoltageLevel '${vl.name || vl.mRID}' has non-positive base voltage (${vl.baseVoltageKv} kV).`,
        mRID: vl.mRID,
      });
    }
    if (
      vl.lowVoltageLimit !== undefined &&
      vl.highVoltageLimit !== undefined &&
      vl.lowVoltageLimit > vl.highVoltageLimit
    ) {
      diagnostics.push({
        code: "C1004",
        rule: "invalid-voltage-level",
        severity: "error",
        message: `VoltageLevel '${vl.name || vl.mRID}' has low limit (${vl.lowVoltageLimit} kV) higher than high limit (${vl.highVoltageLimit} kV).`,
        mRID: vl.mRID,
      });
    }
  }

  // C1005: transformer-end-mismatch
  const transformerEndsCount = new Map<string, number>();
  for (const end of model.transformerEnds.values()) {
    const count = transformerEndsCount.get(end.powerTransformerId) ?? 0;
    transformerEndsCount.set(end.powerTransformerId, count + 1);
  }

  for (const [xfId, xf] of model.transformers.entries()) {
    const ends = transformerEndsCount.get(xfId) ?? 0;
    if (ends !== 2 && ends !== 3) {
      diagnostics.push({
        code: "C1005",
        rule: "transformer-end-mismatch",
        severity: "error",
        message: `PowerTransformer '${xf.name || xfId}' must have 2 or 3 ends, but found ${ends}.`,
        mRID: xfId,
      });
    }
  }

  // C1006: generator-limit-inversion
  for (const gen of model.generators.values()) {
    if (gen.minPMw > gen.maxPMw) {
      diagnostics.push({
        code: "C1006",
        rule: "generator-limit-inversion",
        severity: "error",
        message: `SynchronousMachine '${gen.name || gen.mRID}' minP (${gen.minPMw} MW) exceeds maxP (${gen.maxPMw} MW).`,
        mRID: gen.mRID,
      });
    }
    if (gen.minQMvar > gen.maxQMvar) {
      diagnostics.push({
        code: "C1006",
        rule: "generator-limit-inversion",
        severity: "error",
        message: `SynchronousMachine '${gen.name || gen.mRID}' minQ (${gen.minQMvar} MVAr) exceeds maxQ (${gen.maxQMvar} MVAr).`,
        mRID: gen.mRID,
      });
    }
  }

  // C1007: zero-impedance-line
  for (const line of model.lines.values()) {
    if (line.r <= 0 && line.x <= 0) {
      diagnostics.push({
        code: "C1007",
        rule: "zero-impedance-line",
        severity: "warning",
        message: `ACLineSegment '${line.name || line.mRID}' has zero or negative impedance (r=${line.r}, x=${line.x}).`,
        mRID: line.mRID,
      });
    }
  }

  // C1008: negative-load
  for (const load of model.loads.values()) {
    if (load.pMw < 0) {
      diagnostics.push({
        code: "C1008",
        rule: "negative-load",
        severity: "info",
        message: `EnergyConsumer '${load.name || load.mRID}' has negative active power (${load.pMw} MW), behaving as net generation.`,
        mRID: load.mRID,
      });
    }
  }

  // C1009: isolated-substation
  const substationsWithLines = new Set<string>();
  for (const line of model.lines.values()) {
    const terms = Array.from(model.terminals.values()).filter((t) => t.conductingEquipmentId === line.mRID);
    for (const term of terms) {
      const node = term.topologicalNodeId ? model.nodes.get(term.topologicalNodeId) : undefined;
      const vl = node?.voltageLevelId ? model.voltageLevels.get(node.voltageLevelId) : undefined;
      if (vl?.substationId) substationsWithLines.add(vl.substationId);
    }
  }

  for (const [subId, sub] of model.substations.entries()) {
    if (!substationsWithLines.has(subId) && model.substations.size > 1) {
      diagnostics.push({
        code: "C1009",
        rule: "isolated-substation",
        severity: "warning",
        message: `Substation '${sub.name || subId}' is isolated from the transmission network.`,
        mRID: subId,
      });
    }
  }

  // C1010: unbalanced-profile-data
  for (const [svId, sv] of model.svVoltages.entries()) {
    if (!model.nodes.has(sv.topologicalNodeId)) {
      diagnostics.push({
        code: "C1010",
        rule: "unbalanced-profile-data",
        severity: "error",
        message: `State variable SvVoltage '${svId}' references non-existent TopologicalNode '${sv.topologicalNodeId}'.`,
      });
    }
  }

  return diagnostics;
}
