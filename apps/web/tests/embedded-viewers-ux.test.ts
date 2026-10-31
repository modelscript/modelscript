// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { renderKinematicDiagramSvg } from "@modelscript/diagram/kinematic-diagram-builder";
import { renderOlgaSchematicSvg } from "@modelscript/diagram/olga-diagram-builder";
import { renderPscadSvg } from "@modelscript/diagram/pscad-diagram-builder";
import { renderPsseSldSvg } from "@modelscript/diagram/psse-diagram-builder";
import { renderSimulinkSvg } from "@modelscript/diagram/simulink-diagram-builder";
import { applyLspTextEditsToString } from "../src/components/morsel/util/text-edits.js";

describe("Embedded Artifact Viewers UX/UI & Diagram Editing Regression Suite", () => {
  describe("1. Diagram-Only Editing Without Mounted Monaco Editor (applyLspTextEditsToString)", () => {
    it("applies single-line LSP text edits accurately when Monaco is unmounted", () => {
      const source = [
        "model RC",
        "  Resistor R1(R=10);",
        "  Capacitor C1(C=0.01);",
        "equation",
        "  connect(R1.n, C1.p);",
        "end RC;",
      ].join("\n");

      const updated = applyLspTextEditsToString(source, [
        {
          range: {
            start: { line: 1, character: 16 },
            end: { line: 1, character: 18 },
          },
          newText: "47",
        },
      ]);

      assert.ok(updated.includes("Resistor R1(R=47);"));
      assert.ok(updated.includes("connect(R1.n, C1.p);"));
    });

    it("applies multiple non-overlapping LSP edits in reverse document order without offset drift", () => {
      const source = ["line0", "line1", "line2"].join("\n");
      const updated = applyLspTextEditsToString(source, [
        {
          range: {
            start: { line: 0, character: 4 },
            end: { line: 0, character: 5 },
          },
          newText: "_A",
        },
        {
          range: {
            start: { line: 2, character: 4 },
            end: { line: 2, character: 5 },
          },
          newText: "_C",
        },
      ]);

      assert.strictEqual(updated, ["line_A", "line1", "line_C"].join("\n"));
    });

    it("returns original text unchanged when edits array is empty", () => {
      const source = "model Test\nend Test;";
      assert.strictEqual(applyLspTextEditsToString(source, []), source);
    });
  });

  describe("2. Client-Side Engineering Schematic Synthesis Fallbacks", () => {
    it("synthesizes PSCAD EMT schematic SVG from source when viewConfig.svg is absent", () => {
      const svg = renderPscadSvg({
        name: "IEEE 39-Bus EMT Feeder",
        rootModule: {
          name: "Main",
          buses: [],
          components: [
            {
              id: "G1",
              definitionName: "master:source_3",
              instanceName: "SyncGen1",
              position: { x: 120, y: 140 },
              parameters: { Name: "SyncGen1", Vbase: "345" },
            },
            {
              id: "T1",
              definitionName: "master:xfmr-3p2w",
              instanceName: "StepUp_T1",
              position: { x: 320, y: 140 },
              parameters: { Name: "StepUp_T1", Tmva: "500" },
            },
          ],
          wires: [
            {
              id: "W1",
              vertices: [
                { x: 160, y: 140 },
                { x: 320, y: 140 },
              ],
            },
          ],
        },
      });
      assert.ok(svg.includes("<svg"), "Must produce valid SVG markup");
      assert.ok(svg.includes("SyncGen1"), "Must include generator label");
    });

    it("synthesizes PSS/E Single-Line Diagram SVG from buses and branches", () => {
      const svg = renderPsseSldSvg({
        title1: "WECC 9-Bus System",
        buses: [
          { i: 1, name: "BUS-1", baseKv: 230, ide: 3, vm: 1.04, va: 0 },
          { i: 2, name: "BUS-2", baseKv: 230, ide: 2, vm: 1.025, va: 9.3 },
        ],
        branches: [{ i: 1, j: 2, ckt: "1", r: 0.01, x: 0.085, b: 0.176, st: 1 }],
        generators: [{ i: 1, id: "1", pg: 71.6, qg: 27.0, stat: 1 }],
        loads: [{ i: 2, id: "1", pl: 125.0, ql: 50.0, status: 1 }],
      });
      assert.ok(svg.includes("<svg"), "Must produce valid SLD SVG");
      assert.ok(svg.includes("BUS-1"), "Must render bus labels");
    });

    it("synthesizes OLGA multiphase pipeline profile and kinematic multibody schematics", () => {
      const olgaSvg = renderOlgaSchematicSvg({
        title: "Subsea Tieback Flowline",
        flowpaths: [
          {
            name: "Flowline-1",
            pipes: [
              { label: "P1", length: 2500, elevation: -120, diameter: 0.3 },
              { label: "P2", length: 800, elevation: 450, diameter: 0.25 },
            ],
            valves: [{ name: "CHOKE-1", position: 3000, diameter: 0.2, opening: 0.8 }],
          },
        ],
        nodes: [
          { name: "WELLHEAD", type: "MASS", flowpath: "Flowline-1", boundaryPosition: 0, pressure: 120 },
          { name: "SEPARATOR", type: "PRESSURE", flowpath: "Flowline-1", boundaryPosition: 3300, pressure: 45 },
        ],
      });
      assert.ok(olgaSvg.includes("<svg"), "Must produce OLGA schematic SVG");

      const mbdSvg = renderKinematicDiagramSvg({
        name: "BoBo Railway Bogie",
        dialect: "SIMPACK",
        bodies: [
          { id: "Ground", name: "Inertial Ground", isGround: true },
          { id: "Carbody", name: "Carbody", mass: 32000 },
          { id: "Bogie1", name: "Bogie1", mass: 2600 },
        ],
        joints: [
          { id: "J_Yaw", name: "J_Yaw", type: "revolute", fromBody: "Ground", toBody: "Bogie1" },
          { id: "J_Sec", name: "J_Sec", type: "spring_damper", fromBody: "Bogie1", toBody: "Carbody" },
        ],
      });
      assert.ok(mbdSvg.includes("<svg"), "Must produce SIMPACK/GENSYS kinematic SVG");
    });

    it("synthesizes Easy5 / Simulink control block schematics", () => {
      const easy5Svg = renderSimulinkSvg({
        name: "Flight Actuator Loop",
        blocks: [
          { name: "CMD", type: "Inport", position: { x: 60, y: 80, width: 100, height: 50 } },
          { name: "SERVO", type: "TransferFcn", position: { x: 240, y: 80, width: 120, height: 54 } },
        ],
        lines: [{ id: "L1", srcBlock: "CMD", srcPort: 1, dstBlock: "SERVO", dstPort: 1 }],
      });
      assert.ok(easy5Svg.includes("<svg"), "Must produce Simulink/Easy5 SVG");
    });
  });

  describe("3. Multi-Instance Isolation & Responsive Viewport Contracts", () => {
    it("isolates X6 Graph instances per container in @modelscript/diagram", () => {
      const diagramSrc = fs.readFileSync(
        path.resolve(import.meta.dirname, "../../../packages/diagram/src/index.ts"),
        "utf8",
      );
      assert.ok(
        diagramSrc.includes("containerInstances = new Map<HTMLElement, ContainerDiagramInstance>()"),
        "packages/diagram/src/index.ts must maintain a per-container Map<HTMLElement, ContainerDiagramInstance> instead of a global singleton",
      );
    });

    it("assigns unique LSP document URIs per Morsel instance and allows diagram-only edits", () => {
      const morselSrc = fs.readFileSync(
        path.resolve(import.meta.dirname, "../src/components/morsel/Morsel.tsx"),
        "utf8",
      );
      assert.ok(
        morselSrc.includes("file:///embed_${nextEmbedMorselId++}_document"),
        "Morsel must assign a unique per-instance LSP URI to prevent cross-card AST collisions",
      );
      assert.ok(
        morselSrc.includes("applyLspTextEditsToString"),
        "Morsel must apply LSP text edits directly to source state when Monaco is unmounted",
      );
    });

    it("preserves data-* attributes and unclamps fullscreen SVG height in PolyglotArtifactViewer", () => {
      const polyglotSrc = fs.readFileSync(
        path.resolve(import.meta.dirname, "../src/components/artifacts/PolyglotArtifactViewer.tsx"),
        "utf8",
      );
      assert.ok(
        polyglotSrc.includes('"data-fmu"') &&
          polyglotSrc.includes('"data-line-index"') &&
          polyglotSrc.includes('"data-reqif-id"'),
        "sanitizeSvgMarkup must preserve data-* attributes for interactive SVG node selection",
      );
      assert.ok(
        polyglotSrc.includes("export const InteractiveSvgStage"),
        "PolyglotArtifactViewer must export reusable InteractiveSvgStage for pan/zoom SVG inspection",
      );
    });

    it("avoids duplicate title repetition in CardFooter for self-titled engineering viewers", () => {
      const footerSrc = fs.readFileSync(
        path.resolve(import.meta.dirname, "../src/components/artifacts/card/CardFooter.tsx"),
        "utf8",
      );
      assert.ok(
        footerSrc.includes("isUntitledMediaOr3dViewer"),
        "CardFooter must distinguish untitled media/3D viewers from self-titled engineering viewers",
      );
    });
  });
});
