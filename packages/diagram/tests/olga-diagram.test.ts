// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import {
  buildOlgaDiagram,
  renderOlgaElevationProfileSvg,
  renderOlgaSchematicSvg,
} from "../src/olga-diagram-builder.js";

console.log("=== Testing OLGA Diagram Builder ===");

const sampleModel = {
  title: "Subsea Gas-Condensate Tieback",
  flowpaths: [
    {
      name: "FLOWLINE_A",
      pipes: [
        { label: "PIPE_SEABED", length: 4200, diameter: 0.3048, elevation: -800 },
        { label: "RISER_CATENARY", length: 1100, diameter: 0.3048, elevation: 820 },
      ],
      valves: [{ name: "CHOKE_VALVE", position: 5200, diameter: 0.15, opening: 0.75 }],
    },
  ],
  nodes: [
    { name: "WELL_1", type: "TERMINAL", flowpath: "FLOWLINE_A", boundaryPosition: 0 },
    { name: "SEP_1", type: "SEPARATOR", flowpath: "FLOWLINE_A", boundaryPosition: 1 },
  ],
};

// 1. Test buildOlgaDiagram (AntV X6 graph)
console.log("1. Testing buildOlgaDiagram...");
const diag = buildOlgaDiagram(sampleModel);
assert.strictEqual(diag.title, "Subsea Gas-Condensate Tieback");
assert.ok(diag.cells.length >= 5, "Graph should contain well, valve, pipes, and separator cells");
console.log(`✔ AntV X6 graph built with ${diag.cells.length} cells!`);

// 2. Test renderOlgaSchematicSvg
console.log("2. Testing renderOlgaSchematicSvg...");
const schematicSvg = renderOlgaSchematicSvg(sampleModel);
assert.ok(schematicSvg.includes("<svg"));
assert.ok(schematicSvg.includes("Subsea Gas-Condensate Tieback"));
assert.ok(schematicSvg.includes("SLUG CATCHER"));
console.log("✔ Schematic SVG rendered cleanly!");

// 3. Test renderOlgaElevationProfileSvg with slugs and scraper pig
console.log("3. Testing renderOlgaElevationProfileSvg with slugs and pigging...");
const elevationSvg = renderOlgaElevationProfileSvg(sampleModel, {
  times: [0, 10],
  profiles: [
    {
      time: 10,
      x: [1000, 2000, 3000, 4200, 5300],
      pressure: [120e5, 100e5, 80e5, 60e5, 32e5],
      temperature: [340, 320, 300, 290, 285],
      liquidHoldup: [0.15, 0.22, 0.45, 0.65, 0.35],
      activeSlugs: [
        {
          id: 1,
          tailPosition: 2500,
          frontPosition: 2850,
          length: 350,
          holdup: 0.88,
          velocity: 3.2,
        },
      ],
      pigs: [
        {
          name: "CLEANING_PIG_01",
          position: 1800,
          velocity: 2.4,
          differentialPressure: 2.5e5,
          sweptLiquidVolume: 42.8,
          isStuck: false,
        },
      ],
    },
  ],
});
assert.ok(elevationSvg.includes("<svg"));
assert.ok(elevationSvg.includes("Pipeline Elevation Bathymetry Z(X)"));
assert.ok(elevationSvg.includes("Min Hydrate Margin"));
assert.ok(elevationSvg.includes("Slug (High α_L)"));
assert.ok(elevationSvg.includes("SLUG #1 (L=350m, v=3.2m/s)"));
assert.ok(elevationSvg.includes("PIG: CLEANING_PIG_01"));
console.log("✔ Elevation Bathymetry SVG rendered cleanly with discrete slugs, scraper pig, and hydrate margin!");

console.log("=== All OLGA Diagram Builder Tests Passed! ===");
