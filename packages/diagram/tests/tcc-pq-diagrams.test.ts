// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { renderPqDiagramSvg } from "../src/pq-diagram-builder.js";
import { renderTccDiagramSvg } from "../src/tcc-diagram-builder.js";

test("renderTccDiagramSvg: generates valid SVG log-log coordination chart with CTI markers", () => {
  const svg = renderTccDiagramSvg({
    title: "Feeder vs Substation Transformer Coordination",
    curves: [
      {
        id: "feeder_cb",
        name: "Feeder Relay (51)",
        color: "#38bdf8",
        points: [
          [200, 10.0],
          [500, 2.0],
          [1000, 0.8],
          [3000, 0.2],
          [5000, 0.05],
        ],
      },
      {
        id: "transformer_cb",
        name: "Main Breaker (51)",
        color: "#f59e0b",
        points: [
          [500, 15.0],
          [1000, 3.5],
          [2000, 1.2],
          [3000, 0.55], // at 3000A: Feeder 0.20s vs Main 0.55s -> CTI = 0.35s
          [5000, 0.38],
        ],
      },
      {
        id: "transformer_damage",
        name: "Transformer Damage (ANSI C57.109)",
        color: "#ef4444",
        points: [
          [1000, 100.0],
          [3000, 10.0],
          [6000, 2.0],
        ],
        isDamageCurve: true,
      },
    ],
    marginMarkers: [
      {
        currentA: 3000,
        timePrimarySec: 0.20,
        timeBackupSec: 0.55,
        ctiSec: 0.35,
      },
    ],
  });

  assert.ok(svg.startsWith("<svg"), "Must output valid SVG root element");
  assert.ok(svg.includes("Feeder Relay (51)"), "Must include feeder relay curve label");
  assert.ok(svg.includes("Main Breaker (51)"), "Must include main breaker curve label");
  assert.ok(svg.includes("CTI: 0.35s"), "Must display CTI margin badge");
  assert.ok(svg.includes("stroke-dasharray"), "Damage curve must use dashed line");
  assert.ok(svg.endsWith("</svg>"), "Must properly close SVG tag");
});

test("renderPqDiagramSvg: generates valid SVG generator operating chart with armature & grid code limits", () => {
  const svg = renderPqDiagramSvg({
    title: "Gas Turbine Unit 1 P-Q Capability Curve",
    ratedMva: 100.0,
    maxActivePowerMw: 90.0,
    maxLaggingMvar: 60.0,
    maxLeadingMvar: 40.0,
    gridCodeEnvelope: {
      pMinMw: 20.0,
      pMaxMw: 90.0,
      qMinMvar: -33.0,
      qMaxMvar: 33.0,
      label: "ENTSO-E Type D Capability Limit",
    },
    currentOperatingPoint: {
      pMw: 75.0,
      qMvar: 15.0,
      label: "Full Load Operating Point",
    },
    operatingTrajectory: [
      [20.0, 0.0],
      [50.0, 10.0],
      [75.0, 15.0],
    ],
  });

  assert.ok(svg.startsWith("<svg"), "Must output valid SVG root element");
  assert.ok(svg.includes("Armature Heating Limit"), "Must include armature heating circle");
  assert.ok(svg.includes("ENTSO-E Type D Capability Limit"), "Must include grid code envelope");
  assert.ok(svg.includes("Full Load Operating Point"), "Must include operating point marker");
  assert.ok(svg.endsWith("</svg>"), "Must close SVG tag");
});
