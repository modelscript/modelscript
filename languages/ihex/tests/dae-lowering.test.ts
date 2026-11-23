// SPDX-License-Identifier: AGPL-3.0-or-later

import { DAEBuilder } from "@modelscript/runtime";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { encodeIhex, ihexToDae, lowerIhexToDae, parseIhex } from "../src/index.js";

describe("@modelscript/ihex DAE Lowering Suite", () => {
  it("lowers ROM memory-footprint and checksum balance equations into DAEBuilder", () => {
    const hex = encodeIhex(
      [
        { address: 0x08000000, data: new Uint8Array(64).fill(0xa5) },
        { address: 0x08000100, data: new Uint8Array(32).fill(0x5a) },
      ],
      { format: "I32HEX", startLinearAddress: 0x08000000 },
    );
    const model = parseIhex(hex, "cortex_m4.hex");

    const builder = new DAEBuilder(undefined, "CortexM4Rom");
    const res = lowerIhexToDae(builder, model, { flashSizeBytes: 65536 });

    assert.equal(res.segmentCount, 2);
    assert.ok(res.variableCount >= 19, `Expected >= 19 DAE variables, got ${res.variableCount}`);
    assert.ok(res.equationCount >= 12, `Expected >= 12 DAE equations, got ${res.equationCount}`);
    assert.ok(res.variableMap.has("total_data_bytes"));
    assert.ok(res.variableMap.has("total_gap_bytes"));
    assert.ok(res.variableMap.has("total_span_bytes"));
    assert.ok(res.variableMap.has("flash_utilization"));
    assert.ok(res.variableMap.has("image_crc32"));
    assert.ok(res.variableMap.has("seg_0_end_addr"));
    assert.ok(res.variableMap.has("seg_1_end_addr"));
  });

  it("provides high-level ihexToDae wrapper returning a populated DAEBuilder", () => {
    const hex = encodeIhex([{ address: 0x0000, data: new Uint8Array([1, 2, 3, 4]) }]);
    const dae = ihexToDae(parseIhex(hex, "tiny.hex"));
    assert.ok(dae.getVarCount() > 0);
    assert.ok(dae.getEqCount() > 0);
  });
});
