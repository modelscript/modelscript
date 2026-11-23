// SPDX-License-Identifier: AGPL-3.0-or-later

import { DAEBuilder } from "@modelscript/runtime";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lowerSrecToDae, srecToDae } from "../src/dae/index.js";
import { encodeSrec, parseSrec } from "../src/parser/index.js";

describe("SREC Direct Linear-Memory DAE Lowering", () => {
  it("lowers firmware footprint, address span, and per-region layout equations into DAEBuilder", () => {
    const text = encodeSrec(
      [
        { startAddress: 0x00001000, data: new Uint8Array(64).fill(0x4e) },
        { startAddress: 0x00002000, data: new Uint8Array(128).fill(0x75) },
      ],
      { header: "MC68K_FW", dataRecordType: "S2", startAddress: 0x00001000 },
    );
    const file = parseSrec(text);

    const builder = new DAEBuilder(undefined, "MC68K_FW");
    const result = lowerSrecToDae(builder, file);

    assert.strictEqual(result.solved.regions.length, 2);
    assert.strictEqual(result.solved.totalDataBytes, 192);
    assert.strictEqual(result.solved.addressSpan, 0x2080 - 0x1000);
    // 5 top-level equations + 2 per-region size equations = 7
    assert.strictEqual(result.equationCount, 7);
    assert.ok(result.variableMap.has("min_address"));
    assert.ok(result.variableMap.has("max_address"));
    assert.ok(result.variableMap.has("address_span"));
    assert.ok(result.variableMap.has("total_data_bytes"));
    assert.ok(result.variableMap.has("memory_utilization"));
    assert.ok(result.variableMap.has("gap_bytes"));
    assert.ok(result.variableMap.has("region_0_size"));
    assert.ok(result.variableMap.has("region_1_size"));
  });

  it("provides srecToDae high-level wrapper returning populated DAEBuilder", () => {
    const text = encodeSrec([{ startAddress: 0xe000, data: new Uint8Array([0x01, 0x02, 0x03, 0x04]) }], {
      header: "ROM6800",
      dataRecordType: "S1",
      startAddress: 0xe000,
    });
    const file = parseSrec(text);
    const dae = srecToDae(file, { modelName: "ROM6800_Image" });
    assert.ok(dae.lookupVariable("total_data_bytes") !== -1);
    assert.ok(dae.lookupVariable("address_span") !== -1);
    assert.ok(dae.lookupVariable("region_0_size") !== -1);
  });
});
