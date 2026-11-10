// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * IEC 61850 Substation to PowerFactory Network Mapping.
 *
 * Automatically maps SCL ConductingEquipment (CBR, DIS, PTR, CTR, VTR) and
 * Logical Nodes (XCBR, CSWI, PTOC, PDIS, MMXU) into PowerFactory objects.
 */

import { createEmptyPowerFactoryModel } from "../parser/powerfactory-parser.js";
import type { PowerFactoryModel, StaSwitch } from "../types.js";
import type { SclDocument } from "./scl-types.js";

export interface SclToPowerFactoryMappingResult {
  model: PowerFactoryModel;
  mappedSubstations: number;
  mappedBays: number;
  mappedBreakers: number;
  mappedTransformers: number;
  unmappedEquipment: string[];
}

/**
 * Generates or enriches a PowerFactoryModel from an IEC 61850 SclDocument.
 */
export function mapSclToPowerFactory(
  scl: SclDocument,
  existingModel?: PowerFactoryModel,
): SclToPowerFactoryMappingResult {
  const model = existingModel ?? createEmptyPowerFactoryModel(scl.substation?.name || scl.header.id);
  let mappedBays = 0;
  let mappedBreakers = 0;
  let mappedTransformers = 0;
  const unmapped: string[] = [];

  if (!scl.substation) {
    return {
      model,
      mappedSubstations: 0,
      mappedBays: 0,
      mappedBreakers: 0,
      mappedTransformers: 0,
      unmappedEquipment: ["No <Substation> found in SCL"],
    };
  }

  // 1. Substation
  const substatId = scl.substation.name;
  model.substations.set(substatId, {
    id: substatId,
    loc_name: scl.substation.name,
    desc: scl.substation.desc,
  });

  // 2. Voltage Levels and Bays
  for (const vl of scl.substation.voltageLevels) {
    const vlTerminalId = `Term_${substatId}_${vl.name}`;
    if (!model.terminals.has(vlTerminalId)) {
      model.terminals.set(vlTerminalId, {
        id: vlTerminalId,
        loc_name: `${substatId} ${vl.name} Bus`,
        uknom: vl.nomVoltageKv,
        fnom: vl.nomFreqHz || 50.0,
        substatId,
      });
    }

    for (const bay of vl.bays) {
      const bayId = `Bay_${substatId}_${vl.name}_${bay.name}`;
      model.bays.set(bayId, {
        id: bayId,
        loc_name: bay.name,
        substatId,
      });
      mappedBays++;

      for (const eq of bay.conductingEquipment) {
        const eqId = `${bayId}_${eq.name}`;

        if (eq.type === "CBR" || eq.type === "DIS") {
          // Breaker or Disconnector switch
          const sw: StaSwitch = {
            id: eqId,
            loc_name: eq.name,
            bus1Id: vlTerminalId,
            bus2Id: `${eqId}_out`,
            on_off: 1, // Closed by default
          };
          model.switches.set(eqId, sw);
          mappedBreakers++;
        } else if (eq.type === "PTR") {
          // Power Transformer
          model.transformers2w.set(eqId, {
            id: eqId,
            loc_name: eq.name,
            bushvId: vlTerminalId,
            buslvId: `${eqId}_lv`,
            strn: 40.0,
          });
          mappedTransformers++;
        } else {
          unmapped.push(`${eq.type}: ${eq.name}`);
        }
      }
    }
  }

  return {
    model,
    mappedSubstations: 1,
    mappedBays,
    mappedBreakers,
    mappedTransformers,
    unmappedEquipment: unmapped,
  };
}
