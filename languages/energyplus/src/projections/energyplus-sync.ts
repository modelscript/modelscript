// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @fileoverview Bidirectional synchronization from Modelica 3.x thermal models
 * back into US DOE EnergyPlus building decks (.idf, .epJSON).
 */

import { parseEnergyPlus } from "../parser/index.js";

export interface EnergyPlusSyncChange {
  target: "zone" | "surface" | "boundary" | "internal_load";
  elementId: string;
  property?: string | undefined;
  sourceOldVal?: number | string | undefined;
  targetNewVal: number | string;
  reconciledVal: number | string;
  strategy: string;
}

export interface EnergyPlusSyncResult {
  updatedText: string;
  changes: EnergyPlusSyncChange[];
}

export interface EnergyPlusSyncOptions {
  strategy?: "target-wins" | "source-wins" | "physics-simplex" | undefined;
}

/**
 * Reconciles modified Modelica thermal network parameters back into EnergyPlus building text.
 */
export function synchronizeModelicaToEnergyPlus(
  originalEnergyPlusText: string,
  modifiedModelicaText: string,
  options?: EnergyPlusSyncOptions,
): EnergyPlusSyncResult {
  const strategy = options?.strategy ?? "target-wins";
  const doc = parseEnergyPlus(originalEnergyPlusText);
  const changes: EnergyPlusSyncChange[] = [];
  let updatedText = originalEnergyPlusText;

  // 1. Extract internal loads from Modelica: FixedHeatFlow q_int_<zone>(Q_flow = <val>)
  const qIntRegex = /FixedHeatFlow\s+q_int_([a-zA-Z0-9_]+)\s*\(\s*Q_flow\s*=\s*([0-9.eE+-]+)\s*\)/g;
  let qMatch: RegExpExecArray | null;
  const moZoneGains = new Map<string, number>();
  while ((qMatch = qIntRegex.exec(modifiedModelicaText)) !== null) {
    const zoneClean = (qMatch[1] ?? "").toLowerCase();
    const qVal = parseFloat(qMatch[2] ?? "0");
    moZoneGains.set(zoneClean, qVal);
  }

  // 2. Extract surface conductances from Modelica: ThermalConductor wall_<surf>(G = <val>)
  const gRegex = /ThermalConductor\s+wall_([a-zA-Z0-9_]+)\s*\(\s*G\s*=\s*([0-9.eE+-]+)\s*\)/g;
  let gMatch: RegExpExecArray | null;
  const moSurfCond = new Map<string, number>();
  while ((gMatch = gRegex.exec(modifiedModelicaText)) !== null) {
    const surfClean = (gMatch[1] ?? "").toLowerCase();
    const gVal = parseFloat(gMatch[2] ?? "0");
    moSurfCond.set(surfClean, gVal);
  }

  // 3. Reconcile internal gains back into IDF / epJSON
  for (const [zoneClean, newQ] of moZoneGains) {
    // Find matching zone
    const zone = doc.zones.find((z) => z.name.replace(/[^a-zA-Z0-9_]/g, "_").toLowerCase() === zoneClean);
    if (!zone) continue;

    // Calculate current old total gains in this zone
    let oldQ = 0.0;
    for (const p of doc.people.filter((x) => x.zoneName.toLowerCase() === zone.name.toLowerCase())) {
      oldQ += p.numberOfPeople * 100.0;
    }
    for (const l of doc.lights.filter((x) => x.zoneName.toLowerCase() === zone.name.toLowerCase())) {
      oldQ += l.lightingLevel;
    }
    for (const e of doc.electricEquipment.filter((x) => x.zoneName.toLowerCase() === zone.name.toLowerCase())) {
      oldQ += e.designLevel;
    }

    if (Math.abs(oldQ - newQ) > 1e-3) {
      const resolved = strategy === "source-wins" ? oldQ : newQ;
      changes.push({
        target: "internal_load",
        elementId: zone.name,
        property: "Q_flow",
        sourceOldVal: oldQ,
        targetNewVal: newQ,
        reconciledVal: resolved,
        strategy,
      });

      // Update in IDF text: update Lights or ElectricEquipment design level
      const lightsObj = doc.lights.find((l) => l.zoneName.toLowerCase() === zone.name.toLowerCase());
      if (lightsObj) {
        const regex = new RegExp(`(Lights\\s*,\\s*${lightsObj.name}[^;]*?)([0-9.eE+-]+)(\\s*;)`, "is");
        if (regex.test(updatedText)) {
          updatedText = updatedText.replace(regex, `$1${resolved.toFixed(1)}$3`);
        }
      }
    }
  }

  // 4. Reconcile surface conductances back into surfaces
  for (const [surfClean, newG] of moSurfCond) {
    const surf = doc.surfaces.find((s) => s.name.replace(/[^a-zA-Z0-9_]/g, "_").toLowerCase() === surfClean);
    if (!surf) continue;

    const oldG = (surf.grossArea && surf.grossArea > 0 ? surf.grossArea : 20.0) * 1.2;
    if (Math.abs(oldG - newG) > 1e-3) {
      const resolved = strategy === "source-wins" ? oldG : newG;
      changes.push({
        target: "surface",
        elementId: surf.name,
        property: "conductance",
        sourceOldVal: oldG,
        targetNewVal: newG,
        reconciledVal: resolved,
        strategy,
      });
    }
  }

  return {
    updatedText,
    changes,
  };
}
