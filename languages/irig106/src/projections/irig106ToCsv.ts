// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Projects an IRIG 106 Chapter 9 TMATS commutator schedule and calibration table to CSV.
 */

import { parseIrig106 } from "../parser/tmats-parser.js";
import { buildCommutatorGrid } from "../solver/commutator.js";
import type { TmatsModel } from "../types.js";

function csvCell(val: string | number): string {
  const s = String(val);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/**
 * Exports a TMATS PCM measurement commutator schedule and calibration coefficients as RFC 4180 CSV.
 */
export function irig106ToCsv(modelOrSource: TmatsModel | string): string {
  const model = typeof modelOrSource === "string" ? parseIrig106(modelOrSource) : modelOrSource;
  const grid = buildCommutatorGrid(model);

  const header = [
    "Measurement",
    "DataLink",
    "WordPositions",
    "FramePositions",
    "SlotsPerMajorFrame",
    "CommutationType",
    "SampleRateHz",
    "NyquistBandwidthHz",
    "BitLength",
    "ConversionType",
    "EngineeringUnits",
    "Coefficients",
  ];

  const rows: string[] = [header.join(",")];

  for (const sched of grid.schedules) {
    const conv = model.conversionsByName.get(sched.name);
    const coeffsStr = conv?.coefficients?.length ? conv.coefficients.join(";") : "";
    rows.push(
      [
        csvCell(sched.name),
        csvCell(grid.dataLinkName),
        csvCell(sched.wordPositions.join("|")),
        csvCell(sched.framePositions.join("|")),
        csvCell(sched.slotsPerMajorFrame),
        csvCell(sched.commutationType),
        csvCell(sched.sampleRateHz.toFixed(6)),
        csvCell(sched.nyquistBandwidthHz.toFixed(6)),
        csvCell(sched.bitLength),
        csvCell(conv?.conversionType ?? "NON"),
        csvCell(conv?.engineeringUnits ?? ""),
        csvCell(coeffsStr),
      ].join(","),
    );
  }

  return rows.join("\n") + "\n";
}
