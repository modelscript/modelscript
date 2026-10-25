// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import {
  buildOlgaDiagram,
  renderOlgaBathymetry3dSvg,
  renderOlgaElevationProfileSvg,
  renderOlgaPvtEnvelopeSvg,
  renderOlgaSchematicSvg,
  renderOlgaSlugStatisticsSvg,
  renderOlgaWellboreIprSvg,
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
      pumps: [{ name: "BOOSTER_PUMP_1", position: 3500, type: "MULTIPHASE", ratedHead: 250 }],
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
assert.ok(diag.cells.length >= 6, "Graph should contain well, valve, pump, pipes, and separator cells");
console.log(`✔ AntV X6 graph built with ${diag.cells.length} cells!`);

// 2. Test renderOlgaSchematicSvg with Single & Multi-Flowpath Gathering Network
console.log("2. Testing renderOlgaSchematicSvg...");
const schematicSvg = renderOlgaSchematicSvg(sampleModel);
assert.ok(schematicSvg.includes("<svg"));
assert.ok(schematicSvg.includes("Subsea Gas-Condensate Tieback"));
assert.ok(schematicSvg.includes("SLUG CATCHER"));
assert.ok(schematicSvg.includes("PUMP"), "Must render booster pump badge");
console.log("✔ Schematic SVG rendered cleanly with pump!");

console.log("2b. Testing multi-flowpath gathering network layout...");
const multiModel = {
  title: "Multi-Well Gathering Hub",
  flowpaths: [
    {
      name: "BRANCH_NORTH",
      pipes: [{ label: "LINE_N", length: 1500, diameter: 0.254, elevation: -20 }],
      valves: [{ name: "CHOKE_N", position: 10, diameter: 0.1, opening: 0.8 }],
    },
    {
      name: "BRANCH_SOUTH",
      pipes: [{ label: "LINE_S", length: 1800, diameter: 0.254, elevation: -30 }],
      valves: [{ name: "CHOKE_S", position: 10, diameter: 0.1, opening: 0.6 }],
      compressors: [{ name: "COMP_S", position: 900, type: "CENTRIFUGAL", pressureRatio: 2.2 }],
    },
  ],
  nodes: [
    { name: "WELL_N", type: "WELL", flowpath: "BRANCH_NORTH", boundaryPosition: 0 },
    { name: "WELL_S", type: "WELL", flowpath: "BRANCH_SOUTH", boundaryPosition: 0 },
    { name: "CENTRAL_MANIFOLD", type: "JUNCTION", flowpath: "BRANCH_NORTH", boundaryPosition: 1 },
  ],
};
const multiDiag = buildOlgaDiagram(multiModel);
assert.ok(
  multiDiag.cells.some((c) => c.data?.kind === "junction"),
  "Must include central manifold junction",
);
assert.ok(
  multiDiag.cells.some((c) => c.data?.kind === "compressor"),
  "Must include compressor",
);
const multiSvg = renderOlgaSchematicSvg(multiModel);
assert.ok(multiSvg.includes("CENTRAL_MANIFOLD"));
assert.ok(multiSvg.includes("COMP"));
console.log("✔ Multi-flowpath gathering network rendered cleanly with manifold convergence!");

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

// 4. Test renderOlgaPvtEnvelopeSvg
console.log("4. Testing renderOlgaPvtEnvelopeSvg...");
const pvtSvg = renderOlgaPvtEnvelopeSvg(
  {
    criticalPoint: { pressureBar: 145, temperatureC: 48 },
  },
  undefined,
  "Gas-Condensate Fluid",
);
assert.ok(pvtSvg.includes("<svg"));
assert.ok(pvtSvg.includes("PVT P-T Phase Envelope"));
assert.ok(pvtSvg.includes("2-PHASE GAS + LIQUID"));
assert.ok(pvtSvg.includes("HYDRATE RISK ZONE"));
assert.ok(pvtSvg.includes("Critical Point (48°C, 145 bar)"));
console.log("✔ PVT P-T Phase Envelope SVG rendered cleanly with hydrate zone and operational trajectory!");

// 5. Test renderOlgaWellboreIprSvg
console.log("5. Testing renderOlgaWellboreIprSvg...");
const wellboreSvg = renderOlgaWellboreIprSvg(
  {
    type: "VOGEL",
    reservoirPressure: 220e5,
    maxLiquidRate: 85.0,
  },
  "PRODUCER_WELL_01",
  38.5,
  142.0,
);
assert.ok(wellboreSvg.includes("<svg"));
assert.ok(wellboreSvg.includes("PRODUCER_WELL_01"));
assert.ok(wellboreSvg.includes("DOWNHOLE COMPLETION"));
assert.ok(wellboreSvg.includes("DHSV"));
assert.ok(wellboreSvg.includes("PERFORATIONS"));
assert.ok(wellboreSvg.includes("VOGEL / FETKOVICH INFLOW DELIVERABILITY"));
assert.ok(wellboreSvg.includes("Operating Point"));
console.log("✔ Wellbore Completion & IPR Deliverability SVG rendered cleanly!");

// 6. Test renderOlgaSlugStatisticsSvg
console.log("6. Testing renderOlgaSlugStatisticsSvg...");
const slugSvg = renderOlgaSlugStatisticsSvg(
  {
    times: [0, 600, 1200, 1800],
    profiles: [],
    trends: {
      peakLiquidSurgeVolume: 64.2,
      meanSlugLength: [85],
    },
  },
  150.0,
);
assert.ok(slugSvg.includes("<svg"));
assert.ok(slugSvg.includes("SLUG LENGTH DISTRIBUTION"));
assert.ok(slugSvg.includes("SLUG CATCHER LIQUID SURGE DYNAMICS"));
assert.ok(slugSvg.includes("85% Limit: 127.5 m³"));
assert.ok(slugSvg.includes("SAFE: Peak Surge 64.2 m³"));
console.log("✔ Slug Statistics & Topside Surge Capacity SVG rendered cleanly!");

// 7. Test renderOlgaBathymetry3dSvg
console.log("7. Testing renderOlgaBathymetry3dSvg (3D Seabed & Survey Route)...");
const bathySvg = renderOlgaBathymetry3dSvg(sampleModel);
assert.ok(bathySvg.includes("<svg"));
assert.ok(bathySvg.includes("3D Offshore Seabed Bathymetry & Pipeline Route"));
assert.ok(bathySvg.includes("WELLHEAD"));
assert.ok(bathySvg.includes("PLATFORM"));
assert.ok(bathySvg.includes("3D Compass"));
assert.ok(bathySvg.includes("TOTAL ROUTE DISTANCE"));
console.log("✔ 3D Offshore Seabed Bathymetry SVG rendered cleanly!");

console.log("=== All OLGA Diagram Builder Tests Passed! ===");
