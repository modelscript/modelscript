// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { diagramPreviewSvgCache, registerDiagramHandlers } from "../src/handlers/diagramHandler.js";
import { CURATED_PACKAGE_FALLBACKS } from "../src/vfs/curated-package-fallbacks.js";

describe("Headless Diagram Preview SVGs & Connected Curated Package Examples", () => {
  it("renders responsive, ID-scoped schematic SVGs for standard DiagramData and PSCAD cell graphs", async () => {
    diagramPreviewSvgCache.clear();

    const handlers = new Map<string, (params: any) => Promise<any>>();
    const mockContext: any = {
      connection: {
        onRequest: (method: string, fn: (params: any) => Promise<any>) => {
          handlers.set(method, fn);
        },
        console: {
          warn: () => {},
          error: () => {},
        },
      },
      workspaceManager: {
        getWorkspaceIndex: () => ({
          byName: new Map([["Modelica.Electrical.Analog.Examples.ChuaCircuit", [101]]]),
          symbols: new Map([
            [
              101,
              {
                id: 101,
                name: "ChuaCircuit",
                kind: "Class",
                resourceId: "modelica:/lib/Modelica 4.1.0/Electrical/Analog/Examples/ChuaCircuit.mo",
              },
            ],
          ]),
        }),
      },
      validationService: {
        lastIndexedText: new Map(),
      },
      documentManager: {
        documents: new Map(),
        documentTrees: new Map(),
      },
      diagramService: {
        handleGetDiagramData: async (params: { uri: string; className?: string; documentText?: string }) => {
          if (params.className === "Modelica.Electrical.Analog.Examples.ChuaCircuit") {
            return {
              nodes: [
                {
                  id: "L1",
                  label: "L1",
                  x: 40,
                  y: 60,
                  width: 48,
                  height: 28,
                  ports: [{ id: "p", x: 48, y: 14 }],
                },
                {
                  id: "C1",
                  label: "C1",
                  x: 150,
                  y: 60,
                  width: 48,
                  height: 28,
                  ports: [{ id: "n", x: 0, y: 14 }],
                },
                {
                  id: "solder_dot_1",
                  label: "",
                  x: 110,
                  y: 74,
                  width: 4,
                  height: 4,
                },
              ],
              edges: [
                {
                  id: "e1",
                  source: { cell: "L1", port: "p" },
                  target: { cell: "C1", port: "n" },
                  stroke: "#38bdf8",
                },
              ],
            };
          }

          if (params.uri.endsWith(".pscx")) {
            return {
              cells: [
                {
                  id: "gen1",
                  shape: "rect",
                  position: { x: 20, y: 40 },
                  size: { width: 52, height: 32 },
                  attrs: { label: { text: "SyncGen" } },
                },
                {
                  id: "xfmr1",
                  shape: "rect",
                  position: { x: 130, y: 40 },
                  size: { width: 52, height: 32 },
                  attrs: { label: { text: "StepUp" } },
                },
                {
                  id: "bus_wire",
                  shape: "edge",
                  source: { cell: "gen1" },
                  target: { cell: "xfmr1" },
                },
              ],
            };
          }

          // Equation-only model with zero visual nodes
          return { nodes: [], edges: [] };
        },
        getDiagramDispatch: () => ({}),
      },
    };

    registerDiagramHandlers(mockContext);
    const handler = handlers.get("modelscript/getDiagramPreviewSvgs");
    assert.ok(handler, "Expected modelscript/getDiagramPreviewSvgs handler to be registered");

    const res = await handler({
      isDark: true,
      items: [
        { id: "chua", className: "Modelica.Electrical.Analog.Examples.ChuaCircuit" },
        { id: "pscad_feeder", uri: "file:///feeder.pscx", documentText: "<project/>" },
        { id: "eq_only", uri: "file:///pure_eq.mo", documentText: "model M Real x; equation x = 1; end M;" },
      ],
    });

    assert.ok(res.previews.chua, "Expected preview SVG for ChuaCircuit");
    assert.equal(res.previews.chua.nodeCount, 2, "Solder-dot pseudo-nodes must not inflate component nodeCount");
    assert.equal(res.previews.chua.edgeCount, 1);
    assert.ok(res.previews.chua.svg.includes('width="100%"'));
    assert.ok(res.previews.chua.svg.includes('preserveAspectRatio="xMidYMid meet"'));

    assert.ok(res.previews.pscad_feeder, "Expected preview SVG for PSCAD cell graph");
    assert.equal(res.previews.pscad_feeder.nodeCount, 2);
    assert.equal(res.previews.pscad_feeder.edgeCount, 1);

    // Ensure `<defs>` filter/marker IDs are scoped uniquely per SVG so multiple inline cards do not collide
    const chuaShadowMatch = res.previews.chua.svg.match(/id="(shadow-[^"]+)"/);
    const pscadShadowMatch = res.previews.pscad_feeder.svg.match(/id="(shadow-[^"]+)"/);
    assert.ok(chuaShadowMatch && pscadShadowMatch, "Expected scoped shadow filter IDs");
    assert.notEqual(chuaShadowMatch[1], pscadShadowMatch[1], "Scoped SVG filter IDs must be distinct across cards");

    // Equation-only models with 0 nodes are omitted so clients render clean equation blueprints
    assert.equal(res.previews.eq_only, undefined);
  });

  it("includes connected runnable Examples subpackages in PlanarMechanics, Buildings, and SPICE-Standard", () => {
    const buildingsMeta = CURATED_PACKAGE_FALLBACKS["Buildings"];
    assert.ok(buildingsMeta, "Expected curated fallback for Buildings");
    const buildingsPkg = Object.values(buildingsMeta.files).join("\n");
    assert.ok(buildingsPkg.includes("model HydronicHeatingLoop"));
    assert.ok(buildingsPkg.includes("Placement(transformation("));
    assert.ok(buildingsPkg.includes("connect(pump.port_b, valve.port_a)"));

    const planarMeta = CURATED_PACKAGE_FALLBACKS["PlanarMechanics"];
    assert.ok(planarMeta, "Expected curated fallback for PlanarMechanics");
    const planarPkg = Object.values(planarMeta.files).join("\n");
    assert.ok(planarPkg.includes("model DoublePendulum"));
    assert.ok(planarPkg.includes("Placement(transformation("));
    assert.ok(planarPkg.includes("connect(fixed.frame_b, rev1.frame_a)"));

    const spiceMeta = CURATED_PACKAGE_FALLBACKS["SPICE-Standard"];
    assert.ok(spiceMeta, "Expected curated fallback for SPICE-Standard");
    const spicePkg = Object.values(spiceMeta.files).join("\n");
    assert.ok(spicePkg.includes("model ActiveClampStage"));
    assert.ok(spicePkg.includes("Placement(transformation("));
    assert.ok(spicePkg.includes("connect(nmos1.d, clampDiode.p)"));
  });
});
