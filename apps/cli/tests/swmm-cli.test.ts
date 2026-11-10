// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { SwmmCommand } from "../src/commands/swmm.js";

const CLI_SWMM_INP = `[TITLE]
CLI Municipal Drainage Test

[OPTIONS]
FLOW_UNITS          CMS
FLOW_ROUTING        DYNWAVE

[JUNCTIONS]
J1               10.00      2.50       0.50
J2               8.00       2.50       0.40

[OUTFALLS]
BAY1             5.00       FREE

[CONDUITS]
PIPE1            J1         J2         80.00      0.013
PIPE2            J2         BAY1       120.00     0.013

[XSECTIONS]
PIPE1            CIRCULAR   1.20
PIPE2            CIRCULAR   1.50
`;

test("SWMM CLI Commands (msx swmm inspect, lint, to-dae, to-modelica, route-flow)", async (t) => {
  const tmpDir = path.resolve(process.cwd(), "data/scratch_swmm_cli");
  fs.mkdirSync(tmpDir, { recursive: true });

  const swmmFile = path.join(tmpDir, "network.inp");
  fs.writeFileSync(swmmFile, CLI_SWMM_INP, "utf-8");

  await t.test("msx swmm inspect / summary", async () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => logs.push(args.join(" "));

    try {
      await (SwmmCommand.handler as any)({
        action: "inspect",
        files: [swmmFile],
      });
      assert.ok(logs.some((l) => l.includes("SWMM Network: CLI Municipal Drainage Test")));
      assert.ok(logs.some((l) => l.includes("Junctions:        2")));
      assert.ok(logs.some((l) => l.includes("Conduits:         2")));
    } finally {
      console.log = origLog;
    }
  });

  await t.test("msx swmm lint", async () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => logs.push(args.join(" "));

    try {
      await (SwmmCommand.handler as any)({
        action: "lint",
        files: [swmmFile],
      });
      assert.ok(logs.some((l) => l.includes("No hydraulic network or slope diagnostics found")));
    } finally {
      console.log = origLog;
    }
  });

  await t.test("msx swmm to-dae", async () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => logs.push(args.join(" "));

    try {
      await (SwmmCommand.handler as any)({
        action: "to-dae",
        files: [swmmFile],
      });
      assert.ok(logs.some((l) => l.includes("Lowered network to DAE arena:")));
      assert.ok(logs.some((l) => l.includes("Variables:")));
    } finally {
      console.log = origLog;
    }
  });

  await t.test("msx swmm to-modelica", async () => {
    const outFile = path.join(tmpDir, "network.mo");
    await (SwmmCommand.handler as any)({
      action: "to-modelica",
      files: [swmmFile],
      out: outFile,
    });
    assert.ok(fs.existsSync(outFile));
    const content = fs.readFileSync(outFile, "utf-8");
    assert.match(content, /model CLI_Municipal_Drainage_Test/);
    assert.match(content, /import Modelica\.Units\.SI;/);
  });

  await t.test("msx swmm route-flow", async () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => logs.push(args.join(" "));

    try {
      await (SwmmCommand.handler as any)({
        action: "route-flow",
        files: [swmmFile],
      });
      assert.ok(logs.some((l) => l.includes("SWMM Hydraulic Routing Summary")));
      assert.ok(logs.some((l) => l.includes("PIPE1")));
      assert.ok(logs.some((l) => l.includes("PIPE2")));
    } finally {
      console.log = origLog;
    }
  });

  await t.test("msx swmm from-gis", async () => {
    const conduitsGeoJsonFile = path.join(tmpDir, "conduits.geojson");
    const outDeckFile = path.join(tmpDir, "gis_deck.inp");
    fs.writeFileSync(
      conduitsGeoJsonFile,
      JSON.stringify({
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            id: "STORM_C1",
            properties: { diameter: 0.75, roughness: 0.013 },
            geometry: {
              type: "LineString",
              coordinates: [
                [10, 20],
                [50, 60],
              ],
            },
          },
        ],
      }),
      "utf-8",
    );

    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => logs.push(args.join(" "));

    try {
      await (SwmmCommand.handler as any)({
        action: "from-gis",
        files: [conduitsGeoJsonFile],
        out: outDeckFile,
        diameter: 0.75,
        title: "CLI SWMM GIS Network",
      });

      assert.ok(fs.existsSync(outDeckFile));
      const inp = fs.readFileSync(outDeckFile, "utf-8");
      assert.ok(inp.includes("CLI SWMM GIS Network"));
      assert.ok(inp.includes("STORM_C1"));
      assert.ok(logs.some((l) => l.includes("SWMM GIS Ingestion Succeeded")));
      assert.ok(logs.some((l) => l.includes("Conduits:      1")));
    } finally {
      console.log = origLog;
    }
  });

  await t.test("msx swmm convert", async () => {
    const tableDumpFile = path.join(tmpDir, "infoworks_model.json");
    const outInpFile = path.join(tmpDir, "converted_infoworks.inp");

    fs.writeFileSync(
      tableDumpFile,
      JSON.stringify({
        hw_node: [
          { node_id: "MH_IW1", ground_level: 15.0, chamber_floor: 12.0, node_type: "MANHOLE" },
          { node_id: "OUT_IW1", ground_level: 10.0, chamber_floor: 8.5, node_type: "OUTFALL" },
        ],
        hw_conduit: [
          { conduit_id: "COND_IW1", us_node_id: "MH_IW1", ds_node_id: "OUT_IW1", length: 100.0, conduit_width: 0.75 },
        ],
      }),
      "utf-8",
    );

    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => logs.push(args.join(" "));

    try {
      await (SwmmCommand.handler as any)({
        action: "convert",
        files: [tableDumpFile],
        out: outInpFile,
      });

      assert.ok(fs.existsSync(outInpFile));
      const inp = fs.readFileSync(outInpFile, "utf-8");
      assert.ok(inp.includes("MH_IW1"));
      assert.ok(inp.includes("OUT_IW1"));
      assert.ok(inp.includes("COND_IW1"));
      assert.ok(logs.some((l) => l.includes("Conversion Summary:")));
    } finally {
      console.log = origLog;
    }
  });

  await t.test("msx swmm inundate-2d", async () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => logs.push(args.join(" "));

    try {
      await (SwmmCommand.handler as any)({
        action: "inundate-2d",
        files: [swmmFile],
      });

      assert.ok(logs.some((l) => l.includes("2D Surface Inundation & Overland Flood Simulation")));
      assert.ok(logs.some((l) => l.includes("Peak Inundated Surface Area:")));
      assert.ok(logs.some((l) => l.includes("Cumulative Manhole Overflow:")));
    } finally {
      console.log = origLog;
    }
  });

  // Cleanup
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
