// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * PSS/E v33 `.raw` Powerflow Base Case Serializer.
 */

import type { PsseCase } from "../types.js";
import { writeRaw, type WriteRawOptions } from "./raw-parser.js";

function q(str: string): string {
  return `'${str.replaceAll("'", "''")}'`;
}

/**
 * Serializes a `PsseCase` into PSS/E `.raw` ASCII text (defaults to v33 layout;
 * pass `{ rev: 26 | 29 | 30 | 31 | 32 | 33 | 34 | 35 | 36 }` for version-targeted export).
 */
export function serializePsseRaw(psseCase: PsseCase, opts?: WriteRawOptions): string {
  if (opts?.rev !== undefined || opts?.includeMetadataHeaders !== undefined) {
    return writeRaw(psseCase, opts);
  }
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

  // Transformer Data (2-winding and 3-winding)
  for (const xf of psseCase.transformers) {
    lines.push(
      `${xf.i}, ${xf.j}, ${xf.k}, ${q(xf.ckt)}, ${xf.cw}, 1, ${xf.cm}, ${xf.mag1}, ${xf.mag2}, ${xf.nmetr}, ${q(xf.name)}, ${xf.stat}, ${xf.o1 ?? 1}, ${xf.f1 ?? 1.0}`,
    );
    if (xf.k !== 0) {
      lines.push(
        `${xf.r12}, ${xf.x12}, ${xf.sbase12}, ${xf.r23 ?? 0}, ${xf.x23 ?? 0}, ${xf.sbase23 ?? xf.sbase12}, ${xf.r31 ?? 0}, ${xf.x31 ?? 0}, ${xf.sbase31 ?? xf.sbase12}, ${xf.vmstar ?? 1.0}, ${xf.anstar ?? 0.0}`,
      );
      lines.push(
        `${xf.windv1}, ${xf.nomv1}, ${xf.ang1}, ${xf.rata1}, ${xf.ratb1}, ${xf.ratc1}, ${xf.cod1}, ${xf.cont1}, ${xf.rma1}, ${xf.rmi1}, ${xf.vma1}, ${xf.vmi1}, ${xf.ntp1}, ${xf.tab1}`,
      );
      lines.push(`${xf.windv2}, ${xf.nomv2}, ${xf.ang2 ?? 0}, ${xf.rata2 ?? 0}, ${xf.ratb2 ?? 0}, ${xf.ratc2 ?? 0}`);
      lines.push(
        `${xf.windv3 ?? 1.0}, ${xf.nomv3 ?? 0}, ${xf.ang3 ?? 0}, ${xf.rata3 ?? 0}, ${xf.ratb3 ?? 0}, ${xf.ratc3 ?? 0}`,
      );
    } else {
      lines.push(`${xf.r12}, ${xf.x12}, ${xf.sbase12}`);
      lines.push(
        `${xf.windv1}, ${xf.nomv1}, ${xf.ang1}, ${xf.rata1}, ${xf.ratb1}, ${xf.ratc1}, ${xf.cod1}, ${xf.cont1}, ${xf.rma1}, ${xf.rmi1}, ${xf.vma1}, ${xf.vmi1}, ${xf.ntp1}, ${xf.tab1}`,
      );
      lines.push(`${xf.windv2}, ${xf.nomv2}`);
    }
  }
  lines.push("0 / END OF TRANSFORMER DATA, BEGIN AREA DATA");
  for (const area of psseCase.areas) {
    lines.push(`${area.i}, ${area.isw}, ${area.pdes}, ${area.ptol}, ${q(area.arname)}`);
  }
  lines.push("0 / END OF AREA DATA, BEGIN TWO-TERMINAL DC DATA");
  for (const dc of psseCase.twoTerminalDc) {
    lines.push(
      `${q(dc.name ?? String(dc.i))}, ${dc.mdc}, ${dc.rdc}, ${dc.setvl}, ${dc.vschd}, ${dc.vcmod}, ${dc.rcomp}, ${dc.deltm}`,
    );
    lines.push(`${dc.ipr ?? 0}, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0`);
    lines.push(`${dc.ipi ?? 0}, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0`);
  }
  lines.push("0 / END OF TWO-TERMINAL DC DATA, BEGIN VSC DC LINE DATA");
  for (const vsc of psseCase.vscDc) {
    lines.push(`${q(vsc.name)}, ${vsc.mdc}, ${vsc.rdc}, ${vsc.o1 ?? 1}, ${vsc.f1 ?? 1.0}`);
    lines.push(`${vsc.ibus1 ?? 0}, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0`);
    lines.push(`${vsc.ibus2 ?? 0}, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0`);
  }
  lines.push("0 / END OF VSC DC LINE DATA, BEGIN SWITCHED SHUNT DATA");
  for (const ss of psseCase.switchedShunts) {
    lines.push(
      `${ss.i}, ${ss.modsw}, ${ss.adjm}, ${ss.stat}, ${ss.vswhi}, ${ss.vswlo}, ${ss.swrem}, ${ss.rmpct}, ${q(ss.rmidnt)}, ${ss.binit}`,
    );
  }
  lines.push("0 / END OF SWITCHED SHUNT DATA");
  if (psseCase.substations && psseCase.substations.length > 0) {
    lines.push("0 / BEGIN SUBSTATION DATA");
    for (const sub of psseCase.substations) {
      lines.push(`${sub.is}, ${q(sub.name)}, ${sub.lati}, ${sub.long}, ${sub.sgr}`);
      for (const nd of sub.nodes) {
        lines.push(`${nd.ni}, ${q(nd.name)}, ${nd.ibus}, ${nd.status}`);
      }
      lines.push("0 / END OF SUBSTATION NODE DATA");
      for (const sw of sub.switches) {
        lines.push(
          `${sw.ni}, ${sw.nj}, ${q(sw.id)}, ${sw.x}, ${sw.rate1}, ${sw.rate2}, ${sw.rate3}, ${sw.status}, ${sw.type}, ${q(sw.name)}`,
        );
      }
      lines.push("0 / END OF SUBSTATION SWITCH DATA");
      for (const tm of sub.terminals) {
        lines.push(`${tm.eqType}, ${tm.i}, ${tm.j ?? 0}, ${tm.k ?? 0}, ${q(tm.id)}, ${tm.ni}`);
      }
      lines.push("0 / END OF SUBSTATION TERMINAL DATA");
    }
    lines.push("0 / END OF SUBSTATION DATA");
  }
  lines.push("Q");

  return lines.join("\n");
}
