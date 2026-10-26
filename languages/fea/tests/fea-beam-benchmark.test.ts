// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getFeaDialect } from "../src/index.js";

describe("Abaqus/CalculiX Structural & Dynamic Beam Benchmark", () => {
  const dynamicBeamDeckTemplate = `** ─────────────────────────────────────────────────────────────────────────────
** Abaqus / CalculiX Structural & Dynamic Modal Beam Benchmark
** Validation case: Euler-Bernoulli & Timoshenko Cantilever Beam
** ─────────────────────────────────────────────────────────────────────────────
*HEADING
Dynamic Cantilever Beam Analysis: {{ Beam.name }}
*NODE
1, 0.0, 0.0, 0.0
2, 0.0, {{ Beam.width }}, 0.0
3, 0.0, {{ Beam.width }}, {{ Beam.height }}
4, 0.0, 0.0, {{ Beam.height }}
5, {{ Beam.length * 0.5 }}, 0.0, 0.0
6, {{ Beam.length * 0.5 }}, {{ Beam.width }}, 0.0
7, {{ Beam.length * 0.5 }}, {{ Beam.width }}, {{ Beam.height }}
8, {{ Beam.length * 0.5 }}, 0.0, {{ Beam.height }}
9, {{ Beam.length }}, 0.0, 0.0
10, {{ Beam.length }}, {{ Beam.width }}, 0.0
11, {{ Beam.length }}, {{ Beam.width }}, {{ Beam.height }}
12, {{ Beam.length }}, 0.0, {{ Beam.height }}
*ELEMENT, TYPE=C3D8R, ELSET=BEAM_ROOT
1, 1, 2, 3, 4, 5, 6, 7, 8
*ELEMENT, TYPE=C3D8R, ELSET=BEAM_TIP
2, 5, 6, 7, 8, 9, 10, 11, 12
*MATERIAL, NAME={{ Beam.material }}
*ELASTIC
 {{ Beam.youngsModulus }}, {{ Beam.poissonsRatio }}
*DENSITY
 {{ Beam.density }}
*BOUNDARY
1, 1, 3
2, 1, 3
3, 1, 3
4, 1, 3
*STEP, NAME=STATIC_TIP_LOAD
*STATIC
*CLOAD
11, 3, {{ Beam.tipLoad }}
12, 3, {{ Beam.tipLoad }}
*END STEP
*STEP, NAME=MODAL_FREQUENCY
*FREQUENCY
 5
*END STEP
`;

  it("materializes dynamic cantilever beam parameters across geometric and material sweeps", () => {
    const dialect = getFeaDialect("inp");

    const cases = [
      {
        name: "Steel_IBeam",
        length: 2.5,
        width: 0.15,
        height: 0.3,
        material: "STRUCTURAL_STEEL_A36",
        youngsModulus: 200e9,
        poissonsRatio: 0.29,
        density: 7850,
        tipLoad: -15000.0,
      },
      {
        name: "Aluminum_Spar",
        length: 1.8,
        width: 0.1,
        height: 0.2,
        material: "ALUMINUM_7075_T6",
        youngsModulus: 71.7e9,
        poissonsRatio: 0.33,
        density: 2810,
        tipLoad: -8500.0,
      },
    ];

    for (const c of cases) {
      const materialized = dialect.materialize(dynamicBeamDeckTemplate, {
        evaluator: {
          "Beam.name": c.name,
          "Beam.length": c.length,
          "Beam.width": c.width,
          "Beam.height": c.height,
          "Beam.material": c.material,
          "Beam.youngsModulus": c.youngsModulus,
          "Beam.poissonsRatio": c.poissonsRatio,
          "Beam.density": c.density,
          "Beam.tipLoad": c.tipLoad,
        },
      });

      assert.ok(materialized.includes(`Dynamic Cantilever Beam Analysis: ${c.name}`));
      assert.ok(materialized.includes(`*MATERIAL, NAME=${c.material}`));
      assert.ok(materialized.includes(`*DENSITY\n ${c.density}`));

      // Parse the deck into canonical FeaModelData
      const parsed = dialect.parse(materialized);
      assert.strictEqual(parsed.dialect, "inp");
      assert.strictEqual(parsed.nodes.size, 12);
      assert.strictEqual(parsed.elements.size, 2);

      // Verify root element and tip element
      const rootElem = parsed.elements.get(1);
      assert.ok(rootElem);
      assert.strictEqual(rootElem.type, "C3D8R");
      assert.strictEqual(rootElem.nodes.length, 8);

      const tipElem = parsed.elements.get(2);
      assert.ok(tipElem);
      assert.strictEqual(tipElem.type, "C3D8R");

      // Verify material properties
      const mat = parsed.materials.get(c.material);
      assert.ok(mat, `Material ${c.material} should be parsed`);
      assert.strictEqual(mat.E, c.youngsModulus);
      assert.strictEqual(mat.nu, c.poissonsRatio);
      assert.strictEqual(mat.rho, c.density);

      // Verify fixed root boundary conditions
      assert.ok(parsed.fixedNodes.has(1));
      assert.ok(parsed.fixedNodes.has(2));
      assert.ok(parsed.fixedNodes.has(3));
      assert.ok(parsed.fixedNodes.has(4));

      // Verify tip nodal loads
      const tipLoad11 = parsed.nodalLoads.get(11);
      assert.ok(tipLoad11);
      assert.strictEqual(tipLoad11[2], c.tipLoad);
    }
  });

  it("validates multi-step deck with static loading and eigenmode frequency extraction", () => {
    const dialect = getFeaDialect("inp");
    const materialized = dialect.materialize(dynamicBeamDeckTemplate, {
      evaluator: {
        "Beam.name": "ModalBeam",
        "Beam.length": 2.0,
        "Beam.width": 0.1,
        "Beam.height": 0.2,
        "Beam.material": "STEEL",
        "Beam.youngsModulus": 210e9,
        "Beam.poissonsRatio": 0.3,
        "Beam.density": 7850,
        "Beam.tipLoad": -5000.0,
      },
    });

    const parsed = dialect.parse(materialized);
    assert.ok(parsed.elementSets.has("BEAM_ROOT"), "Should parse BEAM_ROOT ELSET");
    assert.ok(parsed.elementSets.has("BEAM_TIP"), "Should parse BEAM_TIP ELSET");
    assert.ok(parsed.elementSets.get("BEAM_ROOT")?.has(1));
    assert.ok(parsed.elementSets.get("BEAM_TIP")?.has(2));
    assert.ok(materialized.includes("*STEP, NAME=STATIC_TIP_LOAD"));
    assert.ok(materialized.includes("*STEP, NAME=MODAL_FREQUENCY"));
    assert.ok(materialized.includes("*FREQUENCY"));
    assert.ok(materialized.includes("*CLOAD"));
  });
});
