// SPDX-License-Identifier: AGPL-3.0-or-later

import { DAEBuilder } from "@modelscript/runtime";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lowerRinexToDae, rinexToDae } from "../src/dae/index.js";
import { parseRinex } from "../src/parser/index.js";
import type { SatellitePseudorange } from "../src/types.js";

function headerLine(data: string, label: string): string {
  return data.padEnd(60, " ") + label;
}

describe("RINEX v2 Direct DAE Arena Lowering", () => {
  it("lowers pseudorange observation equations directly into DAEBuilder", () => {
    const obs: SatellitePseudorange[] = [
      { prn: "G01", satPos: { x: 15_600_000, y: 7_540_000, z: 20_140_000 }, pseudorangeM: 21_500_000 },
      { prn: "G05", satPos: { x: 18_760_000, y: 2_750_000, z: 18_610_000 }, pseudorangeM: 22_300_000 },
      { prn: "G12", satPos: { x: 17_610_000, y: 14_630_000, z: 13_480_000 }, pseudorangeM: 21_900_000 },
      { prn: "G24", satPos: { x: 19_170_000, y: 610_000, z: 18_390_000 }, pseudorangeM: 22_700_000 },
    ];

    const builder = new DAEBuilder(undefined, "GnssNavFix");
    const result = lowerRinexToDae(builder, obs, { x: 4_000_000, y: 900_000, z: 4_800_000 });

    assert.strictEqual(result.equationCount, 4);
    assert.ok(result.variableMap.has("rx_x"));
    assert.ok(result.variableMap.has("rx_y"));
    assert.ok(result.variableMap.has("rx_z"));
    assert.ok(result.variableMap.has("rx_cdt"));
    assert.ok(result.variableMap.has("sat_G01_x"));
    assert.ok(result.variableMap.has("obs_G24_pr"));
    assert.strictEqual(builder.getEqCount(), 4);
    assert.strictEqual(builder.getVarCount(), 4 + 4 * 4);
  });

  it("lowers a parsed RINEX v2 OBS document via rinexToDae", () => {
    const obsText = [
      headerLine("     2.11           OBSERVATION DATA    G (GPS)", "RINEX VERSION / TYPE"),
      headerLine("WTZR", "MARKER NAME"),
      headerLine("  4075580.4890   931853.8610  4801568.1760", "APPROX POSITION XYZ"),
      headerLine("     1    C1", "# / TYPES OF OBSERV"),
      headerLine("", "END OF HEADER"),
      " 24  5  1  0  0  0.0000000  0  4G01G05G12G24",
      "  21456789.123 7",
      "  22891234.567 8",
      "  23123456.789 6",
      "  20567890.321 9",
    ].join("\n");

    const doc = parseRinex(obsText);
    const dae = rinexToDae(doc);
    assert.strictEqual(dae.getEqCount(), 4);
    assert.ok(dae.lookupVariable("rx_x") >= 0);
    assert.ok(dae.lookupVariable("rx_cdt") >= 0);
  });
});
