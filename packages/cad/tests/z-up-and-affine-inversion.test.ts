// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AssemblyBVH } from "../src/bvh.js";
import {
  ManifoldWorker,
  ParameterInversionEngine,
  box,
  chamfer,
  computeProjectedFrontalArea,
  computeSolidAABB,
  cylinder,
  evaluateSolidAsync,
  invertAffineExpression,
  subtract,
  terminateCadWorker,
  torus,
  translate,
} from "../src/index.js";

describe("CAD Canonical +Z-up Coordinate Frame & Analytical Affine Inversion", () => {
  it("tessellates Cylinder and ChamferedCylinder along canonical +Z axis matching AABB and frontal area", () => {
    const cyl = cylinder({ radius: 5, height: 20, segments: 32, name: "Shaft" });
    const aabb = computeSolidAABB(cyl);
    assert.deepStrictEqual(aabb.min, [-5, -5, -10]);
    assert.deepStrictEqual(aabb.max, [5, 5, 10]);

    const mesh = ManifoldWorker.evaluateSolid(cyl);
    let minZ = Infinity;
    let maxZ = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < mesh.vertices.length; i += 3) {
      minY = Math.min(minY, mesh.vertices[i + 1]!);
      maxY = Math.max(maxY, mesh.vertices[i + 1]!);
      minZ = Math.min(minZ, mesh.vertices[i + 2]!);
      maxZ = Math.max(maxZ, mesh.vertices[i + 2]!);
    }
    assert.ok(Math.abs(minY - -5) < 1e-4 && Math.abs(maxY - 5) < 1e-4, `Expected Y in [-5,5], got [${minY}, ${maxY}]`);
    assert.ok(
      Math.abs(minZ - -10) < 1e-4 && Math.abs(maxZ - 10) < 1e-4,
      `Expected Z in [-10,10], got [${minZ}, ${maxZ}]`,
    );

    // Chamfered cylinder also along +Z
    const chamfCyl = chamfer(cylinder({ radius: 10, height: 30, segments: 24 }), 1.0);
    const chamfMesh = ManifoldWorker.evaluateSolid(chamfCyl);
    let cMaxY = -Infinity;
    let cMaxZ = -Infinity;
    for (let i = 0; i < chamfMesh.vertices.length; i += 3) {
      cMaxY = Math.max(cMaxY, Math.abs(chamfMesh.vertices[i + 1]!));
      cMaxZ = Math.max(cMaxZ, Math.abs(chamfMesh.vertices[i + 2]!));
    }
    assert.ok(
      cMaxY <= 10.01 && cMaxZ >= 14.9,
      `Expected Z half-height ~15, Y radius <= 10; got Z=${cMaxZ}, Y=${cMaxY}`,
    );

    // Projected area along +Z sees circular cap (pi * 10^2 mm^2 = ~3.14e-4 m^2)
    const bigCyl = cylinder({ radius: 10, height: 100, segments: 64 });
    const areaZ = computeProjectedFrontalArea(bigCyl, [0, 0, 1]);
    const expectedCapArea = Math.PI * 10 * 10 * 1e-6;
    assert.ok(
      Math.abs(areaZ - expectedCapArea) / expectedCapArea < 0.05,
      `Expected +Z frontal area ~${expectedCapArea}, got ${areaZ}`,
    );

    const moved = translate(cylinder({ radius: 4, height: 10 }), [0, 0, 20]);
    const movedBox = computeSolidAABB(moved);
    assert.deepStrictEqual(movedBox.min, [-4, -4, 15]);
    assert.deepStrictEqual(movedBox.max, [4, 4, 25]);
  });

  it("tessellates Torus in canonical XY ring plane with +Z thickness", () => {
    const tor = torus({ major: 10, minor: 2, majorSegments: 24, minorSegments: 12 });
    const aabb = computeSolidAABB(tor);
    assert.deepStrictEqual(aabb.min, [-12, -12, -2]);
    assert.deepStrictEqual(aabb.max, [12, 12, 2]);

    const mesh = ManifoldWorker.evaluateSolid(tor);
    let maxY = 0;
    let maxZ = 0;
    for (let i = 0; i < mesh.vertices.length; i += 3) {
      maxY = Math.max(maxY, Math.abs(mesh.vertices[i + 1]!));
      maxZ = Math.max(maxZ, Math.abs(mesh.vertices[i + 2]!));
    }
    assert.ok(maxY > 11.5 && maxZ <= 2.01, `Expected Torus Y~12 and Z<=2, got maxY=${maxY}, maxZ=${maxZ}`);
  });

  it("analytically inverts single-variable affine expressions and locks compound multi-variable/non-affine expressions", () => {
    const r1 = ParameterInversionEngine.invertAffineExpression("2 * width + 5", 25);
    assert.strictEqual(r1.ok, true);
    assert.strictEqual(r1.locked, false);
    assert.strictEqual(r1.kind, "single_var_affine");
    assert.strictEqual(r1.variableName, "width");
    assert.strictEqual(r1.solvedValue, 10);

    const r2 = invertAffineExpression("-x", 12.5);
    assert.strictEqual(r2.ok, true);
    assert.strictEqual(r2.variableName, "x");
    assert.strictEqual(r2.solvedValue, -12.5);

    const r3 = invertAffineExpression("(r + 1) / 2 - 3", 2);
    assert.strictEqual(r3.ok, true);
    assert.strictEqual(r3.variableName, "r");
    assert.strictEqual(r3.solvedValue, 9);

    const multi = invertAffineExpression("w1 + w2", 30);
    assert.strictEqual(multi.ok, false);
    assert.strictEqual(multi.locked, true);
    assert.strictEqual(multi.kind, "multi_variable");
    assert.deepStrictEqual(multi.variables, ["w1", "w2"]);
    assert.ok(multi.reason?.includes("w1, w2"));

    const nonAffine = invertAffineExpression("r * r", 25);
    assert.strictEqual(nonAffine.ok, false);
    assert.strictEqual(nonAffine.locked, true);
    assert.strictEqual(nonAffine.kind, "non_affine");

    const fnCall = invertAffineExpression("sin(angle) * 10", 5);
    assert.strictEqual(fnCall.ok, false);
    assert.strictEqual(fnCall.locked, true);
    assert.strictEqual(fnCall.kind, "non_affine");

    const degen = invertAffineExpression("x - x + 5", 10);
    assert.strictEqual(degen.ok, false);
    assert.strictEqual(degen.locked, true);
    assert.strictEqual(degen.kind, "degenerate_variable");
  });

  it("expands multi-item BVH leaves into 1-item binary leaf nodes in flatNodes so WASM raycast drops zero items", () => {
    const items = Array.from({ length: 8 }, (_, idx) => ({
      id: 100 + idx,
      aabb: {
        min: [idx * 10, 0, 0] as [number, number, number],
        max: [idx * 10 + 5, 5, 5] as [number, number, number],
      },
    }));
    const bvh = new AssemblyBVH(items, 4);
    const nodeI32 = new Int32Array(bvh.flatNodes.buffer);
    const leafIds = new Set<number>();

    for (let i = 0; i < bvh.totalNodes; i++) {
      const i32Off = i * 16;
      const left = nodeI32[i32Off + 12]!;
      const right = nodeI32[i32Off + 13]!;
      const itemId = nodeI32[i32Off + 14]!;
      const itemCount = nodeI32[i32Off + 15]!;
      if (left < 0 && right < 0) {
        assert.strictEqual(itemCount, 1, `Expected expanded 1-item leaf in flatNodes, got itemCount=${itemCount}`);
        leafIds.add(itemId);
      }
    }

    assert.strictEqual(leafIds.size, 8, `Expected all 8 items in flatNodes leaves, found ${leafIds.size}`);
    for (const item of items) {
      assert.ok(leafIds.has(item.id), `Missing item ${item.id} from flatNodes`);
    }
  });

  it("caches and reuses unchanged CSG subtree meshes in ManifoldWorker.evaluateSolid", () => {
    ManifoldWorker.clearMeshCache();
    const housing = subtract(
      box({ width: 20, height: 20, depth: 10 }),
      cylinder({ radius: 4, height: 12, segments: 24 }),
    );
    const m1 = ManifoldWorker.evaluateSolid(housing);
    assert.ok(m1.vertices.length > 0 && m1.indices.length > 0);
    const m2 = ManifoldWorker.evaluateSolid(
      subtract(box({ width: 20, height: 20, depth: 10 }), cylinder({ radius: 4, height: 12, segments: 24 })),
    );
    assert.strictEqual(m1.vertices, m2.vertices, "Identical CSG subtree must reuse cached Float32Array buffer");

    // Different cutout still produces distinct geometry while hitting cached base operands
    const m3 = ManifoldWorker.evaluateSolid(
      subtract(box({ width: 20, height: 20, depth: 10 }), cylinder({ radius: 6, height: 12, segments: 24 })),
    );
    assert.notStrictEqual(m1.vertices, m3.vertices);
    assert.ok(m3.indices.length > 0);
  });

  it("evaluates CSG trees asynchronously via evaluateSolidAsync background worker with synchronous parity", async () => {
    const part = subtract(box({ width: 16, height: 12, depth: 8 }), cylinder({ radius: 3, height: 10, segments: 16 }));
    const syncMesh = ManifoldWorker.evaluateSolid(part);
    const asyncMesh = await evaluateSolidAsync(part);
    try {
      assert.strictEqual(asyncMesh.vertices.length, syncMesh.vertices.length);
      assert.strictEqual(asyncMesh.indices.length, syncMesh.indices.length);
      assert.ok(asyncMesh.vertices instanceof Float32Array);
      assert.ok(asyncMesh.indices instanceof Uint32Array);
    } finally {
      await terminateCadWorker();
    }
  });

  it("ignores comments and strings and escapes $identifiers in ParameterInversionEngine", () => {
    const src = [
      "// width = 999; dummy: 888;",
      "/* $fn = 99; ARM_LENGTH = 777; */",
      'const label = "width = 555;";',
      "$fn = 16;",
      "width = 20;",
    ].join("\n");

    const extracted = ParameterInversionEngine.extractParameters(src);
    assert.deepStrictEqual(extracted, { $fn: 16, width: 20 });

    const patched = ParameterInversionEngine.patchMcadSource(src, { $fn: 32, width: 40 });
    assert.strictEqual(patched.appliedUpdates.length, 2);
    assert.ok(patched.updatedSource.includes("// width = 999; dummy: 888;"));
    assert.ok(patched.updatedSource.includes("/* $fn = 99; ARM_LENGTH = 777; */"));
    assert.ok(patched.updatedSource.includes('const label = "width = 555;";'));
    assert.ok(patched.updatedSource.includes("$fn = 32;"));
    assert.ok(patched.updatedSource.includes("width = 40;"));
  });
});
