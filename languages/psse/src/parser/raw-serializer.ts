// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * PSS/E v33 `.raw` Powerflow Base Case Serializer.
 */

import type { PsseCase } from "../types.js";

function q(str: string): string {
  return `'${str.replaceAll("'", "''")}'`;
}

/**
 * Serializes a `PsseCase` into PSS/E v33 `.raw` ASCII text.
 */
export function serializePsseRaw(psseCase: PsseCase): string {
  const { header, title1, title2 } = psseCase;
  const lines: string[] = [
    `${header.ic}, ${header.sbase}, ${header.rev}, ${header.xfrrat}, ${header.nxfrat}, ${header.basfrq}`,
    title1 || "MODELSCRIPT EXPORT",
    title2 || "PSS/E V33 BASE CASE",
  ];

  // Bus Data
  for (const bus of psseCase.buses.values()) {
    lines.push(
      `${bus.i}, ${q(bus.name)}, ${bus.baseKv}, ${bus.ide}, ${bus.area}, ${bus.zone}, ${bus.owner}, ${bus.vm}, ${bus.va}, ${bus.nvhi ?? 1.1}, ${bus.nvlo ?? 0.9}, ${bus.evhi ?? 1.1}, ${bus.evlo ?? 0.9}`,
    );
  }
  lines.push("0 / END OF BUS DATA, BEGIN LOAD DATA");

  // Load Data
  for (const load of psseCase.loads) {
    lines.push(
      `${load.i}, ${q(load.id)}, ${load.status}, ${load.area}, ${load.zone}, ${load.pl}, ${load.ql}, ${load.ip}, ${load.iq}, ${load.yp}, ${load.yq}, ${load.owner}, ${load.scale}, ${load.intrct}`,
    );
  }
  lines.push("0 / END OF LOAD DATA, BEGIN FIXED SHUNT DATA");

  // Fixed Shunt Data
  for (const sh of psseCase.fixedShunts) {
    lines.push(`${sh.i}, ${q(sh.id)}, ${sh.status}, ${sh.gl}, ${sh.bl}`);
  }
  lines.push("0 / END OF FIXED SHUNT DATA, BEGIN GENERATOR DATA");

  // Generator Data
  for (const gen of psseCase.generators) {
    lines.push(
      `${gen.i}, ${q(gen.id)}, ${gen.pg}, ${gen.qg}, ${gen.qt}, ${gen.qb}, ${gen.vs}, ${gen.ireg}, ${gen.mbase}, ${gen.zr}, ${gen.zx}, ${gen.rt}, ${gen.xt}, ${gen.gtap}, ${gen.stat}, ${gen.rmpct}, ${gen.pt}, ${gen.pb}`,
    );
  }
  lines.push("0 / END OF GENERATOR DATA, BEGIN BRANCH DATA");

  // Branch Data
  for (const br of psseCase.branches) {
    lines.push(
      `${br.i}, ${br.j}, ${q(br.ckt)}, ${br.r}, ${br.x}, ${br.b}, ${br.rateA}, ${br.rateB}, ${br.rateC}, ${br.gi}, ${br.bi}, ${br.gj}, ${br.bj}, ${br.st}, ${br.met}, ${br.len}`,
    );
  }
  lines.push("0 / END OF BRANCH DATA, BEGIN TRANSFORMER DATA");

  // Transformer Data (2-winding)
  for (const xf of psseCase.transformers) {
    lines.push(
      `${xf.i}, ${xf.j}, ${xf.k}, ${q(xf.ckt)}, ${xf.cw}, 1, ${xf.cm}, ${xf.mag1}, ${xf.mag2}, ${xf.nmetr}, ${q(xf.name)}, ${xf.stat}, ${xf.o1 ?? 1}, ${xf.f1 ?? 1.0}`,
    );
    lines.push(`${xf.r12}, ${xf.x12}, ${xf.sbase12}`);
    lines.push(
      `${xf.windv1}, ${xf.nomv1}, ${xf.ang1}, ${xf.rata1}, ${xf.ratb1}, ${xf.ratc1}, ${xf.cod1}, ${xf.cont1}, ${xf.rma1}, ${xf.rmi1}, ${xf.vma1}, ${xf.vmi1}, ${xf.ntp1}, ${xf.tab1}`,
    );
    lines.push(`${xf.windv2}, ${xf.nomv2}`);
  }
  lines.push("0 / END OF TRANSFORMER DATA, BEGIN AREA DATA");
  lines.push("0 / END OF AREA DATA, BEGIN TWO-TERMINAL DC DATA");
  lines.push("0 / END OF TWO-TERMINAL DC DATA, BEGIN VSC DC LINE DATA");
  lines.push("0 / END OF VSC DC LINE DATA, BEGIN SWITCHED SHUNT DATA");
  lines.push("0 / END OF SWITCHED SHUNT DATA");
  lines.push("Q");

  return lines.join("\n");
}
