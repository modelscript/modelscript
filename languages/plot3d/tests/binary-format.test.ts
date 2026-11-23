// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  detectFortranEndianness,
  encodePlot3dGridBinary,
  encodePlot3dSolutionBinary,
  parsePlot3dGridBinary,
  parsePlot3dSolutionBinary,
  readFortranRecords,
  writeFortranRecord,
} from "../src/parser/binary-codec.js";
import { generateIsentropicNozzlePlot3d } from "../src/solver/nozzle.js";
import type { Plot3dGrid } from "../src/types.js";

describe("PLOT3D Fortran Unformatted Binary Codec", () => {
  it("writes and reads 32-bit Fortran record markers in little and big endian", () => {
    const payload = new Uint8Array([10, 20, 30, 40, 50, 60, 70, 80]);
    for (const endianness of ["little", "big"] as const) {
      const rec = writeFortranRecord(payload, endianness);
      assert.strictEqual(rec.byteLength, 16);
      assert.strictEqual(detectFortranEndianness(rec), endianness);
      const parsed = readFortranRecords(rec);
      assert.strictEqual(parsed.endianness, endianness);
      assert.strictEqual(parsed.records.length, 1);
      assert.deepStrictEqual(Array.from(parsed.records[0]!.payload), Array.from(payload));
    }
  });

  it("throws on mismatched header/trailer Fortran record markers", () => {
    const rec = writeFortranRecord(new Uint8Array([1, 2, 3, 4]), "little");
    // Corrupt trailer byte count
    rec[rec.byteLength - 1] = 99;
    assert.throws(() => readFortranRecords(rec, "little"), /mismatch/i);
  });

  it("round-trips multi-block 3D grid in little/big endian and float32/float64", () => {
    const { grid } = generateIsentropicNozzlePlot3d({ ni: 5, nj: 3, nk: 3, numBlocks: 2 });

    for (const endianness of ["little", "big"] as const) {
      for (const precision of ["float32", "float64"] as const) {
        const bytes = encodePlot3dGridBinary(grid, { endianness, precision });
        const decoded = parsePlot3dGridBinary(bytes);

        assert.strictEqual(decoded.format, "binary");
        assert.strictEqual(decoded.endianness, endianness);
        assert.strictEqual(decoded.precision, precision);
        assert.strictEqual(decoded.multiBlock, true);
        assert.strictEqual(decoded.dimension, "3d");
        assert.strictEqual(decoded.blocks.length, 2);

        const tol = precision === "float64" ? 1e-14 : 1e-6;
        for (let b = 0; b < 2; b++) {
          assert.strictEqual(decoded.blocks[b]!.ni, grid.blocks[b]!.ni);
          for (let i = 0; i < grid.blocks[b]!.x.length; i++) {
            assert.ok(Math.abs(decoded.blocks[b]!.x[i]! - grid.blocks[b]!.x[i]!) <= tol);
            assert.ok(Math.abs(decoded.blocks[b]!.y[i]! - grid.blocks[b]!.y[i]!) <= tol);
            assert.ok(Math.abs(decoded.blocks[b]!.z[i]! - grid.blocks[b]!.z[i]!) <= tol);
          }
        }
      }
    }
  });

  it("round-trips single-block 2D grid with iblank in big-endian binary", () => {
    const grid2d: Plot3dGrid = {
      format: "binary",
      dimension: "2d",
      multiBlock: false,
      hasIblank: true,
      blocks: [
        {
          index: 0,
          ni: 2,
          nj: 2,
          nk: 1,
          x: new Float64Array([0, 1, 0, 1]),
          y: new Float64Array([0, 0, 1, 1]),
          z: new Float64Array([0, 0, 0, 0]),
          iblank: new Int32Array([1, 1, 0, 1]),
        },
      ],
    };

    const bytes = encodePlot3dGridBinary(grid2d, { endianness: "big", precision: "float64" });
    const decoded = parsePlot3dGridBinary(bytes);
    assert.strictEqual(decoded.dimension, "2d");
    assert.strictEqual(decoded.multiBlock, false);
    assert.strictEqual(decoded.hasIblank, true);
    assert.deepStrictEqual(Array.from(decoded.blocks[0]!.iblank!), [1, 1, 0, 1]);
  });

  it("round-trips multi-block 3D conservative solution (.q) in little & big endian", () => {
    const { solution } = generateIsentropicNozzlePlot3d({ ni: 5, nj: 2, nk: 2, numBlocks: 2 });

    for (const endianness of ["little", "big"] as const) {
      const bytes = encodePlot3dSolutionBinary(solution, { endianness, precision: "float64" });
      const decoded = parsePlot3dSolutionBinary(bytes);

      assert.strictEqual(decoded.format, "binary");
      assert.strictEqual(decoded.endianness, endianness);
      assert.strictEqual(decoded.multiBlock, true);
      assert.strictEqual(decoded.blocks.length, 2);
      assert.ok(Math.abs(decoded.blocks[0]!.conditions.fsmach - solution.blocks[0]!.conditions.fsmach) < 1e-12);
      assert.ok(Math.abs(decoded.blocks[1]!.energy[3]! - solution.blocks[1]!.energy[3]!) < 1e-9);
    }
  });
});
