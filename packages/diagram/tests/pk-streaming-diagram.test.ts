// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  attachSimulationTrajectoryToPkDiagram,
  buildPkDiagramFromGeneric,
  interpolatePkConcentration,
  reconcilePkDiagramChangeToMlxtran,
  renderPkDiagramSvgWithStreaming,
  renderPkSparklineSvg,
  type PkDiagramGraph,
} from "../src/pk-diagram-builder.js";

describe("PK/PD Live Simulation Streaming & Bi-Directional Writeback", () => {
  const times = [0, 0.5, 1.0, 2.0, 4.0, 8.0, 12.0, 24.0];
  const centralValues = [0, 8.5, 15.2, 18.4, 14.1, 8.5, 4.2, 0.9];
  const depotValues = [100, 60.0, 36.0, 13.0, 1.7, 0.03, 0.0, 0.0];

  it("interpolates concentration values across simulation trajectory steps", () => {
    // Exact boundary endpoints
    assert.equal(interpolatePkConcentration(times, centralValues, 0), 0);
    assert.equal(interpolatePkConcentration(times, centralValues, 24.0), 0.9);

    // Intermediate linear interpolation
    const interpHalf = interpolatePkConcentration(times, centralValues, 0.25);
    assert.ok(Math.abs(interpHalf - 4.25) < 1e-6);

    const interpPeak = interpolatePkConcentration(times, centralValues, 1.5);
    assert.ok(Math.abs(interpPeak - 16.8) < 1e-6);

    // Beyond boundaries
    assert.equal(interpolatePkConcentration(times, centralValues, -5), 0);
    assert.equal(interpolatePkConcentration(times, centralValues, 50), 0.9);
  });

  it("renders sparkline SVG with interactive time scrub bar indicator", () => {
    const sparkline = renderPkSparklineSvg(times, centralValues, {
      width: 100,
      height: 40,
      lineColor: "#38bdf8",
      currentTime: 1.5,
    });

    assert.ok(sparkline.includes("<svg"), "Should output valid SVG root");
    assert.ok(sparkline.includes("<polyline"), "Should render polyline trace");
    assert.ok(sparkline.includes('stroke="#f59e0b"'), "Should render vertical scrubber bar at currentTime");
    assert.ok(sparkline.includes("<circle"), "Should render scrubber tracking dot");
  });

  it("renders live streaming PK diagram with timeline scrubber badge and pulsating wash", () => {
    const graph: PkDiagramGraph = buildPkDiagramFromGeneric({
      title: "Warfarin Two-Compartment Model",
      hasDepot: true,
      hasPeripheral: true,
    });

    attachSimulationTrajectoryToPkDiagram(graph, {
      depot: { times, values: depotValues },
      central: { times, values: centralValues },
    });

    const svgPlaying = renderPkDiagramSvgWithStreaming(graph, {
      currentTime: 2.0,
      isPlaying: true,
      theme: "dark",
    });

    assert.ok(svgPlaying.includes("t = 2.00 h"), "Should render timeline scrubber time indicator");
    assert.ok(svgPlaying.includes("PLAYING"), "Should render PLAYING status badge");
    assert.ok(svgPlaying.includes("node-glow"), "Should include animated node glow filter");
    assert.ok(
      svgPlaying.includes("C(t): 18.40 mg/L"),
      "Should render live interpolated C(t) badge for central compartment",
    );
    assert.ok(svgPlaying.includes("13.00 mg"), "Should render live interpolated C(t) for depot compartment");

    const svgPaused = renderPkDiagramSvgWithStreaming(graph, {
      currentTime: 4.0,
      isPlaying: false,
      theme: "light",
    });
    assert.ok(svgPaused.includes("PAUSED"), "Should render PAUSED status badge");
    assert.ok(svgPaused.includes("t = 4.00 h"));
  });

  it("reconciles all 8 visual diagram mutations back into MLXTRAN longitudinal code", () => {
    const baseCode = `[LONGITUDINAL]
input = {ka = 0.5, V = 10.0, Cl = 1.2}

EQUATION:
ddt_A_depot = -ka * A_depot
ddt_A_central = ka * A_depot - (Cl / V) * A_central
Cc = A_central / V
`;

    // 1. add_peripheral
    const codeWithPeri = reconcilePkDiagramChangeToMlxtran(baseCode, {
      type: "add_peripheral",
      v2Param: "V2",
      qParam: "Q",
    });
    assert.ok(codeWithPeri.includes("V2 = 20.0"));
    assert.ok(codeWithPeri.includes("Q = 5.0"));
    assert.ok(codeWithPeri.includes("ddt_A_peripheral"));

    // 2. remove_peripheral
    const codeWithoutPeri = reconcilePkDiagramChangeToMlxtran(codeWithPeri, {
      type: "remove_peripheral",
      id: "peripheral",
    });
    assert.ok(!codeWithoutPeri.includes("ddt_A_peripheral"));

    // 3. add_depot
    const ivOnlyCode = `[LONGITUDINAL]
input = {V = 10.0, Cl = 1.2}

EQUATION:
ddt_A_central = -(Cl / V) * A_central
`;
    const codeWithDepot = reconcilePkDiagramChangeToMlxtran(ivOnlyCode, {
      type: "add_depot",
      kaParam: "ka",
    });
    assert.ok(codeWithDepot.includes("ka = 1.0"));
    assert.ok(codeWithDepot.includes("ddt_A_depot = -ka * A_depot"));

    // 4. remove_depot
    const codeDepotRemoved = reconcilePkDiagramChangeToMlxtran(baseCode, {
      type: "remove_depot",
    });
    assert.ok(!codeDepotRemoved.includes("ddt_A_depot"));

    // 5. update_parameter
    const codeUpdatedParam = reconcilePkDiagramChangeToMlxtran(baseCode, {
      type: "update_parameter",
      name: "Cl",
      value: 2.4,
    });
    assert.ok(codeUpdatedParam.includes("Cl = 2.4"));

    // 6. update_volume
    const codeUpdatedVol = reconcilePkDiagramChangeToMlxtran(baseCode, {
      type: "update_volume",
      compartmentId: "central",
      volume: 15.5,
    });
    assert.ok(codeUpdatedVol.includes("V = 15.5"));

    // 7. connect_clearance
    const codeClearance = reconcilePkDiagramChangeToMlxtran(baseCode, {
      type: "connect_clearance",
      sourceId: "central",
      clParam: "Cl_renal",
    });
    assert.ok(codeClearance.includes("Cl_renal"));

    // 8. add_dosing
    const codeWithDosing = reconcilePkDiagramChangeToMlxtran(baseCode, {
      type: "add_dosing",
      targetId: "depot",
      route: "oral",
    });
    assert.ok(codeWithDosing.includes("[PK]"));
    assert.ok(codeWithDosing.includes("oral(cmt=1)"));
  });
});
