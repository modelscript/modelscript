// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  analyzeStlTopology,
  buildCylinderStl,
  buildIcosphereStl,
  buildOctahedronStl,
  buildTetrahedronStl,
  buildUnitCubeStl,
  computeStlMassProperties,
  encodeBinaryStl,
  parseBinaryStl,
} from "../src/index.js";

describe("@modelscript/stl — Analytical Mass-Property & Euler Characteristic Benchmarks", () => {
  it("computes exact unit cube [0,1]^3 volume V=1, surface area A=6, centroid (0.5,0.5,0.5), inertia Ixx=1/6 & binary round-trip relErr < 1e-6", () => {
    const cube = buildUnitCubeStl(1.0, "benchmark_unit_cube");
    const props = computeStlMassProperties(cube, { density: 1.0 });
    const topo = analyzeStlTopology(cube);

    assert.ok(Math.abs(props.signedVolume - 1.0) < 1e-12, `Expected V=1, got ${props.signedVolume}`);
    assert.ok(Math.abs(props.surfaceArea - 6.0) < 1e-12, `Expected A=6, got ${props.surfaceArea}`);
    assert.ok(Math.abs(props.centroid[0] - 0.5) < 1e-12);
    assert.ok(Math.abs(props.centroid[1] - 0.5) < 1e-12);
    assert.ok(Math.abs(props.centroid[2] - 0.5) < 1e-12);

    const expectedI = 1.0 / 6.0;
    assert.ok(
      Math.abs(props.inertiaTensor[0][0] - expectedI) < 1e-12,
      `Expected Ixx=1/6, got ${props.inertiaTensor[0][0]}`,
    );
    assert.ok(Math.abs(props.inertiaTensor[1][1] - expectedI) < 1e-12);
    assert.ok(Math.abs(props.inertiaTensor[2][2] - expectedI) < 1e-12);
    assert.ok(Math.abs(props.inertiaTensor[0][1]) < 1e-12);
    assert.ok(Math.abs(props.inertiaTensor[0][2]) < 1e-12);
    assert.ok(Math.abs(props.inertiaTensor[1][2]) < 1e-12);

    assert.equal(topo.vertexCount, 8);
    assert.equal(topo.edgeCount, 18);
    assert.equal(topo.faceCount, 12);
    assert.equal(topo.eulerCharacteristic, 2);
    assert.equal(topo.isWatertight, true);
    assert.equal(topo.isManifold, true);

    // Binary STL round-trip accuracy check (IEEE-754 float32)
    const bin = encodeBinaryStl(cube);
    const decoded = parseBinaryStl(bin);
    const binProps = computeStlMassProperties(decoded, { density: 1.0 });

    const relErrVol = Math.abs(binProps.volume - 1.0) / 1.0;
    const relErrArea = Math.abs(binProps.surfaceArea - 6.0) / 6.0;
    const relErrIxx = Math.abs(binProps.inertiaTensor[0][0] - expectedI) / expectedI;
    assert.ok(relErrVol < 1e-6, `Binary volume relErr=${relErrVol}`);
    assert.ok(relErrArea < 1e-6, `Binary area relErr=${relErrArea}`);
    assert.ok(relErrIxx < 1e-6, `Binary Ixx relErr=${relErrIxx}`);
  });

  it("computes exact tetrahedron volume V=1/6 & Euler chi=2 parity with rmse < 1e-10", () => {
    const tet = buildTetrahedronStl(1.0, "benchmark_tetrahedron");
    const props = computeStlMassProperties(tet, { density: 1.0 });
    const topo = analyzeStlTopology(tet);

    const exactVol = 1.0 / 6.0;
    const exactCentroid = [0.25, 0.25, 0.25];
    const exactChi = 2;

    const sqErrs = [
      (props.signedVolume - exactVol) ** 2,
      (props.centroid[0] - exactCentroid[0]!) ** 2,
      (props.centroid[1] - exactCentroid[1]!) ** 2,
      (props.centroid[2] - exactCentroid[2]!) ** 2,
      (topo.eulerCharacteristic - exactChi) ** 2,
    ];
    const rmse = Math.sqrt(sqErrs.reduce((a, b) => a + b, 0) / sqErrs.length);
    assert.ok(rmse < 1e-10, `Expected tetrahedron RMSE < 1e-10, got ${rmse}`);
    assert.equal(topo.vertexCount, 4);
    assert.equal(topo.edgeCount, 6);
    assert.equal(topo.faceCount, 4);
    assert.equal(topo.isWatertight, true);
  });

  it("verifies watertightness and Euler chi=2 across octahedron, cylinder, and icosphere", () => {
    const oct = buildOctahedronStl(1.0);
    const octProps = computeStlMassProperties(oct);
    const octTopo = analyzeStlTopology(oct);
    assert.ok(Math.abs(octProps.volume - 4.0 / 3.0) < 1e-12);
    assert.equal(octTopo.eulerCharacteristic, 2);
    assert.equal(octTopo.isWatertight, true);

    const cyl = buildCylinderStl(1.0, 2.0, 32);
    const cylTopo = analyzeStlTopology(cyl);
    assert.equal(cylTopo.eulerCharacteristic, 2);
    assert.equal(cylTopo.isWatertight, true);

    const ico = buildIcosphereStl(1.0, 1);
    const icoTopo = analyzeStlTopology(ico);
    assert.equal(icoTopo.eulerCharacteristic, 2);
    assert.equal(icoTopo.isWatertight, true);
  });
});
