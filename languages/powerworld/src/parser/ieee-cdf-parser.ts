// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/powerworld — IEEE Common Data Format (.cdf) Parser & Exporter.
 *
 * Bridges IEEE CDF ("BUS DATA FOLLOWS" / "BRANCH DATA FOLLOWS") exports from
 * ETAP, SKM Power*Tools, EasyPower, and academic cases into PowerWorldAuxModel.
 */

import type { AuxBranch, AuxBus, AuxGen, AuxLoad, AuxSourceSpan, PowerWorldAuxModel } from "../types.js";

const DEFAULT_SPAN: AuxSourceSpan = {
  line: 1,
  column: 1,
  endLine: 1,
  endColumn: 1,
  startOffset: 0,
  endOffset: 0,
};

/**
 * Parse an IEEE Common Data Format (.cdf) string into a PowerWorldAuxModel.
 */
export function parseIeeeCdf(source: string): PowerWorldAuxModel {
  const buses: AuxBus[] = [];
  const busByNum = new Map<number, AuxBus>();
  const generators: AuxGen[] = [];
  const loads: AuxLoad[] = [];
  const branches: AuxBranch[] = [];

  let mode: "header" | "bus" | "branch" | "done" = "header";
  const lines = source.split(/\r?\n/);

  for (let idx = 0; idx < lines.length; idx++) {
    const raw = lines[idx]!;
    const trimmed = raw.trim();
    if (!trimmed) continue;

    const upper = trimmed.toUpperCase();
    if (upper.startsWith("BUS DATA FOLLOWS")) {
      mode = "bus";
      continue;
    }
    if (upper.startsWith("BRANCH DATA FOLLOWS")) {
      mode = "branch";
      continue;
    }
    if (upper.startsWith("-999") || upper.startsWith("-99")) {
      mode = "header";
      continue;
    }
    if (upper.startsWith("END OF DATA")) {
      mode = "done";
      break;
    }

    const span: AuxSourceSpan = {
      line: idx + 1,
      column: 1,
      endLine: idx + 1,
      endColumn: raw.length + 1,
      startOffset: 0,
      endOffset: 0,
    };

    if (mode === "bus") {
      // IEEE CDF Bus card (supports space-delimited or standard column layout):
      // BusNum Name ... Area Zone Type V_pu Angle_deg LoadMW LoadMVAR GenMW GenMVAR BaseKV DesiredV ...
      const cols = trimmed.split(/\s+/);
      const busNum = Number(cols[0]);
      if (!Number.isFinite(busNum)) continue;

      // Find numeric tail tokens after bus name
      let nameEnd = 1;
      while (nameEnd < cols.length && !/^[+-]?\d+(\.\d+)?$/.test(cols[nameEnd]!)) {
        nameEnd++;
      }
      const busName = cols.slice(1, nameEnd).join(" ") || `Bus_${busNum}`;
      const nums = cols.slice(nameEnd).map(Number);

      // Standard IEEE CDF numeric columns after name:
      // 0:Area, 1:Zone, 2:Type(0=PQ,2=PV,3=Slack), 3:V_pu, 4:Angle, 5:LoadMW, 6:LoadMVAR, 7:GenMW, 8:GenMVAR, 9:BaseKV
      const busType = nums[2] ?? 0;
      const puVolt = nums[3] ?? 1.0;
      const angleDeg = nums[4] ?? 0.0;
      const loadMw = nums[5] ?? 0.0;
      const loadMvar = nums[6] ?? 0.0;
      const genMw = nums[7] ?? 0.0;
      const genMvar = nums[8] ?? 0.0;
      const nomVoltKv = (nums[9] ?? 0) > 0 ? nums[9]! : 138.0;

      const bus: AuxBus = {
        busNum,
        busName,
        nomVoltKv,
        puVolt,
        angleDeg,
        isSlack: busType === 3,
        span,
      };
      buses.push(bus);
      busByNum.set(busNum, bus);

      if (loadMw !== 0 || loadMvar !== 0) {
        loads.push({
          busNum,
          loadId: "1",
          status: "Closed",
          mw: loadMw,
          mvar: loadMvar,
          span,
        });
      }
      if (busType === 2 || busType === 3 || genMw !== 0) {
        generators.push({
          busNum,
          genId: "1",
          status: "Closed",
          mw: genMw,
          mvar: genMvar,
          voltSetPu: puVolt,
          span,
        });
      }
    } else if (mode === "branch") {
      // IEEE CDF Branch card:
      // TapBus ZBus Area Zone Ckt Type R X B RateA RateB RateC ... Tap Phase
      const cols = trimmed.split(/\s+/).map(Number);
      if (cols.length < 8 || !Number.isFinite(cols[0]) || !Number.isFinite(cols[1])) continue;
      const fromBus = cols[0]!;
      const toBus = cols[1]!;
      const circuit = String(cols[4] ?? 1);
      const branchType = cols[5] ?? 0;
      const rPu = cols[6] ?? 0.0;
      const xPu = cols[7] ?? 0.01;
      const bPu = cols[8] ?? 0.0;
      const rateAMva = (cols[9] ?? 0) > 0 ? cols[9]! : 100.0;
      const tapRatio = (cols[14] ?? 0) > 0 ? cols[14]! : 1.0;
      const phaseShiftDeg = cols[15] ?? 0.0;

      branches.push({
        fromBus,
        toBus,
        circuit,
        status: "Closed",
        rPu,
        xPu,
        bPu,
        rateAMva,
        tapRatio,
        phaseShiftDeg,
        isTransformer: branchType !== 0 || tapRatio !== 1.0 || phaseShiftDeg !== 0.0,
        span,
      });
    }
  }

  return {
    dataSections: [],
    scriptBlocks: [],
    buses,
    busByNum,
    generators,
    loads,
    branches,
    shunts: [],
    contingencies: [],
  };
}

