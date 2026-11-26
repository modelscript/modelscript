// SPDX-License-Identifier: AGPL-3.0-or-later

import { extractFlowFeatures } from "@modelscript/simulate";
import assert from "node:assert";
import { decodeCgnsDataArray, exportToCgnsJson, validateCgnsTree } from "../src/cfd/cgns-exporter.js";

console.log("=== Testing CGNS/SIDS Exporter & Tree Validator ===");

// Build a synthetic 3D Lamb-Oseen vortex grid for flow-feature + CGNS round-trip verification
const nx = 16;
const ny = 16;
const nz = 8;
const dx = 0.1;
const total = nx * ny * nz;
const vx = new Float64Array(total);
const vy = new Float64Array(total);
const vz = new Float64Array(total);
const cx = (nx - 1) * 0.5 * dx;
const cy = (ny - 1) * 0.5 * dx;
const rc = 0.25;
const gamma = 1.0;

for (let k = 0; k < nz; k++) {
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const idx = i + nx * (j + ny * k);
      const x = i * dx - cx;
      const y = j * dx - cy;
      const r2 = x * x + y * y;
      const factor = (gamma / (2 * Math.PI * (r2 + 1e-12))) * (1 - Math.exp(-r2 / (rc * rc)));
      vx[idx] = -y * factor;
      vy[idx] = x * factor;
      vz[idx] = 0;
    }
  }
}

const features = extractFlowFeatures(nx, ny, nz, dx, vx, vy, vz);

// 1. Structured 3D CGNS export with Base64 encoding + V&V provenance
const structuredTree = exportToCgnsJson({
  baseName: "LambOseenVortex3D",
  cellDimension: 3,
  physicalDimension: 3,
  encoding: "base64",
  floatPrecision: "R8",
  provenance: {
    solver: "ModelScript-CFD",
    solverVersion: "2.0.0",
    caseName: "Lamb-Oseen 3D Vortex Benchmark",
    turbulenceModel: "laminar",
    reynoldsNumber: 1000,
    vvStatus: "PASSED",
    vvMetrics: { qCorePositive: true, lambda2CoreNegative: true },
  },
  zones: [
    {
      name: "VortexDomain",
      zoneType: "Structured",
      vertexDimensions: [nx, ny, nz],
      uniformSpacing: { dx },
      flowSolutions: [
        {
          name: "FlowSolution",
          gridLocation: "Vertex",
          fields: {
            VelocityX: vx,
            VelocityY: vy,
            VelocityZ: vz,
            QCriterion: features.qCriterion,
            Lambda2: features.lambda2,
            DucrosSensor: features.ducrosSensor,
          },
        },
      ],
      boundaryConditions: [
        {
          name: "InletXMin",
          type: "BCInflow",
          gridLocation: "Vertex",
          pointRange: [1, 1, 1, 1, ny, nz],
        },
        {
          name: "OutletXMax",
          type: "BCOutflow",
          gridLocation: "Vertex",
          pointRange: [nx, 1, 1, nx, ny, nz],
        },
        {
          name: "WallYMin",
          type: "BCWallViscous",
          gridLocation: "Vertex",
          pointRange: [1, 1, 1, nx, 1, nz],
        },
      ],
    },
  ],
});

// Round-trip through JSON.stringify / JSON.parse to confirm full JSON serializability
const roundTripped = JSON.parse(JSON.stringify(structuredTree));
const validation = validateCgnsTree(roundTripped);
console.log(
  `[CGNS Structured] valid=${validation.valid}, errors=${validation.errors.length}, ` +
    `stats=${JSON.stringify(validation.stats)}`,
);

assert.strictEqual(validation.valid, true, `CGNS validation failed: ${validation.errors.join("; ")}`);
assert.strictEqual(validation.stats.baseCount, 1);
assert.strictEqual(validation.stats.zoneCount, 1);
assert.strictEqual(validation.stats.fieldCount, 6);
assert.strictEqual(validation.stats.bcCount, 3);
assert.ok(validation.stats.descriptorCount >= 1);

// Verify Base64 round-trip fidelity for QCriterion
const baseNode = roundTripped.children.find((c: { label: string }) => c.label === "CGNSBase_t");
const zoneNode = baseNode.children.find((c: { label: string }) => c.label === "Zone_t");
const solNode = zoneNode.children.find((c: { label: string }) => c.label === "FlowSolution_t");
const qNode = solNode.children.find((c: { name: string }) => c.name === "QCriterion");
const decodedQ = decodeCgnsDataArray(qNode);
assert.ok(decodedQ instanceof Float64Array, "Expected decoded QCriterion to be Float64Array");
assert.strictEqual(decodedQ.length, features.qCriterion.length);
for (let i = 0; i < decodedQ.length; i++) {
  assert.strictEqual(decodedQ[i], features.qCriterion[i]);
}

// 2. Unstructured CGNS export with typed-array encoding
const unstructuredTree = exportToCgnsJson({
  baseName: "UnstructuredTetMesh",
  cellDimension: 3,
  physicalDimension: 3,
  encoding: "typed-array",
  zones: [
    {
      name: "TetZone",
      zoneType: "Unstructured",
      vertexDimensions: [4, 1, 4],
      coordinates: {
        x: Float64Array.from([0, 1, 0, 0]),
        y: Float64Array.from([0, 0, 1, 0]),
        z: Float64Array.from([0, 0, 0, 1]),
      },
      elements: [
        {
          name: "TetElements",
          elementType: "TETRA_4",
          elementRange: [1, 1],
          connectivity: Int32Array.from([1, 2, 3, 4]),
        },
      ],
      flowSolutions: [
        {
          gridLocation: "Vertex",
          fields: { Pressure: Float64Array.from([101325, 101320, 101318, 101315]) },
        },
      ],
      boundaryConditions: [
        {
          name: "FarfieldVerts",
          type: "BCFarfield",
          gridLocation: "Vertex",
          pointList: Int32Array.from([1, 2, 3, 4]),
        },
      ],
    },
  ],
});
const unstructVal = validateCgnsTree(unstructuredTree);
assert.strictEqual(unstructVal.valid, true, `Unstructured CGNS validation failed: ${unstructVal.errors.join("; ")}`);

// 3. Negative test: malformed tree must fail validation
const badValidation = validateCgnsTree({
  name: "BadRoot",
  label: "Zone_t",
  dataType: "MT",
  dimensions: [],
  children: [],
});
assert.strictEqual(badValidation.valid, false);
assert.ok(badValidation.errors.length > 0);
console.log("  [PASS] CGNS/SIDS structured & unstructured export + validation verified.");
