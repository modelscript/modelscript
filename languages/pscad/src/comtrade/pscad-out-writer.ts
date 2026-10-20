// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * PSCAD-style output writer: `<base>.inf` channel index plus `<base>_NN.out`
 * ASCII data files (time column + up to 10 channels per file, as PSCAD does).
 */

import type { SimulationResultLike } from "./comtrade-writer.js";

export interface PscadOutFile {
  /** File name suffix, e.g. `_01.out`. */
  suffix: string;
  content: string;
}

export interface PscadOutResult {
  inf: string;
  out: PscadOutFile[];
}

const CHANNELS_PER_FILE = 10;

function sci(v: number): string {
  return (Number.isFinite(v) ? v : 0)
    .toExponential(6)
    .toUpperCase()
    .replace(/E([+-])(\d)$/, "E$10$2");
}

export function writePscadOut(result: SimulationResultLike, projectName: string = "ModelScript"): PscadOutResult {
  const channels: { name: string; unit: string; group: string; data: Float64Array }[] = [];

  for (const [bus, v] of result.busVoltages) {
    channels.push({ name: `V_${bus}`, unit: "V", group: "Voltages", data: v });
    const ph = result.busPhaseVoltages?.get(bus);
    if (ph) {
      channels.push({ name: `V_${bus}_B`, unit: "V", group: "Voltages", data: ph.b });
      channels.push({ name: `V_${bus}_C`, unit: "V", group: "Voltages", data: ph.c });
    }
  }
  for (const [br, i] of result.branchCurrents ?? []) {
    channels.push({ name: `I_${br}`, unit: "A", group: "Currents", data: i });
    const ph = result.branchPhaseCurrents?.get(br);
    if (ph) {
      channels.push({ name: `I_${br}_B`, unit: "A", group: "Currents", data: ph.b });
      channels.push({ name: `I_${br}_C`, unit: "A", group: "Currents", data: ph.c });
    }
  }
  for (const [sig, s] of result.controlSignals ?? []) {
    channels.push({ name: sig, unit: "", group: "Controls", data: s });
  }

  const infLines: string[] = [`# PSCAD-style output index for ${projectName}`];
  const out: PscadOutFile[] = [];
  const n = result.time.length;

  for (let f = 0; f * CHANNELS_PER_FILE < channels.length; f++) {
    const slice = channels.slice(f * CHANNELS_PER_FILE, (f + 1) * CHANNELS_PER_FILE);
    const rows: string[] = [];
    for (let k = 0; k < n; k++) {
      const cols = [sci(result.time[k]!)];
      for (const ch of slice) cols.push(sci(ch.data[k] ?? 0));
      rows.push(" " + cols.join(" "));
    }
    out.push({ suffix: `_${String(f + 1).padStart(2, "0")}.out`, content: rows.join("\n") + "\n" });

    slice.forEach((ch, c) => {
      let min = Infinity;
      let max = -Infinity;
      for (let k = 0; k < ch.data.length; k++) {
        const x = ch.data[k]!;
        if (x < min) min = x;
        if (x > max) max = x;
      }
      if (!Number.isFinite(min)) min = max = 0;
      const pgb = f * CHANNELS_PER_FILE + c + 1;
      infLines.push(
        `PGB(${pgb}) Output Desc="${ch.name}" Group="${ch.group}" Max=${max} Min=${min} Units="${ch.unit}"`,
      );
    });
  }

  return { inf: infLines.join("\n") + "\n", out };
}
