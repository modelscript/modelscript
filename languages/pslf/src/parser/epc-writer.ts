// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * GE PSLF Extended Power flow Card (.epc) Serializer.
 */

import type { PslfEpcCase } from "../types.js";

/**
 * Serializes a `PslfEpcCase` into standard PSLF .epc file format.
 */
export function writePslfEpc(epcCase: PslfEpcCase): string {
  const lines: string[] = [];

  lines.push(`c =========================================================================`);
  lines.push(`c GE PSLF Extended Power Flow Card (.epc)`);
  lines.push(`c Case: ${epcCase.title1}`);
  if (epcCase.title2) lines.push(`c Subtitle: ${epcCase.title2}`);
  lines.push(`c Base MVA: ${epcCase.mbaseMva.toFixed(1)}, Frequency: ${epcCase.baseFreqHz.toFixed(1)} Hz`);
  lines.push(`c Exported by ModelScript Polyglot Engineering Compiler`);
  lines.push(`c =========================================================================`);
  lines.push("");

  // Buses
  lines.push(`c --- BUS DATA ---`);
  for (const b of epcCase.buses.values()) {
    const nameStr = `'${b.name.trim()}'`;
    lines.push(
      `b ${b.busNumber} ${nameStr} ${b.baseKv.toFixed(2)} ${b.busType} ${b.area} ${b.zone} ${b.vmPu.toFixed(4)} ${b.vaDeg.toFixed(2)} ${b.vmax.toFixed(3)} ${b.vmin.toFixed(3)}`,
    );
  }
  lines.push("");

  // Generators
  if (epcCase.generators.length > 0) {
    lines.push(`c --- GENERATOR DATA ---`);
    for (const g of epcCase.generators) {
      const idStr = `'${g.genId.trim()}'`;
      lines.push(
        `g ${g.busNumber} ${idStr} ${g.status} ${g.pgMw.toFixed(2)} ${g.qgMvar.toFixed(2)} ${g.qmaxMvar.toFixed(2)} ${g.qminMvar.toFixed(2)} ${g.vschedPu.toFixed(4)} ${g.mbaseMva.toFixed(1)} ${g.rSource.toFixed(4)} ${g.xSource.toFixed(4)} ${g.pmaxMw.toFixed(2)} ${g.pminMw.toFixed(2)}`,
      );
    }
    lines.push("");
  }

  // Loads
  if (epcCase.loads.length > 0) {
    lines.push(`c --- LOAD DATA ---`);
    for (const l of epcCase.loads) {
      const idStr = `'${l.loadId.trim()}'`;
      lines.push(
        `ld ${l.busNumber} ${idStr} ${l.status} ${l.plMw.toFixed(2)} ${l.qlMvar.toFixed(2)} ${l.ipMw.toFixed(2)} ${l.iqMvar.toFixed(2)} ${l.ypMw.toFixed(2)} ${l.yqMvar.toFixed(2)} ${l.area} ${l.zone}`,
      );
    }
    lines.push("");
  }

  // Shunts
  if (epcCase.shunts.length > 0) {
    lines.push(`c --- SHUNT DATA ---`);
    for (const s of epcCase.shunts) {
      const idStr = `'${s.shuntId.trim()}'`;
      lines.push(`s ${s.busNumber} ${idStr} ${s.status} ${s.gMw.toFixed(2)} ${s.bMvar.toFixed(2)}`);
    }
    lines.push("");
  }

  // Transmission Lines
  if (epcCase.branches.length > 0) {
    lines.push(`c --- TRANSMISSION LINE DATA ---`);
    for (const br of epcCase.branches) {
      const cktStr = `'${br.circuitId.trim()}'`;
      lines.push(
        `ln ${br.fromBus} ${br.toBus} ${cktStr} ${br.status} ${br.rPu.toFixed(5)} ${br.xPu.toFixed(5)} ${br.bPu.toFixed(5)} ${br.rate1Mva.toFixed(1)} ${br.rate2Mva.toFixed(1)} ${br.rate3Mva.toFixed(1)}`,
      );
    }
    lines.push("");
  }

  // Transformers
  if (epcCase.transformers.length > 0) {
    lines.push(`c --- TRANSFORMER DATA ---`);
    for (const tr of epcCase.transformers) {
      const cktStr = `'${tr.circuitId.trim()}'`;
      lines.push(
        `t ${tr.fromBus} ${tr.toBus} ${cktStr} ${tr.status} ${tr.rPu.toFixed(5)} ${tr.xPu.toFixed(5)} ${tr.ratio.toFixed(4)} ${tr.phaseDeg.toFixed(2)} ${tr.rate1Mva.toFixed(1)} ${tr.rate2Mva.toFixed(1)} ${tr.rate3Mva.toFixed(1)}`,
      );
    }
    lines.push("");
  }

  // Areas
  if (epcCase.areas.length > 0) {
    lines.push(`c --- AREA DATA ---`);
    for (const a of epcCase.areas) {
      const nameStr = `'${a.name.trim()}'`;
      lines.push(`a ${a.areaNumber} ${a.slackBus} ${a.desiredNetInterchangeMw.toFixed(1)} ${a.toleranceMw.toFixed(1)} ${nameStr}`);
    }
    lines.push("");
  }

  // Zones
  if (epcCase.zones.length > 0) {
    lines.push(`c --- ZONE DATA ---`);
    for (const z of epcCase.zones) {
      const nameStr = `'${z.name.trim()}'`;
      lines.push(`z ${z.zoneNumber} ${nameStr}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}
