// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decodeHdf4Binary, encodeHdf4Binary } from "../src/parser/binary-codec.js";
import { computeSdsStatistics, sliceSds, traverseVgroupHierarchy } from "../src/solver/index.js";
import { Hdf4DataType, type Hdf4Document } from "../src/types.js";

describe("HDF4 scientific accuracy benchmarks", () => {
  it("achieves relErr < 1e-6 on HDF4 binary tag/DDH/SDS IEEE-754 float32 & float64 round-trip", () => {
    const f32Data: number[] = [];
    const f64Data: number[] = [];
    for (let i = 0; i < 64; i++) {
      f32Data.push(Math.sin(i * 0.17) * 250.0 + 300.0);
      f64Data.push(Math.cos(i * 0.13) * 1e4 + 12345.67890123);
    }

    const doc: Hdf4Document = {
      name: "BenchmarkGrid",
      version: "4.2",
      attributes: [{ name: "benchmark", value: "ieee754" }],
      sdsList: [
        {
          name: "TempF32",
          ref: 10,
          dataType: Hdf4DataType.DFNT_FLOAT32,
          dims: [
            { name: "y", size: 8 },
            { name: "x", size: 8 },
          ],
          attributes: [{ name: "units", value: "K" }],
          data: f32Data,
          unit: "K",
        },
        {
          name: "EnergyF64",
          ref: 11,
          dataType: Hdf4DataType.DFNT_FLOAT64,
          dims: [
            { name: "y", size: 8 },
            { name: "x", size: 8 },
          ],
          attributes: [{ name: "units", value: "J" }],
          data: f64Data,
          unit: "J",
        },
      ],
      vgroups: [
        {
          name: "RootGrid",
          vgroupClass: "EOS_GRID",
          ref: 50,
          members: [
            { kind: "SDS", name: "TempF32" },
            { kind: "SDS", name: "EnergyF64" },
          ],
          attributes: [],
        },
      ],
      vdatas: [],
      rasters: [],
      palettes: [],
      descriptors: [],
      ddhBlocks: [],
      parseErrors: [],
    };

    const bytes = encodeHdf4Binary(doc, { ddPerBlock: 6 });
    const decoded = decodeHdf4Binary(bytes);
    assert.equal(decoded.parseErrors.length, 0);

    const outF32 = decoded.sdsList.find((s) => s.name === "TempF32")!;
    const outF64 = decoded.sdsList.find((s) => s.name === "EnergyF64")!;

    let maxRelErrF32 = 0;
    for (let i = 0; i < f32Data.length; i++) {
      const ref = f32Data[i]!;
      const got = outF32.data[i]!;
      const rel = Math.abs(got - ref) / Math.max(1e-12, Math.abs(ref));
      if (rel > maxRelErrF32) maxRelErrF32 = rel;
    }
    assert.ok(maxRelErrF32 < 1e-6, `Expected float32 relErr < 1e-6, got ${maxRelErrF32}`);

    let maxRelErrF64 = 0;
    for (let i = 0; i < f64Data.length; i++) {
      const ref = f64Data[i]!;
      const got = outF64.data[i]!;
      const rel = Math.abs(got - ref) / Math.max(1e-12, Math.abs(ref));
      if (rel > maxRelErrF64) maxRelErrF64 = rel;
    }
    assert.ok(maxRelErrF64 < 1e-12, `Expected float64 relErr < 1e-12, got ${maxRelErrF64}`);
  });

  it("achieves rmse < 1e-10 on SDS statistics, N-D slicing, and Vgroup hierarchy traversal", () => {
    // 2x3x4 tensor with known exact statistics: values 1..24
    const values = Array.from({ length: 24 }, (_, i) => i + 1);
    const stats = computeSdsStatistics(values, values);

    // Exact analytical mean = 12.5, variance = (24^2 - 1)/12 = 47.916666666666664
    const exactMean = 12.5;
    const exactVar = (24 * 24 - 1) / 12;
    const exactStd = Math.sqrt(exactVar);

    assert.ok(Math.abs(stats.mean - exactMean) < 1e-12);
    assert.ok(Math.abs(stats.variance - exactVar) < 1e-12);
    assert.ok(Math.abs(stats.std - exactStd) < 1e-12);
    assert.ok((stats.rmse ?? 1) < 1e-10);

    const doc: Hdf4Document = {
      name: "HierarchyBench",
      version: "4.2",
      attributes: [],
      sdsList: [
        {
          name: "Cube",
          ref: 1,
          dataType: Hdf4DataType.DFNT_FLOAT64,
          dims: [
            { name: "z", size: 2 },
            { name: "y", size: 3 },
            { name: "x", size: 4 },
          ],
          attributes: [],
          data: values,
        },
      ],
      vgroups: [
        {
          name: "Top",
          ref: 10,
          members: [{ kind: "VGROUP", name: "Sub" }],
          attributes: [],
        },
        {
          name: "Sub",
          ref: 11,
          members: [{ kind: "SDS", name: "Cube" }],
          attributes: [],
        },
      ],
      vdatas: [],
      rasters: [],
      palettes: [],
      descriptors: [],
      ddhBlocks: [],
      parseErrors: [],
    };

    const slice = sliceSds(doc.sdsList[0]!, [1, [0, 2], [1, 3]]);
    assert.deepEqual(slice.shape, [2, 2]);
    // z=1 starts at index 12 (val 13): row0=[13,14,15,16]->[14,15], row1=[17,18,19,20]->[18,19]
    assert.deepEqual(slice.data, [14, 15, 18, 19]);

    const tree = traverseVgroupHierarchy(doc);
    assert.equal(tree.cycles.length, 0);
    assert.equal(tree.orphanSds.length, 0);
    assert.deepEqual(tree.visitedVgroups, ["Top", "Sub"]);
    assert.equal(tree.root.children[0]?.children[0]?.children[0]?.path, "/Top/Sub/Cube");
  });
});
