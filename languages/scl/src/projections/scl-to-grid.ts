// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * IEC 61850 SCL Substation Single-Line Diagram (SLD) & Grid Topology Projection.
 *
 * Extracts topological node-breaker connectivity from <Substation>, <VoltageLevel>,
 * <Bay>, <ConnectivityNode>, and <Terminal> elements.
 */

import type { SclConductingEquipmentType, SclDocument } from "../types.js";

export interface GridSubstationNode {
  name: string;
  voltageKv: number;
  bayName: string;
  connectivityNode: string;
}

export interface GridBranchEquipment {
  name: string;
  type: SclConductingEquipmentType;
  fromNode: string;
  toNode: string;
  bayName: string;
  voltageKv: number;
}

export interface SclGridTopology {
  substationName: string;
  nodes: GridSubstationNode[];
  equipment: GridBranchEquipment[];
  breakerCount: number;
  disconnectorCount: number;
  transformerCount: number;
}

/**
 * Synthesizes node-breaker grid topology from an IEC 61850 SclDocument.
 */
export function sclToGridTopology(doc: SclDocument): SclGridTopology {
  const s = doc.substation;
  if (!s) {
    return {
      substationName: doc.header.id,
      nodes: [],
      equipment: [],
      breakerCount: 0,
      disconnectorCount: 0,
      transformerCount: 0,
    };
  }

  const nodes: GridSubstationNode[] = [];
  const equipment: GridBranchEquipment[] = [];
  let breakerCount = 0;
  let disconnectorCount = 0;
  let transformerCount = 0;

  for (const vl of s.voltageLevels) {
    const vKv = vl.nominalVoltageKv ?? 110.0;

    for (const bay of vl.bays) {
      for (const cn of bay.connectivityNodes) {
        nodes.push({
          name: cn.name,
          voltageKv: vKv,
          bayName: bay.name,
          connectivityNode: cn.pathName,
        });
      }

      for (const ce of bay.conductingEquipment) {
        if (ce.type === "CBR") breakerCount++;
        else if (ce.type === "DIS") disconnectorCount++;
        else if (ce.type === "PTR") transformerCount++;

        const tFrom = ce.terminals[0]?.connectivityNode ?? `${bay.name}_Bus1`;
        const tTo = ce.terminals[1]?.connectivityNode ?? `${bay.name}_Bus2`;

        equipment.push({
          name: ce.name,
          type: ce.type,
          fromNode: tFrom,
          toNode: tTo,
          bayName: bay.name,
          voltageKv: vKv,
        });
      }
    }
  }

  return {
    substationName: s.name,
    nodes,
    equipment,
    breakerCount,
    disconnectorCount,
    transformerCount,
  };
}