/**
 * Export a PowerWorldAuxModel to IEEE Common Data Format (.cdf).
 */
export function projectToIeeeCdf(model: PowerWorldAuxModel, title = "MODELSCRIPT IEEE CDF EXPORT"): string {
  const lines: string[] = [];
  lines.push(` 08/17/26 ${title.padEnd(32, " ")} 100.0  2026 S`);
  lines.push(`BUS DATA FOLLOWS                    ${model.buses.length} ITEMS`);

  for (const bus of model.buses) {
    const gen = model.generators.find((g) => g.busNum === bus.busNum && g.status === "Closed");
    const load = model.loads.find((l) => l.busNum === bus.busNum && l.status === "Closed");
    const bType = bus.isSlack ? 3 : gen ? 2 : 0;
    const safeName = bus.busName.replace(/\s+/g, "_").slice(0, 12);
    lines.push(
      `${bus.busNum} ${safeName} 1 1 ${bType} ${bus.puVolt.toFixed(4)} ${bus.angleDeg.toFixed(2)} ${(load?.mw ?? 0).toFixed(2)} ${(load?.mvar ?? 0).toFixed(2)} ${(gen?.mw ?? 0).toFixed(2)} ${(gen?.mvar ?? 0).toFixed(2)} ${bus.nomVoltKv.toFixed(2)}`,
    );
  }
  lines.push("-999");
  lines.push(`BRANCH DATA FOLLOWS                 ${model.branches.length} ITEMS`);

  for (const br of model.branches) {
    const bType = br.isTransformer ? 1 : 0;
    lines.push(
      `${br.fromBus} ${br.toBus} 1 1 ${br.circuit} ${bType} ${br.rPu.toFixed(6)} ${br.xPu.toFixed(6)} ${br.bPu.toFixed(6)} ${br.rateAMva.toFixed(1)} ${br.rateAMva.toFixed(1)} ${br.rateAMva.toFixed(1)} 0 0 ${br.tapRatio.toFixed(4)} ${br.phaseShiftDeg.toFixed(2)}`,
    );
  }
  lines.push("-999");
  lines.push("END OF DATA");
  void DEFAULT_SPAN;
  return lines.join("\n");
}
